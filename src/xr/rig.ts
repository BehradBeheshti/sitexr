// The XR rig: owns the camera parent entity while an immersive session runs.
//
// Locomotion builds on the engine's XrNavigation script (left stick move, right stick
// snap/smooth turn, ballistic teleport arc) and extends it with what a real site needs:
//   - terrain following from the voxel collision data, so the floor is the mud, not y=0
//   - a walk capsule that stops visitors walking through the excavator or off the scan
//   - validated teleport targets (standable, not too steep, headroom)
//   - blink transitions (fade to black) for teleports, resets and the guided tour
//   - a comfort vignette during smooth movement
//   - controller rays that hover/select SiteXR surfaces, with haptic feedback
import { Color, Entity, EventHandler, Vec3, math } from 'playcanvas';
import type { AppBase, Layer, StandardMaterial, XrInputSource } from 'playcanvas';
import { XrNavigation } from 'playcanvas/scripts/esm/xr/xr-navigation.mjs';


import { FOVEATION, FRAMEBUFFER_SCALE, SPEEDS, settings } from '../settings';
import type { Collision } from '../vendor/supersplat-viewer/collision';
import { findCylinderSpawn } from '../vendor/supersplat-viewer/collision/find-spawn';
import { Panel, THEME, unlitMaterial } from './panel';
import type { Interactable, UiHit } from './panel';

export type Hand = 'left' | 'right';

/** Gamepad button slots of the WebXR `xr-standard` mapping. */
export const BUTTON = { trigger: 0, squeeze: 1, stick: 3, primary: 4, secondary: 5 } as const;
export type ButtonName = keyof typeof BUTTON;

const tmpV1 = new Vec3();
const tmpV2 = new Vec3();
const tmpV3 = new Vec3();
const push = { x: 0, y: 0, z: 0 };

const yawOf = (forward: Vec3) => Math.atan2(-forward.x, -forward.z) * math.RAD_TO_DEG;

/** Engine navigation with SiteXR's teleport commit: a blink, not a snap. */
class SiteXrNavigation extends (XrNavigation as any) {
    static scriptName = 'siteXrNavigation';

    onTeleport: ((point: Vec3) => void) | null = null;

    /** 'head' walks where you look; 'controller' walks where the left hand points. */
    steering: 'head' | 'controller' = 'head';

    /**
     * The engine walks relative to the camera, which is what most people expect: push the
     * stick and go where you are looking. Steering with the hand instead lets you walk one
     * way while looking another, which some people much prefer on a site.
     */
    _handleMovement(inputSource: XrInputSource, dt: number) {
        if (this.steering !== 'controller') {
            super._handleMovement(inputSource, dt);
            return;
        }
        const gp = inputSource.gamepad;
        if (!gp) return;
        const sx = gp.axes[2];
        const sy = gp.axes[3];
        const mag = Math.hypot(sx, sy);
        if (mag <= this.movementThreshold) return;

        const dir = inputSource.getDirection();
        let fx = dir.x;
        let fz = dir.z;
        const flat = Math.hypot(fx, fz);
        if (flat < 1e-4) return;
        fx /= flat;
        fz /= flat;
        // right-hand basis with Y up: right = forward x up
        const rx = -fz;
        const rz = fx;
        const nx = sx / mag;
        const ny = sy / mag;
        const step = this.movementSpeed * dt;
        this.entity.translate((rx * nx - fx * ny) * step, 0, (rz * nx - fz * ny) * step);
    }

    tryTeleport(inputSource: XrInputSource) {
        const rec = this._arcHits.get(inputSource);
        if (!rec?.valid) return;
        this.onTeleport?.(rec.point.clone());
    }
}

type HandState = {
    source: XrInputSource;
    pressed: boolean[];
    laser: Entity;
    cursor: Entity;
    hit: UiHit | null;
    hoverTarget: Interactable | null;
};

export class XrRig {
    readonly events = new EventHandler();

    readonly app: AppBase;

