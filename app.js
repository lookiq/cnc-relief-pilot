/* Relief Pilot - test build.
   Fresh implementation: upload -> brightness relief -> preview -> approve -> download.
   All processing happens in the browser. Nothing is uploaded to a server.
   No AI-depth model in this build; brightness relief only, stated honestly in the UI. */
"use strict";

const $ = (s) => document.querySelector(s);
const PASSCODE = "pilot123";
const BED_W = 1300, BED_H = 2500; // standard flat bed, mm
const BASE_MM = 5;
const GRID_MAX = 448;

const state = {
  img: null,          // HTMLImageElement
  imgAspect: 0,
  height: null,       // Float32Array, normalized 0..1, row 0 = image top
  gw: 0, gh: 0,
  mode: "relief",
  approved: false,
};

/* ---------- Passcode gate ---------- */
const gate = $("#gate");
if (sessionStorage.getItem("relief-pilot-in") === "1") gate.hidden = true;
function tryGate() {
  if ($("#passcode").value.trim() === PASSCODE) {
    sessionStorage.setItem("relief-pilot-in", "1");
    gate.hidden = true;
  } else {
    $("#gateError").hidden = false;
  }
}
$("#gateBtn").addEventListener("click", tryGate);
$("#passcode").addEventListener("keydown", (e) => { if (e.key === "Enter") tryGate(); });

/* ---------- Controls ---------- */
const fileInput = $("#fileInput");
const dropzone = $("#dropzone");
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault(); dropzone.classList.remove("drag");
  if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", () => { if (fileInput.files.length) loadFile(fileInput.files[0]); });

document.querySelectorAll(".seg").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    $("#dlDxf").hidden = state.mode !== "dxf";
    recompute();
  });
});

document.querySelectorAll(".preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.custom) { $("#widthMm").focus(); return; }
    $("#widthMm").value = btn.dataset.w;
    $("#heightMm").value = btn.dataset.h;
    recompute();
  });
});

["widthMm", "heightMm"].forEach((id) => {
  $("#" + id).addEventListener("input", () => {
    document.querySelectorAll(".preset").forEach((b) => b.classList.remove("active"));
    document.querySelector('.preset[data-custom="1"]').classList.add("active");
    recompute();
  });
});

$("#depth").addEventListener("input", () => { $("#depthOut").textContent = $("#depth").value + " mm"; recompute(); });
$("#smoothing").addEventListener("input", () => { $("#smoothOut").textContent = $("#smoothing").value; recompute(); });
$("#invert").addEventListener("change", recompute);
$("#roughBit").addEventListener("change", recompute);
$("#finishBit").addEventListener("change", recompute);

/* ---------- Image loading ---------- */
function loadFile(file) {
  if (!file.type.startsWith("image/")) { alert("ছবি ফাইল দিন (JPG/PNG)।"); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    state.imgAspect = img.naturalWidth / img.naturalHeight;
    URL.revokeObjectURL(url);
    recompute();
  };
  img.onerror = () => alert("ছবিটি খোলা যায়নি। অন্য ছবি দিন।");
  img.src = url;
}

/* ---------- Relief computation ---------- */
function boxBlur(src, w, h, passes) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -1; x <= 1; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / 3;
        const xAdd = Math.min(w - 1, x + 2), xSub = Math.max(0, x - 1);
        acc += a[y * w + xAdd] - a[y * w + xSub];
      }
    }
    const out = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -1; y <= 1; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / 3;
        const yAdd = Math.min(h - 1, y + 2), ySub = Math.max(0, y - 1);
        acc += tmp[yAdd * w + x] - tmp[ySub * w + x];
      }
    }
    a = out;
  }
  return a;
}

function recompute() {
  resetApproval();
  if (!state.img) return;
  const aspect = state.imgAspect;
  let gw, gh;
  if (aspect >= 1) { gw = GRID_MAX; gh = Math.max(8, Math.round(GRID_MAX / aspect)); }
  else { gh = GRID_MAX; gw = Math.max(8, Math.round(GRID_MAX * aspect)); }
  const cv = document.createElement("canvas");
  cv.width = gw; cv.height = gh;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(state.img, 0, 0, gw, gh);
  const px = ctx.getImageData(0, 0, gw, gh).data;
  let g = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    g[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  }
  const passes = Math.round(parseFloat($("#smoothing").value) * 2);
  if (passes > 0) g = boxBlur(g, gw, gh, passes);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < g.length; i++) { if (g[i] < mn) mn = g[i]; if (g[i] > mx) mx = g[i]; }
  const inv = $("#invert").checked;
  const h = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) {
    let v = (g[i] - mn) / (mx - mn + 1e-9);
    h[i] = inv ? 1 - v : v;
  }
  state.height = h; state.gw = gw; state.gh = gh;
  renderPreviews();
  updateSpecs();
}

