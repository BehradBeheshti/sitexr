// Prepares a converted BIM model for the app: bakes node transforms into the vertex data,
// merges duplicate material/mesh data and drops what is not drawn.
//
// Baking matters twice over. IFC is Z-up and the converter expresses that as a rotation on
// every node, and the viewer's mesh collision reads raw vertex buffers without walking the
// node hierarchy — so an unbaked model would collide in a different orientation from the
// one you see.
//
//   node tools/optimize-glb.mjs in.glb out.glb [--scale 1]
import { NodeIO, Primitive } from '@gltf-transform/core';
import { dedup, join, prune, transformMesh, weld } from '@gltf-transform/functions';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
    console.error('usage: node tools/optimize-glb.mjs in.glb out.glb [--scale n]');
    process.exit(1);
}
const scaleArg = process.argv.indexOf('--scale');
const scale = scaleArg === -1 ? 1 : Number(process.argv[scaleArg + 1]);

const io = new NodeIO();
const doc = await io.read(src);

const before = doc.getRoot().listMeshes().length;

// Bake every node's world transform into its mesh. The IFC converter expresses the
// Z-up to Y-up change as a rotation on each node, and nothing downstream (least of all
// the collision loader, which reads vertex buffers directly) applies node transforms.
const seen = new Map();
for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const matrix = node.getWorldMatrix();
    // a mesh reached from two nodes needs a copy, or the transform lands on it twice
    let target = mesh;
    if (seen.has(mesh)) {
        target = mesh.clone();
        node.setMesh(target);
    }
    seen.set(target, true);
    transformMesh(target, matrix);
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
// parents may still carry a transform; clear the whole graph now that it is baked
for (const node of doc.getRoot().listNodes()) {
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

await doc.transform(dedup(), join({ keepNamed: false }), weld(), prune());

if (scale !== 1) {
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const pos = prim.getAttribute('POSITION');
            const arr = pos.getArray().slice();
            for (let i = 0; i < arr.length; i++) arr[i] *= scale;
            pos.setArray(arr);
        }
    }
}

// A BIM model has no site: outside the footprint there is nothing to stand on, and a
// visitor who steps off the slab falls forever. Add a ground plane at the model's base so
// the building can be approached from outside. It is part of the mesh, so it is part of
// the collision too.
const groundArg = process.argv.indexOf('--ground');
if (groundArg !== -1) {
    const margin = Number(process.argv[groundArg + 1] ?? 20);
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const mesh of doc.getRoot().listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const acc = prim.getAttribute('POSITION');
            const a = acc.getMin([0, 0, 0]);
            const b = acc.getMax([0, 0, 0]);
            for (let i = 0; i < 3; i++) {
                lo[i] = Math.min(lo[i], a[i]);
                hi[i] = Math.max(hi[i], b[i]);
            }
        }
    }
    const y = lo[1];
    const x0 = lo[0] - margin;
    const x1 = hi[0] + margin;
    const z0 = lo[2] - margin;
    const z1 = hi[2] + margin;
    const buf = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
    const pos = doc.createAccessor('groundPos').setType('VEC3').setBuffer(buf)
        .setArray(new Float32Array([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1]));
    const nrm = doc.createAccessor('groundNrm').setType('VEC3').setBuffer(buf)
        .setArray(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]));
    const idx = doc.createAccessor('groundIdx').setType('SCALAR').setBuffer(buf)
        .setArray(new Uint32Array([0, 2, 1, 0, 3, 2]));
    const mat = doc.createMaterial('ground')
        .setBaseColorFactor([0.42, 0.44, 0.46, 1])
        .setRoughnessFactor(1)
        .setMetallicFactor(0)
        .setDoubleSided(true);
    const prim = doc.createPrimitive().setMode(Primitive.Mode.TRIANGLES)
        .setAttribute('POSITION', pos).setAttribute('NORMAL', nrm).setIndices(idx).setMaterial(mat);
    const mesh = doc.createMesh('ground').addPrimitive(prim);
    const node = doc.createNode('ground').setMesh(mesh);
    doc.getRoot().listScenes()[0].addChild(node);
    console.log(`ground plane at y=${y.toFixed(2)}, ${(x1 - x0).toFixed(0)}x${(z1 - z0).toFixed(0)} m`);
}

await io.write(dst, doc);
const root = doc.getRoot();
let min = [Infinity, Infinity, Infinity];
let max = [-Infinity, -Infinity, -Infinity];
let tris = 0;
for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
        const acc = prim.getAttribute('POSITION');
        const lo = acc.getMin([0, 0, 0]);
        const hi = acc.getMax([0, 0, 0]);
        for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], lo[i]);
            max[i] = Math.max(max[i], hi[i]);
        }
        tris += (prim.getIndices()?.getCount() ?? acc.getCount()) / 3;
    }
}
const fmt = (v) => v.map((n) => n.toFixed(2)).join(', ');
console.log(`meshes ${before} -> ${root.listMeshes().length}, ${Math.round(tris)} triangles`);
console.log(`bounds min (${fmt(min)})  max (${fmt(max)})  size (${fmt(max.map((v, i) => v - min[i]))})`);
