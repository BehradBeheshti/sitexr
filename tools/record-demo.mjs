// Records a first-person walkthrough of a site as an MP4, framed the way the headset view
// looks: wide field of view, eye-height camera, head bob, blink transitions and the in-VR
// panels (markers, note cards, menu). Frames are rendered offscreen in headless Chrome, so
// it works without a headset and without a working GPU.
//
//   node tools/record-demo.mjs <siteId> [--fps 24] [--width 1280] [--height 720]
//                              [--quality high] [--out media/<siteId>-demo.mp4]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
};
const siteId = process.argv[2] ?? 'komatsu';
const fps = Number(arg('fps', 24));
const width = Number(arg('width', 1280));
const height = Number(arg('height', 720));
const quality = arg('quality', 'high');
const out = arg('out', join(root, 'media', `${siteId}-vr-demo.mp4`));
const frameDir = arg('frames', join(root, 'test-output', 'frames', siteId));
const FOV = Number(arg('fov', 100));
const EYE = 1.65;

// ---- shot lists ----------------------------------------------------------------------
// t: seconds. pos is (x, z) in metres; look is a world point. `cut` starts a new shot,
// which the blink (fade to black) covers.
const SHOTS = {
    office: {
        title: 'Office Building',
        keys: [
            // the atrium, looking up the stair
            { t: 0.0, x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.6, 2.2] },
            { t: 2.2, x: 7.5, z: 0.3, floor: 0, look: [3.4, 2.6, 2.2] },
            { t: 4.2, x: 6.7, z: 0.4, floor: 0, look: [3.2, 2.9, 2.4] },

            // the same spot one floor up, at the guardrail
            { t: 4.8, x: 8.3, z: 0.3, floor: 3.66, look: [3.4, 3.2, 2.2], cut: true },
            { t: 7.0, x: 7.6, z: -0.6, floor: 3.66, look: [2.0, 2.2, 1.6] },
            { t: 8.8, x: 7.6, z: -0.6, floor: 3.66, look: [1.0, 3.6, 6.0] },

            // up to the glazed entrance, from inside. The two leaves part in the middle,
            // so the walk keeps to z = 8.4 and goes between them.
            { t: 9.4, x: 1.6, z: 8.4, floor: 0, look: [7.46, 1.6, 8.4], cut: true },
            { t: 12.4, x: 3.8, z: 8.4, floor: 0, look: [7.46, 1.6, 8.4] },
            { t: 15.4, x: 3.9, z: 8.4, floor: 0, look: [7.46, 1.6, 8.4] },   // they swing here
            { t: 19.0, x: 10.8, z: 9.4, floor: 0, look: [4.0, 3.0, 5.5] },   // and we walk through, turning

            // outside, on the approach
            { t: 19.6, x: -9.0, z: 11.0, floor: 0, look: [4.0, 2.2, 8.8], cut: true },
            { t: 21.8, x: -10.5, z: 12.0, floor: 0, look: [-6.0, 3.0, 7.0] },
            { t: 23.4, x: -12.0, z: 13.0, floor: 0, look: [-19.0, 2.5, 4.0] },

            // back inside, and open the menu
            { t: 24.0, x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.7, 2.2], cut: true },
            { t: 27.8, x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.7, 2.2] }
        ],
        events: [
            { t: 12.9, do: 'doors', leaves: [6, 7], open: 1 },
            { t: 24.6, do: 'menu' },
            { t: 26.0, do: 'menuPage', page: 'sites' }
        ]
    },
    komatsu: {
        title: 'Heavy Plant Yard',
        keys: [
            { t: 0.0, x: -14.0, z: 10.6, look: [-5.0, 4.0, 1.0] },
            { t: 2.6, x: -14.0, z: 10.6, look: [-9.0, 3.0, -1.0] },
            { t: 4.4, x: -14.0, z: 9.2, look: [-8.8, 3.2, 0.4] },
            { t: 7.4, x: -13.5, z: 6.7, look: [-8.6, 3.5, 1.0] },
            { t: 9.6, x: -13.5, z: 6.7, look: [-8.6, 7.2, 1.0] },
            { t: 11.0, x: -13.5, z: 6.7, look: [-8.6, 7.2, 1.0] },
            { t: 11.6, x: 2.0, z: -7.0, look: [1.9, 3.0, 0.6], cut: true },
            { t: 14.6, x: 2.0, z: -7.0, look: [1.9, 5.8, 0.6] },
            { t: 17.4, x: 4.6, z: -5.6, look: [1.9, 3.2, 0.6] },
            { t: 20.4, x: 8.8, z: -2.4, look: [1.9, 1.6, 0.6] },
            { t: 24.0, x: 8.8, z: -2.4, look: [1.9, 1.6, 0.6] }
        ],
        events: [
            { t: 15.2, do: 'card', poi: 'excavator' },
            { t: 19.4, do: 'closeCard' },
            { t: 21.6, do: 'menu' },
            { t: 23.6, do: 'closeMenu' }
        ]
    },
    excavator: {
        title: 'Muddy Excavator Site',
        keys: [
            { t: 0.0, x: 1.0, z: 10.5, look: [1.6, 2.4, -0.8] },
            { t: 2.4, x: 1.0, z: 10.5, look: [-3.0, 2.0, 2.0] },
            { t: 5.0, x: -2.0, z: 8.0, look: [0.5, 1.6, 0.5] },
            { t: 8.0, x: -1.0, z: 6.5, look: [4.0, 1.2, 0.5] },
            { t: 9.6, x: -1.0, z: 6.5, look: [1.6, 4.4, -1.2] },
            { t: 11.2, x: -1.0, z: 6.5, look: [1.6, 4.4, -1.2] },
            { t: 11.8, x: -9.0, z: 4.0, look: [2.0, 2.5, -1.5], cut: true },
            { t: 15.4, x: -6.0, z: 2.0, look: [2.0, 3.2, -1.5] },
            { t: 17.4, x: -6.0, z: 2.0, look: [2.0, 3.2, -1.5] },
            { t: 18.0, x: 14.0, z: -6.0, look: [4.0, 3.0, 2.0], cut: true },
            { t: 22.0, x: 11.5, z: -5.0, look: [4.0, 2.6, 1.6] },
            { t: 24.0, x: 11.5, z: -5.0, look: [4.0, 2.6, 1.6] }
        ],
        events: [
            { t: 8.6, do: 'card', poi: 'tracks' },
            { t: 11.0, do: 'closeCard' },
            { t: 19.0, do: 'card', poi: 'access' },
            { t: 22.6, do: 'closeCard' }
        ]
    },
    scaffold: {
        title: 'Formwork & Scaffold Floor',
        keys: [
            { t: 0.0, x: 1.5, z: 0.6, look: [-3.0, 0.2, -4.0] },
            { t: 2.6, x: 1.5, z: 0.6, look: [-1.0, 0.4, -3.2] },
            { t: 5.4, x: 0.8, z: -1.0, look: [-1.0, 0.4, -3.4] },
            { t: 8.0, x: 0.8, z: -1.0, look: [-1.4, 2.3, -1.6] },
            { t: 10.0, x: 0.8, z: -1.0, look: [-1.4, 2.3, -1.6] },
            { t: 10.6, x: 0.0, z: 2.0, look: [-1.5, 2.2, -1.5], cut: true },
            { t: 13.6, x: 1.6, z: 3.6, look: [2.0, 0.4, 2.0] },
            { t: 16.6, x: 4.0, z: 5.2, look: [4.2, -0.8, 2.4] },
            { t: 19.6, x: 4.0, z: 5.2, look: [4.2, -0.8, 2.4] }
        ],
        events: [
            { t: 8.6, do: 'card', poi: 'soffit' },
            { t: 10.2, do: 'closeCard' },
            { t: 17.2, do: 'card', poi: 'housekeeping' },
            { t: 19.2, do: 'closeCard' }
        ]
    }
};

