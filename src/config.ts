// SiteXR site catalogue. World space is the viewer's (PlayCanvas, Y up, metres). Scenes
// captured in other units carry a `worldScale` that the app applies to the splat and the
// collision data, so every position below is already in metres.
//
// VITE_SCENE_URL / VITE_COLLISION_URL are build-time overrides for the first site, used
// by the smoke test to run against other cuts of the excavator scene.

export const BRAND = {
    name: 'SiteXR',
    tagline: 'Walk a site before it is built'
};

export const ASSETS = {
    controllerProfilesUrl: 'controllers'
};

/**
 * Where scene assets are served from. Empty by default, meaning they sit beside the app.
 *
 * Set `VITE_ASSET_BASE` at build time to serve them from somewhere else — a private
 * bucket, for instance — so a licensed or client-owned model never has to live in the
 * repository. Only the splat, collision and model urls are redirected; the app's own
 * images stay local. A site url that is already absolute is left alone.
 *
 *   VITE_ASSET_BASE=https://assets.example.com/sitexr npm run build
 *
 * The bucket must allow cross-origin reads from the site's origin.
 */
const ASSET_BASE = ((import.meta.env.VITE_ASSET_BASE as string | undefined) ?? '').replace(/\/$/, '');

/** Resolve a site asset path against {@link ASSET_BASE}. */
export const assetUrl = (path: string) =>
    !ASSET_BASE || /^(https?:)?\/\//.test(path) || path.startsWith('data:') ? path : `${ASSET_BASE}/${path}`;

/** Standing eye height used for the desktop (non-VR) walkthrough camera. */
export const EYE_HEIGHT = 1.65;

export type Poi = {
    id: string;
    index: number;
    title: string;
    text: string;
    /** Marker position in world space (metres). */
    marker: [number, number, number];
    /** Standing point (x, z) and a look target for "Go there". `floor` picks the storey. */
    stand: { x: number; z: number; look: [number, number, number]; floor?: number };
};

export type TourStop = {
    title: string;
    text: string;
    x: number;
    z: number;
    look: [number, number, number];
    /** Approximate height of the storey to stand on, for a model with more than one. */
    floor?: number;
    /** Seconds before the tour advances automatically. */
    dwell: number;
};

export type Credits = {
    sceneTitle: string;
    sceneAuthor: string;
    sceneLicense: string;
    sceneLicenseUrl: string;
    sceneSourceUrl: string;
    changes: string;
};

/** The two ways into the app: a captured site, or a model of one not built yet. */
export type ModeId = 'capture' | 'design';

export type Mode = {
    id: ModeId;
    name: string;
    tagline: string;
    blurb: string;
    /** Who the experience is for, in one phrase. */
    audience: string;
};

export const MODES: Mode[] = [
    {
        id: 'capture',
        name: 'Captured Sites',
        tagline: 'Real places, recorded on site',
        blurb: 'Walk real places as they were on the day: dug ground, heavy plant and a floor being built, at the size and in the state they were found.',
        audience: 'for site teams reviewing what is actually there'
    },
    {
        id: 'design',
        name: 'Design Models',
        tagline: 'Buildings as they were drawn',
        blurb: 'Walk a building at full size before any of it is built, inside and out, the way it would be reviewed.',
        audience: 'for design teams reviewing what is drawn'
    }
];

