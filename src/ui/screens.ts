// The DOM side of SiteXR: loading / welcome overlay, the desktop walkthrough HUD, the
// settings and credits modals. Nothing here is visible inside an immersive session.
import type { Poi, TourStop } from '../config';
import { settings } from '../settings';
import type { Comfort } from '../settings';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenCallbacks = {
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

    constructor(cb: ScreenCallbacks) {
        this.cb = cb;
        $('enter').addEventListener('click', () => cb.onEnter());
        $('open-settings').addEventListener('click', () => this.openModal('modal-settings'));
        $('open-credits').addEventListener('click', () => this.openModal('modal-credits'));
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

    // ---- loading / welcome -------------------------------------------------------------

    setProgress(pct: number, label?: string) {
        $('progress-fill').style.width = `${Math.max(0, Math.min(100, pct))}%`;
        $('progress-pct').textContent = `${Math.round(pct)}%`;
        if (label) $('progress-label').textContent = label;
    }

    setReady(xr: boolean) {
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

    setLoadError(message: string) {
        $('progress-label').textContent = message;
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
