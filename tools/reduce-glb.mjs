// Makes a big coordination model fit a headset.
//
// Three things make an exported model expensive, and they are not the same problem:
//
//   draw calls  one material per element is normal in an FBX export, and meshes can only be
//               merged when they share a material. Rounding colours together first is what
//               turns a thousand draw calls into a few dozen.
//   triangles   a Quest has a budget per frame, and a coordination model spends it on pipe
//               elbows nobody will look at closely.
//   bytes       a visitor downloads this before they can start.
//
//   node tools/reduce-glb.mjs in.glb out.glb [--target 150000] [--colors 12] [--keep-materials]
import { NodeIO, Primitive } from '@gltf-transform/core';
import { dedup, join, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
    console.error('usage: node tools/reduce-glb.mjs in.glb out.glb [--target n] [--colors n]');
    process.exit(1);
}
const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : Number(process.argv[i + 1]);
};
const target = arg('target', 150000);
const steps = arg('colors', 12);
const error = arg('error', 0.002);
const scale = arg('scale', 1);
const zUp = process.argv.includes('--z-up');
const ground = arg('ground', NaN);

/**
 * Applied on the way in, so the merge reads already-correct world positions.
 *
 * Doing this in a separate pass first is what lost the element names on two of these models:
 * a bake-and-join step renames what it merges, and the names are the only thing left to
 * colour by once an exporter has flattened every material to white.
 */
const PRE = (() => {
    const s = scale;
    // column-major, glTF order. Z-up to Y-up is x, z, -y.
    return zUp
        ? [s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, 0, 0, 1]
        : [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
})();
const mulMat = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            let v = 0;
            for (let k = 0; k < 4; k++) v += a[k * 4 + r] * b[c * 4 + k];
            o[c * 4 + r] = v;
        }
    }
    return o;
};
const keepMaterials = process.argv.includes('--keep-materials');
const byCategory = process.argv.includes('--categories');
const mute = process.argv.includes('--mute');

/**
 * Pull a colour toward something a person can stand inside.
 *
 * AutoCAD colour indices are pure primaries, and a wall of saturated yellow a metre from your
 * eyes is genuinely unpleasant in a headset. Hue is the part that carries the meaning, so
 * this keeps it and takes the saturation down, which leaves the discipline legible without
 * the glare.
 */
const muted = ([r, g, b]) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [r, g, b];
    const d = max - min;
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const hue = (() => {
        if (max === r) return ((g - b) / d + (g < b ? 6 : 0)) / 6;
        if (max === g) return ((b - r) / d + 2) / 6;
        return ((r - g) / d + 4) / 6;
    })();
    const S = Math.min(sat, 0.42);
    const L = 0.45 + l * 0.28;
    const c = (1 - Math.abs(2 * L - 1)) * S;
    const x = c * (1 - Math.abs(((hue * 6) % 2) - 1));
    const m = L - c / 2;
    const seg = Math.floor(hue * 6) % 6;
    const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][seg];
    return rgb.map((v) => v + m);
};

/**
 * Colour by what a thing is, from its element name.
 *
 * These exports came out of Navisworks with every material set to plain white, so the colour
 * is genuinely not in the file. The names survived in full, though, and a coordination model
 * is more useful coloured by discipline than it ever was in one flat grey: services read
 * against structure, and a clash is something you can see rather than infer.
 *
 * First match wins, so the order is the rule.
 */
const CATEGORIES = [
    [/sprinkler|fire\s*protection/i, 'sprinkler', [0.78, 0.20, 0.18]],
    [/\bpipe|plumb|hydronic/i, 'pipework', [0.85, 0.42, 0.25]],
    [/\bduct|air\s*terminal|diffuser|hvac/i, 'ductwork', [0.28, 0.50, 0.76]],
    [/cable|conduit|electric|lighting fixture/i, 'electrical', [0.88, 0.72, 0.22]],
    [/solar|photovolt|\bpv\b/i, 'solar array', [0.18, 0.24, 0.38]],
    [/curtain|mullion|glaz|window|system panel/i, 'glazing', [0.55, 0.68, 0.82]],
    [/\bdoor/i, 'doors', [0.70, 0.52, 0.32]],
    [/railing|guard\s*rail|handrail|balustrade/i, 'railings', [0.72, 0.74, 0.77]],
    [/stair|ramp/i, 'stairs', [0.66, 0.66, 0.68]],
    [/roof/i, 'roof', [0.52, 0.53, 0.56]],
    [/floor|slab|deck/i, 'floors', [0.80, 0.79, 0.76]],
    [/\bwall|partition/i, 'walls', [0.86, 0.85, 0.82]],
    [/column|\bpile\b/i, 'columns', [0.60, 0.57, 0.53]],
    [/beam|joist|truss|framing|brace|girder/i, 'structure', [0.69, 0.60, 0.48]],
    [/furniture|casework|desk|chair|seat/i, 'furniture', [0.62, 0.56, 0.62]],
    [/ground|topo|site|terrain/i, 'ground', [0.58, 0.63, 0.55]]
];
const categoryOf = (name) => {
    for (const [re, label, rgb] of CATEGORIES) if (re.test(name)) return { label, rgb };
    return { label: 'other', rgb: [0.74, 0.73, 0.71] };
};

