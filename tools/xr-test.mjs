// Drives the app through a full immersive VR session against an emulated Meta Quest 3
// (the IWER runtime), in headless Chrome. This is what exercises the code paths a real
// headset would: session start, spawn placement, terrain following, thumbstick walking,
// snap turning, teleport, controller rays on the in-VR panels, the menu, the tutorial,
// reset and exit. Screenshots of the headset view land in test-output/xr/.
//
//   npm run build && node tools/xr-test.mjs [siteId] [--headed] [--keep]
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const siteId = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'excavator';
const outDir = join(root, 'test-output', 'xr', siteId);
mkdirSync(outDir, { recursive: true });
const iwer = readFileSync(join(root, 'tools/vendor/iwer.bundle.js'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const f = join(dist, p);
        await stat(f);
        res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
        res.end(await readFile(f));
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: process.argv.includes('--headed') ? false : 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1100,700']
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
const errors = [];
page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// install the emulated runtime before any page script runs, and start fresh
await page.evaluateOnNewDocument(
    ({ iwer, siteId }) => {
        try {
            localStorage.clear();
            localStorage.setItem('sitexr.site', siteId);
            // quality low keeps the software renderer usable; the tutorial must run
            localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ quality: 'low' }));
        } catch {
            // ignore
        }
        // eslint-disable-next-line no-eval
        (0, eval)(iwer);
        const dev = new window.IWER.XRDevice(window.IWER.metaQuest3, { stereoEnabled: false });
        dev.installRuntime({ forceInstall: true });
        window.__xrdev = dev;
    },
    { iwer, siteId }
);

