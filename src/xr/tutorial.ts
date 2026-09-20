// First-time controller tutorial, shown in VR. Each step completes when the visitor
// actually performs the input, so it doubles as a controller check.
import { settings } from '../settings';
import { Panel, THEME, drawButton, drawPanelBackground, roundRect, wrapText } from './panel';
import type { XrRig } from './rig';

type Step = {
    title: string;
    text: string;
    /** Returns true once the step's input was seen. */
    check: (t: Tutorial, dt: number) => boolean;
};

export class Tutorial {
    readonly panel: Panel;

    active = false;

    private rig: XrRig;

    private step = 0;

    private hold = 0;

    private yawStart = 0;

    private yawTravel = 0;

    private lastYaw = 0;

    private turned = false;

    private teleported = false;

    private pressed = false;

    private steps: Step[];

    private advanceDelay = 0;

    private onDone: () => void;

    constructor(rig: XrRig, onDone: () => void, opts: { doors?: boolean } = {}) {
        this.rig = rig;
        this.onDone = onDone;
        this.panel = new Panel(rig.app, rig.layer, { name: 'tutorial', width: 0.8, height: 0.5, pixels: 1024, overlay: true });
        this.panel.onHoverChange = () => this.render();
        this.panel.onButton = (id) => {
            if (id === 'skip' || id === 'done') this.finish();
            if (id === 'next') this.advance();
        };
        this.steps = [
            {
                title: 'Look around',
                text: 'Turn your head. Your movement in the room is tracked, so you can also step around freely.',
                check: (t) => t.yawTravel > 40
            },
            {
                title: 'Walk',
                text: 'Push the LEFT thumbstick to walk. You always move in the direction you are looking.',
                check: (t, dt) => {
                    const [x, y] = t.rig.axes('left');
                    t.hold = Math.hypot(x, y) > 0.5 ? t.hold + dt : 0;
                    return t.hold > 0.6;
                }
            },
            {
                title: 'Turn',
                text: 'Flick the RIGHT thumbstick left or right to snap-turn. Smooth turning can be enabled in Comfort settings.',
                check: (t) => t.turned
            },
            {
                title: 'Teleport',
                text: 'Point at the ground, hold the TRIGGER, then release to blink to that spot.',
                check: (t) => t.teleported
            },
            {
                title: 'Menu and reset',
                text: opts.doors
                    ? 'Press B for the menu, Y to reset, X for the guided tour. Point at a marker and pull the trigger to read a note \u2014 or at a door, to open it.'
                    : 'Press B for the menu, Y to reset your position, and X to start the guided tour. Point at a numbered marker and press the trigger to read a site note.',
                check: (t) => t.pressed
            }
        ];
        rig.events.on('teleport', () => {
            this.teleported = true;
        });
        rig.events.on('button', (hand: string, name: string) => {
            if (!this.active) return;
            if (name === 'secondary' || (hand === 'left' && name === 'primary')) this.pressed = true;
        });
        rig.app.on('update', (dt: number) => this.update(dt));
    }

    start() {
        this.active = true;
        this.step = 0;
        this.hold = 0;
        this.yawTravel = 0;
        this.turned = false;
        this.teleported = false;
        this.pressed = false;
        this.advanceDelay = 0;
        this.lastYaw = this.rig.headYaw;
        this.yawStart = this.lastYaw;
        this.place();
        this.panel.show();
        this.rig.interactables.add(this.panel);
        this.render();
    }

    finish() {
        if (!this.active) return;
        this.active = false;
        this.panel.hide();
        this.rig.interactables.delete(this.panel);
        settings.set('tutorialDone', true);
        this.onDone();
    }

    private place() {
        this.panel.placeInFront(this.rig.camera, 1.5, 0.05);
    }

    private advance() {
        this.step++;
        this.hold = 0;
        this.advanceDelay = 0;
        if (this.step >= this.steps.length) {
            this.finish();
            return;
        }
        this.place();
        this.render();
    }

