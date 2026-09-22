// The DOM side of SiteXR: loading / welcome overlay, the desktop walkthrough HUD, the
// settings and credits modals. Nothing here is visible inside an immersive session.
import { MODES, availableModes, modeOf, sitesOf } from '../config';
import type { ModeId, Poi, Site, TourStop } from '../config';
import { settings } from '../settings';
import type { Comfort } from '../settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenCallbacks = {
    sites: Site[];
    selected: string;
    /** The chosen experience, or null to show the chooser. */
    mode: ModeId | null;
    onSelectMode: (mode: ModeId) => void;
    onSelectSite: (id: string) => void;
    onChangeSite: () => void;
    onEnter: () => void;
    onTour: () => void;
    onTourNext: () => void;
    onTourPrev: () => void;
    onTourStop: () => void;
    onReset: () => void;
    onPoiGo: (poi: Poi) => void;
};

export class Screens {
    private cb: ScreenCallbacks;

    private currentPoi: Poi | null = null;

    private site: Site;

    private mode: ModeId | null;

    constructor(cb: ScreenCallbacks) {
        this.cb = cb;
        this.site = cb.sites.find((s) => s.id === cb.selected) ?? cb.sites[0];
        this.mode = cb.mode;
        this.renderModes();
        this.renderSites();
        this.applyMode();
        this.applySite();
        $('change-mode').addEventListener('click', () => this.showModeChooser());
        $('hud-site').addEventListener('click', () => cb.onChangeSite());
        $('enter').addEventListener('click', () => cb.onEnter());
        $('open-settings').addEventListener('click', () => this.openModal('modal-settings'));
        $('open-credits').addEventListener('click', () => this.openModal('modal-credits'));
        $('open-watch').addEventListener('click', () => {
            const code = (window.prompt('Enter the code shown in the headset') ?? '').trim().toUpperCase();
            if (!code) return;
            const url = new URL(location.href);
            url.searchParams.set('watch', code);
            location.href = url.toString();
        });
        $('hud-tour').addEventListener('click', () => cb.onTour());
        $('hud-reset').addEventListener('click', () => cb.onReset());
        $('hud-menu').addEventListener('click', () => this.openModal('modal-settings'));
        $('caption-next').addEventListener('click', () => cb.onTourNext());
        $('caption-prev').addEventListener('click', () => cb.onTourPrev());
        $('caption-stop').addEventListener('click', () => cb.onTourStop());
        $('poi-close').addEventListener('click', () => this.hidePoi());
        $('poi-go').addEventListener('click', () => {
            if (this.currentPoi) cb.onPoiGo(this.currentPoi);
            this.hidePoi();
        });
        document.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => {
            b.addEventListener('click', () => b.closest<HTMLElement>('.modal')?.setAttribute('hidden', ''));
        });
        document.querySelectorAll<HTMLElement>('.modal').forEach((m) => {
            m.addEventListener('click', (e) => {
                if (e.target === m) m.setAttribute('hidden', '');
            });
        });
        $('settings-defaults').addEventListener('click', () => settings.reset());
        this.renderSettings();
        settings.events.on('change', () => this.renderSettings());
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModals();
        });
    }

    // ---- experience chooser ---------------------------------------------------------------

    private renderModes() {
        const host = $('modes');
        host.innerHTML = '';
        for (const mode of availableModes()) {
            const b = document.createElement('button');
            b.className = 'mode';
            b.type = 'button';
            b.dataset.id = mode.id;
            b.innerHTML = `<span class="mode-eyebrow">${mode.tagline}</span>
                <span class="mode-name">${mode.name}</span>
                <span class="mode-blurb">${mode.blurb}</span>
                <span class="mode-audience">${mode.audience}</span>`;
            b.addEventListener('click', () => this.cb.onSelectMode(mode.id));
            host.appendChild(b);
        }
    }

    /** Back to the two cards, without unloading whatever is already running. */
    showModeChooser() {
        this.showingAll = false;
        this.mode = null;
        this.applyMode();
    }

    /**
     * Every site at once, whichever experience it belongs to.
     *
     * The two cards exist because captures and design models are for different people, and
     * that framing is right on the way in. Once someone is already inside, it only puts the
     * scene they want two clicks away, so "Change site" lists the lot.
     */
    showAllSites() {
        this.showingAll = true;
        if (this.mode === null) this.mode = modeOf(this.site.id);
        this.applyMode();
    }

    setMode(mode: ModeId) {
        this.showingAll = false;
        this.mode = mode;
        this.applyMode();
    }

    private showingAll = false;

    private applyMode() {
        const chosen = this.mode !== null;
        if (this.watching) {
            this.renderSites();
            this.applyWatchChrome();
            return;
        }
        $('modes').hidden = chosen;
        $('sites').hidden = !chosen;
        $('mode-bar').hidden = !chosen;
        $('site-eyebrow').hidden = !chosen;
        $('site-title').hidden = !chosen;
        $('site-lede').hidden = !chosen;
        $('progress').hidden = !chosen;
        $('enter').hidden = !chosen;
        $('mode-note').hidden = !chosen;
        if (chosen) {
            $('mode-name').textContent = this.showingAll
                ? 'All sites'
                : (MODES.find((x) => x.id === this.mode)?.name ?? '');
            this.renderSites();
        }
    }

    // ---- watch mode --------------------------------------------------------------------------

    /**
     * A projected second screen: no controls, no hints, just the badge. The watcher is not a
     * visitor and should not be offered anything to press.
     */
    /** Offer the watch entry point only where a relay can actually be reached. */
    setWatchOffered(offered: boolean) {
        $('open-watch').hidden = !offered;
    }

    /**
     * A watching screen is not a visitor. It never gets a button to press, and while the
     * presenter is changing scene it says so rather than offering a way in.
     */
    private watching = false;

    /** True once a frame has actually arrived, so a later silence reads as paused. */
    private hasWatched = false;

    setWatching(code: string) {
        this.watching = true;
        this.hideWelcome();
        $('watch-badge').hidden = false;
        $('watch-text').textContent = `Watching \u00b7 ${code}`;
        $('hud-hint').hidden = true;
        $('hud-site').hidden = true;
        $('hud-reset').hidden = true;
        $('hud-tour').hidden = true;
    }

    /** While watching, the loading card keeps its progress bar and loses its controls. */
    private applyWatchChrome() {
        if (!this.watching) return;
        for (const id of ['enter', 'sites', 'mode-bar', 'modes', 'site-lede', 'mode-note']) {
            const el = document.getElementById(id);
            if (el) el.hidden = true;
        }
    }

    setWatchStatus(status: { kind: string; code?: string; message?: string }) {
        const text = $('watch-text');
        const badge = $('watch-badge');
        if (status.kind === 'paused') {
            badge.hidden = false;
            badge.classList.add('watch-paused');
            text.textContent = `Paused \u00b7 ${status.code ?? ''}`;
            return;
        }
        // Two routes reach the same place: the relay reports the presenter's socket closed,
        // or nothing has arrived for a few seconds and the screen works it out for itself.
        // Whichever wins the race, a viewer should read the same word.
        if (status.kind === 'waiting' && this.hasWatched) {
            badge.hidden = false;
            badge.classList.add('watch-paused');
            text.textContent = `Paused \u00b7 ${status.code ?? ''}`;
            return;
        }
        badge.classList.remove('watch-paused');
        if (status.kind === 'waiting') {
            badge.hidden = false;
            text.textContent = `Waiting for ${status.code ?? ''} to start`;
        } else if (status.kind === 'watching') {
            this.hasWatched = true;
            badge.hidden = false;
            text.textContent = `Watching \u00b7 ${status.code ?? ''}`;
        } else if (status.kind === 'error') {
            badge.hidden = false;
            text.textContent = status.message ?? 'Cannot reach the relay';
        }
    }

    // ---- site picker -------------------------------------------------------------------------

    private renderSites() {
        const host = $('sites');
        host.innerHTML = '';
        const list = this.showingAll || !this.mode ? this.cb.sites : sitesOf(this.mode);
        for (const site of list) {
            const b = document.createElement('button');
            b.className = 'site';
            b.type = 'button';
            b.dataset.id = site.id;
            b.setAttribute('aria-pressed', String(site.id === this.site.id));
            const poster = new URL(site.poster, document.baseURI).href;
            b.innerHTML = `<span class="site-img" style="background-image:url('${poster}')"></span>
                <span class="site-body"><span class="site-tag">${site.tag}</span><span class="site-name">${site.name}</span></span>`;
            b.addEventListener('click', () => {
                if (site.id !== this.site.id) this.cb.onSelectSite(site.id);
            });
            host.appendChild(b);
        }
    }

    setSelected(id: string) {
        this.site = this.cb.sites.find((s) => s.id === id) ?? this.site;
        document.querySelectorAll<HTMLElement>('#sites .site').forEach((el) => {
            el.setAttribute('aria-pressed', String(el.dataset.id === id));
        });
        this.applySite();
    }

    private applySite() {
        const s = this.site;
        $('site-title').textContent = s.name;
        $('site-eyebrow').textContent = `${s.kind === 'design' ? 'Design model' : 'Site capture'} · ${s.subtitle}`;
        $('site-lede').textContent = s.blurb;
        $('hud-site-name').textContent = s.name;
        const c = s.credits;
        $('credit-scene').innerHTML = `“${c.sceneTitle}” by ${c.sceneAuthor} — licensed <a href="${c.sceneLicenseUrl}" target="_blank" rel="noopener">${c.sceneLicense}</a>. Source: <a href="${c.sceneSourceUrl}" target="_blank" rel="noopener">original scene</a>.<br /><span class="muted">Changes: ${c.changes}</span>`;
        const bd = document.querySelector<HTMLElement>('.overlay .backdrop');
        if (bd) bd.style.setProperty('--poster', `url('${new URL(s.poster, document.baseURI).href}')`);
    }

    /** Back to the loading state for a newly selected site. */
    setLoading(site: Site) {
        // The mode is not changed here: the app pre-loads a site so it is ready the moment
        // someone picks a side, and that must not dismiss the chooser.
        this.site = site;
        this.applyMode();
        this.applySite();
        const overlay = $('overlay');
        overlay.dataset.state = 'loading';
        overlay.hidden = false;
        overlay.classList.remove('fading');
        const btn = $<HTMLButtonElement>('enter');
        btn.disabled = true;
        $('enter-sub').textContent = 'Loading…';
        $('mode-note').textContent = '';
        this.setProgress(2, 'Connecting to site data…');
        this.hideHud();
    }

    get welcomeHidden() {
        return $('overlay').hidden;
    }

    // ---- loading / welcome -------------------------------------------------------------

    setProgress(pct: number, label?: string) {
        $('progress-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
        $('progress-pct').textContent = `${Math.round(pct)}%`;
        if (label) $('progress-label').textContent = label;
    }

    setReady(xr: boolean) {
        if (this.watching) {
            this.applyWatchChrome();
            return;
        }
        const overlay = $('overlay');
        overlay.dataset.state = 'ready';
        this.setProgress(100, 'Site ready');
        const btn = $<HTMLButtonElement>('enter');
        btn.disabled = false;
        $('enter-sub').textContent = xr ? 'Immersive VR · Meta Quest' : 'Desktop walkthrough';
        $('mode-note').textContent = xr
            ? 'Put on the headset and pull the trigger on Enter Site.'
            : 'VR headset not detected. Open this page in the Meta Quest Browser for the immersive experience.';
    }

    setEnterBusy(busy: boolean) {
        const btn = $<HTMLButtonElement>('enter');
        btn.disabled = busy;
        if (busy) $('enter-sub').textContent = 'Starting…';
    }

    showWelcome(note?: string) {
        const overlay = $('overlay');
        overlay.hidden = false;
        overlay.classList.remove('fading');
        if (note) $('mode-note').textContent = note;
        this.hideHud();
    }

    hideWelcome() {
        const overlay = $('overlay');
        overlay.classList.add('fading');
        setTimeout(() => {
            if (overlay.classList.contains('fading')) overlay.hidden = true;
        }, 480);
    }

    setLoadError(kind: string) {
        const noGraphics = kind === 'no-graphics';
        $('progress-label').textContent = noGraphics
            ? '3D graphics are unavailable in this browser.'
            : 'The site could not be loaded. Please refresh to try again.';
        $('mode-note').textContent = noGraphics
            ? 'Enable hardware acceleration (Chrome: Settings → System) or check the graphics driver, then reload. On a Meta Quest headset this works out of the box.'
            : '';
        $('enter-sub').textContent = 'Unavailable';
        $('overlay').dataset.state = 'error';
    }

    // ---- desktop HUD -------------------------------------------------------------------

    showHud() {
        $('hud').hidden = false;
    }

    hideHud() {
        $('hud').hidden = true;
        this.hideCaption();
        this.hidePoi();
    }

    setTourActive(active: boolean) {
        $('hud-tour').classList.toggle('active', active);
        $('hud-tour').textContent = active ? 'End tour' : 'Guided tour';
        if (!active) this.hideCaption();
    }

    showCaption(stop: TourStop, index: number, total: number) {
        $('caption-step').textContent = `Stop ${index + 1} / ${total}`;
        $('caption-title').textContent = stop.title;
        $('caption-text').textContent = stop.text;
        $('caption').hidden = false;
        this.hidePoi();
    }

    hideCaption() {
        $('caption').hidden = true;
    }

    showPoi(poi: Poi) {
        this.currentPoi = poi;
        $('poi-index').textContent = String(poi.index);
        $('poi-title').textContent = poi.title;
        $('poi-text').textContent = poi.text;
        $('poi').hidden = false;
    }

    hidePoi() {
        this.currentPoi = null;
        $('poi').hidden = true;
    }

    /** Full-screen blink for desktop tour travel. Resolves once black. */
    fadeOut(): Promise<void> {
        $('fade').classList.add('on');
        return new Promise((r) => setTimeout(r, 240));
    }

    fadeIn() {
        $('fade').classList.remove('on');
    }

    toast(text: string, ms = 2600) {
        const t = $('toast');
        t.textContent = text;
        t.hidden = false;
        clearTimeout((t as any)._timer);
        (t as any)._timer = setTimeout(() => {
            t.hidden = true;
        }, ms);
    }

    // ---- modals -------------------------------------------------------------------------

    openModal(id: string) {
        $(id).hidden = false;
    }

    closeModals() {
        document.querySelectorAll<HTMLElement>('.modal').forEach((m) => m.setAttribute('hidden', ''));
    }

    get modalOpen() {
        return !!document.querySelector('.modal:not([hidden])');
    }

    private renderSettings() {
        const c = settings.get();
        const rows: { label: string; key: keyof Comfort; options: [string, string][] }[] = [
            { label: 'Turning (VR)', key: 'turn', options: [['snap30', 'Snap 30°'], ['snap45', 'Snap 45°'], ['smooth', 'Smooth']] },
            { label: 'Walk speed (VR)', key: 'speed', options: [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']] },
            { label: 'Walk towards (VR)', key: 'steering', options: [['head', 'Where I look'], ['controller', 'Where I point']] },
            { label: 'Vignette when moving (VR)', key: 'vignette', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Teleport with trigger (VR)', key: 'teleport', options: [['true', 'On'], ['false', 'Off']] },
            { label: 'Quality', key: 'quality', options: [['low', 'Low'], ['balanced', 'Balanced'], ['high', 'High']] }
        ];
        const host = $('settings-rows');
        host.innerHTML = '';
        for (const row of rows) {
            const div = document.createElement('div');
            div.className = 'row';
            const label = document.createElement('label');
            label.textContent = row.label;
            const seg = document.createElement('div');
            seg.className = 'seg';
            for (const [value, text] of row.options) {
                const b = document.createElement('button');
                b.textContent = text;
                b.type = 'button';
                b.classList.toggle('active', String(c[row.key]) === value);
                b.addEventListener('click', () => {
                    const v: unknown = value === 'true' ? true : value === 'false' ? false : value;
                    settings.set(row.key, v as never);
                });
                seg.appendChild(b);
            }
            div.append(label, seg);
            host.appendChild(div);
        }
    }
}
