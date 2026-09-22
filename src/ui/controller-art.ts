// A schematic Meta Quest 3 Touch Plus controller, drawn once and used three times: in the
// Controls panel on the page (as SVG), on the Controls page of the in-VR menu, and in the
// first-time tutorial (both on canvas). The geometry lives here so those three never drift
// apart, and so a binding change is a one-line edit in CONTROLS below.
//
// Everything is expressed in a 200 x 300 local box with the controller upright and facing
// the viewer. The left controller is the right one mirrored about x = 100, so part positions
// are computed rather than transformed — a transform would flip the button letters too.

export type Hand = 'left' | 'right';

/** Which part of the controller a line of text is about. */
export type PartId = 'stick' | 'upper' | 'lower' | 'trigger' | 'grip';

export const BOX = { w: 200, h: 300 };

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * The right controller's silhouette: a wide head that the thumb works on, tapering into a
 * handle. Drawn clockwise from the upper left. The left controller uses the same path
 * mirrored, which is why it carries no lettering.
 */
export const BODY_PATH =
    'M30,88 C30,42 62,12 104,12 C148,12 178,44 178,88 C178,124 164,148 140,160 ' +
    'C128,168 122,186 118,212 C114,244 110,268 102,280 C96,289 78,289 72,280 ' +
    'C64,268 60,244 58,212 C54,186 48,168 36,158 C32,140 30,112 30,88 Z';

type Circle = { kind: 'circle'; x: number; y: number; r: number };
type Rounded = { kind: 'rect'; x: number; y: number; w: number; h: number; r: number };
export type PartShape = Circle | Rounded;

export type Part = {
    id: PartId;
    shape: PartShape;
    /** The letter printed on a face button, if it has one. */
    letter?: string;
    /** Where a leader line should leave the part, and which way the label sits. */
    anchor: { x: number; y: number; side: 'in' | 'out' };
};

/** Mirror an x coordinate for the left controller. */
const mx = (hand: Hand, x: number) => (hand === 'left' ? BOX.w - x : x);

/**
 * The parts of one controller, positioned in the 200 x 300 box.
 *
 * On a Touch Plus the thumbstick sits toward the inner edge of the face with the two face
 * buttons outboard of it, the upper one above the lower. The trigger is under the index
 * finger where the head meets the handle, and the grip is on the inner face of the handle.
 */
export const partsOf = (hand: Hand): Part[] => {
    const inner = (x: number) => mx(hand, x);
    const upper = hand === 'right' ? 'B' : 'Y';
    const lower = hand === 'right' ? 'A' : 'X';
    return [
        {
            id: 'stick',
            shape: { kind: 'circle', x: inner(76), y: 64, r: 27 },
            anchor: { x: inner(76), y: 37, side: 'in' }
        },
        {
            id: 'upper',
            shape: { kind: 'circle', x: inner(143), y: 52, r: 16 },
            letter: upper,
            anchor: { x: inner(159), y: 52, side: 'out' }
        },
        {
            id: 'lower',
            shape: { kind: 'circle', x: inner(141), y: 102, r: 16 },
            letter: lower,
            anchor: { x: inner(157), y: 102, side: 'out' }
        },
        {
            id: 'trigger',
            shape: { kind: 'rect', x: inner(64) - (hand === 'left' ? 54 : 0), y: 150, w: 54, h: 40, r: 16 },
            anchor: { x: inner(118), y: 170, side: 'out' }
        },
        {
            id: 'grip',
            shape: { kind: 'rect', x: inner(54) - (hand === 'left' ? 16 : 0), y: 202, w: 16, h: 52, r: 8 },
            anchor: { x: inner(54), y: 228, side: 'in' }
        }
    ];
};

/**
 * What each control does, in the words the panel shows. These are the bindings in
 * src/main.ts and src/xr/rig.ts; change them together.
 */
export const CONTROLS: Record<Hand, Record<PartId, { title: string; note?: string }>> = {
    left: {
        stick: { title: 'Walk', note: 'the way you are looking' },
        upper: { title: 'Reset', note: 'back to where you started' },
        lower: { title: 'Guided tour' },
        trigger: { title: 'Teleport', note: 'or open a door, or read a note' },
        grip: { title: 'Hold for a bigger step' }
    },
    right: {
        stick: { title: 'Turn', note: 'up and down changes floor' },
        upper: { title: 'Menu' },
        lower: { title: 'Next stop on the tour' },
        trigger: { title: 'Teleport', note: 'or open a door, or read a note' },
        grip: { title: 'Hold for a bigger step' }
    }
};