// a deep link names the site directly
await page.goto(`${base}?site=${siteId}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 600000 });

const gate = await page.evaluate(() => ({
    sub: document.getElementById('enter-sub')?.textContent,
    hasVR: window.__sitexr?.viewer.state.hasVR
}));
check('immersive VR detected, Enter offers VR', /VR/.test(gate.sub ?? '') && gate.hasVR === true, gate.sub);
await page.screenshot({ path: join(outDir, '01-welcome.png') });

// ---- enter VR ------------------------------------------------------------------------
await page.click('#enter');
let active = false;
try {
    await page.waitForFunction(() => window.__sitexr?.viewer.app.xr.active === true, { timeout: 60000 });
    active = true;
} catch {
    active = false;
}
check('immersive session starts', active);
if (!active) {
    console.log(errors.slice(0, 5).join('\n'));
    await browser.close();
    server.close();
    process.exit(1);
}

const settle = (ms = 1200) => new Promise((r) => setTimeout(r, ms));
await settle(2500);

const headState = () => page.evaluate(() => {
    const qa = window.__sitexr;
    const p = qa.rig.headPosition;
    const rig = qa.rig.rig.getPosition();
    return {
        x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2),
        floor: +rig.y.toFixed(2), yaw: +qa.rig.headYaw.toFixed(1),
        spawn: qa.site.spawn, eye: +(p.y - rig.y).toFixed(2)
    };
});

let s = await headState();
const nearSpawn = Math.hypot(s.x - s.spawn.x, s.z - s.spawn.z) < 3;
check('rig spawns at the site arrival point', nearSpawn, `head ${s.x},${s.z} vs spawn ${s.spawn.x},${s.spawn.z}`);
check('floor sits under the head, not at y=0', Math.abs(s.floor - s.spawn.floor) < 1.5, `floor ${s.floor}, expected ~${s.spawn.floor}`);
await page.screenshot({ path: join(outDir, '02-in-vr-tutorial.png') });

const tut = await page.evaluate(() => ({ active: window.__sitexr.tutorial.active, visible: window.__sitexr.tutorial.panel.visible }));
check('first-time tutorial appears in VR', tut.active && tut.visible);

// ---- controller ray hits the tutorial panel ------------------------------------------
/** Point a controller's grip so its *target ray* lands on `target`. */
const setPose = (hand, yaw, pitch) => page.evaluate(({ hand, yaw, pitch }) => {
    const dev = window.__xrdev;
    const qa = window.__sitexr;
    const c = dev.controllers[hand];
    // Controller poses are in the XR reference space (the room), not world space: the rig
    // entity carries the room into the site. The head's room position is its local
    // position under the rig. Using world coordinates here would launch the teleport arc
    // from wherever the rig happens to have been translated to.
    const head = qa.rig.camera.getLocalPosition();
    c.position.set(head.x + (hand === 'right' ? 0.2 : -0.2), head.y - 0.3, head.z);
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    c.quaternion.set(cy * sp, sy * cp, -sy * sp, cy * cp);
}, { hand, yaw, pitch });

const rayOf = async (hand) => (await page.evaluate(() => window.__sitexr.rig.debugState())).find((h) => h.hand === hand);

/**
 * Aim a controller at a world point. The runtime puts a fixed offset between the grip
 * pose we set and the target ray the viewer uses, so this closes the loop: set a pose,
 * read the resulting ray, correct, repeat.
 */
const aimAt = async (hand, target) => {
    // first guess in world terms; the loop below corrects for the room-to-world rotation
    const head = await page.evaluate(() => {
        const p = window.__sitexr.rig.headPosition;
        return { x: p.x, y: p.y, z: p.z };
    });
    const ox = head.x;
    const oy = head.y - 0.3;
    const oz = head.z;
    let dx = target.x - ox, dy = target.y - oy, dz = target.z - oz;
    let L = Math.hypot(dx, dy, dz);
    let yaw = Math.atan2(-dx / L, -dz / L);
    let pitch = Math.asin(dy / L);
    for (let i = 0; i < 6; i++) {
        await setPose(hand, yaw, pitch);
        await new Promise((r) => setTimeout(r, 140));
        const st = await rayOf(hand);
        if (!st) return;
        const [rx, ry, rz] = st.origin;
        const [ax, ay, az] = st.dir;
        dx = target.x - rx; dy = target.y - ry; dz = target.z - rz;
        L = Math.hypot(dx, dy, dz);
        const wantYaw = Math.atan2(-dx / L, -dz / L);
        const wantPitch = Math.asin(dy / L);
        const gotYaw = Math.atan2(-ax, -az);
        const gotPitch = Math.asin(Math.max(-1, Math.min(1, ay)));
        let dYaw = wantYaw - gotYaw;
        while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
        while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
        const dPitch = wantPitch - gotPitch;
        if (Math.abs(dYaw) < 0.004 && Math.abs(dPitch) < 0.004) break;
        yaw += dYaw;
        pitch += dPitch;
    }
};

/** Point a hand straight down, so an idle controller cannot hover a panel. */
const parkHand = (hand) => setPose(hand, 0, -Math.PI / 2 + 0.05);

await parkHand('left');
await settle(400);

const panelCentre = await page.evaluate(() => {
    const p = window.__sitexr.tutorial.panel.entity.getPosition();
    return { x: p.x, y: p.y, z: p.z };
});
await aimAt('right', panelCentre);
await settle(900);
const hovering = await page.evaluate(() => window.__sitexr.rig.pointingAtUi);
check('controller ray hits an in-VR panel', hovering === true);
await page.screenshot({ path: join(outDir, '03-ray-on-panel.png') });

const press = async (hand, button, ms = 180) => {
    await page.evaluate(({ hand, button }) => window.__xrdev.controllers[hand].updateButtonValue(button, 1), { hand, button });
    await settle(ms);
    await page.evaluate(({ hand, button }) => window.__xrdev.controllers[hand].updateButtonValue(button, 0), { hand, button });
    await settle(250);
};
const stick = async (hand, x, y) => page.evaluate(({ hand, x, y }) => window.__xrdev.controllers[hand].updateAxes('thumbstick', x, y), { hand, x, y });

// skip the tutorial by selecting its "Skip tutorial" button with the trigger
const skipBtn = await page.evaluate(() => {
    const t = window.__sitexr.tutorial;
    const b = t.panel.buttons.find((x) => x.id === 'skip');
    const p = t.panel.entity.getPosition();
    const e = t.panel.entity;
    // button centre in panel uv -> world
    const u = (b.x + b.w / 2) / t.panel.pxW;
    const v = (b.y + b.h / 2) / t.panel.pxH;
    const local = { x: (u - 0.5) * t.panel.width, y: (0.5 - v) * t.panel.height, z: 0 };
    const m = e.getWorldTransform();
    const out = new (p.constructor)();
    m.transformPoint(new (p.constructor)(local.x, local.y, local.z), out);
    return { x: out.x, y: out.y, z: out.z };
});
await aimAt('right', skipBtn);
await settle(600);
await press('right', 'trigger');
await settle(800);
const skipped = await page.evaluate(() => ({ active: window.__sitexr.tutorial.active, done: window.__sitexr.settings.get().tutorialDone }));
check('tutorial button responds to a trigger press', !skipped.active && skipped.done);

// ---- walking -------------------------------------------------------------------------
// Note on distances: the engine clamps delta time per frame, and this runs on a software
// renderer at a few frames a second, so the *rate* here is far below the real headset. The
// assertions therefore check that movement happens, in the direction the visitor faces —
// not how fast.
const before = await headState();
await stick('left', 0, -1);
await settle(3000);
await stick('left', 0, 0);
await settle(600);
const after = await headState();
const walked = Math.hypot(after.x - before.x, after.z - before.z);
const facing = { x: -Math.sin((before.yaw * Math.PI) / 180), z: -Math.cos((before.yaw * Math.PI) / 180) };
const along = ((after.x - before.x) * facing.x + (after.z - before.z) * facing.z) / Math.max(1e-6, walked);
check('left thumbstick walks forward', walked > 0.4 && along > 0.7, `moved ${walked.toFixed(2)} m, ${(along * 100).toFixed(0)}% along facing`);
check('floor follows the terrain while walking', Math.abs(after.eye - before.eye) < 0.35, `eye height ${before.eye} -> ${after.eye}`);
await page.screenshot({ path: join(outDir, '04-after-walking.png') });

// ---- snap turn -----------------------------------------------------------------------
const yaw0 = (await headState()).yaw;
await stick('right', 1, 0);
await settle(500);
await stick('right', 0, 0);
await settle(600);
const yaw1 = (await headState()).yaw;
let dYaw = yaw1 - yaw0;
while (dYaw > 180) dYaw -= 360;
while (dYaw < -180) dYaw += 360;
check('right thumbstick snap-turns ~30°', Math.abs(Math.abs(dYaw) - 30) < 12, `turned ${dYaw.toFixed(1)}°`);

// smooth turn option
await page.evaluate(() => window.__sitexr.settings.set('turn', 'smooth'));
const yaw2 = (await headState()).yaw;
await stick('right', 1, 0);
await settle(900);
await stick('right', 0, 0);
const yaw3 = (await headState()).yaw;
let dYaw2 = yaw3 - yaw2;
while (dYaw2 > 180) dYaw2 -= 360;
while (dYaw2 < -180) dYaw2 += 360;
check('smooth turning option rotates continuously', Math.abs(dYaw2) > 5, `turned ${dYaw2.toFixed(1)}°`);
await page.evaluate(() => window.__sitexr.settings.set('turn', 'snap30'));

// ---- teleport ------------------------------------------------------------------------
const tpStart = await headState();
// Find a direction with a clear shot at standable ground. A site legitimately has raised
// beds and machines in the way, so the test looks for somewhere a visitor could land
// rather than assuming whatever happens to be straight ahead.
const ground = await page.evaluate(() => {
    const qa = window.__sitexr;
    const h = qa.rig.headPosition;
    const P = h.constructor;
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        for (const d of [3, 4, 5, 6]) {
            const tx = h.x + Math.sin(a) * d;
            const tz = h.z + Math.cos(a) * d;
            const stand = qa.rig.findStand(tx, tz);
            if (Math.hypot(stand.x - h.x, stand.z - h.z) < 1.5) continue;
            const probe = qa.rig.debugTeleport(new P(h.x, h.y - 0.3, h.z), new P(stand.x, stand.y - 0.1, stand.z));
            if (probe.inSite && probe.free && probe.headroom && probe.normalY >= 0.6) {
                return { x: stand.x, y: stand.y, z: stand.z, probe };
            }
        }
    }
    return null;
});
check('a reachable teleport target exists nearby', !!ground, ground ? JSON.stringify(ground.probe) : 'none found');

// Aim like a person does: point roughly at the spot, then steepen until the ballistic arc
// actually lands there. Aiming straight at a target overshoots it, because the arc is a
// projectile at 9 m/s, not a straight line.
await aimAt('right', ground ?? { x: tpStart.x, y: 0, z: tpStart.z });
await page.evaluate(() => window.__xrdev.controllers.right.updateButtonValue('trigger', 1));
await settle(700);
const arcValid = async () => page.evaluate(() => {
    const hits = [...window.__sitexr.rig.nav._arcHits.values()];
    return hits.some((h) => h.valid);
});
let aimed = await arcValid();
if (!aimed && ground) {
    const headNow = await page.evaluate(() => {
        const p = window.__sitexr.rig.headPosition;
        return { x: p.x, y: p.y, z: p.z };
    });
    const yaw = Math.atan2(-(ground.x - headNow.x), -(ground.z - headNow.z));
    for (const pitchDeg of [-15, -25, -35, -45, -55, -65]) {
        await setPose('right', yaw, (pitchDeg * Math.PI) / 180);
        await settle(450);
        aimed = await arcValid();
        if (aimed) break;
    }
}
check('teleport arc finds a valid landing spot when aimed at the ground', aimed);
await page.screenshot({ path: join(outDir, '05-teleport-arc.png') });
const arc = await page.evaluate(() => {
    const nav = window.__sitexr.rig.nav;
    const visuals = [...nav._arcVisuals.values()];
    const hits = [...nav._arcHits.values()];
    return {
        drawn: visuals.some((v) => v.entity.enabled),
        ring: visuals.some((v) => v.ringEntity.enabled),
        valid: hits.some((h) => h.valid)
    };
});
check('teleport arc is drawn while the trigger is held', arc.drawn, JSON.stringify(arc));
check('teleport target validates against the site surface', arc.valid && arc.ring, JSON.stringify(arc));
await page.evaluate(() => window.__xrdev.controllers.right.updateButtonValue('trigger', 0));
await settle(1800);
const tpEnd = await headState();
const jumped = Math.hypot(tpEnd.x - tpStart.x, tpEnd.z - tpStart.z);
check('teleport moves the visitor', jumped > 0.8, `moved ${jumped.toFixed(2)} m`);

// ---- menu ----------------------------------------------------------------------------
await press('right', 'b-button');
await settle(700);
check('B opens the in-VR menu', await page.evaluate(() => window.__sitexr.menu.isOpen));
await page.screenshot({ path: join(outDir, '06-menu.png') });

// select "Comfort settings" with the ray
const comfortBtn = await page.evaluate(() => {
    const m = window.__sitexr.menu;
    const b = m.panel.buttons.find((x) => x.id === 'comfort');
    const u = (b.x + b.w / 2) / m.panel.pxW;
    const v = (b.y + b.h / 2) / m.panel.pxH;
    const P = m.panel.entity.getPosition().constructor;
    const out = new P();
    m.panel.entity.getWorldTransform().transformPoint(new P((u - 0.5) * m.panel.width, (0.5 - v) * m.panel.height, 0), out);
    return { x: out.x, y: out.y, z: out.z };
});
await aimAt('right', comfortBtn);
await settle(500);
await press('right', 'trigger');
await settle(600);
check('menu navigates to comfort settings', await page.evaluate(() => window.__sitexr.menu.page === 'comfort'));

// back out, then into the site list
const btnAt = (id) => page.evaluate((wanted) => {
    const m = window.__sitexr.menu;
    const b = m.panel.buttons.find((x) => x.id === wanted);
    if (!b) return null;
    const u = (b.x + b.w / 2) / m.panel.pxW;
    const v = (b.y + b.h / 2) / m.panel.pxH;
    const P = m.panel.entity.getPosition().constructor;
    const out = new P();
    m.panel.entity.getWorldTransform().transformPoint(new P((u - 0.5) * m.panel.width, (0.5 - v) * m.panel.height, 0), out);
    return { x: out.x, y: out.y, z: out.z };
}, id);

const backBtn = await btnAt('back');
await aimAt('right', backBtn);
await settle(400);
await press('right', 'trigger');
await settle(500);

const switchBtn = await btnAt('switch');
await aimAt('right', switchBtn);
await settle(400);
await press('right', 'trigger');
await settle(700);
check('menu opens the in-VR site list', await page.evaluate(() => window.__sitexr.menu.page === 'sites'));

const offered = await page.evaluate(() => {
    const ids = window.__sitexr.menu.panel.buttons.map((b) => b.id).filter((id) => id.startsWith('site:'));
    return { ids, here: window.__sitexr.site.id };
});
check('the site list offers every site, both experiences', offered.ids.length >= 4 &&
    offered.ids.includes(`site:${offered.here}`), offered.ids.join(' '));
await page.screenshot({ path: join(outDir, '13-site-list.png') });

// back to the main page, so the rest of the run is unaffected
await aimAt('right', await btnAt('back'));
await settle(400);
await press('right', 'trigger');
await settle(500);
check('the site list returns to the menu', await page.evaluate(() => window.__sitexr.menu.page === 'main'));
await page.screenshot({ path: join(outDir, '07-comfort.png') });
await page.evaluate(() => window.__sitexr.menu.close());
await settle(400);

// ---- reset and tour --------------------------------------------------------------------
await page.evaluate(() => {
    const qa = window.__sitexr;
    qa.rig.rig.translate(3, 0, 3);
});
await settle(500);
await press('left', 'y-button');
await settle(2500);
const afterReset = await headState();
const backHome = Math.hypot(afterReset.x - afterReset.spawn.x, afterReset.z - afterReset.spawn.z) < 3;
check('Y resets to the arrival point', backHome, `head ${afterReset.x},${afterReset.z}`);

await press('left', 'x-button');
await settle(3000);
const tour = await page.evaluate(() => ({ active: window.__sitexr.tour.active, index: window.__sitexr.tour.index }));
check('X starts the guided tour', tour.active && tour.index >= 0, `stop ${tour.index}`);
await page.screenshot({ path: join(outDir, '08-tour.png') });
await press('right', 'a-button');
await settle(3000);
const tour2 = await page.evaluate(() => window.__sitexr.tour.index);
check('A advances the tour', tour2 >= 1, `stop ${tour2}`);
await page.evaluate(() => window.__sitexr.tour.stop());

// ---- point of interest card ------------------------------------------------------------
const markerPos = await page.evaluate(() => {
    const qa = window.__sitexr;
    const poi = qa.site.pois[0];
    // stand where the poi is meant to be viewed from, facing it
    const stand = qa.rig.findStand(poi.stand.x, poi.stand.z);
    qa.rig.placeHead(stand.x, stand.y, stand.z, poi.stand.look);
    const m = qa.markers.markers[0].panel.entity.getPosition();
    return { x: m.x, y: m.y, z: m.z };
});
await settle(1500);
await aimAt('right', markerPos);
await settle(700);
await press('right', 'trigger');
await settle(900);
check('selecting a marker opens its note card', await page.evaluate(() => window.__sitexr.markers.cardOpen));
await page.screenshot({ path: join(outDir, '09-poi-card.png') });

// "Go there" on the card
const goBtn = await page.evaluate(() => {
    const c = window.__sitexr.markers.card;
    const b = c.buttons.find((x) => x.id === 'go');
    const u = (b.x + b.w / 2) / c.pxW;
    const v = (b.y + b.h / 2) / c.pxH;
    const P = c.entity.getPosition().constructor;
    const out = new P();
    c.entity.getWorldTransform().transformPoint(new P((u - 0.5) * c.width, (0.5 - v) * c.height, 0), out);
    return { x: out.x, y: out.y, z: out.z };
});
await aimAt('right', goBtn);
await settle(500);
await press('right', 'trigger');
await settle(2500);
check('card "Go there" travels and closes the card', !(await page.evaluate(() => window.__sitexr.markers.cardOpen)));

// ---- physical head movement (room scale) ------------------------------------------------
const roomBefore = await headState();
await page.evaluate(() => {
    const d = window.__xrdev;
    d.position.set(d.position.x + 0.6, d.position.y, d.position.z + 0.4);
});
await settle(900);
const roomAfter = await headState();
const moved = Math.hypot(roomAfter.x - roomBefore.x, roomAfter.z - roomBefore.z);
check('physical head movement moves the view (room scale)', moved > 0.3, `moved ${moved.toFixed(2)} m`);

// ---- stairs and height --------------------------------------------------------------------
// A site declares `stair` when it has one worth climbing; the rest only get the height test.
const stair = await page.evaluate(() => window.__sitexr.site.stair ?? null);
if (stair) {
    const climbed = await page.evaluate(async ({ from, to }) => {
        const qa = window.__sitexr;
        qa.rig.heightOffset = 0;
        const stand = qa.rig.findStand(from[0], from[1], qa.site.spawn.floor);
        qa.rig.placeHead(stand.x, stand.y, stand.z, [to[0], stand.y + 1, to[1]]);
        await new Promise((r) => setTimeout(r, 600));
        const start = qa.rig.camera.getPosition().y;

        // walk the flight in small steps, letting the floor follow between each
        const n = 40;
        for (let i = 1; i <= n; i++) {
            const x = from[0] + ((to[0] - from[0]) * i) / n;
            const z = from[1] + ((to[1] - from[1]) * i) / n;
            const head = qa.rig.camera.getPosition();
            const rig = qa.rig.rig.getPosition();
            qa.rig.rig.setPosition(rig.x + (x - head.x), rig.y, rig.z + (z - head.z));
            await new Promise((r) => setTimeout(r, 60));
        }
        return { start: +start.toFixed(2), end: +qa.rig.camera.getPosition().y.toFixed(2) };
    }, stair);
    const rise = climbed.end - climbed.start;
    check(`walking the stair carries the visitor up (${stair.rise} m expected)`,
        rise > stair.rise * 0.6, `rose ${rise.toFixed(2)} m, ${JSON.stringify(climbed)}`);
}

const height = await page.evaluate(async () => {
    const qa = window.__sitexr;
    qa.rig.resetToSpawn(false);
    await new Promise((r) => setTimeout(r, 900));
    const floor = qa.rig.camera.getPosition().y;
    qa.rig.nav.onVertical(1, true);
    qa.rig.nav.onVertical(1, true);
    await new Promise((r) => setTimeout(r, 1400));
    const up = qa.rig.camera.getPosition().y;
    qa.rig.resetToSpawn(false);
    await new Promise((r) => setTimeout(r, 900));
    return { floor: +floor.toFixed(2), up: +up.toFixed(2), back: +qa.rig.camera.getPosition().y.toFixed(2),
             offset: qa.rig.heightOffset };
});
check('the right thumbstick lifts the visitor and the lift holds', height.up - height.floor > 3,
    `${height.floor} -> ${height.up}`);
check('resetting puts the visitor back on the floor',
    Math.abs(height.back - height.floor) < 0.6 && height.offset === 0, JSON.stringify(height));

// ---- doors, when the site has them --------------------------------------------------------
const hasDoors = await page.evaluate(() => !!window.__sitexr.doors);
if (hasDoors) {
    // stand in front of a shut leaf, facing it
    const aim = await page.evaluate(() => {
        const qa = window.__sitexr;
        const leaf = qa.doors.leaves.find((l) => l.openable);
        const c = leaf.centre();
        const fwd = leaf.entity.forward;             // across the doorway
        const mid = { x: c.x, y: c.y, z: c.z };
        const stand = qa.rig.findStand(c.x + fwd.x * 1.4, c.z + fwd.z * 1.4, qa.site.spawn.floor);
        qa.rig.placeHead(stand.x, stand.y, stand.z, [mid.x, mid.y, mid.z]);
        qa.doors.closeAll();
        return { mid, name: leaf.label, standY: +stand.y.toFixed(2) };
    });
    await settle(1800);
    await page.screenshot({ path: join(outDir, '11-door-shut.png') });

    await aimAt('right', aim.mid);
    await settle(700);
    const hovering = await page.evaluate(() => {
        const st = window.__sitexr.rig.debugState().find((h) => h.hand === 'right');
        return st?.hit?.name ?? null;
    });
    check('controller ray picks out a door leaf', /^door-/.test(hovering ?? ''), `${hovering} (${aim.name})`);

    await press('right', 'trigger');
    await settle(1400);
    const opened = await page.evaluate(() => {
        const l = window.__sitexr.doors.leaves.find((x) => x.openable);
        return { open: l.open, shut: l.shut };
    });
    check('a trigger press swings the door open', opened.open > 0.5 && !opened.shut, JSON.stringify(opened));
    await page.screenshot({ path: join(outDir, '12-door-open.png') });

    // the leaf has moved, so aim at where it is now rather than where it was
    const nowAt = await page.evaluate(() => {
        const c = window.__sitexr.doors.leaves.find((x) => x.openable).centre();
        return { x: c.x, y: c.y, z: c.z };
    });
    await aimAt('right', nowAt);
    await settle(700);
    await press('right', 'trigger');
    await settle(1600);
    const reshut = await page.evaluate(() => window.__sitexr.doors.leaves.find((x) => x.openable).open);
    check('a second press shuts it again', reshut < 0.5, `open ${reshut.toFixed(2)}`);

    // a shut leaf is not a place the teleport arc will drop you
    const blocked = await page.evaluate(() => {
        const qa = window.__sitexr;
        const l = qa.doors.leaves.find((x) => x.openable);
        qa.doors.closeAll();
        const c = l.centre();
        return qa.doors.obstructs(c.x, c.y, c.z, 0.3);
    });
    check('a shut door blocks a teleport target', blocked === true);

    const clears = await page.evaluate(async () => {
        const qa = window.__sitexr;
        const l = qa.doors.leaves.find((x) => x.openable);
        const c0 = l.centre();
        const where = { x: c0.x, y: c0.y, z: c0.z };
        l.set(1);
        for (let i = 0; i < 120; i++) qa.doors.update(1 / 60);
        const c1 = l.centre();
        return {
            open: l.open,
            blocked: qa.doors.obstructs(where.x, where.y, where.z, 0.3),
            moved: +Math.hypot(c1.x - where.x, c1.z - where.z).toFixed(3),
            culprit: qa.doors.leaves.filter((x) => x.obstructs(where.x, where.y, where.z, 0.3)).map((x) => x.label)
        };
    });
    check('once open, the same spot is clear', clears.open === 1 && clears.blocked === false, JSON.stringify(clears));
    await page.evaluate(() => window.__sitexr.doors.closeAll());
    await settle(900);
}

// ---- exit --------------------------------------------------------------------------------
await page.evaluate(() => window.__sitexr.rig.exitVr());
await settle(2000);
const ended = await page.evaluate(() => ({
    active: window.__sitexr.viewer.app.xr.active,
    welcome: !document.getElementById('overlay').hidden
}));
check('exiting VR returns to the welcome screen', ended.active === false && ended.welcome);
await page.screenshot({ path: join(outDir, '10-after-exit.png') });

// ---- switching site from the in-VR list --------------------------------------------------
const wasOn = await page.evaluate(() => window.__sitexr.site.id);
const other = await page.evaluate(() => {
    // the menu rebuilds its buttons per page, so ask the site page for them
    const m = window.__sitexr.menu;
    m.page = 'sites';
    m.render();
    const ids = m.panel.buttons.map((b) => b.id).filter((id) => id.startsWith('site:'));
    return ids.find((id) => id !== `site:${window.__sitexr.site.id}`) ?? null;
});
if (other) {
    await page.evaluate((id) => window.__sitexr.menu.panel.onButton(id), other);
    const want = other.slice(5);
    let landed = null;
    for (let i = 0; i < 120; i++) {
        landed = await page.evaluate(() => window.__sitexr?.site?.id ?? null);
        if (landed === want) break;
        await settle(1000);
    }
    check(`choosing another site in VR loads it (${wasOn} -> ${want})`, landed === want, `ended on ${landed}`);
    // the site id lands when the new session is built; the Enter button unlocks a beat
    // later, when the first frame is drawable
    let ready = false;
    for (let i = 0; i < 90; i++) {
        ready = await page.evaluate(() => !document.getElementById('enter')?.disabled);
        if (ready) break;
        await settle(1000);
    }
    check('the new site comes up ready to enter', ready === true);
    await page.screenshot({ path: join(outDir, '14-after-switch.png') });
}

const benign = (e) => /favicon|WebGPU|GPU stall|Automatic fallback|swiftshader|GroupMarkerNotSet|ERR_BLOCKED_BY_CLIENT|Failed to load resource: net::ERR_FAILED/i.test(e);
const real = errors.filter((e) => !benign(e));
check('no runtime console errors during the VR session', real.length === 0, real.slice(0, 4).join(' | '));

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} VR checks passed. Screenshots in ${outDir}`);
process.exit(failed.length ? 1 : 0);
