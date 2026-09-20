// SiteXR site catalogue. World space is the viewer's (PlayCanvas, Y up, metres). Scenes
// captured in other units carry a `worldScale` that the app applies to the splat and the
// collision data, so every position below is already in metres.
//
// VITE_SCENE_URL / VITE_COLLISION_URL are build-time overrides for the first site, used
// by the smoke test to run against other cuts of the excavator scene.

export const BRAND = {
    name: 'SiteXR',
    tagline: 'Immersive Construction Review'
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
        tagline: 'Reality capture · Gaussian splats',
        blurb: 'Walk real sites recorded as 3D scans: earthworks, heavy plant and a floor under construction, at the scale and condition they were captured in.',
        audience: 'for site teams reviewing what is actually there'
    },
    {
        id: 'design',
        name: 'Design Models',
        tagline: 'BIM · Revit and IFC models',
        blurb: 'Walk a building information model at full size, on both floors and from the approach, the way it would be reviewed before anything is built.',
        audience: 'for design and BIM teams reviewing what is drawn'
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

export const TECH_CREDIT =
    'Rendered with the PlayCanvas engine and the open-source SuperSplat viewer runtime (MIT).';

const excavator: Site = {
    id: 'excavator',
    kind: 'capture',
    name: 'Muddy Excavator Site',
    subtitle: 'Earthworks · tracked excavator · access review',
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
        changes: 'Converted to a multi-level-of-detail streaming format, spherical harmonics reduced to one band, and voxel collision data used for navigation.'
    }
};

// Komatsu no Mori heavy-plant yard. Scene units are ~3.6 m: the two machines measure
// 2.0 and 2.2 units tall, which is a 7.4 m haul truck and an 8 m mining excavator.
const komatsu: Site = {
    id: 'komatsu',
    kind: 'capture',
    name: 'Heavy Plant Yard',
    subtitle: 'Mining haul truck · hydraulic excavator · display yard',
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
        changes: 'Rescaled to metres, the highest detail level dropped and spherical harmonics reduced to one band for the headset, and a navigation grid derived from the splat data.'
    }
};

// Slab-formwork floor. Scene units are ~0.75 m: the deck-to-soffit distance measures
// 5.7 units (a 4.3 m floor) and the shoring towers sit on a 3.1 unit (2.3 m) grid.
const scaffold: Site = {
    id: 'scaffold',
    kind: 'capture',
    name: 'Formwork & Scaffold Floor',
    subtitle: 'Interior · slab formwork · shoring towers',
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
        changes: 'Rescaled to metres, the highest detail level dropped and spherical harmonics reduced to one band for the headset, and a navigation grid derived from the splat data.'
    }
};


// The project's Revit model, exported to IFC and read with IfcOpenShell. Two storeys plus
// roof, with the site pad kept so there is ground outside the walls to stand on.
const officeBuilding: Site = {
    id: 'office',
    kind: 'design',
    name: 'Office Building',
    subtitle: 'Revit model \u00b7 two storeys \u00b7 787 elements',
    blurb: 'Your Revit model at full size, with doors that open. Arrive in the double-height atrium beside the stair, go up to the second floor, and step outside to read the curtain walling from the approach.',
    tag: 'Revit model',
    poster: 'private/poster-office.webp',
    model: { url: 'private/office-building.glb' },
    collision: { type: 'mesh', url: 'private/office-building.glb' },
    doors: { url: 'private/office-doors.json' },
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
        sceneTitle: 'Office Building (Revit model)',
        sceneAuthor: 'supplied by the project',
        sceneLicense: 'not for redistribution',
        sceneLicenseUrl: '',
        sceneSourceUrl: '',
        changes: 'Exported from Revit to IFC4, triangulated with IfcOpenShell, node transforms baked in, meshes merged by material and materials made double-sided so walls read from inside. Fill lights added because a model carries no baked lighting of its own.'
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

export const SITES: Site[] = [excavator, komatsu, scaffold, ...(PRIVATE_ASSETS ? [officeBuilding] : [])];
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
