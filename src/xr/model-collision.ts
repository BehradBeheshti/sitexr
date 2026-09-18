// Builds collision for a mesh model (a converted BIM export) from the entity that is
// already in the scene, rather than downloading the GLB a second time.
//
// The viewer ships `MeshCollision.fromGlb`, but it loads its own copy of the file and
// unloads it afterwards. The engine's loader caches by url, so that unload destroys the
// container resource the rendered model depends on and the building disappears. Reading
// the vertex buffers off the live mesh instances avoids that, costs no extra download,
// and guarantees that what you see and what stops you are the same triangles.
import { SEMANTIC_POSITION } from 'playcanvas';
import type { Entity, Mat4 } from 'playcanvas';

import { MeshCollision } from '../vendor/supersplat-viewer/collision';

type RenderLike = { meshInstances: MeshInstanceLike[] };
type MeshInstanceLike = {
    node: { getWorldTransform(): Mat4 };
    mesh: {
        vertexBuffer: {
            storage: ArrayBuffer;
            format: { elements: { name: string; offset: number; stride: number }[] };
            numVertices: number;
        } | null;
        indexBuffer: { storage: ArrayBuffer; numIndices: number; glFormat?: number }[];
        primitive: { base: number; count: number }[];
    };
};

/**
 * Collision over every triangle of `entity`, in world space.
 *
 * @param entity - the instantiated model
 * @returns collision, or null when the model has no readable geometry
 */
export const collisionFromModel = (entity: Entity): MeshCollision | null => {
    const renders = entity.findComponents('render') as unknown as RenderLike[];
    const positions: number[] = [];
    const indices: number[] = [];
    let base = 0;

    for (const render of renders) {
        for (const mi of render.meshInstances ?? []) {
            const vb = mi.mesh?.vertexBuffer;
            const ib = mi.mesh?.indexBuffer?.[0];
            if (!vb || !ib) continue;

            const element = vb.format.elements.find((e) => e.name === SEMANTIC_POSITION);
            if (!element) continue;

            const data = new Float32Array(vb.storage);
            const stride = element.stride / 4;
            const offset = element.offset / 4;
            const world = mi.node.getWorldTransform();
            const m = world.data;

            for (let v = 0; v < vb.numVertices; v++) {
                const i = offset + v * stride;
                const x = data[i];
                const y = data[i + 1];
                const z = data[i + 2];
                // transform to world: the model may be scaled, rotated or offset
                positions.push(
                    m[0] * x + m[4] * y + m[8] * z + m[12],
                    m[1] * x + m[5] * y + m[9] * z + m[13],
                    m[2] * x + m[6] * y + m[10] * z + m[14]
                );
            }

            const src = ib.numIndices > 65535 || ib.storage.byteLength / ib.numIndices === 4
                ? new Uint32Array(ib.storage)
                : new Uint16Array(ib.storage);
            for (let i = 0; i < ib.numIndices; i++) indices.push(src[i] + base);
            base += vb.numVertices;
        }
    }

    if (indices.length < 3) return null;
    return new MeshCollision(new Float32Array(positions), new Uint32Array(indices));
};