export type Site = {
    id: string;
    /** Which of the two experiences this site belongs to. */
    kind: ModeId;
    name: string;
    subtitle: string;
    /** One sentence on the welcome card. */
    blurb: string;
    /** Short tag shown on the site card. */
    tag: string;
    poster: string;
    /** Splat scene. Omitted for a model-only site. */
    contentUrl?: string;
    /** A `.glb` mesh model placed in the scene, on its own or over a captured site. */
    model?: { url: string; scale?: number; offset?: [number, number, number]; yaw?: number };
    collision: { type: 'voxel' | 'grid' | 'mesh'; url: string };
    /** Openable door leaves extracted from the source model by `tools/ifc-doors.py`. */
    doors?: { url: string };
    /** A flight of stairs worth testing: walk from `from` to `to` and expect to gain `rise`. */
    stair?: { from: [number, number]; to: [number, number]; rise: number };
    /** Metres per scene unit. */
    worldScale: number;
    /** Arrival point, look target and an approximate floor height for the first camera. */
    spawn: { x: number; z: number; floor: number; look: [number, number, number] };
    /** Visitors are kept within this radius (m) of the scene origin. */
    walkRadius: number;
    background: [number, number, number];
    pois: Poi[];
    tour: TourStop[];
    credits: Credits;
};

