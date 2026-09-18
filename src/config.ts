// SiteXR scene configuration. World space is the viewer's (PlayCanvas, Y up, metres).
// Ground heights are resolved at runtime from the voxel collision data, so positions
// below only carry X/Z for standing points and full XYZ for look targets and markers.

export const BRAND = {
    name: 'SiteXR',
    tagline: 'Immersive Construction Review',
    site: 'Muddy Excavator Site',
    siteSubtitle: 'Earthworks capture · tracked excavator · access review'
};

export const ASSETS = {
    // Streamed, multi-LOD SOG built from the CC BY 4.0 source (see README → Asset pipeline).
    // VITE_SCENE_URL / VITE_COLLISION_URL are build-time overrides for testing other cuts.
    contentUrl: (import.meta.env.VITE_SCENE_URL as string | undefined) ?? 'scene/lod-meta.json',
    collisionUrl: (import.meta.env.VITE_COLLISION_URL as string | undefined) ?? 'scene/scene.voxel.json',
    controllerProfilesUrl: 'controllers',
    posterUrl: 'brand/site-poster.webp'
};

export const CREDITS = {
    sceneTitle: 'Muddy Excavator Site',
    sceneAuthor: 'dok11',
    sceneLicense: 'CC BY 4.0',
    sceneLicenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    sceneSourceUrl: 'https://superspl.at/scene/ded12920',
    changes: 'Converted to a multi-level-of-detail streaming format, spherical harmonics reduced to one band, and voxel collision data used for navigation.',
    tech: 'Rendered with the PlayCanvas engine and the open-source SuperSplat viewer runtime (MIT).'
};

/** Where a visitor stands on arrival: on the haul surface, facing the excavator ~10 m away. */
export const SPAWN = {
    x: 1.0,
    z: 10.5,
    look: [1.6, 2.4, -0.8] as [number, number, number]
};

/** Standing eye height used for the desktop (non-VR) walkthrough camera. */
export const EYE_HEIGHT = 1.65;

/** Visitors are kept within this radius of the site centre (the scan's edges are sky). */
export const WALK_RADIUS = 24;

export type Poi = {
    id: string;
    index: number;
    title: string;
    text: string;
    /** Marker position in world space (metres). */
    marker: [number, number, number];
    /** Standing point (x, z) and a look target for "Go there". */
    stand: { x: number; z: number; look: [number, number, number] };
};

export const POIS: Poi[] = [
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
        text: 'The haul route climbs a soft, uneven bank toward the stockpile. Review the gradient and drainage before plant is routed this way, and keep the pedestrian route separated from the machine swing radius.',
        marker: [11.5, 3.6, -14.0],
        stand: { x: 6.0, z: -9.0, look: [12.0, 3.4, -16.0] }
    }
];

export type TourStop = {
    title: string;
    text: string;
    x: number;
    z: number;
    look: [number, number, number];
    /** Seconds before the tour advances automatically. */
    dwell: number;
};

export const TOUR: TourStop[] = [
    {
        title: 'Site overview',
        text: 'Welcome to the excavation. The tracked excavator ahead is the focus of this review.',
        x: 1.0, z: 10.5, look: [1.6, 2.4, -0.8], dwell: 9
    },
    {
        title: 'Working side',
        text: 'From here the boom, stick and bucket are visible in full. Note the raised boom and clear swing radius.',
        x: -9.0, z: 4.0, look: [2.0, 2.5, -1.5], dwell: 10
    },
    {
        title: 'Running gear',
        text: 'The tracks sit in deep, saturated mud. This is the ground and track-condition point of interest.',
        x: -1.0, z: 6.5, look: [4.0, 1.2, 0.5], dwell: 10
    },
    {
        title: 'Rear and counterweight',
        text: 'The rear of the machine and the ground it has just cleared. Watch the change in surface level.',
        x: 8.5, z: -6.0, look: [2.5, 2.6, -2.0], dwell: 9
    },
    {
        title: 'Access route',
        text: 'The haul route rises over soft ground toward the bank. This is the site-access and terrain point of interest.',
        x: 6.0, z: -9.0, look: [12.0, 3.4, -16.0], dwell: 10
    },
    {
        title: 'End of tour',
        text: 'You are back at the arrival point. Explore freely, or open the menu with the B button.',
        x: 1.0, z: 10.5, look: [1.6, 2.4, -0.8], dwell: 6
    }
];

/** Viewer experience settings (schema v2). Post effects stay off for a matching XR/desktop look. */
export const VIEWER_SETTINGS = {
    version: 2,
    tonemapping: 'linear',
    highPrecisionRendering: false,
    background: { color: [0.86, 0.88, 0.9] },
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
                position: [SPAWN.x, 0.35 + EYE_HEIGHT, SPAWN.z],
                target: SPAWN.look,
                fov: 70
            }
        }
    ],
    annotations: [] as unknown[],
    startMode: 'default'
};
