// The in-VR menu: Resume, Reset Position, Guided Tour, Comfort Settings, About, Exit VR.
// Opens 1.3 m ahead of the visitor and pauses locomotion while it is up.
import { CREDITS, BRAND } from '../config';
import { settings } from '../settings';
import type { Comfort } from '../settings';
import { Panel, THEME, drawButton, drawPanelBackground, wrapText } from './panel';
import type { Button } from './panel';
import type { XrRig } from './rig';

type Page = 'main' | 'comfort' | 'about';

export type MenuActions = {
    tourActive: () => boolean;
    toggleTour: () => void;
    replayTutorial: () => void;
};

export class VrMenu {
    readonly panel: Panel;

    page: Page = 'main';

    private rig: XrRig;

    private actions: MenuActions;

    constructor(rig: XrRig, actions: MenuActions) {
        this.rig = rig;
        this.actions = actions;
        this.panel = new Panel(rig.app, rig.layer, { name: 'menu', width: 0.72, height: 0.66, pixels: 1024, overlay: true });
        this.panel.onHoverChange = () => this.render();
        this.panel.onButton = (id) => this.onButton(id);
        settings.events.on('change', () => {
            if (this.isOpen) this.render();
        });
    }

    get isOpen() {
        return this.panel.visible;
    }

    open(page: Page = 'main') {
        this.page = page;
        this.panel.placeInFront(this.rig.camera, 1.25, -0.08);
        this.panel.show();
        this.rig.interactables.add(this.panel);
        this.rig.locked = true;
        this.render();
    }

    close() {
        this.panel.hide();
        this.rig.interactables.delete(this.panel);
        this.rig.locked = false;
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    private onButton(id: string) {
        const c = settings.get();
        switch (id) {
            case 'resume':
                this.close();
                break;
            case 'reset':
                this.close();
                this.rig.resetToSpawn();
                break;
            case 'tour':
                this.close();
                this.actions.toggleTour();
                break;
            case 'comfort':
                this.page = 'comfort';
                break;
            case 'about':
                this.page = 'about';
                break;
            case 'exit':
                this.close();
                this.rig.exitVr();
                break;
            case 'back':
                this.page = 'main';
                break;
            case 'tutorial':
                this.close();
                this.actions.replayTutorial();
                break;
            default: {
                // comfort options are encoded as key:value
                const [key, value] = id.split(':');
                if (key && value !== undefined) {
                    const v: unknown = value === 'true' ? true : value === 'false' ? false : value;
                    settings.set(key as keyof Comfort, v as never);
                    // turning on the "Turn: Smooth" option is a common cause of discomfort; keep
                    // the vignette suggestion visible by re-rendering
                    if (key === 'turn' && value === 'smooth' && !c.vignette) settings.set('vignette', true);
                }
            }
        }
        this.render();
    }

    render() {
        const { panel } = this;
        panel.draw((ctx, w, h) => {
            panel.buttons = [];
            if (this.page === 'main') this.drawMain(ctx, w, h);
            else if (this.page === 'comfort') this.drawComfort(ctx, w, h);
            else this.drawAbout(ctx, w, h);
        });
    }

    private button(id: string, x: number, y: number, w: number, h: number): Button {
        const b = { id, x, y, w, h };
        this.panel.buttons.push(b);
        return b;
    }

    private drawMain(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, `${BRAND.name} menu`);
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        ctx.textAlign = 'right';
        ctx.fillText(BRAND.site, w - 48, 66);

        const items: [string, string, boolean?][] = [
            ['resume', 'Resume'],
            ['reset', 'Reset position'],
            ['tour', this.actions.tourActive() ? 'Stop guided tour' : 'Start guided tour'],
            ['comfort', 'Comfort settings'],
            ['about', 'About & credits'],
            ['exit', 'Exit VR', true]
        ];
        const bw = w - 96;
        const bh = 108;
        let y = 128;
        for (const [id, label, danger] of items) {
            const b = this.button(id, 48, y, bw, bh);
            drawButton(ctx, b, label, { hover: this.panel.hover === id, primary: id === 'resume', danger, size: 34 });
            y += bh + 18;
        }
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 24px ${THEME.font}`;
        ctx.textAlign = 'center';
        ctx.fillText('B closes this menu · Y resets position · X toggles the tour', w / 2, h - 34);
    }

    private drawComfort(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'Comfort settings');
        const c = settings.get();
        const rows: { label: string; key: keyof Comfort; options: [string, string][] }[] = [
            { label: 'Turning', key: 'turn', options: [['snap30', 'Snap 30°'], ['snap45', 'Snap 45°'], ['smooth', 'Smooth']] },
            { label: 'Walk speed', key: 'speed', options: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] },
            { label: 'Vignette when moving', key: 'vignette', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Teleport (trigger)', key: 'teleport', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Quality', key: 'quality', options: [['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High']] }
        ];
        let y = 122;
        for (const row of rows) {
            ctx.fillStyle = THEME.muted;
            ctx.font = `500 26px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(row.label, 48, y + 22);
            const n = row.options.length;
            const gap = 12;
            const bw = (w - 96 - gap * (n - 1)) / n;
            const by = y + 36;
            row.options.forEach(([value, label], i) => {
                const id = `${row.key}:${value}`;
                const b = this.button(id, 48 + i * (bw + gap), by, bw, 68);
                const active = String(c[row.key]) === value;
                drawButton(ctx, b, label, { hover: this.panel.hover === id, active, size: 27 });
            });
            y += 128;
        }
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 22px ${THEME.font}`;
        ctx.textAlign = 'left';
        ctx.fillText('Quality changes the splat budget now; resolution applies on the next VR entry.', 48, y + 8);

        const bb = this.button('back', 48, h - 128, (w - 96 - 16) / 2, 84);
        drawButton(ctx, bb, 'Back', { hover: this.panel.hover === 'back', primary: true, size: 30 });
        const tb = this.button('tutorial', 48 + (w - 96 - 16) / 2 + 16, h - 128, (w - 96 - 16) / 2, 84);
        drawButton(ctx, tb, 'Replay tutorial', { hover: this.panel.hover === 'tutorial', size: 30 });
    }

    private drawAbout(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'About & credits');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = THEME.text;
        ctx.font = `600 30px ${THEME.font}`;
        ctx.fillText(`${BRAND.name} — ${BRAND.tagline}`, 48, 140);
        ctx.font = `400 26px ${THEME.font}`;
        ctx.fillStyle = THEME.muted;
        let y = wrapText(ctx, 'A construction-site review experience for Meta Quest 3, built with WebXR.', 48, 184, w - 96, 36);

        y += 22;
        ctx.fillStyle = THEME.text;
        ctx.font = `600 28px ${THEME.font}`;
        ctx.fillText('Scene', 48, y);
        y += 40;
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        y = wrapText(ctx, `“${CREDITS.sceneTitle}” by ${CREDITS.sceneAuthor}, licensed ${CREDITS.sceneLicense}.`, 48, y, w - 96, 36);
        y = wrapText(ctx, `Changes: ${CREDITS.changes}`, 48, y + 4, w - 96, 34);

        y += 22;
        ctx.fillStyle = THEME.text;
        ctx.font = `600 28px ${THEME.font}`;
        ctx.fillText('Technology', 48, y);
        y += 40;
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        y = wrapText(ctx, CREDITS.tech, 48, y, w - 96, 34);

        const bb = this.button('back', 48, h - 128, w - 96, 84);
        drawButton(ctx, bb, 'Back', { hover: this.panel.hover === 'back', primary: true, size: 30 });
    }
}
