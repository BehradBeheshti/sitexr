# Vendored: @playcanvas/supersplat-viewer

Source: https://github.com/playcanvas/supersplat-viewer (MIT, see LICENSE)
Pinned commit: see version.json. This is the `src/` tree of the upstream repo, used
directly because the `/viewer` embedding entry point is not yet in the published npm
package (1.31.2 only ships the standalone document).

Local modifications (kept deliberately small; search for `SITEXR` to find them):

1. `index.ts` — html/json imports adapted to Vite (`?raw`, local `version.json`),
   and the `ViewerHandle` gains an `internals` field exposing the camera entity and
   the collision promise so SiteXR's XR locomotion can query the terrain.
2. `ui.ts` — version import path.
3. `xr.ts` — the engine `XrNavigation` teleport/locomotion script is no longer
   attached here; SiteXR attaches and configures it itself (see `src/xr/`), so the
   session start handler is also told the real floor height instead of assuming y=0.