    readonly camera: Entity;

    /** The camera's parent: what locomotion moves. */
    readonly rig: Entity;

    readonly layer: Layer;

    collision: Collision | null;

    nav: any;

    /** Surfaces controller rays can hit. */
    readonly interactables = new Set<Interactable>();

    /** While set, thumbstick locomotion and teleport are suspended (menus, tutorial prompts). */
    locked = false;

    /** Ground under the head on the last valid frame; the teleport arc and reset use it. */
    lastSafe = { x: 0, z: 0, ground: 0, valid: false };

    private hands = new Map<XrInputSource, HandState>();

    private fadePanel: Panel;

    private vignettePanel: Panel;

    private fadeAlpha = 0;

    private fadeTarget = 0;

    private fadeSpeed = 6;

    private fadeResolve: (() => void) | null = null;

    private vignetteAlpha = 0;

    private xrFrames = 0;

    settleFrames = 0;

    lastGround: number | null = null;

    private laserMat: StandardMaterial;

    private cursorMat: StandardMaterial;

    /** Arrival point and look target (world metres). */
    spawn: { x: number; z: number; look: [number, number, number] };

    /** Visitors are kept within this radius of the scene origin. */
    walkRadius: number;

    private onSettings: () => void;

    constructor(
        app: AppBase,
        camera: Entity,
        collision: Collision | null,
        layer: Layer,
        opts: { spawn: { x: number; z: number; look: [number, number, number] }; walkRadius: number }
    ) {
        this.app = app;
        this.spawn = opts.spawn;
        this.walkRadius = opts.walkRadius;
        this.camera = camera;
        this.rig = camera.parent as Entity;
        this.collision = collision;
        this.layer = layer;

        // navigation script (the viewer already gave the rig a script component)
        if (!this.rig.script) this.rig.addComponent('script');
        this.nav = this.rig.script.create(SiteXrNavigation as any);
        this.nav.enableSnapVertical = false;
        this.nav.maxTeleportDistance = 12;
        this.nav.teleportArcSpeed = 9;
        this.nav.validTeleportColor = new Color(0.96, 0.65, 0.14);
        this.nav.invalidTeleportColor = new Color(0.9, 0.35, 0.3);
        this.nav.teleportIndicatorRadius = 0.28;
        this.nav.castRay = (from: Vec3, to: Vec3) => this.castTeleportRay(from, to);
        this.nav.onTeleport = (point: Vec3) => {
            this.blinkTo(point.x, point.y, point.z).then(() => this.events.fire('teleport', point));
        };
        this.applyComfort();
        this.onSettings = () => this.applyComfort();
        settings.events.on('change', this.onSettings);

        // fade + vignette quads ride on the camera
        this.fadePanel = new Panel(app, layer, { name: 'xr-fade', width: 3, height: 3, pixels: 8, overlay: true });
        this.fadePanel.draw((ctx, w, h) => {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);
        });
        this.fadePanel.entity.reparent(camera);
        this.fadePanel.entity.setLocalPosition(0, 0, -0.5);
        this.fadePanel.entity.setLocalEulerAngles(0, 180, 0);

        this.vignettePanel = new Panel(app, layer, { name: 'xr-vignette', width: 1.7, height: 1.7, pixels: 512, overlay: true });
        this.vignettePanel.draw((ctx, w, h) => {
            const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.5);
            g.addColorStop(0, 'rgba(0,0,0,0)');
            g.addColorStop(0.55, 'rgba(0,0,0,0)');
            g.addColorStop(1, 'rgba(0,0,0,0.92)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
        });
        this.vignettePanel.entity.reparent(camera);
        this.vignettePanel.entity.setLocalPosition(0, 0, -0.5);
        this.vignettePanel.entity.setLocalEulerAngles(0, 180, 0);
        this.setPanelAlpha(this.fadePanel, 0);
        this.setPanelAlpha(this.vignettePanel, 0);