export const HAND_LABEL: Record<Hand, string> = { left: 'Left hand', right: 'Right hand' };

// ---- layout ---------------------------------------------------------------------------------

/** One label row: where the leader starts on the controller and where the text sits. */
export type Row = {
    part: Part;
    /** Leader start, on the part. */
    ax: number;
    ay: number;
    /** The column the leader steps through, and the row it lands on. */
    elbow: number;
    ly: number;
    /** Where the leader ends and the text begins. */
    tx: number;
    lx: number;
    align: 'start' | 'end';
    title: string;
    note?: string;
};

export type Layout = {
    /** Full drawing size, controller plus its label column. */
    w: number;
    h: number;
    /** X offset of the 200-wide controller box inside the drawing. */
    ox: number;
    rows: Row[];
};

const LABEL_W = 250;
const GAP = 30;

/**
 * Place one controller and its labels. Every label goes in a single column on the outer side
 * of the hand — left controller labelled to the left, right to the right — so the two can
 * stand side by side without their callouts meeting in the middle. Rows are evenly spaced and
 * joined to their part by a stepped leader, which keeps the lines apart wherever the part sits.
 */
export const layoutOf = (hand: Hand): Layout => {
    const right = hand === 'right';
    const ox = right ? 0 : LABEL_W + GAP;
    const colX = right ? BOX.w + GAP : LABEL_W;
    const parts = partsOf(hand);
    const top = 40;
    const step = (BOX.h - 90) / (parts.length - 1);
    const rows = parts.map((part, i) => {
        const c = CONTROLS[hand][part.id];
        return {
            part,
            ax: part.anchor.x + ox,
            ay: part.anchor.y,
            elbow: right ? BOX.w + ox + GAP / 2 : ox - GAP / 2,
            ly: top + step * i,
            tx: right ? colX + 10 : colX - 10,
            lx: right ? colX + 18 : colX - 18,
            align: (right ? 'start' : 'end') as 'start' | 'end',
            title: c.title,
            note: c.note
        };
    });
    return { w: BOX.w + GAP + LABEL_W, h: BOX.h + 46, ox, rows };
};

// ---- canvas drawing (the in-VR panel and the tutorial) -------------------------------------

export type CanvasTheme = {
    body: string;
    /** The dish the thumbstick cap sits in. */
    dish: string;
    part: string;
    highlight: string;
    letter: string;
};

/**
 * Draw one controller into `ctx`, scaled to fit `size` pixels tall, with its top-left at
 * (x, y). `highlight` picks out a single part in the accent colour, which is what the
 * tutorial uses to point at the control it is asking for.
 */
