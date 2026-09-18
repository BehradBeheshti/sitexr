// A small frame-rate readout inside VR, for judging performance on a real headset.
// Off unless the url asks for it (?fps), because it is a diagnostic, not a feature.
//
// Frame rate is the one thing a headset test can measure that a desktop or an emulator
// cannot: the Quest renders both eyes at 72 Hz or better, and a splat scene is the kind
// of load that quietly misses that.
import type { AppBase, Entity } from 'playcanvas';

import { Panel, THEME } from './panel';
import type { Layer } from 'playcanvas';

export class FpsReadout {
    private panel: Panel;

    private frames = 0;

    private elapsed = 0;

    private worst = 999;

    private app: AppBase;

    constructor(app: AppBase, camera: Entity, layer: Layer, budget: () => number) {
        this.app = app;
        this.panel = new Panel(app, layer, { name: 'fps', width: 0.3, height: 0.1, pixels: 512, overlay: true });
        this.panel.entity.reparent(camera);
        this.panel.entity.setLocalPosition(0.2, -0.2, -0.7);
        this.panel.entity.setLocalEulerAngles(-12, 0, 0);
        this.panel.show();
        this.draw(0, 0, budget());

        app.on('update', (dt: number) => {
            this.frames++;
            this.elapsed += dt;
            if (this.elapsed < 0.5) return;
            const fps = this.frames / this.elapsed;
            if (fps < this.worst && this.elapsed > 0.1) this.worst = fps;
            this.draw(fps, this.worst, budget());
            this.frames = 0;
            this.elapsed = 0;
        });
    }

    /** Forget the worst reading, so a fresh measurement can be taken after a change. */
    reset() {
        this.worst = 999;
    }

    private draw(fps: number, worst: number, budget: number) {
        this.panel.draw((ctx, w, h) => {
            ctx.fillStyle = 'rgba(10,13,18,0.82)';
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = fps >= 68 ? THEME.ok : fps >= 55 ? THEME.accent : THEME.danger;
            ctx.font = `700 54px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${fps.toFixed(0)} fps`, 20, h * 0.42);
            ctx.fillStyle = THEME.muted;
            ctx.font = `500 26px ${THEME.font}`;
            ctx.fillText(`low ${worst > 900 ? '—' : worst.toFixed(0)}`, 20, h * 0.78);
            ctx.textAlign = 'right';
            ctx.fillText(`${budget.toFixed(1)}M splats`, w - 20, h * 0.78);
        });
        this.app.renderNextFrame = true;
    }

    destroy() {
        this.panel.destroy();
    }
}
