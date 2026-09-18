// Comfort and quality settings, persisted per device. Shared by the DOM settings
// screen and the in-VR menu so both edit the same values.
import { EventHandler } from 'playcanvas';

export type TurnMode = 'snap30' | 'snap45' | 'smooth';
export type Speed = 'slow' | 'normal' | 'fast';
export type Quality = 'low' | 'balanced' | 'high';

export type Comfort = {
    turn: TurnMode;
    speed: Speed;
    vignette: boolean;
    teleport: boolean;
    quality: Quality;
    tutorialDone: boolean;
};

const KEY = 'sitexr.comfort.v1';

const DEFAULTS: Comfort = {
    turn: 'snap30',
    speed: 'normal',
    vignette: true,
    teleport: true,
    quality: 'balanced',
    tutorialDone: false
};

export const SPEEDS: Record<Speed, number> = { slow: 1.1, normal: 1.6, fast: 2.4 };

/** Splat budget (millions) per quality tier; the standalone headset gets the smaller table. */
export const BUDGETS: Record<Quality, { headset: number; desktop: number }> = {
    low: { headset: 0.7, desktop: 1.5 },
    balanced: { headset: 1.1, desktop: 2.5 },
    high: { headset: 1.8, desktop: 4 }
};

/** WebXR framebuffer scale per quality tier (applied when a session starts). */
export const FRAMEBUFFER_SCALE: Record<Quality, number> = { low: 0.8, balanced: 1.0, high: 1.0 };

class SettingsStore {
    readonly events = new EventHandler();

    private data: Comfort;

    constructor() {
        let stored: Partial<Comfort> = {};
        try {
            stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
        } catch {
            stored = {};
        }
        this.data = { ...DEFAULTS, ...stored };
    }

    get(): Readonly<Comfort> {
        return this.data;
    }

    set<K extends keyof Comfort>(key: K, value: Comfort[K]) {
        if (this.data[key] === value) return;
        this.data = { ...this.data, [key]: value };
        try {
            localStorage.setItem(KEY, JSON.stringify(this.data));
        } catch {
            // storage unavailable (private mode): settings live for the session only
        }
        this.events.fire('change', key, value);
        this.events.fire(`change:${key}`, value);
    }

    reset() {
        for (const k of Object.keys(DEFAULTS) as (keyof Comfort)[]) {
            if (k !== 'tutorialDone') this.set(k, DEFAULTS[k]);
        }
    }
}

export const settings = new SettingsStore();
