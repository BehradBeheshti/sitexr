/**
 * SiteXR on Cloudflare: the static site, plus the one thing static hosting cannot do.
 *
 * Two browsers cannot introduce themselves to each other. A page in a headset and a page on
 * a laptop need somewhere to meet, and GitHub Pages only hands out files. This Worker serves
 * exactly the same build and adds a meeting point: `/relay/<code>`, a WebSocket room held
 * open by a Durable Object.
 *
 * Only the viewpoint travels. The model is already on both machines, because both loaded the
 * same site, so the wearer's position and what they have touched is all that crosses the
 * wire: a few dozen bytes, fifteen times a second. Nothing of the model itself passes
 * through Cloudflare.
 */
import { DurableObject } from 'cloudflare:workers';

/** One shared view: a single host, any number of watchers. */
export class ShareRoom extends DurableObject {
    async fetch(request) {
        const url = new URL(request.url);
        const role = url.searchParams.get('role') === 'host' ? 'host' : 'view';

        if (request.headers.get('Upgrade') !== 'websocket') {
            // a plain GET reports whether anyone is presenting, so the watcher page can say
            // "nobody is sharing that code" instead of waiting in silence
            return Response.json({ host: this.hostCount() > 0, viewers: this.viewerCount() });
        }

        if (role === 'host' && this.hostCount() > 0) {
            // someone is already presenting under this code; the client picks another
            return Response.json({ error: 'busy' }, { status: 409 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        // the tag rides with the socket through hibernation, so the room still knows which
        // end is presenting after it has slept
        this.ctx.acceptWebSocket(server, [role]);
        server.send(JSON.stringify({ t: 'hello', role, viewers: this.viewerCount() }));
        if (role === 'view') this.tellHost();

        return new Response(null, { status: 101, webSocket: client });
    }

    hostCount() {
        return this.ctx.getWebSockets('host').length;
    }

    viewerCount() {
        return this.ctx.getWebSockets('view').length;
    }

    tellHost() {
        const msg = JSON.stringify({ t: 'viewers', n: this.viewerCount() });
        for (const ws of this.ctx.getWebSockets('host')) {
            try {
                ws.send(msg);
            } catch {
                // the socket is going away; webSocketClose will tidy up
            }
        }
    }

    async webSocketMessage(ws, message) {
        // only the presenter's messages are passed on, and they are passed on untouched
        if (!this.ctx.getTags(ws).includes('host')) return;
        for (const viewer of this.ctx.getWebSockets('view')) {
            try {
                viewer.send(message);
            } catch {
                // dropped viewer
            }
        }
    }

    async webSocketClose(ws, code, reason) {
        const wasHost = this.ctx.getTags(ws).includes('host');
        try {
            ws.close(code, reason);
        } catch {
            // already gone
        }
        if (wasHost) {
            // tell the watchers the presenter left, rather than leaving them on a frozen frame
            const bye = JSON.stringify({ t: 'hostgone' });
            for (const viewer of this.ctx.getWebSockets('view')) {
                try {
                    viewer.send(bye);
                } catch {
                    // dropped viewer
                }
            }
        } else {
            this.tellHost();
        }
    }

    async webSocketError(ws) {
        try {
            ws.close(1011, 'error');
        } catch {
            // already gone
        }
    }
}

/** Codes people read aloud: no O/0, no I/1, no vowels, so nothing spells anything. */
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';
const validCode = (code) =>
    typeof code === 'string' &&
    code.length >= 4 &&
    code.length <= 8 &&
    [...code].every((c) => CODE_ALPHABET.includes(c));

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/relay/')) {
            const code = url.pathname.slice('/relay/'.length).toUpperCase();
            if (!validCode(code)) return Response.json({ error: 'bad code' }, { status: 400 });
            const id = env.SHARE_ROOM.idFromName(code);
            return env.SHARE_ROOM.get(id).fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};
