// Where are the floors in this model, and where is there room to stand?
//
// Placing an arrival point by eye means loading the thing and flying around. This answers the
// two questions that matter first, straight off the geometry: which heights carry a floor,
// and which spots on a given floor have clearance in every direction.
//
//   node tools/inspect-model.mjs public/private/model.glb            # list the floors
//   node tools/inspect-model.mjs public/private/model.glb --floor 0  # where to stand on one
import { NodeIO } from '@gltf-transform/core';

const [file] = process.argv.slice(2);
if (!file) {
    console.error('usage: node tools/inspect-model.mjs model.glb [--floor y] [--cell 0.5]');
    process.exit(1);
}
const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i === -1 ? d : Number(process.argv[i + 1]);
};
const floorY = arg('floor', NaN);
const CELL = arg('cell', 0.5);
const HEAD = arg('head', 1.9);

const mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let s = 0;
            for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = s;
        }
    }
    return o;
};
const xf = (m, v) => [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
];

const doc = await new NodeIO().read(file);
const tris = [];
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const walk = (node, m) => {
    const w = mul(m, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
        for (const p of mesh.listPrimitives()) {
            const pos = p.getAttribute('POSITION');
            if (!pos) continue;
            const idx = p.getIndices();
            const n = idx ? idx.getCount() : pos.getCount();
            for (let i = 0; i < n; i += 3) {
                tris.push([0, 1, 2].map((k) => xf(w, pos.getElement(idx ? idx.getScalar(i + k) : i + k, []))));
            }
        }
    }
    for (const c of node.listChildren()) walk(c, w);
};
for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) walk(n, I);

const lo = [Infinity, Infinity, Infinity];
const hi = [-Infinity, -Infinity, -Infinity];
for (const t of tris) for (const v of t) for (let i = 0; i < 3; i++) {
    lo[i] = Math.min(lo[i], v[i]);
    hi[i] = Math.max(hi[i], v[i]);
}
const f2 = (v) => v.map((n) => n.toFixed(1)).join(', ');
console.log(`${tris.length.toLocaleString()} triangles`);
console.log(`bounds  (${f2(lo)})  to  (${f2(hi)})   size (${f2(hi.map((h, i) => h - lo[i]))})`);

/** Upward-facing area per half-metre of height: a floor shows up as a spike. */
const up = [];
const side = [];
for (const t of tris) {
    const u = [1, 2].map((i) => [0, 1, 2].map((k) => t[i][k] - t[0][k]));
    const n = [
        u[0][1] * u[1][2] - u[0][2] * u[1][1],
        u[0][2] * u[1][0] - u[0][0] * u[1][2],
        u[0][0] * u[1][1] - u[0][1] * u[1][0]
    ];
    const len = Math.hypot(...n) || 1;
    const area = len / 2;
    const y = (t[0][1] + t[1][1] + t[2][1]) / 3;
    (Math.abs(n[1] / len) > 0.85 ? up : side).push([y, area, t]);
}

if (!Number.isFinite(floorY)) {
    const band = new Map();
    for (const [y, area] of up) {
        const k = Math.round(y * 2) / 2;
        band.set(k, (band.get(k) ?? 0) + area);
    }
    const rows = [...band.entries()].filter(([, a]) => a > 20).sort((a, b) => b[1] - a[1]).slice(0, 10);
    console.log('\nheights carrying a floor (m, upward-facing area m2):');
    for (const [y, a] of rows.sort((x, z) => x[0] - z[0])) {
        console.log(`  y ${String(y).padStart(7)}   ${Math.round(a).toLocaleString().padStart(8)} m2`);
    }
    console.log('\nrerun with --floor <y> to find standing room on one of them');
    process.exit(0);
}

// occupancy on the chosen floor
const key = (a, b) => `${a},${b}`;
const floor = new Set();
const blocked = new Set();
const mark = (set, t) => {
    const x0 = Math.min(t[0][0], t[1][0], t[2][0]);
    const x1 = Math.max(t[0][0], t[1][0], t[2][0]);
    const z0 = Math.min(t[0][2], t[1][2], t[2][2]);
    const z1 = Math.max(t[0][2], t[1][2], t[2][2]);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) set.add(key(i, j));
    }
};
for (const [y, , t] of up) if (Math.abs(y - floorY) < 0.4) mark(floor, t);
for (const [, , t] of side) {
    const ys = t.map((v) => v[1]);
    if (Math.max(...ys) > floorY + 0.4 && Math.min(...ys) < floorY + HEAD) mark(blocked, t);
}

const free = [...floor].filter((k) => !blocked.has(k));
console.log(`\nfloor at y=${floorY}: ${floor.size} cells of ${CELL} m, ${free.length} of them clear`);

const clearance = (k) => {
    const [i, j] = k.split(',').map(Number);
    for (let r = 1; r <= 20; r++) {
        for (let a = -r; a <= r; a++) {
            for (const [di, dj] of [[a, -r], [a, r], [-r, a], [r, a]]) {
                if (blocked.has(key(i + di, j + dj)) || !floor.has(key(i + di, j + dj))) return r * CELL;
            }
        }
    }
    return 20 * CELL;
};
const scored = free.map((k) => {
    const [i, j] = k.split(',').map(Number);
    return { x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, c: clearance(k) };
});
scored.sort((a, b) => b.c - a.c);
const picked = [];
for (const s of scored) {
    if (picked.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 8)) continue;
    picked.push(s);
    if (picked.length >= 8) break;
}
console.log('\nopen spots (clearance m, x, z):');
for (const p of picked) console.log(`  ${p.c.toFixed(1)} m   x ${p.x.toFixed(1)}   z ${p.z.toFixed(1)}`);
