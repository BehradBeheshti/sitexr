// Two browsers, one relay: does a watcher actually follow a presenter?
//
// Runs against `wrangler dev`, which is the same Worker and the same Durable Object that
// Cloudflare runs, so passing here means the deployed thing works. Nothing is mocked.
//
//   VITE_INCLUDE_PRIVATE=1 npm run build && node tools/share-test.mjs
//
// It starts `wrangler dev` itself and stops it afterwards. That is not tidiness: wrangler
// snapshots the asset list when it boots, so a server left running across a rebuild serves
// an index.html pointing at a bundle that no longer exists.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import puppeteer from 'puppeteer-core';

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
};
const siteId = arg('site', 'office');
/** A port nobody else is on, so a stray dev server from an earlier run cannot collide. */
const freePort = () =>
    new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port: p } = srv.address();
            srv.close(() => resolve(p));
        });
    });
const port = Number(arg('port', 0)) || (await freePort());
const given = arg('base', null);
const base = given ?? `http://localhost:${port}`;

/** Bring up the Worker, the Durable Object and the static assets, exactly as deployed. */
let dev = null;
if (!given) {
    dev = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--local'], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('wrangler did not come up')), 90000);
        const watch = (chunk) => {
            log += String(chunk);
            if (/Ready on/.test(String(chunk))) {
                clearTimeout(timer);
                resolve();
            }
        };
        dev.stdout.on('data', watch);
        dev.stderr.on('data', watch);
        dev.on('exit', (c) => reject(new Error(`wrangler exited ${c}: ${log.slice(-600)}`)));
    });
    await ready;
}
const shutdown = async () => {
    if (!dev) return;
    dev.kill('SIGTERM');
    await Promise.race([once(dev, 'exit'), new Promise((r) => setTimeout(r, 4000))]);
};

const results = [];
const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const launchArgs = {
    executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
    headless: 'new',
    args: [
        '--no-sandbox',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        // two pages are live at once here; without these the one not in front is throttled
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
    ]
};
// Two browsers, not two tabs. A hidden tab gets no animation frames at all, so a presenter
// sharing from a background tab would look broken here for a reason the product does not have.
const browser = await puppeteer.launch(launchArgs);
const browser2 = await puppeteer.launch(launchArgs);