const io = new NodeIO();
const doc = await io.read(src);
const root = doc.getRoot();

const countTris = () => {
    let n = 0;
    for (const mesh of root.listMeshes()) {
        for (const p of mesh.listPrimitives()) {
            const idx = p.getIndices();
            const pos = p.getAttribute('POSITION');
            n += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
        }
    }
    return Math.round(n);
};

const countVerts = () => {
    let n = 0;
    for (const mesh of root.listMeshes()) {
        for (const p of mesh.listPrimitives()) n += p.getAttribute('POSITION')?.getCount() ?? 0;
    }
    return n;
};
const before = {
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    tris: countTris(),
    verts: countVerts()
};

if (!keepMaterials) {
    // Group materials by rounded colour. An exporter writes one material per element even
    // when a hundred of them are the same grey, and each distinct material is a draw call
    // that can never be merged away.
    const key = (m) => {
        const c = m.getBaseColorFactor();
        const q = (v) => Math.round(v * steps) / steps;
        return [
            ...c.slice(0, 4).map(q),
            q(m.getMetallicFactor()),
            q(m.getRoughnessFactor()),
            m.getDoubleSided() ? 'd' : 's',
            m.getBaseColorTexture() ? m.getBaseColorTexture().getURI() || 'tex' : ''
        ].join(',');
    };
    if (mute) {
        for (const m of root.listMaterials()) {
            const c = m.getBaseColorFactor();
            m.setBaseColorFactor([...muted(c.slice(0, 3)), c[3]]);
        }
    }
    const pick = new Map();
    for (const m of root.listMaterials()) {
        const k = key(m);
        if (!pick.has(k)) pick.set(k, m);
    }
    for (const mesh of root.listMeshes()) {
        for (const p of mesh.listPrimitives()) {
            const m = p.getMaterial();
            if (!m) continue;
            const rep = pick.get(key(m));
            if (rep && rep !== m) p.setMaterial(rep);
        }
    }
    console.log(`materials ${before.materials} -> ${pick.size} colour groups (${steps} steps per channel)`);
}

/**
 * One mesh per material, built by hand.
 *
 * `join()` leaves a thousand separate meshes alone here, and it is right to be cautious:
 * it cannot know the node transforms were already baked. This can, so it concatenates
 * everything sharing a material into a single primitive. It also has to run *before*
 * simplification: a simplifier will not collapse across a mesh boundary, so a model split
 * into a thousand pieces barely reduces at all, while one continuous surface does.
 */
// An exporter often hangs the element name on a parent and calls the mesh node "Body" or
// "Geometry_0". The nearest ancestor with a name that means something is the element.
const GENERIC = /^(body|mesh|geometry|node|polygon mesh|solid|face set|composite part|root|scene)([\s_].*)?$|^$|\$assimpfbx\$/i;

