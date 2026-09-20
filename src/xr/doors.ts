// Openable doors for a design model.
//
// A Revit door is one element holding a frame and a panel, and only the panel should swing.
// `tools/ifc-doors.py` splits them and writes each leaf in its own hinge frame: vertices
// relative to the hinge, plus the rigid transform that puts that hinge in the world. Opening
// a leaf is then a rotation about one entity's local Y, with no matrix work per frame.
//
// The building's own glb carries no door geometry at all, so the static collision mesh has
// open holes where the doorways are. A closed leaf puts its own box back, which is what lets
// a door both block you and get out of your way.
import { BoundingBox, Color, Entity, Geometry, Mat4, Mesh, MeshInstance, Quat, StandardMaterial, Vec3 } from 'playcanvas';
import type { AppBase, Layer } from 'playcanvas';

import type { Interactable, UiHit } from './panel';

type LeafData = {
    door: string;
    guid: string;
    operation: string;
    side: string | null;
    position: [number, number, number];
    rotation: [number, number, number, number];
    sign: number;
    maxAngle: number;
    width: number;
    height: number;
    thickness: number;
    color: [number, number, number];
    positions: number[];
    normals: number[];
    indices: number[];
};

type DoorFile = {
    leaves: LeafData[];
    frames?: { positions: number[]; normals?: number[]; indices: number[]; colors?: number[] };
};

/** Seconds for a leaf to travel its full swing. */
const SWING_TIME = 0.75;
/** How long a visitor has to lean on a closed door before it gives way. */
const PUSH_TO_OPEN = 0.35;

const smooth = (t: number) => t * t * (3 - 2 * t);

const tmpM = new Mat4();
const tmpA = new Vec3();
const tmpB = new Vec3();
const tmpC = new Vec3();

const buildMesh = (
    app: AppBase,
    positions: number[],
    normals: number[] | undefined,
    indices: number[]
) => {
    const geometry = new Geometry();
    geometry.positions = positions;
    if (normals) geometry.normals = normals;
    geometry.indices = indices;
    return Mesh.fromGeometry(app.graphicsDevice, geometry);
};

const material = (rgb: [number, number, number], app: AppBase) => {
    const m = new StandardMaterial();
    m.diffuse = new Color(rgb[0], rgb[1], rgb[2]);
    m.gloss = 0.35;
    m.useMetalness = false;
    m.cull = 0; // CULLFACE_NONE: a door is seen from both sides
    m.update();
    return m;
};

export class DoorLeaf implements Interactable {
    readonly entity: Entity;

    /** Child of {@link entity}; this is what actually swings. */
    private readonly panel: Entity;

    private readonly data: LeafData;

    private readonly box: BoundingBox;

    private readonly mat: StandardMaterial;

    private readonly baseColor: Color;

    private readonly app: AppBase;

    /** 0 shut, 1 fully open. */
    open = 0;

    private target = 0;

    private hovered = false;

    private leanTime = 0;

    constructor(app: AppBase, parent: Entity, layer: Layer, data: LeafData) {
        this.data = data;
        this.app = app;
        this.entity = new Entity(`door-${data.guid}-${data.side ?? 'fixed'}`, app);
        this.entity.setLocalPosition(data.position[0], data.position[1], data.position[2]);
        this.entity.setLocalRotation(
            new Quat(data.rotation[0], data.rotation[1], data.rotation[2], data.rotation[3])
        );

        this.panel = new Entity('leaf', app);
        this.mat = material(data.color, app);
        this.baseColor = this.mat.diffuse.clone();
        const mesh = buildMesh(app, data.positions, data.normals, data.indices);
        const instance = new MeshInstance(mesh, this.mat, this.panel);
        this.panel.addComponent('render', { meshInstances: [instance], castShadows: false });
        this.entity.addChild(this.panel);
        parent.addChild(this.entity);

        // local bounds, for both the ray test and the block test
        const min = new Vec3(Infinity, Infinity, Infinity);
        const max = new Vec3(-Infinity, -Infinity, -Infinity);
        for (let i = 0; i < data.positions.length; i += 3) {
            min.x = Math.min(min.x, data.positions[i]);
            min.y = Math.min(min.y, data.positions[i + 1]);
            min.z = Math.min(min.z, data.positions[i + 2]);
            max.x = Math.max(max.x, data.positions[i]);
            max.y = Math.max(max.y, data.positions[i + 1]);
            max.z = Math.max(max.z, data.positions[i + 2]);
        }
        this.box = new BoundingBox();
        this.box.setMinMax(min, max);
    }