const shot = SHOTS[siteId];
if (!shot) {
    console.error(`no shot list for site "${siteId}"`);
    process.exit(1);
}
const duration = Number(arg('seconds', shot.keys[shot.keys.length - 1].t));

// ---- timeline ------------------------------------------------------------------------
const yawPitch = (x, y, z, look) => {
    const dx = look[0] - x;
    const dy = look[1] - y;
    const dz = look[2] - z;
    const h = Math.hypot(dx, dz);
    return { yaw: (Math.atan2(-dx, -dz) * 180) / Math.PI, pitch: (Math.atan2(dy, h) * 180) / Math.PI };
};
const smooth = (t) => t * t * (3 - 2 * t);
const shortest = (a, b) => {
    let d = b - a;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
};

/** Pose at time t: interpolated across the keyframes, with a cut treated as a jump. */
const poseAt = (t, groundOf) => {
    const keys = shot.keys;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const u = b.cut ? 0 : smooth(Math.min(1, Math.max(0, (t - a.t) / span)));
    const x = a.x + (b.x - a.x) * u;
    const z = a.z + (b.z - a.z) * u;
    const ya = yawPitch(a.x, groundOf(a.x, a.z, a.floor) + EYE, a.z, a.look);
    const yb = yawPitch(b.x, groundOf(b.x, b.z, b.floor) + EYE, b.z, b.look);
    const yaw = ya.yaw + shortest(ya.yaw, yb.yaw) * u;
    const pitch = ya.pitch + (yb.pitch - ya.pitch) * u;
    // head motion: a walking bob while the position changes, plus a slow idle sway
    const moving = Math.hypot(b.x - a.x, b.z - a.z) > 0.2 && u > 0.01 && u < 0.99;
    const bob = (moving ? 0.022 * Math.sin(t * Math.PI * 2 * 1.7) : 0.006 * Math.sin(t * Math.PI * 2 * 0.5));
    const sway = 0.35 * Math.sin(t * Math.PI * 2 * 0.23) + (moving ? 0.5 * Math.sin(t * Math.PI * 2 * 0.85) : 0);
    return { x, z, floor: u < 0.5 ? a.floor : b.floor, yaw: yaw + sway, pitch: pitch + (moving ? 0.35 * Math.sin(t * Math.PI * 2 * 1.7 + 1) : 0), bob };
};

