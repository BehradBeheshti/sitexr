# SiteXR — Immersive Construction Review

A purpose-built Meta Quest 3 WebXR experience for walking a captured excavation site at
true scale: inspect the tracked excavator, review ground and track condition, and check
site access and terrain. Built on the PlayCanvas engine and the open-source SuperSplat
viewer runtime, self-hosted as a static site over HTTPS.

Scene: “Muddy Excavator Site” by dok11, licensed CC BY 4.0 (see [Credits](#credits)).

## Linux development workflow

Requires Node.js 20+ (tested on Node 24). No Windows-only tools anywhere.

```sh
npm install        # install dependencies (viewer runtime, engine, Vite, asset tooling)
npm run dev        # local dev server on http://<your-ip>:5173 (HTTP, desktop walkthrough only)
npm run build      # production build → dist/
npm run preview    # serve dist/ locally on port 4173 to check the production bundle
npm run test       # build + headless Chrome smoke test (screenshots in test-output/)
```

Plain HTTP on the LAN is fine for desktop iteration, but WebXR requires a secure context:
the headset must load the site over HTTPS (see [Deployment](#deployment)). For quick
headset testing without deploying, `npm run dev:https` serves the dev server with a
self-signed certificate that the Quest Browser will ask you to accept once.

## Deployment (HTTPS)

The build is a static site: `dist/` can be dropped on any HTTPS host.

### GitHub Pages (live)

**https://behradbeheshti.github.io/sitexr/** — open it in the Meta Quest Browser and press
*Enter Site*.

`.github/workflows/deploy.yml` builds and publishes `dist/` on every push to `main`.
One-time setup in the repository: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. The site is then served at `https://<user>.github.io/<repo>/`. The
workflow passes `BASE_PATH=/<repo>/` so asset URLs resolve under the project path.

### Cloudflare Pages

Create a Pages project from the repository with build command `npm run build` and output
directory `dist`. No `BASE_PATH` is needed at the domain root. `public/_headers` sets cache
headers for the scene chunks.

### Any static host

```sh
npm run build          # or BASE_PATH=/some/prefix/ npm run build
rsync -a dist/ user@host:/var/www/sitexr/
```

## Controls

### Meta Quest 3 (Touch Plus controllers)

| Input | Action |
| --- | --- |
| Head / body movement | Room-scale tracking (`local-floor` reference space) |
| Left thumbstick | Walk in the direction you look; follows the terrain and stops at obstacles |
| Right thumbstick left/right | Snap turn (30° default, 45° or smooth in Comfort settings) |
| Trigger (hold, aim at the ground, release) | Teleport with a validated landing spot and a blink transition |
| Trigger / A while pointing at a marker or button | Select |
| B | Open / close the SiteXR menu |
| Y | Reset position (returns to the arrival point, facing the excavator) |
| X | Start / stop the guided tour |
| A or trigger during the tour (not pointing at UI) | Next tour stop |

The in-VR menu contains **Resume, Reset position, Guided tour, Comfort settings, About &
credits, Exit VR**. Comfort settings: turning mode, walk speed (1.1 / 1.6 / 2.4 m/s),
movement vignette, teleport on/off, quality (splat budget and render scale). Settings
persist on the device.

**Reset behaviour.** Reset places the visitor at the arrival point on the haul surface
(about 10 m in front of the excavator), rotates the world so they face the machine, and
puts the floor at the terrain height under the head. It is a blink (fade to black), never
a slide. The same logic runs automatically three frames after a VR session starts, so the
visitor never spawns inside the splat or above the ground.

### Desktop walkthrough (no headset)

| Input | Action |
| --- | --- |
| Drag | Look |
| Click the ground | Walk to that point |
| W A S D | Move |
| Click a numbered marker | Read the site note |
| R | Reset position |
| T | Start / stop the guided tour (N: next stop) |
| M | Settings |

## How locomotion works

The viewer's engine-level `XrNavigation` script provides thumbstick movement, snap/smooth
turning and the ballistic teleport arc. SiteXR extends it in `src/xr/rig.ts`:

- **Terrain following** — five downward rays from the head into the voxel collision data
  set the floor height every frame (spring-damped); a step higher than 0.55 m is treated
  as a wall and the move is rejected.
- **Walk capsule** — the visitor is pushed out of solid voxels horizontally, so they
  cannot walk through the excavator or off the edge of the scan (24 m radius).
- **Teleport validation** — the arc is cast through the voxel data; a landing spot must
  be walkable (surface normal ≥ 0.6), inside the site, carved as free space, and have
  1.6 m of headroom. Invalid targets show the red arc.
- **Blink transitions** — teleports, resets and tour travel fade to black, move, fade in.

## Asset pipeline (Linux, Node only)

`source-assets/` holds the downloaded CC BY scene (SOG `meta.json` + WebP textures, and
the voxel collision data). `public/scene/` holds what the app serves. To rebuild it:

```sh
npm run assets     # runs tools/build-scene.sh → public/scene/lod-meta.json + chunks
```

The script uses `@playcanvas/splat-transform` to:

1. Read the SOG, drop invalid Gaussians and reduce spherical harmonics to one band
   (cheaper per-splat shading on the headset).
2. Decimate to 40 %, 15 % and 5 % for LOD levels 1–3.
3. Bundle all four levels into a Streamed SOG (`lod-meta.json`) with 12 m chunks so the
   engine streams and swaps detail to fit the splat budget (0.7–1.8 M splats on Quest).

Controller models are copied from `@webxr-input-profiles/assets` by
`node tools/sync-controller-profiles.mjs` and served from `public/controllers/`.

## Project layout

```
index.html                  app shell (loading, welcome, credits, settings, desktop HUD)
src/main.ts                 bootstrap: XR detection, viewer creation, wiring
src/config.ts               scene URLs, spawn, points of interest, tour stops, credits
src/settings.ts             comfort/quality settings store (localStorage)
src/ui/screens.ts           DOM screens
src/xr/rig.ts               XR rig: locomotion, terrain following, teleport, fades, pointers
src/xr/panel.ts             canvas-textured VR surfaces + drawing helpers
src/xr/menu.ts              in-VR menu
src/xr/markers.ts           points of interest (VR + desktop)
src/xr/tour.ts              guided tour state machine
src/xr/tutorial.ts          first-time controller tutorial
src/vendor/supersplat-viewer  vendored viewer runtime (MIT; see VENDORED.md for the patches)
tools/                      asset pipeline, controller profile sync, smoke test
```

## Verification

`npm run test` builds and runs `tools/smoke-test.mjs` in headless Chrome: the scene loads
from the self-hosted build, no runtime console errors, no iframe, no SuperSplat/localhost
wording, no page scrollbar, the VR button only offers VR when `immersive-vr` is supported,
and the desktop walkthrough, tour and settings work at desktop, Quest-browser and phone
viewport sizes. Screenshots land in `test-output/`.

## Credits

- **Scene:** “Muddy Excavator Site” by dok11 — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/),
  source: https://superspl.at/scene/ded12920. Changes: converted to a multi-LOD streaming
  format, spherical harmonics reduced to one band, voxel collision data used for navigation.
- **Engine:** [PlayCanvas](https://playcanvas.com) (MIT).
- **Viewer runtime:** SuperSplat viewer (MIT), vendored under `src/vendor/supersplat-viewer`.
- **Controller models:** [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) (Apache-2.0).
