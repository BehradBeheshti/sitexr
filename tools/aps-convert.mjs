#!/usr/bin/env node
/**
 * Convert a Revit .rvt to OBJ using Autodesk Platform Services (Model Derivative).
 *
 * Why this exists: a .rvt stores a parametric model, not a mesh. Walls are
 * curves plus types plus host constraints; the mesh only exists once Revit's
 * geometry kernel regenerates it. No open-source reader has that kernel, so the
 * only ways to get geometry out are Revit itself (File > Export > IFC/FBX),
 * the commercial ODA BimRv SDK, or this: Autodesk's own cloud service, which
 * runs the real kernel.
 *
 * This uploads the file to Autodesk. Do not run it on a model whose licence
 * forbids that.
 *
 * Setup (free, ~5 minutes, no Windows needed):
 *   1. Sign in at https://aps.autodesk.com/ with an Autodesk account.
 *   2. Create an app; choose "Model Derivative API".
 *   3. Copy the Client ID and Client Secret.
 *
 * Usage:
 *   APS_CLIENT_ID=... APS_CLIENT_SECRET=... \
 *     node tools/aps-convert.mjs "/path/to/Office Building.rvt" out/office
 *
 * Writes out/office.obj (+ .mtl and textures) and prints the next command to
 * turn it into a GLB for SiteXR.
 */

const BASE = 'https://developer.api.autodesk.com';
const ID = process.env.APS_CLIENT_ID;
const SECRET = process.env.APS_CLIENT_SECRET;

const [input, outPrefix] = process.argv.slice(2);
if (!input || !outPrefix) {
    console.error('usage: node tools/aps-convert.mjs <model.rvt> <out-prefix>');
    process.exit(2);
}
if (!ID || !SECRET) {
    console.error('APS_CLIENT_ID and APS_CLIENT_SECRET must be set. See the header of this file.');
    process.exit(2);
}

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[aps]', ...a);

async function api(path, opts = {}, token) {
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(path.startsWith('http') ? path : BASE + path, { ...opts, headers });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${path}\n${text.slice(0, 600)}`);
    try { return JSON.parse(text); } catch { return text; }
}

async function auth() {
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'data:read data:write data:create bucket:create bucket:read'
    });
    const res = await fetch(`${BASE}/authentication/v2/token`, {
        method: 'POST',
        headers: {
            Authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
    if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
    const json = await res.json();
    log('authenticated');
    return json.access_token;
}

async function ensureBucket(token, bucketKey) {
    try {
        await api('/oss/v2/buckets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucketKey, policyKey: 'transient' })
        }, token);
        log('bucket created:', bucketKey);
    } catch (e) {
        if (!/409/.test(e.message)) throw e;
        log('bucket exists:', bucketKey);
    }
}

async function upload(token, bucketKey, objectKey, buf) {
    const CHUNK = 5 * 1024 * 1024;
    const parts = Math.max(1, Math.ceil(buf.length / CHUNK));
    const signed = await api(
        `/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3upload?parts=${parts}`,
        {}, token);
    log(`uploading ${(buf.length / 1e6).toFixed(1)} MB in ${parts} part(s)`);
    for (let i = 0; i < parts; i++) {
        const slice = buf.subarray(i * CHUNK, Math.min((i + 1) * CHUNK, buf.length));
        const res = await fetch(signed.urls[i], { method: 'PUT', body: slice });
        if (!res.ok) throw new Error(`part ${i + 1} upload failed: ${res.status}`);
        log(`  part ${i + 1}/${parts} done`);
    }
    const done = await api(
        `/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/signeds3upload`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uploadKey: signed.uploadKey })
        }, token);
    log('upload complete');
    return done.objectId;
}

const toUrn = (objectId) =>
    Buffer.from(objectId).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function translate(token, urn, formats) {
    await api('/modelderivative/v2/designdata/job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ads-force': 'true' },
        body: JSON.stringify({ input: { urn }, output: { formats } })
    }, token);
    log('translation job posted:', formats.map((f) => f.type).join(', '));
}

async function waitManifest(token, urn) {
    for (let i = 0; i < 240; i++) {
        const m = await api(`/modelderivative/v2/designdata/${urn}/manifest`, {}, token);
        if (m.status === 'success' || m.status === 'failed') {
            log('manifest status:', m.status, m.progress || '');
            if (m.status === 'failed') {
                console.error(JSON.stringify(m.derivatives?.flatMap((d) => d.messages || []), null, 2));
                throw new Error('translation failed');
            }
            return m;
        }
        if (i % 6 === 0) log('translating...', m.progress || m.status);
        await sleep(5000);
    }
    throw new Error('timed out waiting for translation');
}

function findDerivatives(manifest, ext) {
    const out = [];
    const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        if (typeof node.urn === 'string' && node.urn.toLowerCase().endsWith(ext)) out.push(node.urn);
        for (const k of ['derivatives', 'children']) if (node[k]) walk(node[k]);
    };
    walk(manifest.derivatives || []);
    return out;
}

async function download(token, urn, derivativeUrn, dest) {
    const signed = await api(
        `/modelderivative/v2/designdata/${urn}/manifest/${encodeURIComponent(derivativeUrn)}/signedcookies`,
        {}, token).catch(() => null);
    let res;
    if (signed?.url) {
        res = await fetch(signed.url);
    } else {
        res = await fetch(
            `${BASE}/modelderivative/v2/designdata/${urn}/manifest/${encodeURIComponent(derivativeUrn)}`,
            { headers: { Authorization: `Bearer ${token}` } });
    }
    if (!res.ok) throw new Error(`download failed ${res.status} for ${derivativeUrn}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, buf);
    log(`wrote ${dest} (${(buf.length / 1e6).toFixed(2)} MB)`);
}