/** Blink alpha: black over each cut, plus a fade in at the start and out at the end. */
const fadeAt = (t) => {
    let a = 0;
    if (t < 0.6) a = Math.max(a, 1 - t / 0.6);
    if (t > duration - 0.8) a = Math.max(a, (t - (duration - 0.8)) / 0.8);
    for (const k of shot.keys) {
        if (!k.cut) continue;
        const d = t - k.t;
        if (d < -0.5 || d > 0.5) continue;
        a = Math.max(a, d < 0 ? Math.min(1, (d + 0.5) / 0.4) : Math.min(1, (0.5 - d) / 0.4));
    }
    return Math.min(1, a);
};

// ---- static server -------------------------------------------------------------------
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

rmSync(frameDir, { recursive: true, force: true });
mkdirSync(frameDir, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars']
});
const page = await browser.newPage();
await page.setViewport({ width, height });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.evaluateOnNewDocument(({ id, q }) => {
    try {
        localStorage.setItem('sitexr.site', id);
        localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ tutorialDone: true, quality: q }));
    } catch {
        // ignore
    }
}, { id: siteId, q: quality });
// a deep link names the site, which also skips the experience chooser
await page.goto(`${base}?site=${siteId}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 600000 });
await page.evaluate(() => document.getElementById('enter').click());
await new Promise((r) => setTimeout(r, 6000));

// headset-like view: no page chrome, wide field of view, a black fade layer we drive
await page.evaluate((fov) => {
    const qa = window.__sitexr;
    document.getElementById('hud').hidden = true;
    const fade = document.getElementById('fade');
    fade.style.transition = 'none';
    const cam = qa.rig.camera.camera;
    qa.viewer.app.on('prerender', () => {
        cam.fov = fov;
        cam.horizontalFov = true;
    });
}, FOV);

/**
 * Floor under a point. `floor` names a storey for a model with more than one; without it the
 * ray starts above everything and a two-storey building answers with its roof.
 */
const groundOf = async (x, z, floor) => {
    return page.evaluate(({ x, z, floor }) => {
        const qa = window.__sitexr;
        const g = qa.rig.groundAt(x, z, floor === undefined ? undefined : floor + 2.2,
            floor === undefined ? undefined : 3.4);
        if (g !== null && Number.isFinite(g)) return g;
        return qa.rig.findStand(x, z, floor).y;
    }, { x, z, floor });
};
// ground under every keyframe, so the timeline can be evaluated without the page
const grounds = new Map();
const gkey = (x, z, floor) => `${x},${z},${floor ?? ''}`;
for (const k of shot.keys) grounds.set(gkey(k.x, k.z, k.floor), await groundOf(k.x, k.z, k.floor));
const groundKey = (x, z, floor) => grounds.get(gkey(x, z, floor)) ?? 0;

const total = Math.round(duration * fps);
console.log(`${siteId}: ${total} frames at ${fps} fps (${duration}s), ${width}x${height}`);
const events = [...shot.events].sort((a, b) => a.t - b.t);
let nextEvent = 0;
const t0 = Date.now();

for (let f = 0; f < total; f++) {
    const t = f / fps;
    while (nextEvent < events.length && events[nextEvent].t <= t) {
        const e = events[nextEvent++];
        await page.evaluate((e) => {
            const qa = window.__sitexr;
            if (e.do === 'card') qa.markers.openCard(qa.site.pois.find((p) => p.id === e.poi), true);
            if (e.do === 'closeCard') qa.markers.closeCard();
            if (e.do === 'menu') qa.menu.open();
            if (e.do === 'menuPage') { qa.menu.page = e.page; qa.menu.render(); }
            if (e.do === 'closeMenu') qa.menu.close();
            if (e.do === 'doors') {
                for (const i of e.leaves) qa.doors.leaves[i].set(e.open ?? 1);
            }
        }, e);
    }
    // interpolate between keyframe grounds so the eye height never steps
    const p = poseAt(t, groundKey);
    const ground = await groundOf(p.x, p.z, p.floor);
    await page.evaluate(({ x, z, yaw, pitch, y, fade }) => {
        const qa = window.__sitexr;
        const cm = qa.viewer.internals.cameraManager();
        const V = qa.rig.camera.getPosition().constructor;
        const ry = (yaw * Math.PI) / 180;
        const rp = (pitch * Math.PI) / 180;
        const fx = -Math.sin(ry) * Math.cos(rp);
        const fy = Math.sin(rp);
        const fz = -Math.cos(ry) * Math.cos(rp);
        cm.camera.look(new V(x, y, z), new V(x + fx * 12, y + fy * 12, z + fz * 12));
        cm.snap();
        qa.viewer.app.renderNextFrame = true;
        document.getElementById('fade').style.opacity = String(fade);
    }, { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, y: ground + EYE + p.bob, fade: fadeAt(t) });
    await page.screenshot({ path: join(frameDir, `f${String(f).padStart(5, '0')}.png`) });
    if (f % 24 === 0 || f === total - 1) {
        const done = f + 1;
        const eta = Math.round(((Date.now() - t0) / done) * (total - done) / 1000);
        console.log(`  frame ${done}/${total}  eta ${Math.floor(eta / 60)}m${String(eta % 60).padStart(2, '0')}s`);
    }
}
await browser.close();
server.close();

const run = (cmd, args) => new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});
await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frameDir, 'f%05d.png'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
console.log('wrote', out);