        this.laserMat = unlitMaterial({ color: new Color(0.96, 0.65, 0.14), alpha: 0.75 });
        this.cursorMat = unlitMaterial({ color: new Color(1, 1, 1), alpha: 0.95 });

        app.xr.on('start', () => this.onSessionStart());
        app.xr.on('end', () => this.onSessionEnd());
        app.xr.input.on('add', (src: XrInputSource) => this.addHand(src));
        app.xr.input.on('remove', (src: XrInputSource) => this.removeHand(src));
        app.on('update', (dt: number) => {
            if (app.xr.active) this.update(dt);
        });
    }

    // ---- session ---------------------------------------------------------------------

    get active() {
        return this.app.xr.active;
    }

    /** Must be called from a user gesture. Resolves when the session is running. */
    enterVr(): Promise<void> {
        return new Promise((resolve, reject) => {
            const cam = this.camera.camera;
            const scale = FRAMEBUFFER_SCALE[settings.get().quality];
            this.camera.camera.nearClip = 0.02;
            this.camera.camera.farClip = 400;
            this.app.xr.start(cam, 'immersive-vr', 'local-floor', {
                framebufferScaleFactor: scale,
                optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
                callback: (err: Error | null) => (err ? reject(err) : resolve())
            });
        });
    }

    exitVr() {
        if (this.app.xr.active) this.app.xr.end();
    }

    private onSessionStart() {
        this.xrFrames = 0;
        this.settleFrames = 0;
        this.lastGround = null;
        this.lastSafe.valid = false;
        // hold black until the visitor has been placed on the spawn (third XR frame)
        this.fadeAlpha = 1;
        this.fadeTarget = 1;
        this.setPanelAlpha(this.fadePanel, 1);
        this.fadePanel.show();
        // Fixed foveation drops resolution at the edge of the lens, away from where the eye
        // is pointed. On a splat scene that is close to free performance. The governor
        // raises it further when it has to hold detail back.
        try {
            if (this.app.xr.fixedFoveation !== null) {
                this.app.xr.fixedFoveation = FOVEATION[settings.get().quality];
            }
        } catch {
            // not supported on this device
        }
        this.events.fire('session:start');
    }

    private onSessionEnd() {
        for (const h of [...this.hands.keys()]) this.removeHand(h);
        this.fadePanel.hide();
        this.vignettePanel.hide();
        this.locked = false;
        this.events.fire('session:end');
    }

    // ---- terrain -----------------------------------------------------------------------

    /** Highest ground under (x, z) probing down from `fromY`. */
    groundAt(x: number, z: number, fromY = 14, range = 40): number | null {
        if (!this.collision) return 0;
        const hit = this.collision.queryRay(x, fromY, z, 0, -1, 0, range);
        return hit ? hit.y : null;
    }

    /** Nearest standable floor point to (x, z): what the tour and "Go there" use. */
    findStand(x: number, z: number, hintY?: number): Vec3 {
        // A navigation grid answers this directly and exactly; the voxel lattice search is
        // the fallback for scenes that ship voxel collision data.
        const grid = this.collision as unknown as {
            nearestStand?: (x: number, z: number) => { x: number; y: number; z: number } | null;
        };
        if (grid?.nearestStand) {
            const hit = grid.nearestStand(x, z);
            if (hit) return new Vec3(hit.x, hit.y, hit.z);
        }
        const g = hintY ?? this.groundAt(x, z) ?? 0;
        const out = { x, y: g, z };
        if (this.collision && findCylinderSpawn(this.collision, x, g + 0.9, z, 0.95, 0.25, out)) {
            return new Vec3(out.x, out.y, out.z);
        }
        return new Vec3(x, g, z);
    }

    probeGround(x: number, z: number, floorY: number): number | null {
        if (!this.collision) return 0;
        const r = 0.22;
        const fromY = floorY + 1.05;
        let total = 0;
        let n = 0;
        for (let i = 0; i < 5; i++) {
            const ox = x + (i === 1 ? -r : i === 2 ? r : 0);
            const oz = z + (i === 3 ? -r : i === 4 ? r : 0);
            const hit = this.collision.queryRay(ox, fromY, oz, 0, -1, 0, 2.6);
            if (hit) {
                total += hit.y;
                n++;
            }
        }
        return n >= 3 ? total / n : null;
    }

    private castTeleportRay(from: Vec3, to: Vec3): Vec3 | null {
        if (!this.collision) return null;
        tmpV1.sub2(to, from);
        const len = tmpV1.length();
        if (len < 1e-4) return null;
        tmpV1.mulScalar(1 / len);
        const hit = this.collision.queryRay(from.x, from.y, from.z, tmpV1.x, tmpV1.y, tmpV1.z, len);
        if (!hit) return null;
        const point = new Vec3(hit.x, hit.y, hit.z);
        // Standable: within the site, not a wall/steep bank, with headroom for a person
        const inSite = Math.hypot(point.x, point.z) <= this.walkRadius;
        const n = this.collision.querySurfaceNormal(point.x, point.y, point.z, tmpV1.x, tmpV1.y, tmpV1.z);
        const walkable = n.ny >= 0.6;
        const headroom = !this.collision.queryRay(point.x, point.y + 0.3, point.z, 0, 1, 0, 1.6);
        const free = this.collision.isFreeAt(point.x, point.y + 0.9, point.z);
        if (!(inSite && walkable && headroom && free)) {
            // mark invalid by returning a hit far outside the allowed distance
            return new Vec3(point.x, point.y - 1000, point.z);
        }
        return point;
    }

    // ---- placement ---------------------------------------------------------------------

    get headPosition(): Vec3 {
        return this.camera.getPosition();
    }

    get headYaw(): number {
        return yawOf(this.camera.forward);
    }

    /** Moves the rig so the head stands on (x, floorY, z), optionally facing `look`. */
    placeHead(x: number, floorY: number, z: number, look?: [number, number, number] | Vec3) {
        if (look) {
            const lx = look instanceof Vec3 ? look.x : look[0];
            const lz = look instanceof Vec3 ? look.z : look[2];
            const wantYaw = Math.atan2(-(lx - x), -(lz - z)) * math.RAD_TO_DEG;
            const delta = wantYaw - this.headYaw;
            // rotate the rig about the head so only the world turns, not the visitor
            tmpV2.copy(this.camera.getLocalPosition());
            this.rig.translateLocal(tmpV2);
            this.rig.rotateLocal(0, delta, 0);
            this.rig.translateLocal(tmpV2.mulScalar(-1));
        }
        const head = this.camera.getPosition();
        const rigPos = this.rig.getPosition();
        this.rig.setPosition(rigPos.x + (x - head.x), floorY, rigPos.z + (z - head.z));
        this.lastSafe = { x, z, ground: floorY, valid: true };
        this.lastGround = floorY;
        this.settleFrames = 6;
        if (this.nav) this.nav._currentGroundY = floorY;
        this.app.renderNextFrame = true;
    }

    /** Fade out, move, fade in. */
    async blinkTo(x: number, floorY: number, z: number, look?: [number, number, number] | Vec3) {
        await this.fade(1, 10);
        this.placeHead(x, floorY, z, look);
        await this.fade(0, 4);
    }

    resetToSpawn(blink = true): Promise<void> {
        const stand = this.findStand(this.spawn.x, this.spawn.z);
        if (blink) return this.blinkTo(stand.x, stand.y, stand.z, this.spawn.look);
        this.placeHead(stand.x, stand.y, stand.z, this.spawn.look);
        return Promise.resolve();
    }

    /** Detach from shared stores; the engine app owns everything else. */
    dispose() {
        settings.events.off('change', this.onSettings);
        this.exitVr();
    }

    fade(target: number, speed = 6): Promise<void> {
        this.fadeTarget = target;
        this.fadeSpeed = speed;
        if (target > 0) this.fadePanel.show();
        return new Promise((resolve) => {
            const prev = this.fadeResolve;
            prev?.();
            this.fadeResolve = resolve;
        });
    }

    // ---- input --------------------------------------------------------------------------

    private addHand(source: XrInputSource) {
        if (this.hands.has(source)) return;
        const laser = new Entity('laser', this.app);
        laser.addComponent('render', { type: 'box', layers: [this.layer.id], material: this.laserMat, castShadows: false });
        laser.enabled = false;
        this.app.root.addChild(laser);
        const cursor = new Entity('cursor', this.app);
        cursor.addComponent('render', { type: 'sphere', layers: [this.layer.id], material: this.cursorMat, castShadows: false });
        cursor.setLocalScale(0.025, 0.025, 0.025);
        cursor.enabled = false;
        this.app.root.addChild(cursor);
        this.hands.set(source, { source, pressed: [], laser, cursor, hit: null, hoverTarget: null });
    }

    private removeHand(source: XrInputSource) {
        const h = this.hands.get(source);
        if (!h) return;
        h.hoverTarget?.onHover(null, source.handedness);
        h.laser.destroy();
        h.cursor.destroy();
        this.hands.delete(source);
    }

    /** Thumbstick axes of a hand, or [0, 0]. */
    axes(hand: Hand): [number, number] {
        for (const h of this.hands.values()) {
            const gp = h.source.gamepad;
            if (h.source.handedness === hand && gp && gp.axes.length >= 4) return [gp.axes[2], gp.axes[3]];
        }
        return [0, 0];
    }

    haptic(hand: Hand | string, intensity = 0.4, ms = 30) {
        for (const h of this.hands.values()) {
            if (h.source.handedness !== hand) continue;
            const act = (h.source.gamepad as any)?.hapticActuators?.[0];
            try {
                act?.pulse?.(intensity, ms);
            } catch {
                // no haptics
            }
        }
    }

    /** Locomotion state, for the emulated-VR test harness. */
    debugWalk() {
        const head = this.camera.getPosition();
        const rig = this.rig.getPosition();
        return {
            head: [+head.x.toFixed(2), +head.y.toFixed(2), +head.z.toFixed(2)],
            floorY: +rig.y.toFixed(2),
            ground: this.probeGround(head.x, head.z, rig.y),
            groundRay: this.groundAt(head.x, head.z),
            lastSafe: { ...this.lastSafe },
            lastGround: this.lastGround,
            settle: this.settleFrames,
            locked: this.locked,
            inSite: Math.hypot(head.x, head.z) <= this.walkRadius
        };
    }

    /** Why a teleport target was accepted or rejected, for the test harness. */
    debugTeleport(from: Vec3, to: Vec3) {
        if (!this.collision) return { reason: 'no collision' };
        const dir = new Vec3().sub2(to, from);
        const len = dir.length();
        dir.mulScalar(1 / len);
        const hit = this.collision.queryRay(from.x, from.y, from.z, dir.x, dir.y, dir.z, len);
        if (!hit) return { reason: 'no hit' };
        const n = this.collision.querySurfaceNormal(hit.x, hit.y, hit.z, dir.x, dir.y, dir.z);
        return {
            hit: [+hit.x.toFixed(2), +hit.y.toFixed(2), +hit.z.toFixed(2)],
            inSite: Math.hypot(hit.x, hit.z) <= this.walkRadius,
            normalY: +n.ny.toFixed(2),
            headroom: !this.collision.queryRay(hit.x, hit.y + 0.3, hit.z, 0, 1, 0, 1.6),
            free: this.collision.isFreeAt(hit.x, hit.y + 0.9, hit.z)
        };
    }

    /** Per-hand pointer and button state, for the emulated-VR test harness. */
    debugState() {
        return [...this.hands.values()].map((h) => ({
            hand: h.source.handedness,
            hit: h.hit ? { u: +h.hit.u.toFixed(3), v: +h.hit.v.toFixed(3), dist: +h.hit.dist.toFixed(2), name: h.hit.target.entity.name } : null,
            buttons: Array.from(h.source.gamepad?.buttons ?? [], (b) => (b?.pressed ? 1 : 0)).join(''),
            axes: Array.from(h.source.gamepad?.axes ?? [], (a) => Number(a).toFixed(2)).join(','),
            // the pointer ray as the viewer sees it, so a test can close the loop on aiming
            origin: [h.source.getOrigin().x, h.source.getOrigin().y, h.source.getOrigin().z],
            dir: [h.source.getDirection().x, h.source.getDirection().y, h.source.getDirection().z]
        }));
    }

    /** True while any controller ray hovers a SiteXR surface. */
    get pointingAtUi() {
        for (const h of this.hands.values()) if (h.hit) return true;
        return false;
    }

    private applyComfort() {
        const c = settings.get();
        if (!this.nav) return;
        this.nav.steering = c.steering;
        this.nav.turnMode = c.turn === 'smooth' ? 'smooth' : 'snap';
        this.nav.rotateSpeed = c.turn === 'snap45' ? 45 : 30;
        this.nav.smoothTurnSpeed = 60;
        this.nav.movementSpeed = SPEEDS[c.speed];
    }

    private setPanelAlpha(panel: Panel, a: number) {
        panel.setAlpha(a);
    }

    // ---- per-frame -----------------------------------------------------------------------

    private update(dt: number) {
        this.xrFrames++;
        const c = settings.get();
        const hoverAny = this.pointingAtUi;

        this.nav.enableMove = !this.locked;
        this.nav.enableTeleport = c.teleport && !this.locked && !hoverAny;

        // controller input: button edges, rays, hover/select
        for (const h of this.hands.values()) {
            const { source } = h;
            const hand = source.handedness;
            const gp = source.gamepad;
            if (gp) {
                for (let i = 0; i < gp.buttons.length; i++) {
                    const p = !!gp.buttons[i]?.pressed;
                    if (p && !h.pressed[i]) this.onButtonDown(h, i);
                    h.pressed[i] = p;
                }
            }
            this.updateRay(h, hand);
        }

        // comfort vignette during smooth movement
        const [lx, ly] = this.axes('left');
        const [rx] = this.axes('right');
        const moving = !this.locked && Math.hypot(lx, ly) > 0.2;
        const turning = !this.locked && c.turn === 'smooth' && Math.abs(rx) > 0.2;
        const wantVignette = c.vignette && (moving || turning) ? 1 : 0;
        this.vignetteAlpha = math.lerp(this.vignetteAlpha, wantVignette, 1 - Math.exp(-dt * 10));
        if (this.vignetteAlpha > 0.01) {
            if (!this.vignettePanel.visible) this.vignettePanel.show();
            this.setPanelAlpha(this.vignettePanel, this.vignetteAlpha);
        } else if (this.vignettePanel.visible) {
            this.vignettePanel.hide();
        }

        // first frames: the headset pose arrives a frame or two after the session starts
        if (this.xrFrames === 3) {
            this.resetToSpawn(false);
            this.fade(0, 3);
            this.events.fire('ready');
        }

        this.followTerrain(dt);

        // fade
        if (this.fadeAlpha !== this.fadeTarget) {
            const step = this.fadeSpeed * dt;
            this.fadeAlpha = this.fadeAlpha < this.fadeTarget
                ? Math.min(this.fadeTarget, this.fadeAlpha + step)
                : Math.max(this.fadeTarget, this.fadeAlpha - step);
            this.setPanelAlpha(this.fadePanel, this.fadeAlpha);
            if (this.fadeAlpha === this.fadeTarget) {
                if (this.fadeAlpha === 0) this.fadePanel.hide();
                const r = this.fadeResolve;
                this.fadeResolve = null;
                r?.();
            }
        }
    }

    private onButtonDown(h: HandState, index: number) {
        const hand = h.source.handedness as Hand;
        const name = (Object.keys(BUTTON) as ButtonName[]).find((k) => BUTTON[k] === index);
        if (name) this.events.fire('button', hand, name);
        if ((index === BUTTON.trigger || index === BUTTON.primary) && h.hit) {
            this.haptic(hand, 0.5, 25);
            h.hit.target.onSelect(h.hit, hand);
            this.events.fire('select', h.hit, hand);
        }
    }

    private updateRay(h: HandState, hand: string) {
        const { source } = h;
        if (!source.gamepad) {
            h.laser.enabled = false;
            h.cursor.enabled = false;
            return;
        }
        const origin = tmpV1.copy(source.getOrigin());
        const dir = tmpV2.copy(source.getDirection()).normalize();

        // nearest surface under the ray
        let best: UiHit | null = null;
        for (const t of this.interactables) {
            if (!t.entity.enabled) continue;
            const hit: UiHit = { target: t, u: 0, v: 0, dist: 0, point: new Vec3() };
            if (t.intersect(origin, dir, hit) && (!best || hit.dist < best.dist)) best = hit;
        }
        if (best?.target !== h.hoverTarget) {
            h.hoverTarget?.onHover(null, hand);
            if (best) this.haptic(hand, 0.15, 12);
        }
        h.hoverTarget = best?.target ?? null;
        h.hoverTarget?.onHover(best, hand);
        h.hit = best;

        // laser: from the controller to the hit or a modest reach
        const len = best ? best.dist : 4;
        const showLaser = !!best || this.locked;
        h.laser.enabled = showLaser;
        if (showLaser) {
            tmpV3.copy(dir).mulScalar(len / 2).add(origin);
            h.laser.setPosition(tmpV3);
            tmpV3.copy(dir).add(origin);
            h.laser.lookAt(tmpV3, Vec3.UP);
            h.laser.setLocalScale(0.004, 0.004, len);
        }
        h.cursor.enabled = !!best;
        if (best) h.cursor.setPosition(best.point);
    }

    private followTerrain(dt: number) {
        const head = this.camera.getPosition();
        const rigPos = this.rig.getPosition();
        const floorY = rigPos.y;

        // walls: keep a capsule around the visitor out of solid voxels (horizontal only)
        if (this.collision && this.collision.queryCapsule(head.x, floorY + 1.0, head.z, 0.4, 0.25, push)) {
            const px = Math.abs(push.x) < 0.5 ? push.x : 0;
            const pz = Math.abs(push.z) < 0.5 ? push.z : 0;
            this.rig.setPosition(rigPos.x + px, rigPos.y, rigPos.z + pz);
        }

        const hx = this.camera.getPosition().x;
        const hz = this.camera.getPosition().z;
        const ground = this.probeGround(hx, hz, floorY);
        const settling = this.settleFrames > 0;
        if (settling) this.settleFrames--;

        const inSite = Math.hypot(hx, hz) <= this.walkRadius;
        const step = ground !== null && this.lastGround !== null ? ground - this.lastGround : 0;
        const ok = ground !== null && inSite && (settling || step < 0.55);

        if (!ok) {
            if (this.lastSafe.valid) {
                // put the head back over the last safe spot; the world stays where it was
                const rp = this.rig.getPosition();
                this.rig.setPosition(rp.x + (this.lastSafe.x - hx), rp.y, rp.z + (this.lastSafe.z - hz));
            }
            return;
        }

        // spring the floor toward the terrain; snap when settling after a placement
        const k = settling ? 1 : 1 - Math.exp(-dt * 9);
        const newY = floorY + (ground - floorY) * k;
        const rp = this.rig.getPosition();
        this.rig.setPosition(rp.x, newY, rp.z);
        this.lastGround = ground;
        this.lastSafe = { x: hx, z: hz, ground, valid: true };
        if (this.nav) this.nav._currentGroundY = ground;
    }
}

export { THEME };
