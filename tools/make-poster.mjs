// One clean 960x960 still for a site card: no interface, no markers.
//
//   node tools/make-poster.mjs <siteId> <out.webp> --fly x,y,z,lx,ly,lz
//   node tools/make-poster.mjs <siteId> <out.webp> --stand x,z,lx,ly,lz [--floor 0]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const [siteId, out] = process.argv.slice(2);
const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i === -1 ? d : process.argv[i + 1];
};
const fly = arg('fly', null);
const stand = arg('stand', null);
const floor = Number(arg('floor', 0));
const size = Number(arg('size', 960));
if (!siteId || !out || (!fly && !stand)) {
    console.error('usage: node tools/make-poster.mjs <site> <out.webp> --fly x,y,z,lx,ly,lz | --stand x,z,lx,ly,lz');
    process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary' };
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
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
const page = await browser.newPage();
await page.setViewport({ width: size, height: size });
await page.evaluateOnNewDocument(() => {
    try {
        localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ tutorialDone: true, quality: 'high' }));
    } catch { /* private mode */ }
});
await page.goto(`${base}?site=${siteId}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => {
    const b = document.getElementById('enter');
    return !!b && !b.disabled;
}, { timeout: 900000 });
await page.evaluate(() => document.getElementById('enter').click());
await new Promise((r) => setTimeout(r, 4000));

await page.evaluate(({ fly, stand, floor }) => {
    const qa = window.__sitexr;
    // hide everything that is not, and does not contain, the canvas
    const canvas = document.querySelector('canvas');
    for (const el of document.querySelectorAll('body *')) {
        if (el === canvas || el.contains(canvas) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        el.style.setProperty('display', 'none', 'important');
    }
    qa.markers?.setVisible(false);
    const cm = qa.viewer.internals.cameraManager();
    const V = qa.rig.camera.getPosition().constructor;
    if (fly) {
        const [x, y, z, lx, ly, lz] = fly.split(',').map(Number);
        qa.viewer.state.cameraMode = 'fly';
        cm.camera.look(new V(x, y, z), new V(lx, ly, lz));
    } else {
        const [x, z, lx, ly, lz] = stand.split(',').map(Number);
        const s = qa.rig.findStand(x, z, floor);
        qa.viewer.state.cameraMode = 'walk';
        cm.camera.look(new V(s.x, s.y + 1.62, s.z), new V(lx, ly, lz));
    }
    cm.snap();
    qa.viewer.app.renderNextFrame = true;
}, { fly, stand, floor });
await new Promise((r) => setTimeout(r, 3000));

const png = join(root, 'test-output', `poster-${siteId}.png`);
await page.screenshot({ path: png });
await browser.close();
server.close();

await new Promise((res, rej) => {
    const p = spawn('python3', ['-c',
        `from PIL import Image; im=Image.open(${JSON.stringify(png)}).convert('RGB'); im.save(${JSON.stringify(out)},'WEBP',quality=88,method=6); print(im.size)`],
    { stdio: 'inherit' });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`webp encode exited ${c}`))));
});
console.log('wrote', out);
