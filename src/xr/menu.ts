// The in-VR menu: Resume, Reset Position, Guided Tour, Comfort Settings, About, Exit VR.
// Opens 1.3 m ahead of the visitor and pauses locomotion while it is up.
import { BRAND, MODES, TECH_CREDIT, sitesOf } from '../config';
import type { Site } from '../config';
import { settings } from '../settings';
import type { Comfort } from '../settings';
import { Panel, THEME, drawButton, drawPanelBackground, wrapText } from './panel';
import type { Button } from './panel';
import type { XrRig } from './rig';

type Page = 'main' | 'comfort' | 'about' | 'sites';

export type MenuActions = {
    tourActive: () => boolean;
    toggleTour: () => void;
    replayTutorial: () => void;
    /** Go to another site. Loading one ends the session, so this leaves VR on the way. */
    switchSite: (id: string) => void;
    site: Site;
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
        this.onSettings = () => {
            if (this.isOpen) this.render();
        };
        settings.events.on('change', this.onSettings);
    }

    private onSettings: () => void;

    dispose() {
        settings.events.off('change', this.onSettings);
        this.close();
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
            case 'switch':
                this.page = 'sites';
                break;
            case 'back':
                this.page = 'main';
                break;
            case 'tutorial':
                this.close();
                this.actions.replayTutorial();
                break;
            default: {
                if (id.startsWith('site:')) {
                    const target = id.slice(5);
                    this.close();
                    if (target !== this.actions.site.id) this.actions.switchSite(target);
                    return;
                }
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
            else if (this.page === 'sites') this.drawSites(ctx, w, h);
            else this.drawAbout(ctx, w, h);
        });
    }

    private button(id: string, x: number, y: number, w: number, h: number): Button {
        const b = { id, x, y, w, h };
        this.panel.buttons.push(b);
        return b;
    }

    /**
     * Every site, both experiences, in one list. The 2D chooser separates captures from
     * design models because they are for different people; in here the visitor is already
     * one of those people and just wants the other scene.
     */
    private drawSites(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'Switch site');

        const bw = w - 96;
        let y = 104;
        for (const mode of MODES) {
            const list = sitesOf(mode.id);
            if (!list.length) continue;
            ctx.fillStyle = THEME.muted;
            ctx.font = `600 22px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.fillText(mode.name.toUpperCase(), 48, y + 16);
            y += 36;

            for (const site of list) {
                const current = site.id === this.actions.site.id;
                const b = this.button(`site:${site.id}`, 48, y, bw, 92);
                drawButton(ctx, b, '', { hover: this.panel.hover === b.id, primary: current, size: 28 });

                ctx.textAlign = 'left';
                ctx.fillStyle = current ? '#1b1205' : THEME.text;
                ctx.font = `600 32px ${THEME.font}`;
                ctx.fillText(site.name, 74, y + 40);
                ctx.fillStyle = current ? 'rgba(27,18,5,0.74)' : THEME.muted;
                ctx.font = `400 23px ${THEME.font}`;
                ctx.fillText(current ? 'you are here' : site.tag, 74, y + 70);
                y += 102;
            }
            y += 12;
        }

        ctx.fillStyle = THEME.muted;
        ctx.font = `400 21px ${THEME.font}`;
        ctx.textAlign = 'center';
        ctx.fillText('Loading another site leaves VR for a moment.', w / 2, y + 26);

        const back = this.button('back', 48, h - 92, bw, 68);
        drawButton(ctx, back, 'Back', { hover: this.panel.hover === 'back', size: 28 });
    }

    private drawMain(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, `${BRAND.name} menu`);
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        ctx.textAlign = 'right';
        ctx.fillText(this.actions.site.name, w - 48, 66);

        const items: [string, string, boolean?][] = [
            ['resume', 'Resume'],
            ['reset', 'Reset position'],
            ['tour', this.actions.tourActive() ? 'Stop guided tour' : 'Start guided tour'],
            ['comfort', 'Comfort settings'],
            ['about', 'About & credits'],
            ['switch', 'Switch site'],
            ['exit', 'Exit VR', true]
        ];
        const bw = w - 96;
        const bh = 94;
        let y = 122;
        for (const [id, label, danger] of items) {
            const b = this.button(id, 48, y, bw, bh);
            drawButton(ctx, b, label, { hover: this.panel.hover === id, primary: id === 'resume', danger, size: 32 });
            y += bh + 14;
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
            { label: 'Walk towards', key: 'steering', options: [['head', 'Where I look'], ['controller', 'Where I point']] },
            { label: 'Vignette when moving', key: 'vignette', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Teleport (trigger)', key: 'teleport', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Quality', key: 'quality', options: [['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High']] }
        ];
        let y = 112;
        for (const row of rows) {
            ctx.fillStyle = THEME.muted;
            ctx.font = `500 25px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(row.label, 48, y + 20);
            const n = row.options.length;
            const gap = 12;
            const bw = (w - 96 - gap * (n - 1)) / n;
            const by = y + 32;
            row.options.forEach(([value, label], i) => {
                const id = `${row.key}:${value}`;
                const b = this.button(id, 48 + i * (bw + gap), by, bw, 58);
                const active = String(c[row.key]) === value;
                drawButton(ctx, b, label, { hover: this.panel.hover === id, active, size: 24 });
            });
            y += 112;
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
        const c = this.actions.site.credits;
        y = wrapText(ctx, `“${c.sceneTitle}” by ${c.sceneAuthor}, licensed ${c.sceneLicense}.`, 48, y, w - 96, 36);
        y = wrapText(ctx, `Changes: ${c.changes}`, 48, y + 4, w - 96, 34);

        y += 22;
        ctx.fillStyle = THEME.text;
        ctx.font = `600 28px ${THEME.font}`;
        ctx.fillText('Technology', 48, y);
        y += 40;
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        y = wrapText(ctx, TECH_CREDIT, 48, y, w - 96, 34);

        const bb = this.button('back', 48, h - 128, w - 96, 84);
        drawButton(ctx, bb, 'Back', { hover: this.panel.hover === 'back', primary: true, size: 30 });
    }
}
