// Points of interest: subtle billboard markers in the scene that open a short note when
// selected. VR selection uses controller rays; desktop selection uses the mouse.
import { Vec3 } from 'playcanvas';
import type { AppBase, Entity } from 'playcanvas';

import type { Poi } from '../config';
import { Panel, THEME, drawButton, roundRect, wrapText } from './panel';
import type { Layer } from 'playcanvas';
import type { UiHit } from './panel';
import type { XrRig } from './rig';

const tmp = new Vec3();

class Marker {
    readonly poi: Poi;

    readonly panel: Panel;

    hovered = false;

    private phase: number;

    constructor(app: AppBase, layer: Layer, poi: Poi) {
        this.poi = poi;
        this.phase = poi.index * 1.7;
        this.panel = new Panel(app, layer, { name: `poi-${poi.id}`, width: 0.42, height: 0.42, pixels: 256, overlay: true });
        this.panel.entity.setPosition(poi.marker[0], poi.marker[1], poi.marker[2]);
        this.render();
        this.panel.show();
    }

    render() {
        const { poi } = this;
        this.panel.draw((ctx, w, h) => {
            const cx = w / 2;
            const cy = h / 2;
            const r = w * 0.3;
            // halo
            const g = ctx.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 1.55);
            g.addColorStop(0, this.hovered ? 'rgba(245,166,35,0.55)' : 'rgba(245,166,35,0.28)');
            g.addColorStop(1, 'rgba(245,166,35,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, w, h);
            // ring + disc
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(14,18,24,0.92)';
            ctx.fill();
            ctx.lineWidth = w * 0.035;
            ctx.strokeStyle = this.hovered ? '#ffd27a' : THEME.accent;
            ctx.stroke();
            ctx.fillStyle = THEME.text;
            ctx.font = `700 ${w * 0.34}px ${THEME.font}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(poi.index), cx, cy + w * 0.02);
        });
    }

    update(t: number, viewer: Vec3, animate: boolean) {
        const p = this.panel.entity.getPosition();
        const dist = Math.max(0.5, tmp.sub2(p, viewer).length());
        // keep a roughly constant angular size with a gentle pulse (VR only: the desktop
        // walkthrough renders on demand, so it keeps the markers still)
        const pulse = animate ? 1 + 0.06 * Math.sin(t * 2.2 + this.phase) : 1;
        const s = Math.max(0.7, dist * 0.1) * pulse * (this.hovered ? 1.2 : 1);
        this.panel.entity.setLocalScale(s, s, s);
        this.panel.faceToward(viewer);
    }
}

export type MarkerCallbacks = {
    /** Desktop: a marker was clicked; the host shows a DOM card. */
    onDesktopSelect: (poi: Poi) => void;
    /** VR "Go there" button. */
    onGoThere: (poi: Poi) => void;
};

export class Markers {
    readonly markers: Marker[] = [];

    readonly card: Panel;

    private rig: XrRig;

    private app: AppBase;

    private camera: Entity;

    private time = 0;

    private openPoi: Poi | null = null;

    private callbacks: MarkerCallbacks;

    private visible = true;

    constructor(rig: XrRig, pois: Poi[], callbacks: MarkerCallbacks) {
        this.rig = rig;
        this.app = rig.app;
        this.camera = rig.camera;
        this.callbacks = callbacks;

        for (const poi of pois) {
            const m = new Marker(rig.app, rig.layer, poi);
            m.panel.onHoverChange = null;
            m.panel.onHover = (hit: UiHit | null) => {
                const h = !!hit;
                if (h !== m.hovered) {
                    m.hovered = h;
                    m.render();
                }
            };
            m.panel.onSelect = () => this.openCard(poi);
            this.markers.push(m);
            rig.interactables.add(m.panel);
        }

        this.card = new Panel(rig.app, rig.layer, { name: 'poi-card', width: 0.9, height: 0.46, pixels: 1024, overlay: true });
        this.card.onHoverChange = () => this.renderCard();
        this.card.onButton = (id) => {
            if (id === 'close') this.closeCard();
            if (id === 'go' && this.openPoi) {
                const poi = this.openPoi;
                this.closeCard();
                this.callbacks.onGoThere(poi);
            }
        };

        rig.app.on('update', (dt: number) => this.update(dt));
        this.attachDesktopPicking();
    }

    setVisible(v: boolean) {
        this.visible = v;
        for (const m of this.markers) {
            if (v) m.panel.show();
            else m.panel.hide();
        }
        if (!v) this.closeCard();
    }

    get cardOpen() {
        return this.card.visible;
    }

    openCard(poi: Poi, forceVrCard = false) {
        if (!this.rig.active && !forceVrCard) {
            this.callbacks.onDesktopSelect(poi);
            return;
        }
        this.openPoi = poi;
        // between the marker and the visitor, at a readable distance
        const head = this.camera.getPosition();
        const mp = new Vec3(poi.marker[0], poi.marker[1], poi.marker[2]);
        const dir = tmp.sub2(mp, head);
        const dist = dir.length();
        dir.normalize();
        const d = Math.min(1.6, Math.max(1.1, dist - 0.6));
        this.card.entity.setPosition(head.x + dir.x * d, head.y + dir.y * d + 0.05, head.z + dir.z * d);
        this.card.faceToward(head);
        this.card.show();
        this.rig.interactables.add(this.card);
        this.renderCard();
    }

    closeCard() {
        this.openPoi = null;
        this.card.hide();
        this.rig.interactables.delete(this.card);
    }

    private renderCard() {
        const poi = this.openPoi;
        if (!poi) return;
        this.card.draw((ctx, w, h) => {
            this.card.buttons = [];
            roundRect(ctx, 0, 0, w, h, 32);
            ctx.fillStyle = THEME.bg;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = THEME.line;
            ctx.stroke();
            // index badge
            ctx.beginPath();
            ctx.arc(72, 72, 34, 0, Math.PI * 2);
            ctx.fillStyle = THEME.accent;
            ctx.fill();
            ctx.fillStyle = '#141414';
            ctx.font = `700 34px ${THEME.font}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(poi.index), 72, 74);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = THEME.text;
            ctx.font = `700 40px ${THEME.font}`;
            ctx.fillText(poi.title, 128, 86);
            ctx.fillStyle = THEME.muted;
            ctx.font = `400 28px ${THEME.font}`;
            wrapText(ctx, poi.text, 48, 150, w - 96, 38);
            const bw = (w - 96 - 16) / 2;
            const go = { id: 'go', x: 48, y: h - 112, w: bw, h: 80 };
            const close = { id: 'close', x: 48 + bw + 16, y: h - 112, w: bw, h: 80 };
            this.card.buttons.push(go, close);
            drawButton(ctx, go, 'Go there', { hover: this.card.hover === 'go', primary: true, size: 30 });
            drawButton(ctx, close, 'Close', { hover: this.card.hover === 'close', size: 30 });
        });
    }

    private update(dt: number) {
        this.time += dt;
        if (!this.visible) return;
        const viewer = this.camera.getPosition();
        const vr = this.rig.active;
        for (const m of this.markers) m.update(this.time, viewer, vr);
    }

    /** Desktop: click a marker (without dragging) to open its note. */
    private attachDesktopPicking() {
        const canvas = this.app.graphicsDevice.canvas;
        let down: { x: number; y: number } | null = null;
        const pick = (x: number, y: number): Marker | null => {
            const cam = this.camera.camera;
            const rect = canvas.getBoundingClientRect();
            const sx = x - rect.left;
            const sy = y - rect.top;
            let best: Marker | null = null;
            let bestD = 28;
            for (const m of this.markers) {
                const p = m.panel.entity.getPosition();
                const s = cam.worldToScreen(p, tmp);
                if (s.z < 0) continue;
                const d = Math.hypot(s.x - sx, s.y - sy);
                if (d < bestD) {
                    bestD = d;
                    best = m;
                }
            }
            return best;
        };
        canvas.addEventListener(
            'pointerdown',
            (e) => {
                if (this.rig.active || !this.visible) return;
                down = { x: e.clientX, y: e.clientY };
                if (pick(e.clientX, e.clientY)) {
                    // keep the viewer's click-to-walk from firing on a marker
                    e.stopPropagation();
                    e.preventDefault();
                }
            },
            { capture: true }
        );
        canvas.addEventListener(
            'pointerup',
            (e) => {
                if (this.rig.active || !this.visible || !down) return;
                const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
                down = null;
                if (moved) return;
                const m = pick(e.clientX, e.clientY);
                if (m) {
                    e.stopPropagation();
                    e.preventDefault();
                    this.callbacks.onDesktopSelect(m.poi);
                }
            },
            { capture: true }
        );
        canvas.addEventListener('pointermove', (e) => {
            if (this.rig.active || !this.visible) return;
            const m = pick(e.clientX, e.clientY);
            for (const mk of this.markers) {
                const h = mk === m;
                if (h !== mk.hovered) {
                    mk.hovered = h;
                    mk.render();
                }
            }
            canvas.style.cursor = m ? 'pointer' : '';
        });
    }
}