    private update(dt: number) {
        if (!this.active || !this.rig.active) return;
        // head yaw travel (unwrapped)
        const yaw = this.rig.headYaw;
        let d = yaw - this.lastYaw;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        this.lastYaw = yaw;
        // snap turns move the rig, which also changes head yaw; count large jumps as a turn
        if (Math.abs(d) > 20) this.turned = true;
        else this.yawTravel += Math.abs(d);

        // re-place the panel if the visitor wandered off
        const p = this.panel.entity.getPosition();
        const head = this.rig.headPosition;
        if (Math.hypot(p.x - head.x, p.z - head.z) > 3.2) this.place();

        if (this.advanceDelay > 0) {
            this.advanceDelay -= dt;
            if (this.advanceDelay <= 0) this.advance();
            return;
        }
        const step = this.steps[this.step];
        if (step.check(this, dt)) {
            this.rig.haptic('left', 0.4, 40);
            this.rig.haptic('right', 0.4, 40);
            this.advanceDelay = 0.9;
            this.render(true);
        }
    }

    private render(done = false) {
        const { panel } = this;
        const step = this.steps[this.step];
        panel.draw((ctx, w, h) => {
            panel.buttons = [];
            drawPanelBackground(ctx, w, h, `Controller basics · ${this.step + 1} of ${this.steps.length}`);
            // progress dots
            for (let i = 0; i < this.steps.length; i++) {
                ctx.beginPath();
                ctx.arc(w - 48 - (this.steps.length - 1 - i) * 30, 62, 8, 0, Math.PI * 2);
                ctx.fillStyle = i < this.step || (i === this.step && done) ? THEME.ok : i === this.step ? THEME.accent : THEME.line;
                ctx.fill();
            }
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = done ? THEME.ok : THEME.text;
            ctx.font = `700 46px ${THEME.font}`;
            ctx.fillText(done ? `${step.title} ✓` : step.title, 48, 170);
            ctx.fillStyle = THEME.muted;
            ctx.font = `400 30px ${THEME.font}`;
            wrapText(ctx, step.text, 48, 226, w - 96 - 220, 40);

            // small controller glyph on the right, highlighting the relevant control
            this.drawGlyph(ctx, w - 190, 150, this.step);

            ctx.fillStyle = THEME.muted;
            ctx.font = `400 22px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.fillText('Point a controller at a button and pull the trigger to choose it.', 48, h - 130);
            const bw = 250;
            const skip = { id: 'skip', x: 48, y: h - 100, w: bw, h: 72 };
            const next = { id: 'next', x: w - 48 - bw, y: h - 100, w: bw, h: 72 };
            panel.buttons.push(skip, next);
            drawButton(ctx, skip, 'Skip tutorial', { hover: panel.hover === 'skip', size: 26 });
            drawButton(ctx, next, this.step === this.steps.length - 1 ? 'Done' : 'Next', { hover: panel.hover === 'next', primary: true, size: 28 });
        });
    }

    /** A schematic Touch controller: stick, A/B, trigger; the active part glows amber. */
    private drawGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, step: number) {
        ctx.save();
        ctx.translate(x, y);
        // body
        roundRect(ctx, 0, 0, 130, 190, 40);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fill();
        ctx.strokeStyle = THEME.line;
        ctx.lineWidth = 3;
        ctx.stroke();
        // thumbstick
        ctx.beginPath();
        ctx.arc(45, 60, 24, 0, Math.PI * 2);
        ctx.fillStyle = step === 1 || step === 2 ? THEME.accent : 'rgba(255,255,255,0.25)';
        ctx.fill();
        // face buttons
        ctx.beginPath();
        ctx.arc(95, 45, 12, 0, Math.PI * 2);
        ctx.fillStyle = step === 4 ? THEME.accent : 'rgba(255,255,255,0.25)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(95, 85, 12, 0, Math.PI * 2);
        ctx.fillStyle = step === 4 ? THEME.accent : 'rgba(255,255,255,0.25)';
        ctx.fill();
        // trigger
        roundRect(ctx, 20, 150, 60, 26, 10);
        ctx.fillStyle = step === 3 ? THEME.accent : 'rgba(255,255,255,0.25)';
        ctx.fill();
        // head arrows for step 0
        if (step === 0) {
            ctx.fillStyle = THEME.accent;
            ctx.font = `700 40px ${THEME.font}`;
            ctx.textAlign = 'center';
            ctx.fillText('↺', 65, -16);
        }
        ctx.fillStyle = THEME.muted;
        ctx.font = `500 20px ${THEME.font}`;
        ctx.textAlign = 'center';
        ctx.fillText(step === 1 ? 'LEFT' : step === 2 ? 'RIGHT' : '', 65, 215);
        ctx.restore();
    }
}
