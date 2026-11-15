# Relief Pilot (test build)

A browser-only test tool: upload a design image, preview the carving relief,
approve it, and download STL, 16-bit heightmap, DXF line, and roughing/finishing
guides. All processing happens in the browser — nothing is uploaded to a server.

This test build uses brightness-based relief. The full build adds AI-depth mix,
accounts, and direct G-code export.

Honesty note: an STL file does not run directly on a CNC machine — a toolpath
must be made in JDPaint or Aspire first. A single photo carries no true depth,
so results are estimates: verify with a test cut.
