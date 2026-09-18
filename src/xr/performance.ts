// Holds the headset's frame rate by trading splat detail for smoothness, automatically.
//
// A Quest renders both eyes every 13.9 ms at 72 Hz, and on the WebGL path the splats are
// depth-sorted on the CPU every frame. That cost scales with the splat budget, which makes
// the budget the one knob worth turning while a session runs. Fixed foveation is the other:
// it drops resolution at the edges of the lens, where you are not looking.
//
// The governor never exceeds what the visitor asked for in Comfort settings. It only ever
// takes detail away to keep motion smooth, and gives it back when there is headroom.
import type { AppBase } from 'playcanvas';

/** Frame time we aim to stay under, in milliseconds (72 Hz with a little slack). */
const TARGET_MS = 14.5;
/** Above this, detail comes down. */
const SLOW_MS = 16.5;
/** Below this, and only after a settled period, detail goes back up. */
const FAST_MS = 11.5;

const DOWN_FACTOR = 0.72;
const UP_FACTOR = 1.18;
/** Never go below this many splats, however slow the device. */
const FLOOR_M = 0.1;
/** Fraction of the requested budget to enter a session with, before climbing. */
const START_FRACTION = 0.6;

export type PerfState = {
    /** Splat budget in force, in millions. */
    budget: number;
    /** What Comfort settings asked for, in millions. */
    target: number;
    /** Fixed foveation in force, 0 to 1, or null when unsupported. */
    foveation: number | null;
    /** Smoothed frame time in milliseconds. */
    frameMs: number;
    /** True while the governor is holding detail below the requested setting. */
    limiting: boolean;
};

export class PerformanceGovernor {
    private app: AppBase;

    private targetBudget: () => number;

    private baseFoveation: () => number;

    private budget: number;

    private ema = TARGET_MS;

    private slowFor = 0;

    private fastFor = 0;

    private cooldown = 0;

    private active = false;

    private prevColorAngle = 0.2;

    constructor(app: AppBase, targetBudget: () => number, baseFoveation: () => number) {
        this.app = app;
        this.targetBudget = targetBudget;
        this.baseFoveation = baseFoveation;
        this.budget = targetBudget();

        app.xr.on('start', () => {
            this.active = true;
            // Start below the ceiling and climb into it. Entering at full detail and
            // falling back means the first seconds in the headset are the worst ones,
            // which is exactly when a first impression is formed.
            this.budget = Math.max(FLOOR_M, this.targetBudget() * START_FRACTION);
            // Rebuilding the splat work buffer is a visible spike. Outside XR the viewer
            // rebuilds it after a fifth of a degree of camera rotation, which is constant
            // in a headset where the head never stops moving. A wider angle trades a little
            // colour accuracy for far fewer spikes, which is what "unstable" usually is.
            this.prevColorAngle = app.scene.gsplat.colorUpdateAngle;
            app.scene.gsplat.colorUpdateAngle = 2;
            this.ema = TARGET_MS;
            this.slowFor = 0;
            this.fastFor = 0;
            this.cooldown = 1.5;
            this.apply();
        });
        app.xr.on('end', () => {
            this.active = false;
            app.scene.gsplat.colorUpdateAngle = this.prevColorAngle;
            // hand the desktop view back its own budget
            app.scene.gsplat.splatBudget = this.targetBudget() * 1e6;
        });

        app.on('update', (dt: number) => this.update(dt));
    }

    /** Called when the visitor changes the quality setting. */
    retarget() {
        this.budget = this.targetBudget();
        this.slowFor = 0;
        this.fastFor = 0;
        this.cooldown = 1.5;
        this.apply();
    }

    get state(): PerfState {
        return {
            budget: this.budget,
            target: this.targetBudget(),
            foveation: this.app.xr.fixedFoveation ?? null,
            frameMs: this.ema,
            limiting: this.budget < this.targetBudget() - 1e-3
        };
    }

    private apply() {
        this.app.scene.gsplat.splatBudget = Math.max(FLOOR_M, this.budget) * 1e6;
        // more foveation while the governor is holding detail back
        const base = this.baseFoveation();
        const want = this.budget < this.targetBudget() - 1e-3 ? Math.min(1, base + 0.25) : base;
        try {
            if (this.app.xr.fixedFoveation !== null) this.app.xr.fixedFoveation = want;
        } catch {
            // not supported on this device
        }
        this.app.renderNextFrame = true;
    }

    private update(dt: number) {
        if (!this.active || !this.app.xr.active) return;

        const ms = Math.min(100, dt * 1000);
        // a long frame counts for more than a short one, so a stutter is not averaged away
        this.ema += (ms - this.ema) * (ms > this.ema ? 0.3 : 0.08);

        if (this.cooldown > 0) {
            this.cooldown -= dt;
            return;
        }

        const target = this.targetBudget();

        if (this.ema > SLOW_MS) {
            this.slowFor += dt;
            this.fastFor = 0;
            if (this.slowFor > 0.8 && this.budget > FLOOR_M) {
                this.budget = Math.max(FLOOR_M, this.budget * DOWN_FACTOR);
                this.slowFor = 0;
                this.cooldown = 1.2;
                this.apply();
            }
            return;
        }

        if (this.ema < FAST_MS && this.budget < target) {
            this.fastFor += dt;
            this.slowFor = 0;
            if (this.fastFor > 4) {
                this.budget = Math.min(target, this.budget * UP_FACTOR);
                this.fastFor = 0;
                this.cooldown = 2.5;
                this.apply();
            }
            return;
        }

        this.slowFor = 0;
        this.fastFor = 0;
    }
}