function renderPreviews() {
  const { gw, gh, height } = state;
  $("#emptyState").hidden = true;
  $("#previews").hidden = false;
  $("#specBlock").hidden = false;
  $("#qcBlock").hidden = false;

  // Heightmap canvas (keep panel aspect)
  const hc = $("#heightCanvas");
  hc.width = gw; hc.height = gh;
  const hctx = hc.getContext("2d");
  const imgData = hctx.createImageData(gw, gh);
  if (state.mode === "dxf") {
    for (let i = 0; i < gw * gh; i++) {
      const v = height[i] < 0.5 ? 0 : 255;
      imgData.data[i * 4] = v; imgData.data[i * 4 + 1] = v; imgData.data[i * 4 + 2] = v; imgData.data[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < gw * gh; i++) {
      const v = Math.round(height[i] * 255);
      imgData.data[i * 4] = v; imgData.data[i * 4 + 1] = v; imgData.data[i * 4 + 2] = v; imgData.data[i * 4 + 3] = 255;
    }
  }
  hctx.putImageData(imgData, 0, 0);

  // Shaded preview (hillshade, 3x exaggeration, labelled in UI)
  const sc = $("#shadeCanvas");
  sc.width = gw; sc.height = gh;
  const sctx = sc.getContext("2d");
  const sData = sctx.createImageData(gw, gh);
  const ex = 3;
  const lx = -0.7071, ly = -0.7071, lz = 0.7071; // light from upper-left
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const xm = height[y * gw + Math.max(0, x - 1)], xp = height[y * gw + Math.min(gw - 1, x + 1)];
      const ym = height[Math.max(0, y - 1) * gw + x], yp = height[Math.min(gh - 1, y + 1) * gw + x];
      const dzdx = (xp - xm) * ex, dzdy = (yp - ym) * ex;
      const inv = 1 / Math.hypot(dzdx, dzdy, 1);
      const nx = -dzdx * inv, ny = -dzdy * inv, nz = inv;
      let shade = nx * lx + ny * ly + nz * lz;
      shade = Math.max(0, Math.min(1, shade));
      const base = 0.25 + 0.75 * shade;
      const i = y * gw + x;
      sData.data[i * 4] = Math.round(196 * base + 30 * height[i]);
      sData.data[i * 4 + 1] = Math.round(140 * base + 18 * height[i]);
      sData.data[i * 4 + 2] = Math.round(96 * base + 8 * height[i]);
      sData.data[i * 4 + 3] = 255;
    }
  }
  sctx.putImageData(sData, 0, 0);
  sc.closest("figure").style.display = state.mode === "dxf" ? "none" : "";
}

function panelSize() {
  const w = Math.max(50, Math.min(4000, parseFloat($("#widthMm").value) || 900));
  const h = Math.max(50, Math.min(4000, parseFloat($("#heightMm").value) || 2100));
  return { w, h };
}

