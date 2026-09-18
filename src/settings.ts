// Comfort and quality settings, persisted per device. Shared by the DOM settings
// screen and the in-VR menu so both edit the same values.
import { EventHandler } from 'playcanvas';

export type TurnMode = 'snap30' | 'snap45' | 'smooth';
export type Speed = 'slow' | 'normal' | 'fast';
export type Quality = 'low' | 'balanced' | 'high';
/** What "forward" means on the walk stick: where you look, or where you point. */
export type Steering = 'head' | 'controller';

export type Comfort = {
    turn: TurnMode;
    speed: Speed;
    steering: Steering;
    vignette: boolean;
    teleport: boolean;
    quality: Quality;
    tutorialDone: boolean;
};

const KEY = 'sitexr.comfort.v1';

const DEFAULTS: Comfort = {
    turn: 'snap30',
    speed: 'normal',
    // Look where you want to go. The alternative, steering with the left hand, suits
    // people who like to look around while walking somewhere else.
    steering: 'head',
    vignette: true,
    teleport: true,
    // The governor protects the frame rate, so a headset can start at the middle tier and
    // be trimmed if the device cannot hold it, rather than starting soft and looking it.
    quality: 'balanced',
    tutorialDone: false
};

export const SPEEDS: Record<Speed, number> = { slow: 1.1, normal: 1.6, fast: 2.4 };

/**
 * Splat budget (millions) per quality tier.
 *
 * The headset figures are far below the desktop ones on purpose. WebXR forces the WebGL
 * path, where splats are depth-sorted on the CPU every frame, for two eyes, inside 13.9 ms.
 * A budget that a desktop shrugs off will not hold 72 Hz on a Quest. These are ceilings:
 * the performance governor lowers the figure further whenever frames run long.
 */
export const BUDGETS: Record<Quality, { headset: number; desktop: number }> = {
    low: { headset: 0.35, desktop: 1.5 },
    balanced: { headset: 0.7, desktop: 2.5 },
    high: { headset: 1.2, desktop: 4 }
};

/**
 * WebXR framebuffer scale per quality tier. Fixed for the life of a session: the spec only
 * allows it to be chosen when the session starts. A Quest 3's native eye buffer is large
 * enough that 0.7 still reads sharply while costing half the fill.
 */
export const FRAMEBUFFER_SCALE: Record<Quality, number> = { low: 0.8, balanced: 0.9, high: 1.0 };

/**
 * Fixed foveation per quality tier: resolution is dropped at the edge of the lens, away
 * from where the eye is pointed. Raised further while the governor is limiting detail.
 * Kept modest, because too much of it reads as smeared peripheral vision.
 */
/**
 * How sharply splat detail falls off with distance, as an exponent on projected coverage:
 * 1 is neutral, 2 concentrates the budget near the camera. Walking a site means the near
 * field is what you are actually looking at, so a limited budget is better spent there
 * than spread evenly over ground you are nowhere near.
 */
export const LOD_FALLOFF = 2;

export const FOVEATION: Record<Quality, number> = { low: 0.6, balanced: 0.4, high: 0.25 };

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