    get openable() {
        return this.data.maxAngle > 0;
    }

    get label() {
        return this.data.door;
    }

    get shut() {
        return this.open < 0.08;
    }

    /**
     * World position of the middle of the leaf. The mesh runs from the hinge, and which way
     * it runs depends on the side, so the entity's own axes are not a shortcut to this.
     */
    centre(out = new Vec3()): Vec3 {
        const c = this.box.center;
        this.panel.getWorldTransform().transformPoint(tmpA.set(c.x, c.y, c.z), out);
        return out;
    }

    toggle() {
        if (!this.openable) return;
        this.target = this.target > 0.5 ? 0 : 1;
    }

    set(openValue: number) {
        if (!this.openable) return;
        this.target = openValue;
    }

    /** Advances the swing. Returns true while the leaf is still moving. */
    update(dt: number): boolean {
        if (this.open === this.target) return false;
        const step = dt / SWING_TIME;
        this.open = this.open < this.target
            ? Math.min(this.target, this.open + step)
            : Math.max(this.target, this.open - step);
        this.panel.setLocalEulerAngles(0, smooth(this.open) * this.data.maxAngle * this.data.sign, 0);
        return true;
    }

    /** World point into this leaf's own frame. */
    private toLocal(x: number, y: number, z: number, out: Vec3) {
        tmpM.copy(this.panel.getWorldTransform()).invert();
        return tmpM.transformPoint(tmpA.set(x, y, z), out);
    }

    // ---- Interactable ------------------------------------------------------------------

    intersect(origin: Vec3, dir: Vec3, out: UiHit): boolean {
        if (!this.openable) return false;
        tmpM.copy(this.panel.getWorldTransform()).invert();
        const o = tmpM.transformPoint(origin, tmpB);
        const d = tmpM.transformVector(dir, tmpC);

        // slab test against the leaf's local box, thickened so a thin panel is still easy
        // to point at from across a room
        const pad = Math.max(0, 0.03 - this.data.thickness * 0.5);
        let near = 0;
        let far = Infinity;
        const lo = [this.box.getMin().x - pad, this.box.getMin().y, this.box.getMin().z - pad];
        const hi = [this.box.getMax().x + pad, this.box.getMax().y, this.box.getMax().z + pad];
        const op = [o.x, o.y, o.z];
        const dp = [d.x, d.y, d.z];
        for (let i = 0; i < 3; i++) {
            if (Math.abs(dp[i]) < 1e-8) {
                if (op[i] < lo[i] || op[i] > hi[i]) return false;
                continue;
            }
            let t0 = (lo[i] - op[i]) / dp[i];
            let t1 = (hi[i] - op[i]) / dp[i];
            if (t0 > t1) [t0, t1] = [t1, t0];
            near = Math.max(near, t0);
            far = Math.min(far, t1);
            if (near > far) return false;
        }
        if (far < 0) return false;
        const t = near > 0 ? near : far;
        out.target = this;
        out.dist = t;
        out.u = 0.5;
        out.v = 0.5;
        out.point.copy(dir).mulScalar(t).add(origin);
        return true;
    }

    onHover(hit: UiHit | null) {
        const h = !!hit;
        if (h === this.hovered) return;
        this.hovered = h;
        this.mat.diffuse.copy(this.baseColor);
        if (h) {
            this.mat.diffuse.r = Math.min(1, this.baseColor.r + 0.22);
            this.mat.diffuse.g = Math.min(1, this.baseColor.g + 0.19);
            this.mat.diffuse.b = Math.min(1, this.baseColor.b + 0.1);
        }
        this.mat.update();
        this.app.renderNextFrame = true;
    }

    onSelect() {
        this.toggle();
    }

    // ---- blocking ----------------------------------------------------------------------

