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
import { dedup, join, mergeDocuments, prune, transformMesh, weld } from '@gltf-transform/functions';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
    console.error('usage: node tools/optimize-glb.mjs in.glb out.glb [--scale n]');
    process.exit(1);
}
const scaleArg = process.argv.indexOf('--scale');
const scale = scaleArg === -1 ? 1 : Number(process.argv[scaleArg + 1]);

const io = new NodeIO();
const doc = await io.read(src);

// --merge <file>@<dy> (repeatable): bring another GLB in, lifted by dy metres.
//
// This exists for floor and ceiling finishes. An IFC gives a slab and its covering exactly
// the same surface height, and two coplanar faces stripe at any depth precision. Converting
// the finishes separately and lifting them a few millimetres settles it for good, which
// raising the near plane cannot.
for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] !== '--merge') continue;
    const [path, dyStr] = process.argv[i + 1].split('@');
    const dy = Number(dyStr ?? 0);
    const other = await io.read(path);
    const lift = other.createNode('merged').setTranslation([0, dy, 0]);
    for (const scene of other.getRoot().listScenes()) {
        for (const child of scene.listChildren()) {
            scene.removeChild(child);
            lift.addChild(child);
        }
    }
    other.getRoot().listScenes()[0].addChild(lift);
    mergeDocuments(doc, other);
    // merge() brings the other document's scenes across; fold their roots into ours.
    const scenes = doc.getRoot().listScenes();
    const main = scenes[0];
    for (const extra of scenes.slice(1)) {
        for (const child of extra.listChildren()) {
            extra.removeChild(child);
            main.addChild(child);
        }
        extra.dispose();
    }
    // a GLB holds one buffer, and merging brought a second across
    const buffers = doc.getRoot().listBuffers();
    for (const accessor of doc.getRoot().listAccessors()) accessor.setBuffer(buffers[0]);
    for (const extra of buffers.slice(1)) extra.dispose();

    console.log(`merged ${path} lifted ${dy * 1000} mm`);
}

const before = doc.getRoot().listMeshes().length;

// Bake every node's world transform into its mesh.
//
// Two traps here, both of which produce a model that looks plausible and is wrong:
//   - a mesh reached from several nodes (instanced furniture) must be copied BEFORE any
//     transform is applied, or the second instance is transformed twice;
//   - every world matrix must be read before any matrix is cleared, since clearing a
//     parent's would silently change its children's.
const nodes = doc.getRoot().listNodes();

const worldMatrices = new Map();
for (const node of nodes) {
    if (node.getMesh()) worldMatrices.set(node, node.getWorldMatrix());
}

const uses = new Map();
for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh) uses.set(mesh, (uses.get(mesh) ?? 0) + 1);
}
for (const node of nodes) {
    const mesh = node.getMesh();
    if (mesh && uses.get(mesh) > 1) node.setMesh(mesh.clone());
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    transformMesh(mesh, worldMatrices.get(node));
}
for (const node of nodes) node.setMatrix(IDENTITY);

// Z-up sources (IFC, Revit, most FBX) need the axes swapped for a Y-up runtime.
if (process.argv.includes('--z-up')) {
    // -90 degrees about X: y' = z, z' = -y, stored column-major as glTF wants
    const R = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, R);
    console.log('rotated Z-up to Y-up');
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

// Architectural exports are usually single-sided, with wall faces pointing outward. Seen
// from inside the building — which is the whole point — those walls vanish. Marking the
// materials double-sided costs nothing here and makes the model behave like a room.
if (process.argv.includes('--double-sided')) {
    for (const mat of doc.getRoot().listMaterials()) mat.setDoubleSided(true);
    console.log(`marked ${doc.getRoot().listMaterials().length} materials double-sided`);
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
