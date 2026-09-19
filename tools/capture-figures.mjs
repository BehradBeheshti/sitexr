// Renders a large set of stills from the built site, for use in figures and slides.
//
//   npm run build && node tools/capture-figures.mjs [--width 1920] [--height 1080]
//
// For every site it captures the arrival point, each point of interest, each tour stop, a
// set of hero angles swept around the arrival point, and a plan view. Each one is written
// twice: `ui/` as a visitor sees it, and `clean/` with the interface and the markers taken
// away, which is what a figure usually wants. Interface screens are captured separately.
//
// Serves dist/ itself, so it needs a build, not a dev server.
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i === -1 ? fallback : process.argv[i + 1];
};
const WIDTH = Number(arg('--width', 1920));
const HEIGHT = Number(arg('--height', 1080));
const OUT = join(root, arg('--out', 'test-output/figures'));
const SETTLE = Number(arg('--settle', 2600));

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webp': 'image/webp', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary'
};
const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = join(dist, p);
        await stat(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let count = 0;
const shot = async (rel) => {
    const file = join(OUT, rel);
    await mkdir(dirname(file), { recursive: true });
    await page.screenshot({ path: file });
    count++;
    return rel;
};

// Hide every element that is not, and does not contain, the canvas. Collapsing the canvas's
// own ancestors would take the render with it.
const setChromeVisible = (visible) =>
    page.evaluate((show) => {
        const canvas = document.querySelector('canvas');
        for (const el of document.querySelectorAll('body *')) {
            if (el === canvas || el.contains(canvas) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            if (show) el.style.removeProperty('display');
            else el.style.setProperty('display', 'none', 'important');
        }
    }, visible);

const setMarkers = (visible) =>
    page.evaluate((v) => {
        window.__sitexr?.markers?.setVisible(v);
        window.__sitexr.viewer.app.renderNextFrame = true;
    }, visible);

/** Point the camera at a target from a standing position on `floor`. */
const place = (x, z, look, floor, eye = 1.62) =>
    page.evaluate(({ x, z, look, floor, eye }) => {
        const qa = window.__sitexr;
        const cm = qa.viewer.internals.cameraManager();
        const stand = qa.rig.findStand(x, z, floor);
        const V = stand.constructor;
        qa.viewer.state.cameraMode = 'walk';
        cm.camera.look(new V(stand.x, stand.y + eye, stand.z), new V(look[0], look[1], look[2]));
        cm.snap();
        qa.viewer.app.renderNextFrame = true;
        return { y: +stand.y.toFixed(2) };
    }, { x, z, look, floor, eye });

const planView = (height) =>
    page.evaluate((h) => {
        const qa = window.__sitexr;
        const cm = qa.viewer.internals.cameraManager();
        const V = qa.rig.camera.getPosition().constructor;
        qa.viewer.state.cameraMode = 'fly';
        cm.camera.look(new V(0.01, h, 0.01), new V(0, 0, 0));
        cm.snap();
        qa.viewer.app.renderNextFrame = true;
    }, height);

const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');

/** Both variants of the current camera, under one name. */
const pair = async (site, name) => {
    await sleep(SETTLE);
    await shot(`01-sites/${site}/ui/${name}.png`);
    await setChromeVisible(false);
    await setMarkers(false);
    await sleep(500);
    await shot(`01-sites/${site}/clean/${name}.png`);
    await setMarkers(true);
    await setChromeVisible(true);
    await sleep(200);
};

const openSite = async (id) => {
    await page.evaluateOnNewDocument((siteId) => {
        try {
            localStorage.setItem('sitexr.site', siteId);
            localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ tutorialDone: true, quality: 'high' }));
        } catch { /* private mode */ }
    }, id);
    await page.goto(`${base}?site=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 600000 });
    await page.evaluate(() => document.getElementById('enter').click());
    await sleep(4000);
};

// The chooser renders one card per site, per experience, so ask it rather than guessing.
const SITES = [];
for (const mode of ['capture', 'design']) {
    await page.goto(`${base}?mode=${mode}`, { waitUntil: 'domcontentloaded' });
    await sleep(2500);
    const ids = await page.evaluate(() =>
        [...document.querySelectorAll('#sites .site')].map((el) => el.dataset.id));
    SITES.push(...ids);
}
console.log('sites:', SITES.join(', ') || '(none)');

const LIST = SITES;
if (!LIST.length) throw new Error('no sites in the chooser — is dist/ built?');

for (const id of LIST) {
    console.log(`\n=== ${id} ===`);
    await openSite(id);
    const site = await page.evaluate(() => {
        const s = window.__sitexr.site;
        return {
            spawn: s.spawn,
            walkRadius: s.walkRadius,
            pois: s.pois.map((p) => ({ id: p.id, stand: p.stand })),
            tour: s.tour.map((t) => ({ title: t.title, x: t.x, z: t.z, look: t.look, floor: t.floor }))
        };
    });

    await place(site.spawn.x, site.spawn.z, site.spawn.look, site.spawn.floor);
    await pair(id, '00-arrival');
    console.log('  arrival');

    // hero angles: the arrival point, swept around
    const { x, z, look, floor } = site.spawn;
    for (const deg of [45, 90, 135, 180, 225, 270, 315]) {
        const a = (deg * Math.PI) / 180;
        const dx = look[0] - x;
        const dz = look[2] - z;
        const rx = dx * Math.cos(a) - dz * Math.sin(a);
        const rz = dx * Math.sin(a) + dz * Math.cos(a);
        await place(x, z, [x + rx, look[1], z + rz], floor);
        await pair(id, `10-look-${String(deg).padStart(3, '0')}`);
    }
    console.log('  7 hero angles');

    for (const [i, p] of site.pois.entries()) {
        await place(p.stand.x, p.stand.z, p.stand.look, p.stand.floor ?? site.spawn.floor);
        await pair(id, `20-poi-${i + 1}-${slug(p.id)}`);
    }
    console.log(`  ${site.pois.length} points of interest`);

    for (const [i, t] of site.tour.entries()) {
        await place(t.x, t.z, t.look, t.floor ?? site.spawn.floor);
        await pair(id, `30-tour-${i + 1}-${slug(t.title)}`);
    }
    console.log(`  ${site.tour.length} tour stops`);

    for (const h of [site.walkRadius * 0.9, site.walkRadius * 1.8]) {
        await planView(h);
        await pair(id, `40-plan-${Math.round(h)}m`);
    }
    console.log('  2 plan views');
}

// ---- interface screens -------------------------------------------------------------
console.log('\n=== interface ===');
await page.evaluateOnNewDocument(() => {
    try {
        localStorage.clear();
    } catch { /* private mode */ }
});
await page.goto(base, { waitUntil: 'domcontentloaded' });
await sleep(3500);
await shot('02-interface/00-experience-chooser.png');

for (const id of LIST) {
    await page.goto(`${base}?site=${id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 600000 });
    await sleep(1500);
    await shot(`02-interface/10-site-card-${id}.png`);
}
await page.evaluate(() => document.getElementById('open-settings')?.click());
await sleep(900);
await shot('02-interface/20-comfort-settings.png');
await page.evaluate(() => document.querySelector('#modal-settings .modal-close, #modal-settings button')?.click());
await sleep(500);
await page.evaluate(() => document.getElementById('open-credits')?.click());
await sleep(900);
await shot('02-interface/21-credits.png');

await browser.close();
server.close();
console.log(`\n${count} images -> ${OUT}`);