const main = async () => {
    const token = await auth();
    const buf = await readFile(input);
    const bucketKey = 'sitexr-' + createHash('sha1').update(ID).digest('hex').slice(0, 16);
    await ensureBucket(token, bucketKey);

    const objectKey = basename(input).replace(/[^\w.\-]/g, '_');
    const objectId = await upload(token, bucketKey, objectKey, buf);
    const urn = toUrn(objectId);
    log('urn:', urn);

    // Pass 1: SVF2 so the model metadata (and its 3D view GUID) exists.
    await translate(token, urn, [{ type: 'svf2', views: ['3d'] }]);
    await waitManifest(token, urn);

    const meta = await api(`/modelderivative/v2/designdata/${urn}/metadata`, {}, token);
    const view3d = (meta.data?.metadata || []).find((v) => v.role === '3d') || meta.data?.metadata?.[0];
    if (!view3d) throw new Error('no 3D view found in the model metadata');
    log('3D view:', view3d.name, view3d.guid);

    // Pass 2: OBJ for the whole model (objectIds [-1] means everything).
    await translate(token, urn, [{
        type: 'obj',
        advanced: { modelGuid: view3d.guid, objectIds: [-1], exportFileStructure: 'single' }
    }]);
    const manifest = await waitManifest(token, urn);

    const objs = findDerivatives(manifest, '.obj');
    const zips = findDerivatives(manifest, '.zip');
    if (!objs.length && !zips.length) {
        console.error(JSON.stringify(manifest, null, 2).slice(0, 4000));
        throw new Error('no OBJ derivative in the manifest');
    }
    for (const [i, d] of [...objs, ...zips].entries()) {
        const ext = d.toLowerCase().endsWith('.zip') ? '.zip' : '.obj';
        await download(token, urn, d, `${outPrefix}${i ? '-' + i : ''}${ext}`);
    }

    console.log(`
Next: turn the OBJ into a SiteXR model.

  python3 tools/fbx-to-glb.py ${outPrefix}.obj ${outPrefix}-raw.glb   # assimp reads OBJ too
  node tools/optimize-glb.mjs ${outPrefix}-raw.glb public/bim/office.glb \\
      --scale 0.3048 --double-sided --ground

(--scale 0.3048 converts feet to metres; check the printed bounds and drop the
flag if the OBJ already came out in metres.)
`);
};

main().catch((e) => { console.error('[aps] ' + e.message); process.exit(1); });
