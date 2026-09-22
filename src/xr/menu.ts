// The in-VR menu: Resume, Reset Position, Guided Tour, Comfort Settings, About, Exit VR.
// Opens 1.3 m ahead of the visitor and pauses locomotion while it is up.
import { BRAND, MODES, sitesOf } from '../config';
import type { Site } from '../config';
import { settings } from '../settings';
import type { Comfort } from '../settings';
import { Panel, THEME, drawButton, drawPanelBackground, wrapText } from './panel';
import type { Button } from './panel';
import type { XrRig } from './rig';

type Page = 'main' | 'comfort' | 'about' | 'sites' | 'share';

export type MenuActions = {
    tourActive: () => boolean;
    toggleTour: () => void;
    replayTutorial: () => void;
    /** Go to another site. Loading one ends the session, so this leaves VR on the way. */
    switchSite: (id: string) => void;
    /** Put this viewpoint on a screen someone else is watching. */
    share: {
        available: boolean;
        active: () => boolean;
        code: () => string;
        viewers: () => number;
        watchUrl: (code: string) => string;
        start: () => void;
        stop: () => void;
    };
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
            case 'share':
                this.page = 'share';
                if (this.actions.share.available && !this.actions.share.active()) {
                    this.actions.share.start();
                }
                break;
            case 'sharestop':
                this.actions.share.stop();
                this.page = 'main';
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
            else if (this.page === 'share') this.drawShare(ctx, w, h);
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
    /**
     * The code a watcher types, in the largest type on any panel here: it has to be read
     * across a room, through a headset, and said out loud correctly first time.
     */
    private drawShare(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'Share view');
        const { share } = this.actions;
        ctx.textAlign = 'center';

        if (!share.available) {
            ctx.fillStyle = THEME.text;
            ctx.font = `600 30px ${THEME.font}`;
            ctx.fillText('Not available on this address', w / 2, 200);
            ctx.fillStyle = THEME.muted;
            ctx.font = `400 23px ${THEME.font}`;
            wrapText(ctx, 'Sharing needs the version of the site that can pass messages between two browsers. Static hosting cannot do it.', 80, 250, w - 160, 32);
        } else if (share.active()) {
            const code = share.code();
            ctx.fillStyle = THEME.muted;
            ctx.font = `400 24px ${THEME.font}`;
            ctx.fillText('On any computer, open this site and enter', w / 2, 180);

            ctx.fillStyle = THEME.accent;
            ctx.font = `700 132px ${THEME.font}`;
            ctx.fillText(code, w / 2, 320);

            ctx.fillStyle = THEME.muted;
            ctx.font = `400 21px ${THEME.font}`;
            wrapText(ctx, share.watchUrl(code), 60, 380, w - 120, 28);

            const n = share.viewers();
            ctx.fillStyle = n > 0 ? THEME.text : THEME.muted;
            ctx.font = `600 27px ${THEME.font}`;
            ctx.fillText(n === 0 ? 'Nobody watching yet' : n === 1 ? '1 screen watching' : `${n} screens watching`, w / 2, 470);

            const stop = this.button('sharestop', 48, h - 176, w - 96, 68);
            drawButton(ctx, stop, 'Stop sharing', { hover: this.panel.hover === 'sharestop', size: 28 });
        } else {
            ctx.fillStyle = THEME.muted;
            ctx.font = `400 26px ${THEME.font}`;
            ctx.fillText('Opening a room\u2026', w / 2, 260);
        }

        const back = this.button('back', 48, h - 92, w - 96, 68);
        drawButton(ctx, back, 'Back', { hover: this.panel.hover === 'back', size: 28 });
    }

    private drawSites(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'Switch site');

        const groups = MODES.map((mode) => ({ mode, list: sitesOf(mode.id) })).filter((g) => g.list.length);
        const rows = groups.reduce((n, g) => n + g.list.length, 0);

        // The list has to fit the panel. It did with four sites and did not with seven, and
        // what overflowed was not clipped: the rows ran under the Back button, so pressing
        // Back chose a site instead. Lay out to the space there is.
        const top = 100;
        const bottom = h - 104;
        const space = bottom - top;
        const headers = groups.length * 34;
        const twoUp = rows > 5;
        const lines = twoUp ? groups.reduce((n, g) => n + Math.ceil(g.list.length / 2), 0) : rows;
        const rowH = Math.max(56, Math.min(92, Math.floor((space - headers - groups.length * 10) / lines) - 10));
        const colW = twoUp ? (w - 96 - 12) / 2 : w - 96;

        let y = top;
        for (const { mode, list } of groups) {
            ctx.fillStyle = THEME.muted;
            ctx.font = `600 21px ${THEME.font}`;
            ctx.textAlign = 'left';
            ctx.fillText(mode.name.toUpperCase(), 48, y + 15);
            y += 32;

            list.forEach((site, i) => {
                const col = twoUp ? i % 2 : 0;
                const x = 48 + col * (colW + 12);
                const current = site.id === this.actions.site.id;
                const b = this.button(`site:${site.id}`, x, y, colW, rowH);
                drawButton(ctx, b, '', { hover: this.panel.hover === b.id, primary: current, size: 26 });

                ctx.textAlign = 'left';
                ctx.fillStyle = current ? '#1b1205' : THEME.text;
                ctx.font = `600 ${rowH > 74 ? 30 : 25}px ${THEME.font}`;
                ctx.fillText(site.name, x + 22, y + rowH * 0.44);
                ctx.fillStyle = current ? 'rgba(27,18,5,0.74)' : THEME.muted;
                ctx.font = `400 ${rowH > 74 ? 22 : 19}px ${THEME.font}`;
                ctx.fillText(current ? 'you are here' : site.tag, x + 22, y + rowH * 0.78);

                if (!twoUp || col === 1 || i === list.length - 1) y += rowH + 10;
            });
            y += 10;
        }

        ctx.fillStyle = THEME.muted;
        ctx.font = `400 19px ${THEME.font}`;
        ctx.textAlign = 'center';
        ctx.fillText('Loading another site leaves VR for a moment.', w / 2, h - 110);

        const back = this.button('back', 48, h - 92, w - 96, 68);
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
            ['share', this.actions.share.active() ? 'Sharing view\u2026' : 'Share view'],
            ['about', 'Controls'],
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
        ctx.fillText('Quality takes effect now; resolution applies the next time you enter VR.', 48, y + 8);

        const bb = this.button('back', 48, h - 128, (w - 96 - 16) / 2, 84);
        drawButton(ctx, bb, 'Back', { hover: this.panel.hover === 'back', primary: true, size: 30 });
        const tb = this.button('tutorial', 48 + (w - 96 - 16) / 2 + 16, h - 128, (w - 96 - 16) / 2, 84);
        drawButton(ctx, tb, 'Replay tutorial', { hover: this.panel.hover === 'tutorial', size: 30 });
    }

    private drawAbout(ctx: CanvasRenderingContext2D, w: number, h: number) {
        drawPanelBackground(ctx, w, h, 'Controls');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        let y = 150;
        for (const line of [
            'Left stick — walk, in the direction you are looking.',
            'Right stick — flick left or right to turn, up or down to change floor.',
            'Trigger — teleport, open a door, or read a note.',
            'B — this menu.   Y — reset where you are standing.   X — guided tour.'
        ]) {
            y = wrapText(ctx, line, 48, y, w - 96, 36) + 8;
        }

        y += 16;
        ctx.fillStyle = THEME.text;
        ctx.font = `600 28px ${THEME.font}`;
        ctx.fillText('This site', 48, y);
        y += 40;
        ctx.fillStyle = THEME.muted;
        ctx.font = `400 26px ${THEME.font}`;
        const c = this.actions.site.credits;
        // The recorded scenes are CC BY: naming the author and the licence is a condition of use.
        y = wrapText(ctx, c.sceneLicenseUrl
            ? `“${c.sceneTitle}” by ${c.sceneAuthor}, ${c.sceneLicense}.`
            : `${c.sceneTitle}, ${c.sceneAuthor}.`, 48, y, w - 96, 36);
        y = wrapText(ctx, c.changes, 48, y + 4, w - 96, 34);

        const bb = this.button('back', 48, h - 128, w - 96, 84);
        drawButton(ctx, bb, 'Back', { hover: this.panel.hover === 'back', primary: true, size: 30 });
    }
}
