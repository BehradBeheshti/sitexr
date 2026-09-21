# SiteXR — Immersive Construction Review

A purpose-built Meta Quest 3 WebXR experience for walking captured construction sites at
true scale. Built on the PlayCanvas engine and the open-source SuperSplat viewer runtime,
self-hosted as a static site over HTTPS.

Four sites ship with the app, each with its own points of interest and guided tour. A
link can name one directly (`?site=komatsu`), and the url tracks whatever is on screen.

Three sites, each with its own points of interest and guided tour:

| Site | What it is | Scale |
| --- | --- | --- |
| **Muddy Excavator Site** | Earthworks with a tracked excavator on saturated, rutted ground | 1.0 m/unit |
| **Heavy Plant Yard** | A 290-tonne mining haul truck and a PC4000 hydraulic shovel, at full size | 3.6 m/unit |
| **Formwork & Scaffold Floor** | A floor under construction between slab-formwork shoring towers | 0.75 m/unit |

All three are Gaussian splat captures licensed CC BY 4.0 (see [Credits](#credits)).

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
| Left thumbstick | Walk. Towards where you look by default, or where the left hand points if you change *Walk towards* in Comfort settings. Follows the terrain and stops at obstacles |
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

## Bringing in a design model

A site can be a mesh model instead of a splat. Three input formats convert on Linux, none
of them needing the authoring application:

| From | With | Notes |
| --- | --- | --- |
| **IFC** | `tools/ifc-to-glb.py` (IfcOpenShell) | the best input: keeps structure and material colours |
| **FBX** | `tools/fbx-to-glb.py` (assimp) | what Revit exports directly |
| **SketchUp** | `tools/skp-to-glb.py` (OpenSKP) | no Trimble SDK needed; writes millimetres |

Every route then goes through the same second step, which is not optional:

```sh
node tools/optimize-glb.mjs /tmp/model.glb public/bim/model.glb \
    --scale 0.0254 --double-sided --ground 4
```

- **`--scale`** converts to metres. Revit FBX exports are usually in inches (0.0254),
  SketchUp in millimetres (0.001). Check against something you know: a 55 inch desk.
- **Baking node transforms** happens always. IFC and FBX both express their up-axis as a
  rotation per node, and the collision code reads vertex buffers without walking the node
  graph — an unbaked model collides in a different orientation from the one you see.
- **`--double-sided`** because architectural exports are single-sided with faces pointing
  outward. Seen from inside, which is the whole point, those walls vanish.
- **`--ground`** adds a floor plane at the model's base. A design model has no site, so
  without one a visitor who steps off the slab falls forever.

Then add a site to `src/config.ts` with `model: { url }` and `collision: { type: 'mesh' }`.
The mesh is its own collision surface: walls stop you, floors carry you, the teleport arc
lands on them. `src/xr/model-collision.ts` reads the triangles off the instantiated entity
rather than downloading the glb twice — the engine caches by url, so a second asset's
unload would destroy the geometry the first is drawing.

### A warning about FBX converters

Revit FBX exports carry their up-axis and unit scale on the nodes, and instanced furniture
shares one mesh between many nodes. Get either wrong and you still get a model — just not
the right one. Facebook's FBX2glTF, the obvious tool, warns about `eInheritRrSs` transform
inheritance on Revit files and then produces geometry whose walls collapse to fragments:
an 8 × 8 m room reduced to 9 m² of total surface, which looks like furniture floating in
space. assimp reads the same file correctly. If a converted model looks sparse, measure its
surface area before believing it.

### `.rvt`

A Revit file opens fine on Linux but no mesh comes out of it directly, and the reason is
worth knowing. `.rvt` is an OLE compound document whose `Partitions/*` streams are runs of
gzip members; those decompress (43.6 MB of element records for the office building here),
and they hold family names, unit strings and double-precision control points in feet. What
they do not hold is triangles. Revit stores a *parametric* model, and the mesh exists only
once its geometry kernel regenerates it. Reading the file is not the hard part.

Four routes give you that kernel's output. The first is the best input this project takes:

1. **File → Export → IFC** in Revit. Needs Revit, gives the cleanest result.
2. **DataDrivenConstruction's RVT2IFC converter**, which packages an ODA runtime and runs
   locally on Linux with no upload. This is how `Office Building.ifc` was produced.
3. **ODA BimRv SDK**, the same engine under a commercial licence.
4. **Autodesk Platform Services**, via `tools/aps-convert.mjs`:

```sh
# free account at https://aps.autodesk.com/ -> create an app -> Model Derivative API
APS_CLIENT_ID=... APS_CLIENT_SECRET=... \
    node tools/aps-convert.mjs "Office Building.rvt" out/office
python3 tools/fbx-to-glb.py out/office.obj out/office-raw.glb   # assimp reads OBJ too
node tools/optimize-glb.mjs out/office-raw.glb public/private/office.glb \
    --scale 0.3048 --double-sided
```

That last one uploads the model to Autodesk. Check the licence before running it.

### Coplanar surfaces, and the striping they cause

An IFC gives a slab, its floor finish and the site pad the same surface height. Two coplanar
faces fight for depth at any precision, and the floor stripes as you move. Raising the near
plane helps and is worth doing — the viewer now floors the depth ratio at 1:2048 rather than
1:16384 — but it does not fix true coincidence. Convert the offenders separately and merge
them at an offset:

```sh
python3 tools/ifc-to-glb.py model.ifc /tmp/struct.glb \
    --exclude IfcSpace,IfcOpeningElement,IfcCovering,IfcSite
python3 tools/ifc-to-glb.py model.ifc /tmp/cover.glb --include IfcCovering
python3 tools/ifc-to-glb.py model.ifc /tmp/site.glb  --include IfcSite

node tools/optimize-glb.mjs /tmp/struct.glb public/private/office-building.glb \
    --merge /tmp/cover.glb@0.006 --merge /tmp/site.glb@-0.05 --double-sided
```

Finishes 6 mm proud of the slab, site pad 50 mm below it. Both are invisible and both stop
the flicker.

### Doors that open

A Revit door arrives as one element holding a frame and a panel, and only the panel should
swing. `tools/ifc-doors.py` splits them on a test the door itself supplies: within its
triangulated shape, the sub-mesh whose width and height match the door's own `OverallWidth`
and `OverallHeight` is the panel. Which edge hinges comes from `OperationType`
(`SINGLE_SWING_RIGHT` and friends); `DOUBLE_*` is split into two leaves at the centre line,
and `SWING_FIXED_*` keeps one leaf fixed. Which way it swings is read off the geometry: the
panel sits off-centre in its frame, and it opens toward whichever side has the room.

```sh
python3 tools/ifc-doors.py model.ifc public/private/doors.json
```

Each leaf is written in its own hinge frame, so opening one is a rotation about a single
entity's local Y with no matrix work per frame. Point at a leaf and pull the trigger, or
click it on the desktop. Leaning on a shut one for a third of a second opens it too, so a
visitor cannot be walled in by a door they could have opened.

The building's glb must then be built **without** `IfcDoor`, because the doors come from the
json instead. That also leaves the static collision mesh with open holes at every doorway,
which is the point: a shut leaf puts its own box back through `rig.doors`, and an open one
takes it away. Without that split a door could only ever be scenery.

### A design model has no lighting

A splat carries the light it was captured in; a mesh model carries none. A single sun leaves
every surface facing away from it at flat ambient, which reads as murk indoors. A site with
`model` and no `contentUrl` turns on `interiorLighting`, which raises ambient and adds two
unshadowed fills. No shadow maps: not worth the draw cost on a Quest.

### Multi-storey models

`spawn.floor`, and the optional `floor` on a point of interest or a tour stop, name the
storey to stand on. Without one the downward ray starts above everything and a two-storey
model answers with its roof, which is then where the visitor is standing.

### Keeping a licensed model out of a public repository

Git history is permanent: a file deleted in a later commit is still in every clone. Set
`VITE_ASSET_BASE` at build time to serve scene assets from somewhere else, so the model
never enters the repository at all:

```sh
VITE_ASSET_BASE=https://assets.example.com/sitexr npm run build
```

`public/private/` is the other half of this and needs no host at all. It is in `.gitignore`,
a pre-commit hook refuses it, and `vite.config.js` deletes `dist/private` after every build
unless you ask for it. A site whose model lives there is offered while developing and in a
build that opts in, and is left out of the public one entirely, so the site list never shows
something the server does not have:

```sh
npm run dev:https                      # the model is there; test it on the headset
VITE_INCLUDE_PRIVATE=1 npm run build   # a build that carries it, for a private host
```

To serve a model from the public site without putting it in the repository, attach it to a
release. Release assets are not part of the repository or its history, so they are absent
from every clone, and unlike a commit they can be deleted:

```sh
gh release create model-assets \
    public/private/office-building.glb public/private/poster-office.webp \
    --title "Model assets (served by the site, not stored in git)" \
    --notes "Fetched by the deploy workflow. Delete this release to take them down."
```

The deploy workflow downloads that release into `public/private/` and sets
`VITE_INCLUDE_PRIVATE=1` for the build. A missing release is not an error: the build leaves
those sites out, so the site list never offers something the server does not have. Note the
trade this makes. The file stays out of git, but anyone who opens the page downloads it into
their own browser, because that is how the model gets drawn. If the model must not reach the
public at all, the page showing it has to sit behind a login.

Only the splat, collision and model urls are redirected; the app's own images stay local,
and the bucket must allow cross-origin reads. `public/private/` and the model formats are
gitignored, and `bash tools/install-hooks.sh` adds a pre-commit hook that refuses to commit
them by accident.

## Moving between sites

Three ways in, and they are meant to feel like one thing.

| Where | How |
| --- | --- |
| A link | `?site=<id>` opens that site; `?mode=capture` or `?mode=design` opens that side's first |
| Desktop | **Change site** in the heads-up display lists every site at once, both experiences |
| In the headset | **B → Switch site** lists every site on a panel; point and pull the trigger |

The two experience cards on the way in are a deliberate split, because a scan and a design
model are for different people. Once someone is already inside, that framing only puts the
scene they want an extra click away, so both switchers ignore it and show the lot.

Loading a site tears the viewer down, and the XR session goes with it, so a switch made in
the headset has to come back out for a moment. It fades, leaves VR, loads, and then calls
`navigator.xr.offerSession`, which exists for this: the headset resumes when the wearer is
ready, with no DOM click, which they cannot give while wearing it. Where that call is not
available the welcome screen is already up with its Enter button, so the fallback is one
press rather than four.

## Capturing images for figures

`tools/capture-figures.mjs` renders a large still set from the built site: for every site the
arrival point, seven angles swept around it, each point of interest, each tour stop and two
plan views, each written twice — once as a visitor sees it, once with the interface and the
markers removed, which is what a figure usually wants. Interface screens are captured too.

```sh
VITE_INCLUDE_PRIVATE=1 npm run build
node tools/capture-figures.mjs                       # 1920x1080 into test-output/figures
node tools/capture-figures.mjs --width 3840 --height 2160 --settle 2600
```

`--settle` is how long each camera is given before the shutter. Splats converge progressively,
so a low value on a heavy scene shows a half-sorted frame. 1800 ms is enough for these four.

`tools/contact-sheet.py` turns any folder of images into one labelled sheet, which is much
faster to pick from than a file browser:

```sh
python3 tools/contact-sheet.py test-output/figures/01-sites/office/clean sheet.jpg \
    --cols 5 --title "Office building"
```

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
                            recorder, desktop smoke test, emulated-VR session test,
                            IFC to glTF conversion (unused: no site ships a mesh model)
```

## First run on a Quest 3

1. Put the headset on and open **https://behradbeheshti.github.io/sitexr/** in the Meta
   Quest Browser. Nothing to install, no sideloading, no developer mode.
2. Pick a site, wait for *Site ready*, and press **Enter Site**. The
   headset asks once for permission to enter immersive mode; accept it.
3. A five-step controller tutorial runs the first time. Each step completes when you
   actually perform the input, so it doubles as a controller check. *Skip tutorial* is
   there if you have done it before.
4. Then: left stick to walk, right stick to turn, trigger to teleport, **B** for the menu,
   **Y** to reset, **X** for the guided tour. Point at a numbered marker and pull the
   trigger to read its note.

If something feels wrong, the menu's *Comfort settings* has turning mode, walk speed, the
movement vignette, teleport on/off and three quality tiers. Quality *Low* is the safest if
the frame rate drops.

### Holding the frame rate

WebXR forces the WebGL path, where splats are depth-sorted **on the CPU every frame, for
both eyes, inside 13.9 ms**. That makes the splat budget the thing that decides whether a
headset holds 72 Hz, and it is why the headset budgets in `src/settings.ts` are a fraction
of the desktop ones.

Three mechanisms keep it smooth:

- **A performance governor** (`src/xr/performance.ts`) measures frame time and lowers the
  splat budget whenever frames run long, then gives the detail back when there is headroom.
  It never exceeds the tier chosen in Comfort settings, and it enters a session below that
  ceiling rather than at it, so the first seconds are not the worst ones.
- **Fixed foveation** drops resolution at the edge of the lens, away from where the eye is
  pointed, and is raised further while the governor is limiting detail.
- **A wider colour-update angle** in XR. Outside a headset the viewer rebuilds the splat
  work buffer after a fifth of a degree of camera rotation; in a headset the head never
  stops moving, so that rebuild becomes a constant spike. This is usually what "unstable"
  turns out to be, as distinct from a low average frame rate.

The framebuffer scale is the one knob that cannot be changed mid-session: WebXR only
allows it to be chosen when the session starts, so it comes from the quality tier.

Detail is also **concentrated near the camera** in VR (`lodFalloff`). Walking a site means
the near field is what you are actually looking at, so a limited budget is better spent
there than spread evenly over ground you are nowhere near. It is the change that buys the
most apparent sharpness per frame.

A headset starts on *Balanced*. The governor trims from there if the device cannot hold it,
which is a better trade than starting soft and looking it.

Two url flags help when judging this on a real headset:

| Flag | Effect |
| --- | --- |
| `?fps` | frame-rate readout in the headset: current rate, lowest seen, the budget in force with an arrow when the governor is limiting, and the foveation level |
| `?nogov` | pins the budget to the chosen tier, so quality can be judged without the governor trimming it | The Quest renders both eyes at 72 Hz,
so anything sitting below about 68 is worth reporting. Changing quality resets the low
reading, which makes the three tiers easy to compare.

## Verification

Two suites, both headless, both runnable without a headset:

```sh
npm run test        # build + desktop suite
npm run test:vr     # one emulated VR session (add a site id)
npm run test:all    # build + desktop suite + a VR session on every site
```

### Emulated VR

`tools/xr-test.mjs` runs a complete immersive session against a synthetic Meta Quest 3,
using the [IWER](https://github.com/meta-quest/immersive-web-emulation-runtime) runtime
injected before the app loads. It is what exercises the code a headset would run: session
start, spawn placement, terrain following, thumbstick walking, snap and smooth turning,
the teleport arc and its landing validation, controller rays hitting the in-VR panels, the
tutorial, the menu, reset, the guided tour, marker cards, room-scale head movement and
exit. Twenty-six checks per site; screenshots of the headset view land in
`test-output/xr/<siteId>/`.

It aims the controllers the way a person does — closing the loop on the reported pointer
ray, and steepening the throw until the ballistic teleport arc lands — so it catches
aiming and coordinate-space faults rather than asserting on internals. `src/xr/rig.ts`
exposes three small `debug*` methods for it; they are the only test hooks in the shipped
source.

What it cannot check: real frame rate, comfort, tracking quality and the headset's own
permission prompt. The engine clamps delta time per frame and this renders in software at
a few frames a second, so distances move at the right *direction* but not the right
*speed*; the suite asserts accordingly.

### Desktop

`npm run test` builds and runs `tools/smoke-test.mjs` in headless Chrome: the scene loads
from the self-hosted build, no runtime console errors, no iframe, no SuperSplat/localhost
wording, no page scrollbar, the VR button only offers VR when `immersive-vr` is supported,
the desktop walkthrough, tour and settings work at desktop, Quest-browser and phone
viewport sizes, and every site in the picker loads and enters its walkthrough.

The app can still host a `.glb` mesh model beside or instead of a splat: `Site.model`,
`src/xr/model-collision.ts` and the two conversion tools remain, but no site uses them. Screenshots land in `test-output/`.

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