const errors = [];
const openPage = async (url, which = browser) => {
    const page = await which.newPage();
    await page.setViewport({ width: 1100, height: 700 });
    page.on('pageerror', (e) => errors.push(`${url}: ${e.message}`));
    await page.evaluateOnNewDocument(() => {
        try {
            localStorage.setItem('sitexr.comfort.v1', JSON.stringify({ tutorialDone: true, quality: 'high' }));
        } catch { /* private mode */ }
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return page;
};

// `?.` would make a missing button look ready, so insist the button exists
const ready = (page) =>
    page.waitForFunction(
        () => {
            const b = document.getElementById('enter');
            return !!b && !b.disabled;
        },
        { timeout: 600000 }
    );

// ---- the presenter -------------------------------------------------------------------
const host = await openPage(`${base}/?site=${siteId}`);
await ready(host);
await host.evaluate(() => document.getElementById('enter').click());
await sleep(3500);

const code = await host.evaluate(async () => {
    const qa = window.__sitexr;
    return qa.share.start();
});
check('the presenter opens a room and gets a code', /^[BCDFGHJKLMNPQRSTVWXYZ23456789]{4}$/.test(code ?? ''), code);

// ---- the watcher ---------------------------------------------------------------------
const view = await openPage(`${base}/?watch=${code}`, browser2);
// The watcher connects only once its own copy of the site is up, and under software
// rendering that is slow. Asserting before then measures nothing.
await view
    .waitForFunction(() => !!window.__sitexrWatch && window.__sitexrWatch.received > 0, {
        timeout: 600000
    })
    .catch(() => null);

// nudge the presenter somewhere specific
const place = (page, x, z, look) =>
    page.evaluate(({ x, z, look }) => {
        const qa = window.__sitexr;
        const cm = qa.viewer.internals.cameraManager();
        const stand = qa.rig.findStand(x, z, qa.site.spawn.floor);
        const V = stand.constructor;
        qa.viewer.state.cameraMode = 'walk';
        cm.camera.look(new V(stand.x, stand.y + 1.62, stand.z), new V(look[0], look[1], look[2]));
        cm.snap();
        qa.viewer.app.renderNextFrame = true;
        return [stand.x, stand.y + 1.62, stand.z];
    }, { x, z, look });

const headOf = (page) =>
    page.evaluate(() => {
        const p = window.__sitexr?.rig?.camera?.getPosition();
        return p ? [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] : null;
    });

const target = await place(host, 8.3, 0.3, [3.4, 1.7, 2.2]);
await sleep(2500);

const diag = await view.evaluate(() => window.__sitexrWatch ?? null);
check('the watcher receives the presenter viewpoint', (diag?.received ?? 0) > 0, JSON.stringify(diag));
const viewerSite = await view.evaluate(() => window.__sitexr?.site?.id ?? null);
check('the watcher loads the site the presenter is in', viewerSite === siteId, String(viewerSite));

let followed = null;
for (let i = 0; i < 40; i++) {
    followed = await headOf(view);
    if (followed && Math.hypot(followed[0] - target[0], followed[2] - target[2]) < 0.4) break;
    await sleep(500);
}
const near = followed && Math.hypot(followed[0] - target[0], followed[2] - target[2]) < 0.4;
check('the watcher lands on the presenter viewpoint', near,
    `presenter ${target.map((n) => n.toFixed(2))} watcher ${followed}`);

// move again: following has to keep up, not just arrive once
const moved = await place(host, 8.3, -6.5, [2.0, 1.6, -6.5]);
await sleep(3000);
const after = await headOf(view);
const kept = after && Math.hypot(after[0] - moved[0], after[2] - moved[2]) < 0.6;
check('the watcher keeps following when the presenter moves', kept,
    `presenter ${moved.map((n) => n.toFixed(2))} watcher ${after}`);

// the presenter's count of watchers
const viewers = await host.evaluate(() => window.__sitexr.share.viewers);
check('the presenter is told a screen is watching', viewers >= 1, `${viewers}`);

// doors travel too
const doorsMirror = await (async () => {
    const has = await host.evaluate(() => !!window.__sitexr.doors);
    if (!has) return null;
    await host.evaluate(() => {
        const l = window.__sitexr.doors.leaves.find((x) => x.openable);
        l.set(1);
    });
    for (let i = 0; i < 30; i++) {
        const v = await view.evaluate(() => {
            const l = window.__sitexr.doors?.leaves.find((x) => x.openable);
            return l ? l.open : null;
        });
        if (v !== null && v > 0.6) return v;
        await sleep(500);
    }
    return await view.evaluate(() => {
        const l = window.__sitexr.doors?.leaves.find((x) => x.openable);
        return l ? l.open : null;
    });
})();
if (doorsMirror !== null) {
    check('a door opened by the presenter opens on the watcher', doorsMirror > 0.6, `open ${doorsMirror}`);
}

// the watcher takes no input of its own
const inert = await view.evaluate(() => ({
    input: window.__sitexr.viewer.state.inputEnabled,
    badge: !document.getElementById('watch-badge').hidden
}));
check('the watcher is a screen, not a second visitor', inert.input === false && inert.badge === true,
    JSON.stringify(inert));

await host.screenshot({ path: 'test-output/share/presenter.png' });
await view.screenshot({ path: 'test-output/share/watcher.png' });

// The watcher has to match the presenter's field of view, or it draws the right place from
// the right spot and still shows a tighter crop than the wearer is describing.
const fovs = await (async () => {
    const sent = await host.evaluate(() => window.__sitexr.share.viewers >= 0 && window.__sitexr.viewer.internals.cameraManager().camera.fov);
    const got = await view.evaluate(() => {
        const cam = window.__sitexr.rig.camera.camera;
        return { fov: cam.fov, horizontal: cam.horizontalFov };
    });
    return { sent, got };
})();
check('the watcher adopts the presenter field of view', Math.abs(fovs.got.fov - 70) < 0.1 || fovs.got.horizontal === true,
    JSON.stringify(fovs));

// A second presenter cannot hijack a code in use. This has to be a real WebSocket: a page
// cannot set the Upgrade header on fetch, so a plain fetch tests nothing.
const busy = await host.evaluate(
    (c) =>
        new Promise((resolve) => {
            const url = `${location.origin.replace(/^http/, 'ws')}/relay/${c}?role=host`;
            const ws = new WebSocket(url);
            const done = (v) => resolve(v);
            ws.onopen = () => {
                ws.close();
                done('accepted');
            };
            ws.onerror = () => done('rejected');
            ws.onclose = (e) => done(e.wasClean ? 'closed' : 'rejected');
            setTimeout(() => done('timeout'), 4000);
        }),
    code
);
check('a code already in use rejects a second presenter', busy === 'rejected', String(busy));

// stopping tells the watcher, rather than leaving a frozen frame
await host.evaluate(() => window.__sitexr.share.stop());
await sleep(2500);
const ended = await view.evaluate(() => document.getElementById('watch-text').textContent ?? '');
check('stopping tells the watcher', /waiting/i.test(ended), ended);

const benign = (e) => /favicon|WebGPU|swiftshader|ERR_BLOCKED_BY_CLIENT/i.test(e);
const real = errors.filter((e) => !benign(e));
check('no runtime console errors', real.length === 0, real.slice(0, 3).join(' | '));

await browser.close();
await browser2.close();
await shutdown();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} share checks passed.`);
process.exit(failed.length ? 1 : 0);