const mergeByMaterial = () => {
    const groups = new Map();
    const visit = (node, parentMatrix, parentLabel) => {
        const m = mulMat(parentMatrix, node.getMatrix());
        const name = node.getName() || '';
        const label = GENERIC.test(name) ? parentLabel : name;
        const mesh = node.getMesh();
        if (mesh) collect(node, mesh, m, label);
        for (const child of node.listChildren()) visit(child, m, label);
    };

    const collect = (node, mesh, m, label) => {
        for (const prim of mesh.listPrimitives()) {
            if (prim.getMode() !== Primitive.Mode.TRIANGLES) continue;
            const mat = prim.getMaterial();
            const cat = byCategory ? categoryOf(label) : null;
            const key = cat ? cat.label : mat ? mat.getName() + root.listMaterials().indexOf(mat) : 'none';
            if (!groups.has(key)) {
                let material = mat;
                if (cat) {
                    material = doc
                        .createMaterial(cat.label)
                        .setBaseColorFactor([...cat.rgb, 1])
                        .setRoughnessFactor(0.85)
                        .setMetallicFactor(0)
                        .setDoubleSided(true);
                }
                groups.set(key, { material, pos: [], nrm: [], idx: [], base: 0 });
            }
            const g = groups.get(key);
            const pos = prim.getAttribute('POSITION');
            const nrm = prim.getAttribute('NORMAL');
            if (!pos) continue;
            const n = pos.getCount();
            const el = [];
            for (let i = 0; i < n; i++) {
                const v = pos.getElement(i, [0, 0, 0]);
                // world transform, in case anything upstream left one on a node
                g.pos.push(
                    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
                    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
                    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]
                );
                if (nrm) {
                    const w = nrm.getElement(i, el);
                    g.nrm.push(
                        m[0] * w[0] + m[4] * w[1] + m[8] * w[2],
                        m[1] * w[0] + m[5] * w[1] + m[9] * w[2],
                        m[2] * w[0] + m[6] * w[1] + m[10] * w[2]
                    );
                } else {
                    g.nrm.push(0, 1, 0);
                }
            }
            const indices = prim.getIndices();
            if (indices) {
                for (let i = 0; i < indices.getCount(); i++) g.idx.push(g.base + indices.getScalar(i));
            } else {
                for (let i = 0; i < n; i++) g.idx.push(g.base + i);
            }
            g.base += n;
        }
    };

    for (const scene of root.listScenes()) {
        for (const child of scene.listChildren()) visit(child, PRE, '');
    }

    for (const node of [...root.listNodes()]) if (node.getMesh()) node.dispose();
    for (const mesh of [...root.listMeshes()]) mesh.dispose();
    if (byCategory) {
        const keep = new Set([...groups.values()].map((g) => g.material));
        for (const m of [...root.listMaterials()]) if (!keep.has(m)) m.dispose();
    }

    if (Number.isFinite(ground)) {
        let lo = [Infinity, Infinity, Infinity];
        let hi = [-Infinity, -Infinity, -Infinity];
        for (const g of groups.values()) {
            for (let i = 0; i < g.pos.length; i += 3) {
                for (let k = 0; k < 3; k++) {
                    lo[k] = Math.min(lo[k], g.pos[i + k]);
                    hi[k] = Math.max(hi[k], g.pos[i + k]);
                }
            }
        }
        const pad = ground;
        const y = lo[1];
        const x0 = lo[0] - pad, x1 = hi[0] + pad, z0 = lo[2] - pad, z1 = hi[2] + pad;
        groups.set('ground', {
            material: doc.createMaterial('ground').setBaseColorFactor([0.58, 0.63, 0.55, 1])
                .setRoughnessFactor(1).setMetallicFactor(0).setDoubleSided(true),
            pos: [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1],
            nrm: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
            idx: [0, 2, 1, 0, 3, 2],
            base: 4
        });
        console.log(`ground plane at y=${y.toFixed(2)}, ${(x1 - x0).toFixed(0)}x${(z1 - z0).toFixed(0)} m`);
    }

    const buffer = root.listBuffers()[0] ?? doc.createBuffer();
    const scene = root.listScenes()[0] ?? doc.createScene();
    for (const [key, g] of groups) {
        if (!g.idx.length) continue;
        const prim = doc
            .createPrimitive()
            .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buffer))
            .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nrm)).setBuffer(buffer))
            .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.idx)).setBuffer(buffer));
        if (g.material) prim.setMaterial(g.material);
        const mesh = doc.createMesh(`merged-${key}`).addPrimitive(prim);
        scene.addChild(doc.createNode(`merged-${key}`).setMesh(mesh));
    }
    console.log(`merged into ${groups.size} mesh(es), one per ${byCategory ? 'category' : 'material'}`);
    if (byCategory) console.log('  ' + [...groups.keys()].join(', '));
};

mergeByMaterial();
await doc.transform(weld());

if (target > 0 && before.tris > target) {
    await MeshoptSimplifier.ready;
    const ratio = target / before.tris;
    // `error` is the cap on how far a vertex may move, as a fraction of the mesh size. Thin
    // architectural parts go to mush well before the ratio is met, so the error bound, not
    // the ratio, is what protects them.
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
}

await doc.transform(dedup(), prune());

await io.write(dst, doc);

const after = { meshes: root.listMeshes().length, materials: root.listMaterials().length, tris: countTris() };
const { size } = await import('node:fs').then((fs) => fs.promises.stat(dst));
console.log(`meshes    ${before.meshes} -> ${after.meshes}`);
console.log(`materials ${before.materials} -> ${after.materials}`);
console.log(`triangles ${before.tris.toLocaleString()} -> ${after.tris.toLocaleString()}`);
console.log(`vertices  ${before.verts.toLocaleString()} -> ${countVerts().toLocaleString()}`);
console.log(`file      ${(size / 1e6).toFixed(2)} MB`);
