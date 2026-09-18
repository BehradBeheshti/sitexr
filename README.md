# SiteXR — Immersive Construction Review

A purpose-built Meta Quest 3 WebXR experience for walking captured construction sites at
true scale. Built on the PlayCanvas engine and the open-source SuperSplat viewer runtime,
self-hosted as a static site over HTTPS.

Three sites ship with the app, each with its own points of interest and guided tour:

| Site | What it is | Scale |
| --- | --- | --- |
| **Muddy Excavator Site** | Earthworks with a tracked excavator on saturated, rutted ground | 1.0 m/unit |
| **Heavy Plant Yard** | A 290-tonne mining haul truck and a PC4000 hydraulic shovel, at full size | 3.6 m/unit |
| **Formwork & Scaffold Floor** | A floor under construction between slab-formwork shoring towers | 0.75 m/unit |

All three scenes are Gaussian splat captures licensed CC BY 4.0 (see [Credits](#credits)).

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
credits, Switch site, Exit VR**. Switching sites leaves VR and returns to the site picker,
since a new scene has to stream in. Comfort settings: turning mode, walk speed (1.1 / 1.6 / 2.4 m/s),
movement vignette, teleport on/off, quality (splat budget and render scale). Settings
persist on the device.

**Reset behaviour.** Reset places the visitor at that site's arrival point, rotates the
world so they face the subject, and puts the floor at the terrain height under the head. It is a blink (fade to black), never
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

- **Terrain following** — five downward rays from the head into the site's collision data
  set the floor height every frame (spring-damped); a step higher than 0.55 m is treated
  as a wall and the move is rejected.
- **Walk capsule** — the visitor is pushed out of solid space horizontally, so they cannot
  walk through a machine or off the edge of the scan.
- **Teleport validation** — the arc is cast through the collision data; a landing spot must
  be walkable, inside the site, and have 1.6 m of headroom. Invalid targets show a red arc.
- **Blink transitions** — teleports, resets and tour travel fade to black, move, fade in.

### Two kinds of collision data

The excavator site ships the voxel octree published with the scene, read by the viewer's
own `VoxelCollision`. The other two sites have no published voxel data, so SiteXR derives a
**navigation grid** from the splats instead (`tools/build-navgrid.py` → `public/nav/*.json`
+ `.bin`): per cell a floor height, a ceiling height and a walkable flag, flood-filled from
a seed and eroded by a keep-out margin. `src/xr/grid-collision.ts` implements the same
`Collision` interface over that grid, so walk mode, spawn search, the capsule and the
teleport arc work identically on either kind of site.

Each site declares `worldScale`, the metres-per-scene-unit factor applied to the splat and
the collision data. It was measured from the capture itself: for the plant yard, two
machines of known type measure 2.0 and 2.2 units tall, giving 3.6 m/unit; for the formwork
floor, the 5.7-unit deck-to-soffit distance and the 3.1-unit shoring grid give 0.75 m/unit.

## Asset pipeline (Linux, Node only)

`source-assets/` holds the downloaded scenes; `public/scene*/` holds what the app serves.

```sh
# 1. fetch a published scene (only where the author enabled downloads under CC BY)
node tools/fetch-scene.mjs 892bab3d source-assets/komatsu

# 2. re-encode it for the headset
tools/build-scene.sh excavator      # full SOG  -> 4-level streamed SOG + voxel collision
tools/build-scene.sh komatsu        # streamed SOG -> lighter 3-level cut
tools/build-scene.sh scaffold

# 3. build the navigation grid for a site without published voxel data
#    (needs a CSV export of one detail level, produced with splat-transform)
npx splat-transform source-assets/komatsu/lod-meta.json -L 2 /tmp/komatsu.csv
python3 tools/build-navgrid.py /tmp/komatsu.csv public/nav/komatsu \
    --scale 3.6 --cell 0.1 --step 0.35 --margin 0.45 --box=-10,-10,10,10 --seed=1.5,3.5
```

`build-navgrid.py` prints an ASCII map of the walkable region, which is how the spawn,
marker and tour coordinates in `src/config.ts` were chosen. `--floor-band lo,hi` pins the
floor to a flat slab, which the formwork site needs because the deck is mostly hidden
behind shoring.

`npm run assets` runs step 2 for the excavator site. Controller models are copied from
`@webxr-input-profiles/assets` by `node tools/sync-controller-profiles.mjs`.

### Reviewing a site's viewpoints

`node tools/survey.mjs <siteId>` renders the site from its spawn, every point of interest
and every tour stop, plus a top-down map, into `test-output/survey/<siteId>/`. Add
`--views "name:x,z,lookX,lookY,lookZ;..."` to try candidate viewpoints before committing
them to `src/config.ts`.

### Recording a walkthrough video

`node tools/record-demo.mjs <siteId>` renders a first-person walkthrough as an MP4, framed
the way the headset view looks: 100° field of view, eye-height camera, walking head bob,
blink transitions between shots and the in-VR panels (markers, note cards, the menu). The
shot list for each site lives at the top of the script. It runs headless, so it needs
neither a headset nor a working GPU — but on a software renderer each frame costs about a
second and a half, so a 24-second clip takes roughly 15 minutes. Output goes to `media/`,
frames to `test-output/frames/<siteId>/`.

```sh
node tools/record-demo.mjs komatsu --fps 24 --width 1280 --height 720
```

## Project layout

```
index.html                  app shell (loading, welcome, credits, settings, desktop HUD)
src/main.ts                 bootstrap: XR detection, viewer creation, wiring
src/config.ts               the site catalogue: scene urls, scale, spawn, points of
                            interest, tour stops and credits, one entry per site
src/settings.ts             comfort/quality settings store (localStorage)
src/ui/screens.ts           DOM screens
src/xr/rig.ts               XR rig: locomotion, terrain following, teleport, fades, pointers
src/xr/grid-collision.ts    navigation-grid collision for sites without voxel data
src/xr/panel.ts             canvas-textured VR surfaces + drawing helpers
src/xr/menu.ts              in-VR menu
src/xr/markers.ts           points of interest (VR + desktop)
src/xr/tour.ts              guided tour state machine
src/xr/tutorial.ts          first-time controller tutorial
src/vendor/supersplat-viewer  vendored viewer runtime (MIT; see VENDORED.md for the patches)
tools/                      asset pipeline, navigation grids, viewpoint survey, video
                            recorder, smoke test
```

## Verification

`npm run test` builds and runs `tools/smoke-test.mjs` in headless Chrome: the scene loads
from the self-hosted build, no runtime console errors, no iframe, no SuperSplat/localhost
wording, no page scrollbar, the VR button only offers VR when `immersive-vr` is supported,
the desktop walkthrough, tour and settings work at desktop, Quest-browser and phone
viewport sizes, and every site in the picker loads and enters its walkthrough. Screenshots land in `test-output/`.

## Credits

- **Scenes**, each [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):
  - “Muddy Excavator Site” by dok11 — https://superspl.at/scene/ded12920
  - “こまつの杜 (Komatsu no Mori)” by gnehs — https://superspl.at/scene/892bab3d
  - “Construction next day” by redmancg — https://superspl.at/scene/73d39431

  Changes in all three: re-encoded as multi-level-of-detail streaming data with spherical
  harmonics reduced to one band, rescaled to metres, and navigation data derived for
  walking. Each site's own credits screen names its author and licence in the app.
- **Engine:** [PlayCanvas](https://playcanvas.com) (MIT).
- **Viewer runtime:** SuperSplat viewer (MIT), vendored under `src/vendor/supersplat-viewer`.
- **Controller models:** [WebXR Input Profiles](https://github.com/immersive-web/webxr-input-profiles) (Apache-2.0).
