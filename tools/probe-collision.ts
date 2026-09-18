// Offline probe of the voxel collision data: ground heights under candidate viewpoints.
// Usage: npx esbuild tools/probe-collision.ts --bundle --platform=node --format=esm --outfile=<out>.mjs && node <out>.mjs
import { readFileSync } from 'node:fs';
import { VoxelCollision } from '../src/vendor/supersplat-viewer/collision/voxel-collision';
import { findCylinderSpawn } from '../src/vendor/supersplat-viewer/collision/find-spawn';

const meta = JSON.parse(readFileSync('source-assets/scene.voxel.json', 'utf8'));
const buf = readFileSync('source-assets/scene.voxel.bin');
const view = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const nodes = view.slice(0, meta.nodeCount);
const leaf = view.slice(meta.nodeCount, meta.nodeCount + meta.leafDataCount);
const col = new VoxelCollision(meta, nodes, leaf);

const ground = (x: number, z: number, fromY = 14) => col.queryRay(x, fromY, z, 0, -1, 0, 60);
const pts: Record<string, [number, number]> = {
    initialCam: [0.96, 10.46], target: [1.63, -0.83], origin: [0, 0],
    n5: [0, -5], s5: [0, 5], e5: [5, 0], w5: [-5, 0], n10: [0, -10], s10: [0, 10], e10: [10, 0], w10: [-10, 0],
    ne8: [8, -8], nw8: [-8, -8], se8: [8, 8], sw8: [-8, 8]
};
for (const [k, [x, z]] of Object.entries(pts)) {
    const g = ground(x, z);
    const free = g ? col.isFreeAt(x, g.y + 1.0, z) : false;
    console.log(k.padEnd(10), x, z, '-> ground', g ? g.y.toFixed(2) : 'none', 'free@+1m', free);
}
// a coarse height map around the origin
console.log('\nheightmap (x -20..20 step 4, z -20..20 step 4):');
for (let z = -20; z <= 20; z += 4) {
    let row = (z + '').padStart(4) + ' |';
    for (let x = -20; x <= 20; x += 4) {
        const g = ground(x, z);
        row += g ? g.y.toFixed(1).padStart(6) : '     .';
    }
    console.log(row);
}
// spawn search near the settings camera target region
const out = { x: 0, y: 0, z: 0 };
const ok = findCylinderSpawn(col, 0.96, 6, 10.46, 0.85, 0.2, out);
console.log('\ncylinder spawn near initial cam:', ok, out);
