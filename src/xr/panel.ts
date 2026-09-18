// Canvas-textured quads for every in-VR surface: menu, tutorial, captions, markers.
// Text is drawn with the 2D canvas API so no font assets are needed, and every panel
// is an `Interactable` that controller rays can hover and select.
import {
    ADDRESS_CLAMP_TO_EDGE,
    BLEND_NORMAL,
    Color,
    CULLFACE_NONE,
    Entity,
    FILTER_LINEAR,
    FILTER_LINEAR_MIPMAP_LINEAR,
    Layer,
    Mat4,
    Mesh,
    MeshInstance,
    PIXELFORMAT_SRGBA8,
    PRIMITIVE_TRIANGLES,
    StandardMaterial,
    Texture,
    Vec3
} from 'playcanvas';
import type { AppBase } from 'playcanvas';

export const THEME = {
    bg: 'rgba(14, 18, 24, 0.94)',
    bgSoft: 'rgba(22, 28, 36, 0.96)',
    accent: '#f5a623',
    accentDark: '#c77f0a',
    text: '#f4f6f8',
    muted: '#9aa5b1',
    line: 'rgba(255,255,255,0.14)',
    ok: '#3ddc84',
    danger: '#ff6b6b',
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
};

export type UiHit = {
    target: Interactable;
    /** 0..1 across the surface, left to right / top to bottom. */
    u: number;
    v: number;
    dist: number;
    point: Vec3;
};

export interface Interactable {
    readonly entity: Entity;
    /** Ray test in world space. Returns true and fills `out` on a hit. */
    intersect(origin: Vec3, dir: Vec3, out: UiHit): boolean;
    onHover(hit: UiHit | null, hand: string): void;
    onSelect(hit: UiHit, hand: string): void;
}

const LAYER_NAME = 'SiteXR UI';

/** One world-space layer rendered after the splats, shared by every SiteXR surface. */
export const getUiLayer = (app: AppBase, camera: Entity): Layer => {
    let layer = app.scene.layers.getLayerByName(LAYER_NAME);
    if (!layer) {
        layer = new Layer({ name: LAYER_NAME });
        app.scene.layers.push(layer);
    }
    const cam = camera.camera;
    if (cam && !cam.layers.includes(layer.id)) {
        cam.layers = [...cam.layers, layer.id];
    }
    return layer;
};

/**
 * An unlit, alpha-blended material: emissive only, so it looks the same in every
 * lighting setup and under both the desktop and XR pipelines.
 */
export const unlitMaterial = (opts: { texture?: Texture; color?: Color; alpha?: number; depthTest?: boolean }) => {
    const m = new StandardMaterial();
    m.useLighting = false;
    m.diffuse.set(0, 0, 0);
    m.ambient.set(0, 0, 0);
    if (opts.texture) {
        m.emissiveMap = opts.texture;
        m.emissive.set(1, 1, 1);
        m.opacityMap = opts.texture;
        m.opacityMapChannel = 'a';
    } else {
        const c = opts.color ?? new Color(1, 1, 1);
        m.emissive.set(c.r, c.g, c.b);
    }
    m.opacity = opts.alpha ?? 1;
    m.blendType = BLEND_NORMAL;
    m.cull = CULLFACE_NONE;
    m.depthWrite = false;
    m.depthTest = opts.depthTest ?? false;
    m.update();
    return m;
};

const tmpMat = new Mat4();
const tmpOrigin = new Vec3();
const tmpDir = new Vec3();
const tmpVec = new Vec3();