export const drawController = (
    ctx: CanvasRenderingContext2D,
    hand: Hand,
    x: number,
    y: number,
    size: number,
    theme: CanvasTheme,
    highlight?: PartId
) => {
    const s = size / BOX.h;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    // The silhouette. Path2D takes the same data the SVG uses, so the two stay identical.
    const body = new Path2D(BODY_PATH);
    if (hand === 'left') {
        ctx.save();
        ctx.translate(BOX.w, 0);
        ctx.scale(-1, 1);
        ctx.fillStyle = theme.body;
        ctx.fill(body);
        ctx.restore();
    } else {
        ctx.fillStyle = theme.body;
        ctx.fill(body);
    }

    for (const part of partsOf(hand)) {
        const lit = part.id === highlight;
        const sh = part.shape;
        ctx.fillStyle = lit ? theme.highlight : part.id === 'stick' ? theme.dish : theme.part;
        ctx.beginPath();
        if (sh.kind === 'circle') ctx.arc(sh.x, sh.y, sh.r, 0, Math.PI * 2);
        else roundRectPath(ctx, sh.x, sh.y, sh.w, sh.h, sh.r);
        ctx.fill();
        // a thumbstick reads as a stick only with the cap drawn raised inside the dish
        if (part.id === 'stick' && sh.kind === 'circle') {
            ctx.beginPath();
            ctx.arc(sh.x, sh.y, sh.r * 0.56, 0, Math.PI * 2);
            ctx.fillStyle = lit ? theme.highlight : theme.part;
            ctx.fill();
        }
        if (part.letter) {
            ctx.fillStyle = lit ? theme.body : theme.letter;
            ctx.font = `600 20px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(part.letter, (sh as Circle).x, (sh as Circle).y + 1);
        }
    }
    ctx.restore();
};

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// ---- SVG (the Controls panel on the page) --------------------------------------------------

/** One controller with its labels, as a standalone SVG. */
export const controllerSvg = (hand: Hand): string => {
    const { w, h, ox, rows } = layoutOf(hand);
    const body =
        hand === 'right'
            ? `<g transform="translate(${ox}, 0)"><path d="${BODY_PATH}" fill="var(--art-body)"/></g>`
            : `<g transform="translate(${ox + BOX.w}, 0) scale(-1, 1)"><path d="${BODY_PATH}" fill="var(--art-body)"/></g>`;

    const shapes: string[] = [];
    const leaders: string[] = [];
    const labels: string[] = [];

    for (const r of rows) {
        const sh = r.part.shape;
        if (sh.kind === 'circle') {
            const fill = r.part.id === 'stick' ? 'var(--art-dish)' : 'var(--art-part)';
            shapes.push(`<circle cx="${sh.x + ox}" cy="${sh.y}" r="${sh.r}" fill="${fill}"/>`);
            if (r.part.id === 'stick') {
                shapes.push(`<circle cx="${sh.x + ox}" cy="${sh.y}" r="${(sh.r * 0.56).toFixed(1)}" fill="var(--art-part)"/>`);
            }
            if (r.part.letter) {
                shapes.push(
                    `<text x="${sh.x + ox}" y="${sh.y}" class="art-letter" dominant-baseline="central" text-anchor="middle">${r.part.letter}</text>`
                );
            }
        } else {
            shapes.push(
                `<rect x="${sh.x + ox}" y="${sh.y}" width="${sh.w}" height="${sh.h}" rx="${sh.r}" fill="var(--art-part)"/>`
            );
        }
        leaders.push(`<path d="M${r.ax},${r.ay} H${r.elbow} V${r.ly} H${r.tx}" class="art-leader"/>`);
        labels.push(
            `<circle cx="${r.ax}" cy="${r.ay}" r="3" class="art-dot"/>` +
                `<text x="${r.lx}" y="${r.note ? r.ly - 8 : r.ly}" text-anchor="${r.align}" class="art-title" dominant-baseline="central">${r.title}</text>` +
                (r.note
                    ? `<text x="${r.lx}" y="${r.ly + 12}" text-anchor="${r.align}" class="art-note" dominant-baseline="central">${r.note}</text>`
                    : '')
        );
    }

    // Leaders go down first so the two that cross the body pass behind it.
    return (
        `<svg class="controller" viewBox="0 0 ${w} ${h}" role="img" aria-label="${HAND_LABEL[hand]} controller">` +
        leaders.join('') +
        body +
        shapes.join('') +
        labels.join('') +
        `<text x="${ox + BOX.w / 2}" y="${h - 10}" text-anchor="middle" class="art-hand">${HAND_LABEL[hand]}</text>` +
        '</svg>'
    );
};

/**
 * The same labelled diagram on a canvas, for the in-VR panel. `width` is the space the whole
 * drawing gets; everything scales to fit it.
 */
export const drawLabelledController = (
    ctx: CanvasRenderingContext2D,
    hand: Hand,
    x: number,
    y: number,
    width: number,
    theme: CanvasTheme & { leader: string; title: string; note: string; hand: string },
    /** The caption under the drawing. Off where something else already names the hand. */
    showHand = true
) => {
    const L = layoutOf(hand);
    const s = width / L.w;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);

    ctx.strokeStyle = theme.leader;
    ctx.lineWidth = 1.5;
    for (const r of L.rows) {
        ctx.beginPath();
        ctx.moveTo(r.ax, r.ay);
        ctx.lineTo(r.elbow, r.ay);
        ctx.lineTo(r.elbow, r.ly);
        ctx.lineTo(r.tx, r.ly);
        ctx.stroke();
    }

    drawController(ctx, hand, L.ox, 0, BOX.h, theme);

    for (const r of L.rows) {
        ctx.fillStyle = theme.note;
        ctx.beginPath();
        ctx.arc(r.ax, r.ay, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = r.align === 'start' ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = theme.title;
        ctx.font = `600 17px ${FONT}`;
        ctx.fillText(r.title, r.lx, r.note ? r.ly - 8 : r.ly);
        if (r.note) {
            ctx.fillStyle = theme.note;
            ctx.font = `400 14px ${FONT}`;
            ctx.fillText(r.note, r.lx, r.ly + 12);
        }
    }

    if (showHand) {
        ctx.fillStyle = theme.hand;
        ctx.font = `600 14px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(HAND_LABEL[hand].toUpperCase(), L.ox + BOX.w / 2, L.h - 10);
    }
    ctx.restore();
    return L.h * s;
};
