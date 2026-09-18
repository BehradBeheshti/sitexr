// Navigation-grid collision: a floor height field, a ceiling field and a carved walkable
// mask, built offline by tools/build-navgrid.py. Implements the viewer's `Collision`
// interface (world space, metres) so the walk camera, the XR rig, spawn search and the
// teleport arc all work unchanged. Scene units are converted with `scale`.
import type { Collision, PushOut, RayHit } from '../vendor/supersplat-viewer/collision';

type NavMeta = {
    version: number;
    cell: number;
    width: number;
    height: number;
    origin: [number, number];
    scale: number;
};

const EPS = 1e-4;

export class GridCollision implements Collision {
    readonly voxelResolution: number;

    private meta: NavMeta;

    private floor: Float32Array;

    private ceiling: Float32Array;

    private walk: Uint8Array;

    private cellM: number;

    private S: number;

    /** Vertical extent (m) above the floor that a blocked cell is treated as solid. */
    private wallHeight = 2.2;

    constructor(meta: NavMeta, bin: ArrayBuffer) {
        this.meta = meta;
        const n = meta.width * meta.height;
        this.floor = new Float32Array(bin, 0, n);
        this.ceiling = new Float32Array(bin, n * 4, n);
        this.walk = new Uint8Array(bin, n * 8, n);
        this.S = meta.scale;
        this.cellM = meta.cell * meta.scale;
        this.voxelResolution = this.cellM;
    }

    static async load(jsonUrl: string): Promise<GridCollision> {
        const meta = (await (await fetch(jsonUrl)).json()) as NavMeta;
        const bin = await (await fetch(jsonUrl.replace(/\.json$/, '.bin'))).arrayBuffer();
        return new GridCollision(meta, bin);
    }

    // ---- grid access (world metres in, scene cells inside) ----------------------------------

    private cellIndex(x: number, z: number): number {
        const { cell, width, height, origin } = this.meta;
        const ix = Math.floor((x / this.S - origin[0]) / cell);
        const iz = Math.floor((z / this.S - origin[1]) / cell);
        if (ix < 0 || iz < 0 || ix >= width || iz >= height) return -1;
        return iz * width + ix;
    }

    /** Floor height (m) at a world x/z, or NaN. Bilinear across cell centres. */
    floorAt(x: number, z: number): number {
        const { cell, width, height, origin } = this.meta;
        const fx = (x / this.S - origin[0]) / cell - 0.5;
        const fz = (z / this.S - origin[1]) / cell - 0.5;
        const x0 = Math.floor(fx);
        const z0 = Math.floor(fz);
        const tx = fx - x0;
        const tz = fz - z0;
        let sum = 0;
        let wsum = 0;
        for (let dz = 0; dz <= 1; dz++) {
            for (let dx = 0; dx <= 1; dx++) {
                const xi = x0 + dx;
                const zi = z0 + dz;
                if (xi < 0 || zi < 0 || xi >= width || zi >= height) continue;
                const v = this.floor[zi * width + xi];
                if (Number.isNaN(v)) continue;
                const w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
                sum += v * w;
                wsum += w;
            }
        }
        return wsum > 0.05 ? (sum / wsum) * this.S : NaN;
    }

    walkableAt(x: number, z: number): boolean {
        const i = this.cellIndex(x, z);
        return i >= 0 && this.walk[i] === 1;
    }

    private ceilingAt(x: number, z: number): number {
        const i = this.cellIndex(x, z);
        if (i < 0) return NaN;
        const v = this.ceiling[i];
        return Number.isNaN(v) ? NaN : v * this.S;
    }

    /** True when the point is inside solid: below the floor, or in a blocked cell's wall band. */
    private solidAt(x: number, y: number, z: number): boolean {
        const f = this.floorAt(x, z);
        if (Number.isNaN(f)) return true;
        if (y <= f) return true;
        if (!this.walkableAt(x, z) && y < f + this.wallHeight) return true;
        const c = this.ceilingAt(x, z);
        return !Number.isNaN(c) && y >= c;
    }

    // ---- Collision interface ----------------------------------------------------------------------

    queryRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
        const len = Math.hypot(dx, dy, dz);
        if (len < EPS) return null;
        dx /= len;
        dy /= len;
        dz /= len;
        // Vertical rays are the common case: answer them analytically.
        if (Math.abs(dx) < EPS && Math.abs(dz) < EPS) {
            const f = this.floorAt(ox, oz);
            if (dy < 0) {
                // A downward ray reports the ground surface, never the wall band of a blocked
                // cell: ground probing (walk camera, rig, spawn search) wants the floor under
                // an object, and the object's volume is handled by the capsule queries.
                if (Number.isNaN(f)) return null;
                if (oy <= f) return { x: ox, y: oy, z: oz };
                if (oy - f <= maxDist) return { x: ox, y: f, z: oz };
                return null;
            }
            const c = this.ceilingAt(ox, oz);
            if (!Number.isNaN(c) && c >= oy && c - oy <= maxDist) return { x: ox, y: c, z: oz };
            if (!this.walkableAt(ox, oz) && !Number.isNaN(f) && oy < f + this.wallHeight) return { x: ox, y: oy, z: oz };
            return null;
        }
        // Oblique rays (teleport arc segments): march in small steps.
        const step = Math.min(0.05, this.cellM * 0.5);
        const n = Math.ceil(maxDist / step);
        let px = ox;
        let py = oy;
        let pz = oz;
        for (let i = 1; i <= n; i++) {
            const t = Math.min(maxDist, i * step);
            px = ox + dx * t;
            py = oy + dy * t;
            pz = oz + dz * t;
            if (this.solidAt(px, py, pz)) {
                const f = this.floorAt(px, pz);
                // snap a ground hit onto the floor surface
                if (!Number.isNaN(f) && py <= f + 0.02 && this.walkableAt(px, pz)) return { x: px, y: f, z: pz };
                return { x: px, y: py, z: pz };
            }
        }
        return null;
    }

    querySphere(cx: number, cy: number, cz: number, radius: number, out: PushOut): boolean {
        return this.pushOut(cx, cy, cz, radius, 0, out);
    }

    queryCapsule(cx: number, cy: number, cz: number, halfHeight: number, radius: number, out: PushOut): boolean {
        return this.pushOut(cx, cy, cz, radius, halfHeight, out);
    }

    private pushOut(cx: number, cy: number, cz: number, radius: number, halfHeight: number, out: PushOut): boolean {
        let px = 0;
        let pz = 0;
        let py = 0;
        const bottom = cy - halfHeight - radius;
        const f = this.floorAt(cx, cz);
        if (!Number.isNaN(f) && bottom < f) py = f - bottom;

        // horizontal: keep the disc out of non-walkable cells within the standing band
        const { cell, width, height, origin } = this.meta;
        const rc = radius / this.S;
        const gx = cx / this.S;
        const gz = cz / this.S;
        const x0 = Math.floor((gx - rc - origin[0]) / cell);
        const x1 = Math.floor((gx + rc - origin[0]) / cell);
        const z0 = Math.floor((gz - rc - origin[1]) / cell);
        const z1 = Math.floor((gz + rc - origin[1]) / cell);
        for (let zi = z0; zi <= z1; zi++) {
            for (let xi = x0; xi <= x1; xi++) {
                const inside = xi >= 0 && zi >= 0 && xi < width && zi < height;
                if (inside && this.walk[zi * width + xi] === 1) continue;
                // the cell's wall band must overlap the capsule vertically
                if (inside) {
                    const cf = this.floor[zi * width + xi];
                    if (!Number.isNaN(cf)) {
                        const wallTop = (cf + this.wallHeight / this.S) * this.S;
                        if (bottom > wallTop) continue;
                    }
                }
                const minX = origin[0] + xi * cell;
                const minZ = origin[1] + zi * cell;
                const qx = Math.max(minX, Math.min(gx, minX + cell));
                const qz = Math.max(minZ, Math.min(gz, minZ + cell));
                const ddx = gx - qx;
                const ddz = gz - qz;
                const d = Math.hypot(ddx, ddz);
                if (d >= rc) continue;
                if (d < 1e-6) {
                    // centre inside a blocked cell: push toward the cell's nearest edge
                    const ex = gx - minX < minX + cell - gx ? -(gx - minX) - rc : minX + cell - gx + rc;
                    px += ex;
                    continue;
                }
                const pen = rc - d;
                px += (ddx / d) * pen;
                pz += (ddz / d) * pen;
            }
        }
        px *= this.S;
        pz *= this.S;
        if (Math.abs(px) < EPS && Math.abs(pz) < EPS && py < EPS) return false;
        out.x = px;
        out.y = py;
        out.z = pz;
        return true;
    }

    /**
     * Nearest standable point to (x, z): the closest walkable cell with a known floor.
     * Used for spawn, "Go there" and tour travel, in place of the voxel lattice search,
     * which measures the floor as the highest hit across a footprint and so steps up
     * beside obstacles.
     */
    nearestStand(x: number, z: number, maxRadius = 8): { x: number; y: number; z: number } | null {
        const { cell, width, height, origin } = this.meta;
        const cx = Math.floor((x / this.S - origin[0]) / cell);
        const cz = Math.floor((z / this.S - origin[1]) / cell);
        const maxCells = Math.ceil(maxRadius / this.S / cell);
        let best: { x: number; y: number; z: number } | null = null;
        let bestD = Infinity;
        for (let r = 0; r <= maxCells; r++) {
            if (r * r * cell * cell > bestD) break;
            for (let dz = -r; dz <= r; dz++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
                    const xi = cx + dx;
                    const zi = cz + dz;
                    if (xi < 0 || zi < 0 || xi >= width || zi >= height) continue;
                    const i = zi * width + xi;
                    if (this.walk[i] !== 1) continue;
                    const f = this.floor[i];
                    if (Number.isNaN(f)) continue;
                    const d = (dx * dx + dz * dz) * cell * cell;
                    if (d >= bestD) continue;
                    bestD = d;
                    best = {
                        x: (origin[0] + (xi + 0.5) * cell) * this.S,
                        y: f * this.S,
                        z: (origin[1] + (zi + 0.5) * cell) * this.S
                    };
                }
            }
        }
        return best;
    }

    querySurfaceNormal(x: number, y: number, z: number): { nx: number; ny: number; nz: number } {
        const h = this.cellM;
        const fx1 = this.floorAt(x + h, z);
        const fx0 = this.floorAt(x - h, z);
        const fz1 = this.floorAt(x, z + h);
        const fz0 = this.floorAt(x, z - h);
        if ([fx1, fx0, fz1, fz0].some((v) => Number.isNaN(v))) return { nx: 0, ny: 1, nz: 0 };
        const nx = -(fx1 - fx0) / (2 * h);
        const nz = -(fz1 - fz0) / (2 * h);
        const len = Math.hypot(nx, 1, nz);
        return { nx: nx / len, ny: 1 / len, nz: nz / len };
    }

    isFreeAt(x: number, y: number, z: number): boolean {
        if (!this.walkableAt(x, z)) return false;
        const f = this.floorAt(x, z);
        if (Number.isNaN(f) || y < f) return false;
        const c = this.ceilingAt(x, z);
        return Number.isNaN(c) || y < c;
    }
}
