// Dev helper: renders a site from its configured viewpoints (spawn, each point of
// interest, each tour stop) plus a top-down map, so the framing can be judged from
// screenshots. Serves dist/ itself.
//   node tools/survey.mjs <siteId> [--top 60]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const siteId = process.argv[2] ?? 'excavator';
const out = join(root, 'test-output', 'survey', siteId);
mkdirSync(out, { recursive: true });
const topArg = process.argv.indexOf('--top');
const top = topArg !== -1 ? Number(process.argv[topArg + 1]) : 40;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
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
await page.setViewport({ width: 1100, height: 700 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
await page.evaluateOnNewDocument((id) => {
    try {
        localStorage.setItem('sitexr.site', id);
        localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ tutorialDone: true, quality: 'high' }));
    } catch {
        // ignore
    }
}, siteId);
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 300000 });
await page.click('#enter');
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: join(out, '00-spawn.png') });

const place = async (name, x, z, look, eye = 1.65) => {
    const info = await page.evaluate(({ x, z, look, eye }) => {
        const qa = window.__sitexr;
        const cm = qa.viewer.internals.cameraManager();
        const stand = qa.rig.findStand(x, z);
        const V = stand.constructor;
        qa.viewer.state.cameraMode = 'walk';
        cm.camera.look(new V(stand.x, stand.y + eye, stand.z), new V(look[0], look[1], look[2]));
        cm.snap();
        qa.viewer.app.renderNextFrame = true;
        return { x: +stand.x.toFixed(2), y: +stand.y.toFixed(2), z: +stand.z.toFixed(2), asked: [x, z] };
    }, { x, z, look, eye });
    await new Promise((r) => setTimeout(r, 2200));
    await page.screenshot({ path: join(out, `${name}.png`) });
    console.log(name, 'asked', info.asked.join(','), '-> stand', `${info.x},${info.y},${info.z}`);
};

// top-down map
await page.evaluate(({ top }) => {
    const qa = window.__sitexr;
    const cm = qa.viewer.internals.cameraManager();
    const V = qa.rig.camera.getPosition().constructor;
    qa.viewer.state.cameraMode = 'fly';
    cm.camera.look(new V(0.01, top, 0.01), new V(0, 0, 0));
    cm.snap();
    qa.viewer.app.renderNextFrame = true;
}, { top });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: join(out, '01-top.png') });

// ad-hoc probe views: --views "name:x,z,lx,ly,lz;..."
const viewsArg = process.argv.indexOf('--views');
if (viewsArg !== -1) {
    for (const spec of process.argv[viewsArg + 1].split(';')) {
        const [name, nums] = spec.split(':');
        const [x, z, lx, ly, lz] = nums.split(',').map(Number);
        await place(`probe-${name}`, x, z, [lx, ly, lz]);
    }
    await browser.close();
    server.close();
    console.log('probe done ->', out);
    process.exit(0);
}

const site = await page.evaluate(() => {
    const s = window.__sitexr.site;
    return { spawn: s.spawn, pois: s.pois.map((p) => ({ id: p.id, stand: p.stand })), tour: s.tour };
});
await place('02-spawn-view', site.spawn.x, site.spawn.z, site.spawn.look);
for (const p of site.pois) await place(`poi-${p.id}`, p.stand.x, p.stand.z, p.stand.look);
for (let i = 0; i < site.tour.length; i++) {
    const t = site.tour[i];
    await place(`tour-${i}-${t.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, t.x, t.z, t.look);
}
await browser.close();
server.close();
console.log('done ->', out);