function updateSpecs() {
  const { w, h } = panelSize();
  const depth = parseFloat($("#depth").value);
  const rough = $("#roughBit").value, finish = $("#finishBit").value;
  $("#specSize").textContent = `${w} × ${h} mm`;
  $("#specDepth").textContent = `${depth} mm (বেস ${BASE_MM} mm, মোট ${BASE_MM + depth} mm)`;
  $("#specGrid").textContent = `${state.gw} × ${state.gh} - প্রতি সেল ${(w / state.gw).toFixed(1)} mm`;
  $("#specBits").textContent = `Roughing ${rough} mm ফ্ল্যাট · Finishing ${finish} mm বল নোজ`;

  const warns = [];
  // Aspect stretch
  const panelAspect = w / h;
  const diff = Math.abs(state.imgAspect - panelAspect) / panelAspect;
  if (diff > 0.02) {
    const suggestedH = Math.round(w / state.imgAspect);
    warns.push(`ছবির অনুপাত প্যানেলের সঙ্গে মিলছে না (${(diff * 100).toFixed(1)}% টান পড়বে)। ছবির অনুপাত ধরে রাখতে নিজের মাপে ${w} × ${suggestedH} mm ব্যবহার করুন।`);
  }
  // Bed fit (either rotation)
  const fits = (w <= BED_W && h <= BED_H) || (w <= BED_H && h <= BED_W);
  if (!fits) warns.push(`প্যানেলটি সাধারণ বেড ${BED_W}×${BED_H} mm-এর বাইরে - ঘুরিয়েও বসবে না। মাপ ছোট করুন বা বেডের মাপ নিশ্চিত করুন।`);
  // Depth limit vs finishing bit
  const fbit = parseFloat(finish);
  if (depth > 4 * fbit) warns.push(`গভীরতা ${depth} mm, ফিনিশিং বিট ${fbit} mm-এর 4 গুণ (${4 * fbit} mm) ছাড়িয়ে গেছে - বিট ভাঙার ঝুঁকি। গভীরতা কমান বা বড় বিট নিন।`);
  // Thin lines
  const thin = thinLineCheck(fbit, w);
  if (thin) warns.push(thin);

  const box = $("#warnings");
  box.innerHTML = "";
  if (!warns.length) {
    box.innerHTML = `<p class="warn ok">কোনো সতর্কতা নেই - মাপ, গভীরতা ও বিটের হিসাব ঠিক আছে।</p>`;
  } else {
    warns.forEach((t) => {
      const p = document.createElement("p");
      p.className = "warn";
      p.textContent = "সতর্কতা: " + t;
      box.appendChild(p);
    });
  }
}

function thinLineCheck(fbit, wMm) {
  const { gw, gh, height } = state;
  const cellMm = wMm / gw;
  let minRun = Infinity, thinCount = 0;
  for (let y = 0; y < gh; y += 3) {
    let run = 0;
    for (let x = 0; x < gw; x++) {
      if (height[y * gw + x] < 0.5) run++;
      else {
        if (run > 0) {
          const mm = run * cellMm;
          if (mm < minRun) minRun = mm;
          if (mm < fbit) thinCount++;
          run = 0;
        }
      }
    }
  }
  if (thinCount > 0) {
    return `প্রায় ${thinCount}টি সরু রেখা ${fbit} mm বিটের চেয়ে চিকন (সবচেয়ে চিকন ≈ ${minRun.toFixed(1)} mm) - এগুলো পরিষ্কার কাটবে না।`;
  }
  return null;
}

/* ---------- Approval gate ---------- */
function resetApproval() {
  state.approved = false;
  const btn = $("#approveBtn");
  btn.textContent = "প্রিভিউ অনুমোদন করলাম";
  btn.classList.remove("done");
  ["#dlStl", "#dlPng", "#dlDxf", "#dlRough", "#dlFinish"].forEach((id) => { $(id).disabled = true; });
}
$("#approveBtn").addEventListener("click", () => {
  if (!state.height) return;
  state.approved = true;
  const btn = $("#approveBtn");
  btn.textContent = "অনুমোদিত";
  btn.classList.add("done");
  const isDxf = state.mode === "dxf";
  $("#dlStl").disabled = isDxf;
  $("#dlPng").disabled = isDxf;
  $("#dlDxf").disabled = !isDxf;
  $("#dlRough").disabled = false;
  $("#dlFinish").disabled = false;
});

/* ---------- Downloads ---------- */
function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function stamp() {
  const { w, h } = panelSize();
  return `${w}x${h}mm`;
}
async function withWorking(fn) {
  $("#workingMsg").hidden = false;
  await new Promise((r) => setTimeout(r, 30));
  try { await fn(); } finally { $("#workingMsg").hidden = true; }
}

$("#dlStl").addEventListener("click", () => withWorking(async () => {
  const blob = await buildSTL();
  downloadBlob(blob, `relief-${stamp()}.stl`);
}));
$("#dlPng").addEventListener("click", () => withWorking(async () => {
  const blob = await buildPNG16();
  downloadBlob(blob, `heightmap-16bit-${stamp()}.png`);
}));
$("#dlDxf").addEventListener("click", () => withWorking(async () => {
  const blob = buildDXF();
  downloadBlob(blob, `lines-${stamp()}.dxf`);
}));
$("#dlRough").addEventListener("click", () => {
  downloadBlob(new Blob([guideText("roughing")], { type: "text/plain;charset=utf-8" }), `roughing-guide-${stamp()}.txt`);
});
$("#dlFinish").addEventListener("click", () => {
  downloadBlob(new Blob([guideText("finishing")], { type: "text/plain;charset=utf-8" }), `finishing-guide-${stamp()}.txt`);
});