/** Builds a unit-independent quad in the local XY plane, facing +Z, v=0 at the top. */
const createQuad = (app: AppBase, w: number, h: number): Mesh => {
    const mesh = new Mesh(app.graphicsDevice);
    const hw = w / 2;
    const hh = h / 2;
    mesh.setPositions([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]);
    mesh.setNormals([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    mesh.setUvs(0, [0, 1, 1, 1, 1, 0, 0, 0]);
    mesh.setIndices([0, 1, 2, 0, 2, 3]);
    mesh.update(PRIMITIVE_TRIANGLES);
    return mesh;
};

export type Button = {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
};

export type PanelOptions = {
    name: string;
    /** Size in metres. */
    width: number;
    height: number;
    /** Canvas pixels across the width; height follows the aspect ratio. */
    pixels?: number;
    /** Draw over everything (menus) or respect depth (markers in the scene). */
    overlay?: boolean;
};

export class Panel implements Interactable {
    readonly entity: Entity;

    readonly canvas: HTMLCanvasElement;

    readonly ctx: CanvasRenderingContext2D;

    readonly width: number;

    readonly height: number;

    readonly pxW: number;

    readonly pxH: number;

    buttons: Button[] = [];

    hover: string | null = null;

    onButton: ((id: string, hand: string) => void) | null = null;

    onHoverChange: ((id: string | null) => void) | null = null;

    /** Scale applied to the whole entity (markers grow with distance). */
    private texture: Texture;

    private material: StandardMaterial;

    private mesh: Mesh;

    private app: AppBase;

    constructor(app: AppBase, layer: Layer, opts: PanelOptions) {
        this.app = app;
        this.width = opts.width;
        this.height = opts.height;
        this.pxW = opts.pixels ?? 1024;
        this.pxH = Math.round((this.pxW * this.height) / this.width);

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.pxW;
        this.canvas.height = this.pxH;
        this.ctx = this.canvas.getContext('2d');

        this.texture = new Texture(app.graphicsDevice, {
            name: `${opts.name}-tex`,
            width: this.pxW,
            height: this.pxH,
            format: PIXELFORMAT_SRGBA8,
            mipmaps: true,
            minFilter: FILTER_LINEAR_MIPMAP_LINEAR,
            magFilter: FILTER_LINEAR,
            addressU: ADDRESS_CLAMP_TO_EDGE,
            addressV: ADDRESS_CLAMP_TO_EDGE
        });
        this.texture.setSource(this.canvas);

        this.material = unlitMaterial({ texture: this.texture, depthTest: !(opts.overlay ?? true) });

        this.mesh = createQuad(app, this.width, this.height);

        this.entity = new Entity(opts.name, app);
        this.entity.addComponent('render', {
            meshInstances: [new MeshInstance(this.mesh, this.material)],
            layers: [layer.id],
            castShadows: false,
            receiveShadows: false
        });
        this.entity.enabled = false;
        app.root.addChild(this.entity);
    }

    get visible() {
        return this.entity.enabled;
    }

    /** Whole-surface opacity multiplier (fades). */
    setAlpha(a: number) {
        this.material.opacity = a;
        this.material.update();
    }

    show() {
        this.entity.enabled = true;
        this.app.renderNextFrame = true;
    }

    hide() {
        this.entity.enabled = false;
        this.hover = null;
        this.app.renderNextFrame = true;
    }

    /** Redraws the surface. The callback receives a cleared context and the pixel size. */
    draw(fn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
        const { ctx } = this;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.pxW, this.pxH);
        fn(ctx, this.pxW, this.pxH);
        this.texture.upload();
        this.app.renderNextFrame = true;
    }

    /** Positions the panel `distance` metres ahead of the head, upright, facing the viewer. */
    placeInFront(camera: Entity, distance: number, heightOffset = -0.05) {
        const head = camera.getPosition();
        const fwd = tmpVec.copy(camera.forward);
        fwd.y = 0;
        if (fwd.length() < 1e-3) fwd.set(0, 0, -1);
        fwd.normalize();
        this.entity.setPosition(head.x + fwd.x * distance, head.y + heightOffset, head.z + fwd.z * distance);
        // +Z of the quad must face the viewer: look away from the head at the same height
        tmpOrigin.set(head.x + fwd.x * (distance + 1), head.y + heightOffset, head.z + fwd.z * (distance + 1));
        this.entity.lookAt(tmpOrigin, Vec3.UP);
    }

    /** Turns the +Z face toward a world position (billboarding). */
    faceToward(pos: Vec3, upright = false) {
        const p = this.entity.getPosition();
        tmpOrigin.set(p.x * 2 - pos.x, upright ? p.y : p.y * 2 - pos.y, p.z * 2 - pos.z);
        this.entity.lookAt(tmpOrigin, Vec3.UP);
    }

    intersect(origin: Vec3, dir: Vec3, out: UiHit): boolean {
        if (!this.entity.enabled) return false;
        tmpMat.copy(this.entity.getWorldTransform()).invert();
        tmpMat.transformPoint(origin, tmpOrigin);
        tmpMat.transformVector(dir, tmpDir);
        if (Math.abs(tmpDir.z) < 1e-6) return false;
        const t = -tmpOrigin.z / tmpDir.z;
        if (t <= 0) return false;
        const x = tmpOrigin.x + tmpDir.x * t;
        const y = tmpOrigin.y + tmpDir.y * t;
        const hw = this.width / 2;
        const hh = this.height / 2;
        if (x < -hw || x > hw || y < -hh || y > hh) return false;
        out.target = this;
        out.u = (x + hw) / this.width;
        out.v = (hh - y) / this.height;
        out.dist = t;
        out.point.copy(dir).mulScalar(t).add(origin);
        return true;
    }

    buttonAt(u: number, v: number): Button | null {
        const px = u * this.pxW;
        const py = v * this.pxH;
        for (const b of this.buttons) {
            if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
        }
        return null;
    }

    onHover(hit: UiHit | null, _hand: string) {
        const id = hit ? (this.buttonAt(hit.u, hit.v)?.id ?? null) : null;
        if (id !== this.hover) {
            this.hover = id;
            this.onHoverChange?.(id);
        }
    }

    onSelect(hit: UiHit, hand: string) {
        const b = this.buttonAt(hit.u, hit.v);
        if (b) this.onButton?.(b.id, hand);
    }

    destroy() {
        this.entity.destroy();
        this.material.destroy();
        this.texture.destroy();
        this.mesh.destroy();
    }
}

// ---- drawing helpers ------------------------------------------------------------------

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
};

