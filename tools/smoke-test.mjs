// Headless verification of the production build. Serves dist/, loads the app in Chrome
// (software WebGL), waits for the scene to render, and checks the things the project
// promises: no console errors, no iframe, no SuperSplat/localhost wording in the UI,
// VR button gating, desktop + Quest-sized layouts, and the desktop walkthrough entry.
//
//   npm run build && node tools/smoke-test.mjs [--headed] [--keep]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, dirname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'test-output');
mkdirSync(outDir, { recursive: true });

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.webp': 'image/webp', '.png': 'image/png', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// tiny static server (no third-party dependency needed for the test)
const server = createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = join(dist, p);
        const s = await stat(file);
        if (!s.isFile()) throw new Error('nf');
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
    } catch {
        res.writeHead(404);
        res.end();
    }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

const chromePath = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const headed = process.argv.includes('--headed');
const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: headed ? false : 'new',
    args: [
        '--no-sandbox', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage', '--no-first-run'
    ]
});

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const runViewport = async (label, viewport, { mockVr = false } = {}) => {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors = [];
    const logs = [];
    page.on('console', (m) => {
        logs.push(`[${m.type()}] ${m.text()}`);
        if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    if (mockVr) {
        await page.evaluateOnNewDocument(() => {
            // Pretend to be a headset browser for the gating check only. No session can start.
            Object.defineProperty(navigator, 'xr', {
                value: { isSessionSupported: async (m) => m === 'immersive-vr', addEventListener() {}, removeEventListener() {} },
                configurable: true
            });
        });
    }
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.screenshot({ path: join(outDir, `${label}-loading.png`) });

    // wait for the viewer to report loaded (Enter button enabled)
    let loaded = false;
    try {
        await page.waitForFunction(() => !document.getElementById('enter')?.disabled, { timeout: 180000 });
        loaded = true;
    } catch {
        loaded = false;
    }
    check(`${label}: scene loaded from the self-hosted build`, loaded);
    await page.screenshot({ path: join(outDir, `${label}-welcome.png`) });

    const info = await page.evaluate(() => {
        const text = document.body.innerText;
        return {
            iframes: document.querySelectorAll('iframe').length,
            superSplat: /supersplat/i.test(text) || /superspl\.at/i.test(text.replace(/https?:\/\/\S+/g, '')),
            localhost: /localhost|127\.0\.0\.1/i.test(text),
            enterSub: document.getElementById('enter-sub')?.textContent,
            modeNote: document.getElementById('mode-note')?.textContent,
            title: document.title,
            scrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
            headerFooter: !!document.querySelector('nav, header.site, footer.site')
        };
    });
    check(`${label}: no iframe used`, info.iframes === 0);
    check(`${label}: no SuperSplat branding in visible text`, !info.superSplat);
    check(`${label}: no localhost wording in visible text`, !info.localhost);
    check(`${label}: no page scrollbar`, !info.scrollable);
    check(`${label}: VR entry gating`, mockVr ? /VR/.test(info.enterSub) : /Desktop/.test(info.enterSub), info.enterSub);
    check(`${label}: title`, info.title.startsWith('SiteXR'), info.title);

    if (!mockVr && loaded) {
        await page.click('#enter');
        await new Promise((r) => setTimeout(r, 2500));
        const hud = await page.evaluate(() => ({
            hudVisible: !document.getElementById('hud').hidden,
            overlayHidden: document.getElementById('overlay').hidden
        }));
        check(`${label}: desktop walkthrough entered`, hud.hudVisible && hud.overlayHidden);
        await page.screenshot({ path: join(outDir, `${label}-walkthrough.png`) });
        // start the guided tour and step once
        await page.click('#hud-tour');
        await new Promise((r) => setTimeout(r, 1500));
        const caption = await page.evaluate(() => !document.getElementById('caption').hidden && document.getElementById('caption-title').textContent);
        check(`${label}: guided tour caption shown`, !!caption, String(caption));
        await page.screenshot({ path: join(outDir, `${label}-tour.png`) });
        await page.click('#caption-next');
        await new Promise((r) => setTimeout(r, 1500));
        await page.screenshot({ path: join(outDir, `${label}-tour-2.png`) });
        await page.click('#caption-stop');
        // open the settings modal and credits
        await page.click('#hud-menu');
        await new Promise((r) => setTimeout(r, 300));
        await page.screenshot({ path: join(outDir, `${label}-settings.png`) });
        await page.keyboard.press('Escape');

        // render the in-VR surfaces in the desktop view to verify the canvas-textured panels
        const panels = await page.evaluate(async () => {
            const qa = window.__sitexr;
            if (!qa) return 'no qa handle';
            qa.menu.open();
            qa.viewer.app.renderNextFrame = true;
            await new Promise((r) => setTimeout(r, 300));
            return 'ok';
        });
        check(`${label}: VR menu panel renders in-world`, panels === 'ok', panels);
        await page.screenshot({ path: join(outDir, `${label}-vr-menu.png`) });
        await page.evaluate(async () => {
            const qa = window.__sitexr;
            qa.menu.page = 'comfort';
            qa.menu.render();
            await new Promise((r) => setTimeout(r, 200));
        });
        await page.screenshot({ path: join(outDir, `${label}-vr-comfort.png`) });
        await page.evaluate(async () => {
            const qa = window.__sitexr;
            qa.menu.page = 'about';
            qa.menu.render();
            await new Promise((r) => setTimeout(r, 200));
        });
        await page.screenshot({ path: join(outDir, `${label}-vr-about.png`) });
        await page.evaluate(async () => {
            const qa = window.__sitexr;
            qa.menu.close();
            qa.tutorial.start();
            qa.markers.openCard(qa.pois[0], true);
            await new Promise((r) => setTimeout(r, 300));
        });
        await page.screenshot({ path: join(outDir, `${label}-vr-tutorial-card.png`) });
        await page.evaluate(() => {
            const qa = window.__sitexr;
            qa.tutorial.finish();
            qa.markers.closeCard();
            qa.settings.set('tutorialDone', false);
        });
    }

    const benign = (e) => /favicon|WebGPU|GPU stall|Automatic fallback|swiftshader|GroupMarkerNotSet|ERR_BLOCKED_BY_CLIENT/i.test(e);
    const real = errors.filter((e) => !benign(e));
    check(`${label}: no runtime console errors`, real.length === 0, real.slice(0, 5).join(' | '));
    await page.close();
    return logs;
};

const logsDesktop = await runViewport('desktop', { width: 1440, height: 900 });
await runViewport('quest', { width: 1000, height: 640, deviceScaleFactor: 1 }, { mockVr: true });
await runViewport('phone', { width: 390, height: 780, deviceScaleFactor: 2 });

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in test-output/`);
if (process.argv.includes('--verbose')) console.log(logsDesktop.join('\n'));
process.exit(failed.length ? 1 : 0);