/* ---------- STL (binary, watertight) ---------- */
async function buildSTL() {
  const { gw, gh, height } = state;
  const { w: W, h: H } = panelSize();
  const depth = parseFloat($("#depth").value);
  // Ztop indexed [i*gw+j], i = 0 at Y=0 (bottom); image row 0 is the top.
  const Z = new Float32Array(gw * gh);
  for (let r = 0; r < gh; r++) {
    const i = gh - 1 - r;
    for (let c = 0; c < gw; c++) Z[i * gw + c] = BASE_MM + height[r * gw + c] * depth;
  }
  const xs = new Float32Array(gw), ys = new Float32Array(gh);
  for (let j = 0; j < gw; j++) xs[j] = (j / (gw - 1)) * W;
  for (let i = 0; i < gh; i++) ys[i] = (i / (gh - 1)) * H;

  const nTop = 2 * (gw - 1) * (gh - 1);
  const nSide = 4 * (gw - 1) + 4 * (gh - 1);
  const nTri = 2 * nTop + nSide;
  const buf = new ArrayBuffer(84 + nTri * 50);
  const dv = new DataView(buf);
  const header = "Relief Pilot STL";
  for (let i = 0; i < header.length; i++) dv.setUint8(i, header.charCodeAt(i));
  dv.setUint32(80, nTri, true);

  let t = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const o = 84 + t * 50;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
    dv.setFloat32(o + 24, bx, true); dv.setFloat32(o + 28, by, true); dv.setFloat32(o + 32, bz, true);
    dv.setFloat32(o + 36, cx, true); dv.setFloat32(o + 40, cy, true); dv.setFloat32(o + 44, cz, true);
    dv.setUint16(o + 48, 0, true);
    t++;
  };

  for (let i = 0; i < gh - 1; i++) {
    for (let j = 0; j < gw - 1; j++) {
      const x0 = xs[j], x1 = xs[j + 1], y0 = ys[i], y1 = ys[i + 1];
      const z00 = Z[i * gw + j], z10 = Z[i * gw + j + 1], z01 = Z[(i + 1) * gw + j], z11 = Z[(i + 1) * gw + j + 1];
      tri(x0, y0, z00, x1, y0, z10, x0, y1, z01);
      tri(x1, y0, z10, x1, y1, z11, x0, y1, z01);
      tri(x0, y0, 0, x0, y1, 0, x1, y0, 0);
      tri(x1, y0, 0, x0, y1, 0, x1, y1, 0);
    }
    if (i % 64 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  for (let j = 0; j < gw - 1; j++) {
    tri(xs[j], 0, 0, xs[j + 1], 0, 0, xs[j + 1], 0, Z[j + 1]);
    tri(xs[j], 0, 0, xs[j + 1], 0, Z[j + 1], xs[j], 0, Z[j]);
    tri(xs[j], H, 0, xs[j], H, Z[(gh - 1) * gw + j], xs[j + 1], H, Z[(gh - 1) * gw + j + 1]);
    tri(xs[j], H, 0, xs[j + 1], H, Z[(gh - 1) * gw + j + 1], xs[j + 1], H, 0);
  }
  for (let i = 0; i < gh - 1; i++) {
    tri(0, ys[i], 0, 0, ys[i], Z[i * gw], 0, ys[i + 1], Z[(i + 1) * gw]);
    tri(0, ys[i], 0, 0, ys[i + 1], Z[(i + 1) * gw], 0, ys[i + 1], 0);
    tri(W, ys[i], 0, W, ys[i + 1], 0, W, ys[i + 1], Z[(i + 1) * gw + gw - 1]);
    tri(W, ys[i], 0, W, ys[i + 1], Z[(i + 1) * gw + gw - 1], W, ys[i], Z[i * gw + gw - 1]);
  }
  return new Blob([buf], { type: "application/octet-stream" });
}

/* ---------- 16-bit grayscale PNG ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcBytes = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) crcBytes[i] = type.charCodeAt(i);
  crcBytes.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcBytes));
  return out;
}
async function buildPNG16() {
  const { gw, gh, height } = state;
  if (!window.CompressionStream) {
    // Fallback: 8-bit from the heightmap canvas
    return new Promise((res) => $("#heightCanvas").toBlob(res, "image/png"));
  }
  const raw = new Uint8Array(gh * (1 + gw * 2));
  for (let y = 0; y < gh; y++) {
    raw[y * (1 + gw * 2)] = 0;
    for (let x = 0; x < gw; x++) {
      const v = Math.round(height[y * gw + x] * 65535);
      const o = y * (1 + gw * 2) + 1 + x * 2;
      raw[o] = (v >> 8) & 0xff; raw[o + 1] = v & 0xff;
    }
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"));
  const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, gw); dv.setUint32(4, gh);
  ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return new Blob([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", deflated), pngChunk("IEND", new Uint8Array(0))], { type: "image/png" });
}

/* ---------- DXF R12 (row-run line segments, layer CUT) ---------- */
function buildDXF() {
  const { gw, gh, height } = state;
  const { w: W, h: H } = panelSize();
  const cellW = W / gw, cellH = H / gh;
  let step = 2, lines = [];
  for (let attempt = 0; attempt < 4; attempt++) {
    lines = [];
    for (let y = 0; y < gh; y += step) {
      let runStart = -1;
      for (let x = 0; x <= gw; x++) {
        const dark = x < gw && height[y * gw + x] < 0.5;
        if (dark && runStart < 0) runStart = x;
        if (!dark && runStart >= 0) {
          if (x - runStart >= 2) lines.push([runStart, x - 1, y]);
          runStart = -1;
        }
      }
    }
    if (lines.length <= 150000) break;
    step *= 2;
  }
  const f = (n) => n.toFixed(3);
  const parts = [
    "  0", "SECTION", "  2", "HEADER", "  0", "ENDSEC",
    "  0", "SECTION", "  2", "TABLES",
    "  0", "TABLE", "  2", "LAYER",
    "  0", "LAYER", "  2", "CUT", " 70", "     0", " 62", "     7", "  6", "Continuous",
    "  0", "ENDTAB", "  0", "ENDSEC",
    "  0", "SECTION", "  2", "ENTITIES",
  ];
  for (const [x0, x1, y] of lines) {
    const yy = (gh / 2 - (y + 0.5)) * cellH;
    parts.push(
      "  0", "LINE", "  8", "CUT",
      " 10", f((x0 + 0.5 - gw / 2) * cellW), " 20", f(yy), " 30", "0.000",
      " 11", f((x1 + 0.5 - gw / 2) * cellW), " 21", f(yy), " 31", "0.000"
    );
  }
  parts.push("  0", "ENDSEC", "  0", "EOF", "");
  return new Blob([parts.join("\n")], { type: "application/dxf" });
}

/* ---------- Roughing / finishing guides ---------- */
function guideText(kind) {
  const { w, h } = panelSize();
  const depth = parseFloat($("#depth").value);
  const rough = $("#roughBit").value, finish = $("#finishBit").value;
  const passes = Math.max(1, Math.ceil(depth / 4));
  const head = kind === "roughing"
    ? `ROUGHING GUIDE - Panel ${w} x ${h} mm\nBit: ${rough} mm flat end mill\n`
    : `FINISHING GUIDE - Panel ${w} x ${h} mm\nBit: ${finish} mm ball nose\n`;
  const body = kind === "roughing"
    ? `1. Clamp the board flat. Set Z zero on the board surface.\n2. Rough in ${passes} pass(es), about ${(depth / passes).toFixed(1)} mm per pass, leaving 0.5 mm for finishing.\n3. Stepover: about 40-50% of bit diameter.\n4. After roughing, STOP and change to the finishing bit, then re-zero Z before finishing.\n`
    : `1. Re-zero Z after the bit change. Do not move X/Y zero.\n2. Finishing depth: total ${depth} mm (base ${BASE_MM} mm + relief ${depth} mm).\n3. Stepover: 8-12% of bit diameter for a smooth finish.\n4. Sand lightly after the cut; check thin details before full production.\n`;
  return head + body + `\nNOTE: These are starting values. The machine operator must verify feeds, speeds and stepdown for the actual timber and machine before cutting.\n`;
}