    /**
     * Push a capsule out of this leaf, if it is inside one. Returns true and fills `out`
     * with the world-space correction. Leaning on a shut door for a moment opens it instead,
     * so nobody is ever walled in by a door they could have opened.
     */
    resolve(x: number, y: number, z: number, radius: number, dt: number, out: Vec3): boolean {
        const p = this.toLocal(x, y, z, tmpB);
        const min = this.box.getMin();
        const max = this.box.getMax();
        if (p.y < min.y - 0.1 || p.y > max.y + 0.1) {
            this.leanTime = 0;
            return false;
        }
        const dx = Math.min(p.x - (min.x - radius), (max.x + radius) - p.x);
        const dz = Math.min(p.z - (min.z - radius), (max.z + radius) - p.z);
        if (dx <= 0 || dz <= 0) {
            this.leanTime = 0;
            return false;
        }

        if (this.openable) {
            this.leanTime += dt;
            if (this.leanTime > PUSH_TO_OPEN) {
                this.set(1);
                this.leanTime = 0;
                return false;
            }
        }

        // smallest way out, in the leaf's own axes
        tmpC.set(0, 0, 0);
        if (dx < dz) tmpC.x = p.x > 0.5 * (min.x + max.x) ? dx : -dx;
        else tmpC.z = p.z > 0.5 * (min.z + max.z) ? dz : -dz;
        tmpM.copy(this.panel.getWorldTransform());
        tmpM.transformVector(tmpC, out);
        out.y = 0;
        return out.lengthSq() > 1e-10;
    }

    /** Does this leaf stand in the way of a point? Used to reject teleport targets. */
    obstructs(x: number, y: number, z: number, radius: number): boolean {
        const p = this.toLocal(x, y, z, tmpB);
        const min = this.box.getMin();
        const max = this.box.getMax();
        if (p.y < min.y || p.y > max.y) return false;
        return (
            p.x > min.x - radius && p.x < max.x + radius &&
            p.z > min.z - radius && p.z < max.z + radius
        );
    }
}

export class DoorSet {
    readonly leaves: DoorLeaf[] = [];

    readonly root: Entity;

    private readonly app: AppBase;

    private constructor(app: AppBase, parent: Entity, layer: Layer, file: DoorFile) {
        this.app = app;
        this.root = new Entity('doors', app);
        parent.addChild(this.root);

        for (const leaf of file.leaves) this.leaves.push(new DoorLeaf(app, this.root, layer, leaf));

        const frames = file.frames;
        if (frames?.positions.length) {
            const e = new Entity('door-frames', app);
            const mesh = buildMesh(app, frames.positions, frames.normals, frames.indices);
            const mat = new StandardMaterial();
            mat.diffuse = new Color(0.46, 0.27, 0.2);
            mat.gloss = 0.3;
            mat.useMetalness = false;
            mat.cull = 0;
            mat.update();
            e.addComponent('render', { meshInstances: [new MeshInstance(mesh, mat, e)], castShadows: false });
            this.root.addChild(e);
        }
    }

    static async load(url: string, app: AppBase, parent: Entity, layer: Layer): Promise<DoorSet> {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`doors ${res.status} for ${url}`);
        return new DoorSet(app, parent, layer, (await res.json()) as DoorFile);
    }

    get openable() {
        return this.leaves.filter((l) => l.openable);
    }

    update(dt: number) {
        // The viewer draws on demand, so a swinging leaf has to ask for the frames it needs
        // or it changes angle without anything being redrawn.
        let moving = false;
        for (const l of this.leaves) moving = l.update(dt) || moving;
        if (moving) this.app.renderNextFrame = true;
    }

    closeAll() {
        for (const l of this.leaves) l.set(0);
    }

    /** Accumulated push-out for a capsule standing at (x, z) on floor `y`. */
    resolve(x: number, y: number, z: number, radius: number, dt: number, out: Vec3): boolean {
        out.set(0, 0, 0);
        let hit = false;
        for (const l of this.leaves) {
            if (l.resolve(x, y, z, radius, dt, tmpA)) {
                out.add(tmpA);
                hit = true;
            }
        }
        return hit;
    }

    obstructs(x: number, y: number, z: number, radius = 0.3): boolean {
        return this.leaves.some((l) => l.obstructs(x, y, z, radius));
    }

    /** Test-harness view of what the doors are doing. */
    debugState() {
        return this.leaves.map((l) => ({
            door: l.label,
            openable: l.openable,
            open: +l.open.toFixed(2),
            shut: l.shut
        }));
    }
}
