// Sharing a live view: one person in the headset, any number watching on a screen.
//
// The watcher does not receive a picture. Both machines already have the model, because both
// loaded the same site, so only the viewpoint travels: position, facing, and what the wearer
// has touched. That is a few dozen bytes rather than megabits, it costs the headset nothing
// to send, and the watcher draws at their own screen's resolution instead of watching a
// compressed copy of one eye.

/**
 * What a presenter sends. Deliberately short: this goes out fifteen times a second.
 *
 * It travels nested under `v` rather than spread into the envelope. Spreading it once let a
 * field called `t` (the tour stop) overwrite the envelope's own `t` (the message type), and
 * every watcher silently ignored every packet.
 */
export type ShareState = {
    /** site id, so a watcher who arrives late loads the right scene */
    s: string;
    /** head position */
    p: [number, number, number];
    /** unit vector the head is facing */
    f: [number, number, number];
    /** open fraction per door leaf, omitted when the site has no doors */
    d?: number[];
    /** id of the open note card, if any */
    c?: string | null;
    /** guided tour stop, if running */
    t?: number | null;
};

export type ShareStatus =
    | { kind: 'idle' }
    | { kind: 'connecting'; code: string }
    | { kind: 'sharing'; code: string; viewers: number }
    | { kind: 'watching'; code: string }
    | { kind: 'waiting'; code: string }
    | { kind: 'ended'; code: string }
    | { kind: 'error'; message: string };

const ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const newCode = (n = 4) =>
    Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

/**
 * Where the relay lives. Same origin by default, which is right once the site is on a host
 * that can run code. On a purely static host there is nothing at `/relay`, and the UI says so
 * rather than hanging.
 */
export const RELAY_BASE = ((import.meta.env.VITE_RELAY_URL as string | undefined) ?? '').replace(/\/$/, '');

const relayUrl = (code: string, role: 'host' | 'view') => {
    const base = RELAY_BASE || location.origin;
    const url = new URL(`${base}/relay/${code}`);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    url.searchParams.set('role', role);
    return url.toString();
};

/**
 * Whether this build was deployed somewhere that can pass messages between two browsers.
 *
 * A build-time fact rather than a probe. Asking the server on every page load cost a request
 * that 404s on static hosting, and a failed request is not something a visitor should see in
 * their console on a site that is working exactly as intended. The deployment knows what it
 * is: the Cloudflare build sets `VITE_RELAY=1`, the static one does not.
 */
export const RELAY_ENABLED =
    (import.meta.env.VITE_RELAY as string | undefined) === '1' || !!RELAY_BASE;

/** The presenter's end: opens a room and pushes the viewpoint into it. */
export class ShareHost {
    private ws: WebSocket | null = null;

    private nextSend = 0;

    private backstop: number | null = null;

    code = '';

    viewers = 0;

    onStatus: ((s: ShareStatus) => void) | null = null;

    constructor(private readonly sample: () => ShareState | null, private readonly hz = 15) {}

    get active() {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    /** Opens a room. Retries with a new code if that one is already presenting. */
    async start(attempts = 4): Promise<string> {
        for (let i = 0; i < attempts; i++) {
            const code = newCode();
            this.onStatus?.({ kind: 'connecting', code });
            try {
                await this.connect(code);
                this.code = code;
                this.onStatus?.({ kind: 'sharing', code, viewers: this.viewers });
                // The engine's update is the main driver, but it rides on animation frames,
                // and a browser stops those entirely for a page that is not in front. A
                // presenter who tabs away should go quiet, not disappear.
                this.backstop = window.setInterval(() => this.tick(), Math.round(1000 / this.hz));
                return code;
            } catch (err) {
                if ((err as Error).message !== 'busy') {
                    this.onStatus?.({ kind: 'error', message: (err as Error).message });
                    throw err;
                }
            }
        }
        const message = 'could not find a free code';
        this.onStatus?.({ kind: 'error', message });
        throw new Error(message);
    }

    private connect(code: string) {
        return new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(relayUrl(code, 'host'));
            const fail = () => reject(new Error('busy'));
            ws.addEventListener('error', fail, { once: true });
            ws.addEventListener('close', fail, { once: true });
            ws.addEventListener(
                'open',
                () => {
                    ws.removeEventListener('close', fail);
                    this.ws = ws;
                    ws.addEventListener('message', (e) => {
                        try {
                            const msg = JSON.parse(String(e.data));
                            if (msg.t === 'viewers') {
                                this.viewers = msg.n;
                                this.onStatus?.({ kind: 'sharing', code, viewers: msg.n });
                            }
                        } catch {
                            // a message we do not understand is not worth crashing over
                        }
                    });
                    ws.addEventListener('close', () => {
                        this.stop();
                        this.onStatus?.({ kind: 'ended', code });
                    });
                    resolve();
                },
                { once: true }
            );
        });
    }

    /**
     * Send the current viewpoint, at most `hz` times a second.
     *
     * Driven by the engine's update rather than a timer of its own. In an immersive session
     * that update comes from the headset's frame loop, and a page that is not in front has
     * its timers throttled to a crawl, which would quietly starve a presentation.
     */
    tick() {
        if (!this.active) return;
        const now = performance.now();
        if (now < this.nextSend) return;
        this.nextSend = now + 1000 / this.hz;
        const state = this.sample();
        if (state) this.ws?.send(JSON.stringify({ t: 's', v: state }));
    }

    stop() {
        this.nextSend = 0;
        if (this.backstop !== null) window.clearInterval(this.backstop);
        this.backstop = null;
        const ws = this.ws;
        this.ws = null;
        try {
            ws?.close();
        } catch {
            // already gone
        }
        this.viewers = 0;
    }
}

/** The watcher's end: receives the viewpoint and hands it to whoever drives the camera. */
export class ShareViewer {
    private ws: WebSocket | null = null;

    private retry: number | null = null;

    last: ShareState | null = null;

    onState: ((s: ShareState) => void) | null = null;

    onStatus: ((s: ShareStatus) => void) | null = null;

    constructor(readonly code: string) {}

    get connected() {
        return !!this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    start() {
        this.open();
    }

    private open() {
        this.onStatus?.({ kind: 'waiting', code: this.code });
        let ws: WebSocket;
        try {
            ws = new WebSocket(relayUrl(this.code, 'view'));
        } catch (err) {
            this.onStatus?.({ kind: 'error', message: (err as Error).message });
            return;
        }
        this.ws = ws;
        ws.addEventListener('message', (e) => {
            try {
                const msg = JSON.parse(String(e.data));
                if (msg.t === 's' && msg.v) {
                    this.last = msg.v as ShareState;
                    this.onState?.(msg.v as ShareState);
                    this.onStatus?.({ kind: 'watching', code: this.code });
                } else if (msg.t === 'hostgone') {
                    this.onStatus?.({ kind: 'waiting', code: this.code });
                }
            } catch {
                // ignore anything we cannot read
            }
        });
        // a presentation outlives a dropped connection; keep trying quietly
        const again = () => {
            this.ws = null;
            if (this.retry !== null) return;
            this.retry = window.setTimeout(() => {
                this.retry = null;
                this.open();
            }, 1500);
        };
        ws.addEventListener('close', again);
        ws.addEventListener('error', again);
    }

    stop() {
        if (this.retry !== null) window.clearTimeout(this.retry);
        this.retry = null;
        const ws = this.ws;
        this.ws = null;
        try {
            ws?.close();
        } catch {
            // already gone
        }
    }
}