export const wrapText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number
): number => {
    const words = text.split(' ');
    let line = '';
    let yy = y;
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, yy);
            line = word;
            yy += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) {
        ctx.fillText(line, x, yy);
        yy += lineHeight;
    }
    return yy;
};

export type ButtonStyle = {
    hover?: boolean;
    primary?: boolean;
    active?: boolean;
    danger?: boolean;
    size?: number;
};

export const drawButton = (
    ctx: CanvasRenderingContext2D,
    b: Button,
    label: string,
    style: ButtonStyle = {}
) => {
    const { hover, primary, active, danger } = style;
    ctx.save();
    roundRect(ctx, b.x, b.y, b.w, b.h, 14);
    if (primary) {
        ctx.fillStyle = hover ? '#ffbf4d' : THEME.accent;
    } else if (active) {
        ctx.fillStyle = hover ? 'rgba(245,166,35,0.45)' : 'rgba(245,166,35,0.3)';
    } else if (danger) {
        ctx.fillStyle = hover ? 'rgba(255,107,107,0.35)' : 'rgba(255,107,107,0.18)';
    } else {
        ctx.fillStyle = hover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
    }
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = active || primary ? THEME.accent : hover ? 'rgba(255,255,255,0.5)' : THEME.line;
    ctx.stroke();
    ctx.fillStyle = primary ? '#141414' : THEME.text;
    ctx.font = `600 ${style.size ?? 30}px ${THEME.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.restore();
};

/** Standard dark panel background with a thin amber header rule. */
export const drawPanelBackground = (ctx: CanvasRenderingContext2D, w: number, h: number, title?: string) => {
    roundRect(ctx, 0, 0, w, h, 36);
    ctx.fillStyle = THEME.bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = THEME.line;
    ctx.stroke();
    if (title) {
        ctx.fillStyle = THEME.accent;
        ctx.fillRect(48, 84, 56, 6);
        ctx.fillStyle = THEME.text;
        ctx.font = `700 44px ${THEME.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(title, 48, 70);
    }
};