const excavator: Site = {
    id: 'excavator',
    kind: 'capture',
    name: 'Excavation Site',
    subtitle: 'Dug ground, a tracked excavator and the way in',
    blurb: 'Walk the excavation at true scale, inspect the tracked excavator and review ground and access conditions.',
    tag: 'Earthworks',
    poster: 'brand/poster-excavator.webp',
    contentUrl: (import.meta.env.VITE_SCENE_URL as string | undefined) ?? 'scene/lod-meta.json',
    collision: { type: 'voxel', url: (import.meta.env.VITE_COLLISION_URL as string | undefined) ?? 'scene/scene.voxel.json' },
    worldScale: 1,
    spawn: { x: 1.0, z: 10.5, floor: 0.35, look: [1.6, 2.4, -0.8] },
    walkRadius: 24,
    background: [0.86, 0.88, 0.9],
    pois: [
        {
            id: 'excavator',
            index: 1,
            title: 'Excavator inspection',
            text: 'Tracked excavator parked with the boom raised and the bucket clear of the working face. Check the slew ring area, hydraulic hoses and the cab glazing for damage before the next shift.',
            marker: [1.6, 4.2, -1.5],
            stand: { x: -4.5, z: 2.5, look: [1.6, 2.6, -1.5] }
        },
        {
            id: 'tracks',
            index: 2,
            title: 'Ground & track condition',
            text: 'The machine is standing on saturated, rutted ground. Deep mud around the tracks indicates poor bearing capacity; confirm the running gear is not sinking and plan a firmer working platform.',
            marker: [4.0, 1.5, 1.7],
            stand: { x: -1.0, z: 6.5, look: [4.0, 1.2, 0.5] }
        },
        {
            id: 'access',
            index: 3,
            title: 'Site access & terrain',
            text: 'Rutted, saturated ground on the approach to the working platform, with the site compound beyond. Review the route and drainage before plant is sent this way, and keep the pedestrian route clear of the machine swing radius.',
            marker: [9.0, 1.6, -3.0],
            stand: { x: 14.0, z: -6.0, look: [4.0, 3.0, 2.0] }
        }
    ],
    tour: [
        { title: 'Site overview', text: 'Welcome to the excavation. The tracked excavator ahead is the focus of this review.', x: 1.0, z: 10.5, look: [1.6, 2.4, -0.8], dwell: 9 },
        { title: 'Working side', text: 'From here the boom, stick and bucket are visible in full. Note the raised boom and clear swing radius.', x: -9.0, z: 4.0, look: [2.0, 2.5, -1.5], dwell: 10 },
        { title: 'Running gear', text: 'The tracks sit in deep, saturated mud. This is the ground and track-condition point of interest.', x: -1.0, z: 6.5, look: [4.0, 1.2, 0.5], dwell: 10 },
        { title: 'Rear and counterweight', text: 'The rear of the machine and the ground it has just cleared. Watch the change in surface level.', x: 8.5, z: -6.0, look: [2.5, 2.6, -2.0], dwell: 9 },
        { title: 'Access route', text: 'The approach to the working platform, rutted and saturated, with the site compound beyond. This is the site-access and terrain point of interest.', x: 14.0, z: -6.0, look: [4.0, 3.0, 2.0], dwell: 10 },
        { title: 'End of tour', text: 'You are back at the arrival point. Explore freely, or open the menu with the B button.', x: 1.0, z: 10.5, look: [1.6, 2.4, -0.8], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Muddy Excavator Site',
        sceneAuthor: 'dok11',
        sceneLicense: 'CC BY 4.0',
        sceneLicenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sceneSourceUrl: 'https://superspl.at/scene/ded12920',
        changes: 'Rescaled and re-encoded so a headset can carry it.'
    }
};

// Komatsu no Mori heavy-plant yard. Scene units are ~3.6 m: the two machines measure
// 2.0 and 2.2 units tall, which is a 7.4 m haul truck and an 8 m mining excavator.
const komatsu: Site = {
    id: 'komatsu',
    kind: 'capture',
    name: 'Heavy Plant Yard',
    subtitle: 'A haul truck and an excavator at full size',
    blurb: 'Stand beside a 290-tonne haul truck and a mining excavator at their real size, and see what heavy plant looks like from the ground.',
    tag: 'Heavy plant',
    poster: 'brand/poster-komatsu.webp',
    contentUrl: 'scene-komatsu/lod-meta.json',
    collision: { type: 'grid', url: 'nav/komatsu.json' },
    worldScale: 3.6,
    spawn: { x: -14, z: 10.5, floor: -1.3, look: [-5.0, 4.0, 1.0] },
    walkRadius: 34,
    background: [0.78, 0.84, 0.92],
    pois: [
        {
            id: 'truck',
            index: 1,
            title: 'Haul truck walk-around',
            text: 'A rigid-frame mining haul truck: 290 tonnes of payload, with the body raised for display. Tyres stand taller than a person, so check tyre condition, the access ladder and the isolation point before any walk-around.',
            marker: [-8.6, 6.8, 1.0],
            stand: { x: -13.4, z: 6.5, look: [-8.6, 3.5, 1.0] }
        },
        {
            id: 'excavator',
            index: 2,
            title: 'Mining excavator',
            text: 'A hydraulic mining shovel with a face-loading bucket. Its loading height and bucket volume decide which class of haul truck can work with it, and how many passes each load takes.',
            marker: [1.9, 6.4, 0.6],
            stand: { x: 2.0, z: -7.0, look: [1.9, 3.0, 0.6] }
        },
        {
            id: 'zone',
            index: 3,
            title: 'Undercarriage & exclusion zone',
            text: 'Track frames at eye level, and the barrier line that keeps people out of the travel path. On a live site nobody approaches a machine of this class without the operator acknowledging them first.',
            marker: [3.2, 1.4, -1.5],
            stand: { x: 8.7, z: -2.4, look: [1.9, 1.5, 0.6] }
        }
    ],
    tour: [
        { title: 'Display yard', text: 'Welcome to the heavy-plant yard. A mining haul truck and a hydraulic shovel stand ahead at full size.', x: -14, z: 10.5, look: [-5.0, 4.0, 1.0], dwell: 9 },
        { title: 'Haul truck', text: 'The truck side-on, with its body raised. The deck you can see sits about as high as a two-storey house.', x: -13.4, z: 6.5, look: [-8.6, 3.5, 1.0], dwell: 10 },
        { title: 'Under the body', text: 'Close enough to read the scale: the rear tyres alone are taller than you are.', x: -3.4, z: 9.0, look: [-8.6, 4.0, 1.0], dwell: 9 },
        { title: 'Mining excavator', text: 'The shovel from the north side, boom and bucket in full view. It loads a truck like that one in three or four passes.', x: 2.0, z: -7.0, look: [1.9, 3.0, 0.6], dwell: 10 },
        { title: 'Undercarriage', text: 'Track frames at eye level, with the barrier line beyond. This is the exclusion-zone point of interest.', x: 8.7, z: -2.4, look: [1.9, 1.5, 0.6], dwell: 9 },
        { title: 'End of tour', text: 'Back at the arrival point. Explore the yard, or press B for the menu.', x: -14, z: 10.5, look: [-5.0, 4.0, 1.0], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'こまつの杜 (Komatsu no Mori)',
        sceneAuthor: 'gnehs',
        sceneLicense: 'CC BY 4.0',
        sceneLicenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sceneSourceUrl: 'https://superspl.at/scene/892bab3d',
        changes: 'Rescaled and re-encoded so a headset can carry it.'
    }
};

// Slab-formwork floor. Scene units are ~0.75 m: the deck-to-soffit distance measures
// 5.7 units (a 4.3 m floor) and the shoring towers sit on a 3.1 unit (2.3 m) grid.
const scaffold: Site = {
    id: 'scaffold',
    kind: 'capture',
    name: 'Formwork Floor',
    subtitle: 'A floor being built, under its shoring',
    blurb: 'Walk a floor under construction between shoring towers and check bracing, prop heads and the access lane.',
    tag: 'Interior',
    poster: 'brand/poster-scaffold.webp',
    contentUrl: 'scene-scaffold/lod-meta.json',
    collision: { type: 'grid', url: 'nav/scaffold.json' },
    worldScale: 0.75,
    spawn: { x: 1.5, z: 0.6, floor: -0.84, look: [-3.0, 0.2, -4.0] },
    walkRadius: 13,
    background: [0.07, 0.08, 0.1],
    pois: [
        {
            id: 'bracing',
            index: 1,
            title: 'Shoring bracing & ties',
            text: 'Formwork support towers, braced diagonally on every lift. Before a pour, confirm each tower is plumb, braced in both directions and standing on a sound base plate.',
            marker: [-1.0, 0.8, -3.0],
            stand: { x: 0.6, z: -1.2, look: [-1.0, 0.4, -3.2] }
        },
        {
            id: 'soffit',
            index: 2,
            title: 'Slab soffit & prop heads',
            text: 'The soffit above is carried by these towers. Check that every prop head bears fully on its bearer and that no leg is over-extended beyond its rated height.',
            marker: [-1.5, 2.4, -1.0],
            stand: { x: 0.0, z: 2.0, look: [-1.5, 2.2, -1.5] }
        },
        {
            id: 'housekeeping',
            index: 3,
            title: 'Housekeeping & access lane',
            text: 'Loose fittings, offcuts and paperwork on the deck are trip hazards on a route the whole trade uses. Keep one clear lane through the shoring at all times.',
            marker: [4.2, -0.5, 3.2],
            stand: { x: 4.0, z: 5.2, look: [4.2, -0.8, 2.4] }
        }
    ],
    tour: [
        { title: 'Floor under construction', text: 'Welcome to a slab-formwork floor. Shoring towers run from this deck up to the soffit above.', x: 1.5, z: 0.6, look: [-3.0, 0.2, -4.0], dwell: 9 },
        { title: 'Bracing and ties', text: 'Every tower is braced diagonally on each lift. This is the bracing point of interest.', x: 0.6, z: -1.2, look: [-1.0, 0.4, -3.2], dwell: 10 },
        { title: 'Soffit and prop heads', text: 'The formwork deck overhead, carried on bearers and prop heads. Check bearing and extension before the pour.', x: 0.0, z: 2.0, look: [-1.5, 2.2, -1.5], dwell: 10 },
        { title: 'Access lane', text: 'The lane through the shoring must stay clear. This is the housekeeping point of interest.', x: 4.0, z: 5.2, look: [4.2, -0.8, 2.4], dwell: 9 },
        { title: 'End of tour', text: 'Back at the arrival point. Explore the floor, or press B for the menu.', x: 1.5, z: 0.6, look: [-3.0, 0.2, -4.0], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Construction next day',
        sceneAuthor: 'redmancg',
        sceneLicense: 'CC BY 4.0',
        sceneLicenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        sceneSourceUrl: 'https://superspl.at/scene/73d39431',
        changes: 'Rescaled and re-encoded so a headset can carry it.'
    }
};


// The project's Revit model, exported to IFC and read with IfcOpenShell. Two storeys plus
// roof, with the site pad kept so there is ground outside the walls to stand on.
const officeBuilding: Site = {
    id: 'office',
    kind: 'design',
    name: 'Office Building',
    subtitle: 'Two floors, a stair, and doors that open',
    blurb: 'Your building at full size, with doors that open. Arrive in the double-height atrium beside the stair, go up to the second floor, and step outside to read the curtain walling from the approach.',
    tag: 'Office',
    poster: 'private/poster-office.webp',
    model: { url: 'private/office-building.glb' },
    collision: { type: 'mesh', url: 'private/office-building.glb' },
    doors: { url: 'private/office-doors.json' },
    stair: { from: [5.2, 2.75], to: [2.0, 2.75], rise: 1.6 },
    worldScale: 1,
    // The atrium, not the approach: the storefront doors are modelled as solid glass, so a
    // visitor who arrived outside could see in but never walk in.
    spawn: { x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.9, 2.2] },
    walkRadius: 30,
    background: [0.74, 0.77, 0.81],
    pois: [
        {
            id: 'stair',
            index: 1,
            title: 'Atrium stair',
            text: 'A steel pan stair with a pipe guardrail, rising through the double-height space. Treads and landings are the easiest thing to get wrong on paper and the easiest to judge standing at the bottom of them.',
            marker: [3.4, 2.4, 2.2],
            stand: { x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.9, 2.2] }
        },
        {
            id: 'level2',
            index: 2,
            title: 'Second floor',
            text: 'The same spot one floor up, at the guardrail. Floor to floor is 3.66 m, and looking down over the edge tells you more about that dimension than any section drawing.',
            marker: [7.2, 5.2, -1.0],
            stand: { x: 8.3, z: 0.3, floor: 3.66, look: [3.4, 3.4, 2.2] }
        },
        {
            id: 'frontage',
            index: 3,
            title: 'Glazed entrance',
            text: 'The approach, with the double-height storefront ahead. Point at a door and pull the trigger to swing it open, or just walk into it and it gives way.',
            marker: [6.5, 4.5, 10.5],
            stand: { x: -9, z: 11, floor: 0, look: [4, 2.2, 8.8] }
        },
        {
            id: 'curve',
            index: 4,
            title: 'Curved wing',
            text: 'Curtain walling wrapped around the curve, with the desks behind it. Whether a curved facade reads as one surface or as a run of flat panels is a question you can only settle by walking along it.',
            marker: [-18.5, 4.5, 6],
            stand: { x: -12, z: 13, floor: 0, look: [-19, 2.5, 4] }
        }
    ],
    tour: [
        { title: 'Arrival', text: 'A design model, not a capture: your building as drawn, at full size.', x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.9, 2.2], dwell: 9 },
        { title: 'Second floor', text: 'The same spot one floor up. Floor to floor is 3.66 m.', x: 8.3, z: 0.3, floor: 3.66, look: [3.4, 3.4, 2.2], dwell: 10 },
        { title: 'Glazed entrance', text: 'Outside now, on the approach, with the storefront ahead.', x: -9, z: 11, floor: 0, look: [4, 2.2, 8.8], dwell: 10 },
        { title: 'Curved wing', text: 'Curtain walling around the curve, desks behind it.', x: -12, z: 13, floor: 0, look: [-19, 2.5, 4], dwell: 10 },
        { title: 'End of tour', text: 'Back in the atrium. Explore freely, or press B for the menu.', x: 8.3, z: 0.3, floor: 0, look: [3.4, 1.9, 2.2], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Office Building',
        sceneAuthor: 'supplied by the project',
        sceneLicense: 'not for redistribution',
        sceneLicenseUrl: '',
        sceneSourceUrl: '',
        changes: 'Prepared from Office Building.rvt. Rescaled, lit and merged so a headset can carry it.'
    }
};

// Three coordination and review models supplied as Revit FBX exports. Units were measured
// rather than assumed: an 18-inch column and a 16-inch joist read 0.457 and 0.406 in the two
// clash models, so those are metres; a door leaf reads 6.65 in the review model, so that one
// is in feet, which is what Revit writes.
const clash1: Site = {
    id: 'clash1',
    kind: 'design',
    name: 'Frame & Ductwork',
    subtitle: 'Four floors of frame with the ducts threaded through',
    blurb: 'Four floors of frame with its ducts and joists. Walk between them at full size and see where everything actually runs.',
    tag: 'Services',
    poster: 'private/poster-clash1.webp',
    model: { url: 'private/clash1.glb' },
    collision: { type: 'mesh', url: 'private/clash1.glb' },
    worldScale: 1,
    spawn: { x: 0, z: 0, floor: 0, look: [-11, 2.2, 0] },
    walkRadius: 45,
    // darker than the capture sites: these models are pale and read as nothing against a
    // bright sky
    background: [0.46, 0.50, 0.56],
    pois: [
        { id: 'frame', index: 1, title: 'Frame', text: 'Concrete columns at 18 inches square, on the grid the model sets out. That measurement is how the units were confirmed.', marker: [-6, 2.6, 0], stand: { x: 3, z: -14, floor: 0, look: [-6, 2.0, -2] } },
        { id: 'services', index: 2, title: 'Ductwork', text: 'Oval duct running in the same zone as the joists. Standing under a crossing is the quickest way to see whether it clears.', marker: [-14, 6.0, 4], stand: { x: -8, z: 4, floor: 4.5, look: [-18, 6.0, 4] } },
        { id: 'upper', index: 3, title: 'Joist zone', text: 'Timber open web joists at 16 inches deep, on the top floor where the frame is clearest.', marker: [-4, 10.5, 0], stand: { x: 0, z: 0, floor: 8, look: [-11, 10.0, 0] } }
    ],
    tour: [
        { title: 'Arrival', text: 'A coordination model, at full size.', x: 0, z: 0, floor: 0, look: [-11, 2.2, 0], dwell: 8 },
        { title: 'Frame', text: 'Columns on the grid, 18 inches square.', x: 3, z: -14, floor: 0, look: [-6, 2.0, -2], dwell: 9 },
        { title: 'Ductwork', text: 'Oval duct sharing the zone with the joists.', x: -8, z: 4, floor: 4.5, look: [-18, 6.0, 4], dwell: 9 },
        { title: 'Joist zone', text: 'Open web joists at 16 inches deep.', x: 0, z: 0, floor: 8, look: [-11, 10.0, 0], dwell: 9 },
        { title: 'End of tour', text: 'Back at the arrival point. Press B for the menu.', x: 0, z: 0, floor: 0, look: [-11, 2.2, 0], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Frame & Ductwork',
        sceneAuthor: 'supplied by the project',
        sceneLicense: 'not for redistribution',
        sceneLicenseUrl: '',
        sceneSourceUrl: '',
        changes: 'Prepared from Clash Detection 1.fbx. Coloured by trade, and given ground to stand on.'
    }
};

const clash2: Site = {
    id: 'clash2',
    kind: 'design',
    name: 'Steel Frame & Services',
    subtitle: 'Seven levels of steel, pipes and ducts',
    blurb: 'Seven levels of steel with the pipes and ducts threaded through. The kind of thing that only starts making sense once you are standing inside it.',
    tag: 'Steel',
    poster: 'private/poster-clash2.webp',
    model: { url: 'private/clash2.glb' },
    collision: { type: 'mesh', url: 'private/clash2.glb' },
    doors: { url: 'private/clash2-doors.json' },
    worldScale: 1,
    spawn: { x: 29.8, z: -29.8, floor: 0, look: [14, 3.0, -20] },
    walkRadius: 60,
    background: [0.46, 0.50, 0.56],
    pois: [
        { id: 'frame', index: 1, title: 'Steel frame', text: 'Seven levels of steel, about 47 by 42 m on plan. Walking the grid is how you read a frame this dense.', marker: [14, 3.0, -20], stand: { x: 26.3, z: -12.8, floor: 0, look: [10, 3.0, -20] } },
        { id: 'services', index: 2, title: 'Service runs', text: 'Pipework and ducts threaded through the frame, coloured as the source drawing had them and toned down so a wall of them is bearable at arm\u2019s length.', marker: [14, 4.4, -14], stand: { x: 26.8, z: -3.8, floor: 0, look: [13, 4.2, -14] } },
        { id: 'upper', index: 3, title: 'Upper level', text: 'The same frame eleven metres up, where the floors thin out and the structure is easiest to follow.', marker: [11, 13.4, -25], stand: { x: 19.3, z: -20.3, floor: 11.5, look: [9, 13.0, -26] } }
    ],
    tour: [
        { title: 'Arrival', text: 'A coordination model, at full size.', x: 29.8, z: -29.8, floor: 0, look: [14, 3.0, -20], dwell: 8 },
        { title: 'Steel frame', text: 'Seven levels of steel on a 47 by 42 m plan.', x: 26.3, z: -12.8, floor: 0, look: [10, 3.0, -20], dwell: 9 },
        { title: 'Service runs', text: 'Pipework and ducts threaded through the frame.', x: 26.8, z: -3.8, floor: 0, look: [13, 4.2, -14], dwell: 9 },
        { title: 'Upper level', text: 'The same frame eleven metres up.', x: 19.3, z: -20.3, floor: 11.5, look: [9, 13.0, -26], dwell: 9 },
        { title: 'End of tour', text: 'Back at the arrival point. Press B for the menu.', x: 29.8, z: -29.8, floor: 0, look: [14, 3.0, -20], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Steel Frame & Services',
        sceneAuthor: 'supplied by the project',
        sceneLicense: 'not for redistribution',
        sceneLicenseUrl: '',
        sceneSourceUrl: '',
        changes: 'Prepared from Clash Detection 2.fbx. Colours toned down, and given ground to stand on.'
    }
};

const design1: Site = {
    id: 'design1',
    kind: 'design',
    name: 'Hillside House',
    subtitle: 'Timber and glass on a sloping site',
    blurb: 'A house on its own sloping ground. Start inside, then step out to read the glazed elevation, the terrace railings and the ground-mounted solar array.',
    tag: 'House',
    poster: 'private/poster-design1.webp',
    model: { url: 'private/design1.glb' },
    collision: { type: 'mesh', url: 'private/design1.glb' },
    doors: { url: 'private/design1-doors.json' },
    stair: { from: [12.4, -2.4], to: [12.4, 2.4], rise: 2.0 },
    worldScale: 1,
    spawn: { x: 0, z: 2, floor: 0, look: [8, 1.5, 6] },
    walkRadius: 70,
    background: [0.46, 0.50, 0.56],
    pois: [
        { id: 'facade', index: 1, title: 'Glazed elevation', text: 'Curtain walling on the grid the model sets out, read from where someone would actually stand rather than off a drawing.', marker: [12, 4.0, 6], stand: { x: 20, z: 9, floor: 0, look: [9, 3.0, 8] } },
        { id: 'terrace', index: 2, title: 'Terrace and railings', text: 'Railings at 1100 mm. That is the dimension a drawing states and the body argues with, so stand at one.', marker: [2, 1.4, 14], stand: { x: 2, z: 17, floor: -2, look: [6, 1.6, 6] } },
        { id: 'solar', index: 3, title: 'Solar array', text: 'The ground-mounted array, set out clear of the building. Its spacing is what decides whether the rows shade each other.', marker: [-16, 2.2, -2], stand: { x: -11, z: -7, floor: 2, look: [-17, 2.2, -1] } }
    ],
    tour: [
        { title: 'Arrival', text: 'A design model, at full size.', x: 0, z: 2, floor: 0, look: [8, 1.5, 6], dwell: 8 },
        { title: 'Glazed elevation', text: 'Curtain walling on the grid the model sets out.', x: 20, z: 9, floor: 0, look: [9, 3.0, 8], dwell: 9 },
        { title: 'Terrace', text: 'Railings at 1100 mm.', x: 2, z: 17, floor: -2, look: [6, 1.6, 6], dwell: 9 },
        { title: 'Solar array', text: 'The ground-mounted array, clear of the building.', x: -11, z: -7, floor: 2, look: [-17, 2.2, -1], dwell: 9 },
        { title: 'End of tour', text: 'Back at the arrival point. Press B for the menu.', x: 0, z: 2, floor: 0, look: [8, 1.5, 6], dwell: 6 }
    ],
    credits: {
        sceneTitle: 'Hillside House',
        sceneAuthor: 'supplied by the project',
        sceneLicense: 'not for redistribution',
        sceneLicenseUrl: '',
        sceneSourceUrl: '',
        changes: 'Prepared from Design Review 1.fbx. Coloured by trade, and given ground to stand on.'
    }
};

/**
 * Whether to offer sites whose model lives in `public/private/`, which is never committed.
 *
 * True while developing, because the file is sitting there; true for a build that points at
 * a private asset host or that opts in explicitly. False for the public Pages build, so the
 * site list never offers something the server does not have.
 */
const PRIVATE_ASSETS =
    import.meta.env.DEV ||
    !!ASSET_BASE ||
    (import.meta.env.VITE_INCLUDE_PRIVATE as string | undefined) === '1';

export const SITES: Site[] = [excavator, komatsu, scaffold, ...(PRIVATE_ASSETS ? [officeBuilding, design1, clash1, clash2] : [])];
export const DEFAULT_SITE = excavator.id;

export const sitesOf = (mode: ModeId) => SITES.filter((s) => s.kind === mode);

/**
 * The experiences this build can actually show. The design track's model is fetched at
 * deploy time rather than committed, so a build without it has nothing to offer there and
 * the chooser must not present an empty side.
 */
export const availableModes = () => MODES.filter((m) => sitesOf(m.id).length > 0);
export const modeOf = (siteId: string): ModeId => SITES.find((s) => s.id === siteId)?.kind ?? 'capture';
export const defaultSiteOf = (mode: ModeId) => sitesOf(mode)[0];


/** Viewer experience settings (schema v2) for a site. Post effects stay off for a matching XR/desktop look. */
export const viewerSettings = (site: Site) => ({
    version: 2,
    tonemapping: 'linear',
    highPrecisionRendering: false,
    background: { color: site.background },
    postEffectSettings: {
        sharpness: { enabled: false, amount: 0 },
        bloom: { enabled: false, intensity: 0.1, blurLevel: 2 },
        grading: { enabled: false, brightness: 1, contrast: 1, saturation: 1, tint: [1, 1, 1] },
        vignette: { enabled: false, intensity: 0.5, inner: 0.3, outer: 0.75, curvature: 1 },
        fringing: { enabled: false, intensity: 0.5 }
    },
    animTracks: [] as unknown[],
    cameras: [
        {
            initial: {
                position: [site.spawn.x, site.spawn.floor + EYE_HEIGHT, site.spawn.z],
                target: site.spawn.look,
                fov: 70
            }
        }
    ],
    annotations: [] as unknown[],
    startMode: 'default'
});
