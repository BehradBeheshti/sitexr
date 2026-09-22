// SiteXR — Immersive Construction Review. Bootstraps the splat viewer for the chosen site,
// decides between immersive VR and the desktop walkthrough, and wires the SiteXR layer.
import { Vec3, platform } from 'playcanvas';
import type { AppBase, Entity, GSplatComponent } from 'playcanvas';

import { ASSETS, DEFAULT_SITE, EYE_HEIGHT, MODES, SITES, assetUrl, defaultSiteOf, modeOf, viewerSettings } from './config';
import type { ModeId, Poi, Site, TourStop } from './config';
import { BUDGETS, FOVEATION, settings } from './settings';
import { Screens } from './ui/screens';
import { createViewer } from './vendor/supersplat-viewer/index';
import type { Collision } from './vendor/supersplat-viewer/collision';
import { RELAY_ENABLED, ShareHost, ShareViewer } from './share/session';
import type { ShareState, ShareStatus } from './share/session';
import { DoorSet } from './xr/doors';
import { GridCollision } from './xr/grid-collision';
import { collisionFromModel } from './xr/model-collision';
import { Markers } from './xr/markers';
import { VrMenu } from './xr/menu';
import { getUiLayer } from './xr/panel';
import { Panel, THEME, drawPanelBackground, wrapText } from './xr/panel';
import { XrRig } from './xr/rig';
import { Tour } from './xr/tour';
import type { TourPresenter } from './xr/tour';
import { Tutorial } from './xr/tutorial';
import { FpsReadout } from './xr/fps-readout';
import { PerformanceGovernor } from './xr/performance';

const detectVr = async (): Promise<boolean> => {
    try {
        return !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'));
    } catch {
        return false;
    }
};

const isHeadset = () => /OculusBrowser|Quest|Pico|VR/i.test(navigator.userAgent) || platform.mobile;

const budgetFor = () => {
    const tier = BUDGETS[settings.get().quality];
    return isHeadset() ? tier.headset : tier.desktop;
};

const SITE_KEY = 'sitexr.site';

type Session = {
    site: Site;
    enterVr: () => Promise<void>;
    enterDesktop: () => void;
    dispose: () => void;
    /** Take over the camera from a shared viewpoint (watch mode). */
    follow: (state: ShareState) => void;
    /** Describe this session's viewpoint for a watcher, or null when it cannot yet. */
    sampleShare: () => ShareState | null;
};

const main = async () => {
    const vrSupported = await detectVr();
    // set by the build, not discovered at run time; see RELAY_ENABLED
    const relayOk = RELAY_ENABLED;

    /**
     * One room for the whole visit.
     *
     * It outlives every site: loading a new one tears the viewer down, and a presentation
     * should not lose its code and everyone watching each time the presenter changes scene.
     * Between sites there is nothing to describe, so it sends nothing and the watching screen
     * simply holds its last frame rather than going blank.
     */
    const share = new ShareHost(() => session?.sampleShare() ?? null);
    let menuRepaint: (() => void) | null = null;
    share.onStatus = () => menuRepaint?.();
    let session: Session | null = null;
    let starting: Promise<Session> | null = null;

    // A shareable link can name the experience or the site, so each audience can be handed
    // its own url: ?mode=design for the models, ?mode=capture for the scans.
    const params = new URLSearchParams(location.search);
    const urlSite = SITES.find((s) => s.id === params.get('site'));
    const urlMode = MODES.find((m) => m.id === params.get('mode'))?.id ?? null;

    let stored: string | null = null;
    try {
        stored = localStorage.getItem(SITE_KEY);
    } catch {
        stored = null;
    }
    let selected =
        urlSite ??
        (urlMode ? defaultSiteOf(urlMode) : null) ??
        SITES.find((s) => s.id === stored) ??
        SITES.find((s) => s.id === DEFAULT_SITE) ??
        SITES[0];
    // The chooser is shown unless the link (or a previous visit) already picked a side.
    let mode: ModeId | null = urlSite ? urlSite.kind : (urlMode ?? null);

    const syncUrl = () => {
        const q = new URLSearchParams();
        if (mode) q.set('mode', mode);
        q.set('site', selected.id);
        history.replaceState(null, '', `${location.pathname}?${q.toString()}`);
    };

    const screens = new Screens({
        sites: SITES,
        selected: selected.id,
        mode,
        onSelectMode: (id) => selectMode(id),
        onSelectSite: (id) => selectSite(id),
        onEnter: () => enter(),
        onTour: () => sessionTour()?.toggle(),
        onTourNext: () => sessionTour()?.next(),
        onTourPrev: () => sessionTour()?.prev(),
        onTourStop: () => sessionTour()?.stop(),
        onReset: () => sessionApi()?.resetDesktop(),
        onPoiGo: (poi) => sessionApi()?.desktopGoTo(poi.stand.x, poi.stand.z, poi.stand.look),
        onChangeSite: () => {
            screens.showAllSites();
            screens.showWelcome();
        }
    });

    // per-session API reachable from the screens callbacks
    type Api = { tour: Tour; resetDesktop: () => void; desktopGoTo: (x: number, z: number, look: [number, number, number]) => void };
    let api: Api | null = null;
    const sessionTour = () => api?.tour ?? null;
    const sessionApi = () => api;

    const selectMode = async (id: ModeId) => {
        mode = id;
        screens.setMode(id);
        const first = defaultSiteOf(id);
        if (first && first.id !== selected.id) {
            await selectSite(first.id);
        } else {
            screens.setSelected(selected.id);
            syncUrl();
        }
    };

    const selectSite = async (id: string) => {
        const site = SITES.find((s) => s.id === id);
        if (!site || site.id === selected.id) return;
        selected = site;
        try {
            localStorage.setItem(SITE_KEY, id);
        } catch {
            // ignore
        }
        mode = modeOf(id);
        screens.setSelected(id);
        syncUrl();
        await startSelected();
    };

    const startSelected = async () => {
        if (starting) await starting.catch((): null => null);
        session?.dispose();
        session = null;
        api = null;
        screens.setLoading(selected);
        starting = startSite(selected);
        try {
            session = await starting;
        } catch (err) {
            console.error('SiteXR failed to start the site', err);
            screens.setLoadError(errorText(err));
        } finally {
            starting = null;
        }
    };

    /**
     * Set when a switch was started from inside the headset. Loading a site tears the viewer
     * down and the XR session with it, so the visitor has to come back in; this is what makes
     * that one step rather than four.
     */
    let resumeVr = false;

    /**
     * Ask the browser to put the visitor back in VR after an in-headset switch.
     *
     * `offerSession` exists for exactly this: the headset resumes when the wearer is ready,
     * with no DOM click, which they cannot give while wearing it. Where it is missing the
     * welcome screen is already showing its Enter button, so the fallback is one press.
     */
    const offerVrAgain = async () => {
        if (!resumeVr || !vrSupported) return;
        resumeVr = false;
        const xr = navigator.xr as unknown as
            { offerSession?: (mode: string, init?: unknown) => Promise<unknown> } | undefined;
        if (!xr?.offerSession) return;
        try {
            await xr.offerSession('immersive-vr', { optionalFeatures: ['local-floor'] });
        } catch {
            // the browser declined to offer; the Enter button is right there
        }
    };

    /** Switch from inside the headset: remember to come back, then load the new site. */
    const onSwitchSite = async (id: string) => {
        resumeVr = true;
        await selectSite(id);
    };

    /** Called once a newly loaded site is drawable. */
    const onSiteReady = async () => {
        if (watchCode) {
            watching = false;
            const last = watcher?.last;
            if (last && last.s === selected.id && session) {
                watching = true;
                session.enterDesktop();
                screens.setWatching(watchCode);
                session.follow(last);
            }
            return;
        }
        await offerVrAgain();
    };

    // ---- watch mode ----------------------------------------------------------------------
    // `?watch=CODE` turns this tab into a second screen: it loads whatever site the presenter
    // is in, hands the camera to them, and takes no input of its own. Nothing to install and
    // nothing to start, which is the whole point of putting it in the site.
    const watchCode = (params.get('watch') ?? '').trim().toUpperCase();
    let watcher: ShareViewer | null = null;

    const startWatching = (code: string) => {
        watcher = new ShareViewer(code);
        // a support handle: "is anything arriving?" is the first question when a projected
        // view stays blank, and it is not answerable from the outside
        const diag = { code, received: 0, lastAt: 0, following: false, paused: false };
        Object.defineProperty(window, '__sitexrWatch', { value: diag, configurable: true });

        // The watching screen judges for itself whether anything is still arriving, rather
        // than waiting to be told. A headset put down, a tab closed, a dropped connection and
        // a presenter who simply stopped all look the same from here, and in every one of them
        // the scene stays on screen exactly as it was. A projected view should hold its last
        // frame and say why, not go blank.
        window.setInterval(() => {
            if (!diag.lastAt) return;
            const quiet = Date.now() - diag.lastAt > 3000;
            if (quiet === diag.paused) return;
            diag.paused = quiet;
            screens.setWatchStatus({ kind: quiet ? 'paused' : 'watching', code });
        }, 1000);
        watcher.onStatus = (st) => screens.setWatchStatus(st);
        watcher.onState = (shared) => {
            diag.received++;
            diag.lastAt = Date.now();
            // A late-joining watcher may be on the wrong site, so follow the presenter there.
            // Guarded, because these arrive fifteen times a second and an unguarded switch
            // would cancel its own load over and over.
            if (shared.s !== selected.id) {
                if (!switchingTo) {
                    switchingTo = shared.s;
                    void selectSite(shared.s).finally(() => {
                        switchingTo = null;
                    });
                }
                return;
            }
            if (!session) return;
            if (!watching) {
                watching = true;
                session.enterDesktop();
                screens.setWatching(code);
            }
            diag.following = true;
            session.follow(shared);
        };
        watcher.start();
    };
    let watching = false;
    let switchingTo: string | null = null;

    const enter = async () => {
        if (!session) return;
        if (vrSupported) {
            screens.setEnterBusy(true);
            try {
                await session.enterVr();
                screens.hideWelcome();
            } catch (err) {
                console.error('SiteXR: could not start the VR session', err);
                screens.setEnterBusy(false);
                screens.setReady(true);
                screens.showWelcome('The headset declined to start VR. Check that the Meta Quest Browser has permission and try again.');
            }
            return;
        }
        session.enterDesktop();
    };

    // ---- one site ----------------------------------------------------------------------------------
    const startSite = async (site: Site): Promise<Session> => {
        const container = document.getElementById('viewer');
        container.innerHTML = '';
        screens.setProgress(2, 'Connecting to site data…');

        const collisionPromise: Promise<Collision | null> | undefined =
            site.collision.type === 'grid' ? GridCollision.load(assetUrl(site.collision.url)) : undefined;
        let collision: Collision | null = null;
        // built once from the instantiated model, and shared with the viewer
        let meshCollision: Collision | null = null;
        const buildMeshCollision = (model: unknown): Collision | null => {
            meshCollision = meshCollision ?? collisionFromModel(model as Entity);
            return meshCollision;
        };

        const viewer = await createViewer({
            container,
            settings: viewerSettings(site),
            contentUrl: site.contentUrl ? assetUrl(site.contentUrl) : undefined,
            // voxel collision is loaded by the viewer from a url; a navigation grid is
            // ours, and mesh collision is read off the model once it is in the scene
            collisionUrl: site.collision.type === 'voxel' ? assetUrl(site.collision.url) : undefined,
            collision: collisionPromise,
            modelUrl: site.model ? assetUrl(site.model.url) : undefined,
            // a model with no splat behind it has no baked lighting of its own
            interiorLighting: !!site.model && !site.contentUrl,
            collisionFromModel: site.collision.type === 'mesh' ? buildMeshCollision : undefined,
            modelTransform: site.model
                ? { scale: site.model.scale, offset: site.model.offset, yaw: site.model.yaw }
                : undefined,
            worldScale: site.worldScale,
            ui: false,
            nofx: true,
            // WebGL everywhere: WebXR requires it, and it avoids partial WebGPU implementations
            renderer: 'webgl',
            budget: budgetFor(),
            controllerProfilesUrl: ASSETS.controllerProfilesUrl,
            floorHeightAt: (x, y, z) => (collision ? (collision.queryRay(x, y, z, 0, -1, 0, 60)?.y ?? null) : null)
        });

        const { app, state, events, internals } = viewer;
        const { camera } = internals;
        let disposed = false;

        events.on('progress:changed', (p: number) => {
            if (!state.loaded) screens.setProgress(5 + p * 0.9, p < 100 ? 'Streaming site capture…' : 'Building the site…');
        });

        collision = await internals.collision;
        if (site.collision.type === 'mesh') {
            const model = await internals.model;
            collision = model ? buildMeshCollision(model) : null;
        }
        if (!collision) console.warn('SiteXR: collision data missing, terrain following disabled');

        const layer = getUiLayer(app, camera);

        // The splat component, once it exists; not awaited, so a large scene does not hold
        // up the rest of the setup.
        let gsplatComponent: GSplatComponent | null = null;
        internals.gsplat
            .then((entity) => {
                gsplatComponent = (entity?.gsplat as GSplatComponent | undefined) ?? null;
            })
            .catch(() => {
                gsplatComponent = null;
            });

        // Holds the headset's frame rate by trading splat detail for smoothness.
        const governor = new PerformanceGovernor(
            app,
            budgetFor,
            () => FOVEATION[settings.get().quality],
            () => gsplatComponent
        );

        // ?nogov pins the budget to the chosen tier, for judging quality without the
        // governor trimming it; a diagnostic, not something a visitor should need
        if (params.has('nogov')) governor.enabled = false;

        // ?fps shows a frame-rate readout in the headset; it is a diagnostic, not a feature
        if (params.has('fps')) {
            const fpsReadout = new FpsReadout(app, camera, layer, () => governor.state);
            settings.events.on('change:quality', () => fpsReadout.reset());
        }
        const rig = new XrRig(app, camera, collision, layer, { spawn: site.spawn, walkRadius: site.walkRadius });

        // Doors, when the site has them. They register as interactables, so the controller
        // ray, cursor and haptics all treat a door leaf like any other thing worth pointing
        // at, and the rig asks them whether a doorway is currently blocked.
        let doors: DoorSet | null = null;
        if (site.doors) {
            try {
                doors = await DoorSet.load(assetUrl(site.doors.url), app, app.root, layer);
                for (const leaf of doors.leaves) {
                    if (leaf.openable) rig.interactables.add(leaf);
                }
                rig.doors = doors;
                app.on('update', (dt: number) => doors?.update(dt));
                attachDoorPicking(app, camera, rig, doors);
            } catch (err) {
                console.warn('doors unavailable:', err);
            }
        }

        const tour = new Tour(site.tour, { travel: async () => {}, caption: () => {}, end: () => {} }, () => {
            screens.setTourActive(tour.active);
        });

        const markers = new Markers(rig, site.pois, {
            onDesktopSelect: (poi: Poi) => screens.showPoi(poi),
            onGoThere: (poi: Poi) => {
                const s = rig.findStand(poi.stand.x, poi.stand.z, poi.stand.floor ?? site.spawn.floor);
                rig.blinkTo(s.x, s.y, s.z, poi.stand.look);
            }
        });

        const tutorial = new Tutorial(rig, () => {
            if (rig.active) toastVr('Tutorial complete. Press B for the menu.');
        }, { doors: !!doors });

        if (doors) {
            const hint = document.getElementById('hud-hint');
            if (hint) hint.textContent =
                'Drag to look \u00b7 click the ground to walk there \u00b7 W A S D to move \u00b7 click a door to open it';
        }

        // ---- describing this viewpoint ---------------------------------------------------
        // Fifteen samples a second of where the head is and what has been touched. The model
        // is already on the watcher's machine, so this is all that has to travel.
        //
        // The room itself is owned above, not here: a site switch disposes this session, and
        // a presentation should not lose its code and its audience every time the presenter
        // changes scene.
        const sampleShare = (): ShareState | null => {
            const p = rig.camera.getPosition();
            const f = rig.camera.forward;
            const state: ShareState = {
                s: site.id,
                p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
                f: [+f.x.toFixed(4), +f.y.toFixed(4), +f.z.toFixed(4)]
            };
            // In a session the headset owns the projection, so read the real angle off it;
            // outside one the camera's own setting is the truth.
            const view = app.xr?.active ? app.xr.views?.list?.[0] : null;
            const proj = (view?.projMat as unknown as { data?: Float32Array } | undefined)?.data;
            state.fov =
                proj && proj[0]
                    ? +((2 * Math.atan(1 / Math.abs(proj[0])) * 180) / Math.PI).toFixed(1)
                    : +(camera.camera?.fov ?? 70).toFixed(1);
            if (doors) state.d = doors.leaves.map((l) => +l.open.toFixed(2));
            state.c = markers.cardOpen ? (markers.openPoiId ?? null) : null;
            state.t = tour.active ? tour.index : null;
            return state;
        };

        app.on('update', () => share.tick());

        // the code panel shows a live count, so it repaints when someone joins
        menuRepaint = () => {
            if (menu.isOpen && menu.page === 'share') menu.render();
        };

        const menu = new VrMenu(rig, {
            tourActive: () => tour.active,
            toggleTour: () => tour.toggle(),
            replayTutorial: () => tutorial.start(),
            share: {
                available: relayOk,
                active: () => share.active,
                code: () => share.code,
                viewers: () => share.viewers,
                watchUrl: (code: string) =>
                    `${location.origin}${location.pathname}?watch=${code}`,
                start: () => {
                    void share.start().then(() => menu.render()).catch(() => menu.render());
                },
                stop: () => share.stop()
            },
            switchSite: (id: string) => {
                void (async () => {
                    // Fade out first, but never wait on it: the fade resolves from the render
                    // loop, and the visitor must not be stranded in a menu if that stops.
                    await Promise.race([
                        rig.fade(1, 4),
                        new Promise((done) => setTimeout(done, 400))
                    ]);
                    rig.exitVr();
                    await onSwitchSite(id);
                })();
            },
            site
        });

        // in-VR tour caption panel
        const captionPanel = new Panel(app, layer, { name: 'tour-caption', width: 1.0, height: 0.3, pixels: 1024, overlay: true });
        const drawCaption = (stop: TourStop, i: number, n: number) => {
            captionPanel.draw((ctx, w, h) => {
                drawPanelBackground(ctx, w, h);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillStyle = THEME.accent;
                ctx.font = `700 22px ${THEME.font}`;
                ctx.fillText(`GUIDED TOUR · STOP ${i + 1} OF ${n}`, 40, 52);
                ctx.fillStyle = THEME.text;
                ctx.font = `700 40px ${THEME.font}`;
                ctx.fillText(stop.title, 40, 104);
                ctx.fillStyle = THEME.muted;
                ctx.font = `400 27px ${THEME.font}`;
                wrapText(ctx, stop.text, 40, 150, w - 80, 36);
                ctx.fillStyle = THEME.muted;
                ctx.font = `400 21px ${THEME.font}`;
                ctx.textAlign = 'right';
                ctx.fillText('A: next stop · X: end tour', w - 40, h - 26);
            });
        };
        let captionTimer = 0;

        const vrPresenter: TourPresenter = {
            travel: async (stop) => {
                const s = rig.findStand(stop.x, stop.z, stop.floor ?? site.spawn.floor);
                await rig.blinkTo(s.x, s.y, s.z, stop.look);
            },
            caption: (stop, i, n) => {
                drawCaption(stop, i, n);
                captionPanel.placeInFront(camera, 1.6, -0.42);
                captionPanel.show();
                captionTimer = 6;
            },
            end: () => captionPanel.hide()
        };

        const desktopGoTo = (x: number, z: number, look: [number, number, number]) => {
            const cm = internals.cameraManager();
            if (!cm) return;
            const s = rig.findStand(x, z);
            state.cameraMode = 'walk';
            cm.camera.look(new Vec3(s.x, s.y + EYE_HEIGHT, s.z), new Vec3(look[0], look[1], look[2]));
            cm.snap();
        };
        const resetDesktop = () => {
            if (rig.active) return;
            desktopGoTo(site.spawn.x, site.spawn.z, site.spawn.look);
            screens.toast('Position reset');
        };

        const desktopPresenter: TourPresenter = {
            travel: async (stop) => {
                await screens.fadeOut();
                desktopGoTo(stop.x, stop.z, stop.look);
                await new Promise((r) => setTimeout(r, 120));
                screens.fadeIn();
            },
            caption: (stop, i, n) => screens.showCaption(stop, i, n),
            end: () => screens.hideCaption()
        };
        tour.setPresenter(desktopPresenter);

        const noticePanel = new Panel(app, layer, { name: 'notice', width: 0.7, height: 0.14, pixels: 768, overlay: true });
        let noticeTimer = 0;
        const toastVr = (text: string) => {
            noticePanel.draw((ctx, w, h) => {
                drawPanelBackground(ctx, w, h);
                ctx.fillStyle = THEME.text;
                ctx.font = `600 34px ${THEME.font}`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, w / 2, h / 2);
            });
            noticePanel.placeInFront(camera, 1.4, -0.3);
            noticePanel.show();
            noticeTimer = 3;
        };

        app.on('update', (dt: number) => {
            tour.update(dt);
            if (captionTimer > 0) {
                captionTimer -= dt;
                if (captionTimer <= 0) captionPanel.hide();
            }
            if (noticeTimer > 0) {
                noticeTimer -= dt;
                if (noticeTimer <= 0) noticePanel.hide();
            }
        });

        // ---- VR session lifecycle
        rig.events.on('ready', () => {
            markers.setVisible(true);
            if (!settings.get().tutorialDone) tutorial.start();
        });
        rig.events.on('button', (hand: string, name: string) => {
            if (menu.isOpen && name === 'secondary') {
                menu.close();
                return;
            }
            if (name === 'secondary' && hand === 'right') {
                if (markers.cardOpen) markers.closeCard();
                else menu.toggle();
            } else if (name === 'secondary' && hand === 'left') {
                if (!menu.isOpen) rig.resetToSpawn();
            } else if (name === 'primary' && hand === 'left') {
                if (!menu.isOpen) tour.toggle();
            } else if (name === 'primary' && hand === 'right') {
                if (tour.active && !rig.pointingAtUi && !menu.isOpen) tour.next();
            }
        });
        rig.events.on('session:start', () => {
            tour.setPresenter(vrPresenter);
            tour.stop();
            screens.hideHud();
            // the governor sets the budget from here on
        });
        rig.events.on('session:end', () => {
            tour.stop();
            menu.close();
            markers.closeCard();
            if (tutorial.active) tutorial.finish();
            captionPanel.hide();
            noticePanel.hide();
            tour.setPresenter(desktopPresenter);
            if (disposed) return;
            screens.setEnterBusy(false);
            screens.setReady(true);
            screens.showWelcome('Session ended. Enter again to return to the site, or choose another site.');
            app.renderNextFrame = true;
        });

        const onQuality = () => {
            // in a session the governor owns the budget; outside one it is set directly
            if (app.xr.active) governor.retarget();
            else app.scene.gsplat.splatBudget = budgetFor() * 1e6;
            app.renderNextFrame = true;
        };
        settings.events.on('change:quality', onQuality);

        let desktopMode = false;
        const onKey = (e: KeyboardEvent) => {
            if (rig.active || !desktopMode || screens.modalOpen || !screens.welcomeHidden) return;
            if (e.target instanceof HTMLInputElement) return;
            switch (e.key.toLowerCase()) {
                case 'r':
                    resetDesktop();
                    break;
                case 't':
                    tour.toggle();
                    break;
                case 'm':
                    screens.openModal('modal-settings');
                    break;
                case 'n':
                    if (tour.active) tour.next();
                    break;
            }
        };
        window.addEventListener('keydown', onKey);

        const onLoaded = () => {
            if (disposed) return;
            state.cameraMode = 'walk';
            markers.setVisible(true);
            screens.setReady(vrSupported);
            app.renderNextFrame = true;
            void onSiteReady();
        };
        if (state.loaded) onLoaded();
        else events.once('loaded:changed', onLoaded);

        api = { tour, resetDesktop, desktopGoTo };

        // Non-enumerable QA handle for the headless smoke test (not a user-facing control).
        Object.defineProperty(window, '__sitexr', {
            value: { viewer, rig, menu, tutorial, markers, tour, settings, doors, share, pois: site.pois, site },
            enumerable: false,
            configurable: true
        });

        // The watcher's camera chases the shared pose rather than snapping to it, so a
        // dropped packet reads as a slight lag instead of a jolt.
        const followTarget = { p: new Vec3(), f: new Vec3(0, 0, -1), have: false };
        const followNow = { p: new Vec3(), f: new Vec3(0, 0, -1), started: false };
        const lookAt = new Vec3();
        let following = false;

        app.on('update', (dt: number) => {
            if (!following || !followTarget.have) return;
            const k = followNow.started ? 1 - Math.exp(-dt * 12) : 1;
            followNow.started = true;
            followNow.p.lerp(followNow.p, followTarget.p, k);
            followNow.f.lerp(followNow.f, followTarget.f, k);
            if (followNow.f.lengthSq() < 1e-6) followNow.f.set(0, 0, -1);
            followNow.f.normalize();
            lookAt.copy(followNow.f).mulScalar(12).add(followNow.p);
            const cm = viewer.internals.cameraManager();
            cm.camera.look(followNow.p, lookAt);
            cm.snap();
            app.renderNextFrame = true;
        });

        return {
            site,
            sampleShare,
            follow: (shared: ShareState) => {
                following = true;
                state.inputEnabled = false;
                followTarget.p.set(shared.p[0], shared.p[1], shared.p[2]);
                followTarget.f.set(shared.f[0], shared.f[1], shared.f[2]);
                followTarget.have = true;
                if (shared.fov && camera.camera) {
                    camera.camera.horizontalFov = true;
                    camera.camera.fov = shared.fov;
                }
                if (shared.d && doors) {
                    shared.d.forEach((v, i) => doors?.leaves[i]?.set(v));
                }
            },
            enterVr: () => rig.enterVr(),
            enterDesktop: () => {
                desktopMode = true;
                screens.hideWelcome();
                screens.showHud();
                state.cameraMode = 'walk';
                state.inputEnabled = true;
                markers.setVisible(true);
                app.renderNextFrame = true;
            },
            dispose: () => {
                disposed = true;
                window.removeEventListener('keydown', onKey);
                settings.events.off('change:quality', onQuality);
                rig.dispose();
                menu.dispose();
                tour.stop();
                screens.hideHud();
                viewer.destroy();
            }
        };
    };

    screens.setWatchOffered(relayOk && !watchCode);
    syncUrl();
    await startSelected();
    if (watchCode) startWatching(watchCode);
};

const errorText = (err: unknown) => {
    const noGraphics = /webgl|graphics device|context/i.test(String((err as Error)?.message ?? err));
    return noGraphics ? 'no-graphics' : 'generic';
};

main().catch((err) => {
    console.error('SiteXR failed to start', err);
    const label = document.getElementById('progress-label');
    if (label) label.textContent = 'The site could not be loaded. Please refresh to try again.';
});

/**
 * Desktop: click a door to swing it. The viewer's own click-to-walk fires on the same
 * canvas, so a click that lands on a door has to be swallowed before it becomes a walk.
 */
function attachDoorPicking(app: AppBase, camera: Entity, rig: XrRig, doors: DoorSet) {
    const canvas = app.graphicsDevice.canvas;
    const near = new Vec3();
    const far = new Vec3();
    const dir = new Vec3();
    let down: { x: number; y: number } | null = null;

    const pick = (clientX: number, clientY: number) => {
        const cam = camera.camera;
        if (!cam) return null;
        const rect = canvas.getBoundingClientRect();
        const sx = clientX - rect.left;
        const sy = clientY - rect.top;
        cam.screenToWorld(sx, sy, cam.nearClip + 0.01, near);
        cam.screenToWorld(sx, sy, cam.nearClip + 20, far);
        dir.sub2(far, near).normalize();
        let best: { target: DoorSet['leaves'][number]; dist: number } | null = null;
        for (const leaf of doors.leaves) {
            const hit = { target: leaf, u: 0, v: 0, dist: 0, point: new Vec3() };
            if (leaf.intersect(near, dir, hit) && (!best || hit.dist < best.dist)) {
                best = { target: leaf, dist: hit.dist };
            }
        }
        return best && best.dist < 14 ? best.target : null;
    };

    canvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (rig.active) return;
        down = { x: e.clientX, y: e.clientY };
        if (pick(e.clientX, e.clientY)) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, { capture: true });

    canvas.addEventListener('pointerup', (e: PointerEvent) => {
        if (rig.active || !down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6;
        down = null;
        if (moved) return;
        const leaf = pick(e.clientX, e.clientY);
        if (leaf) {
            e.stopPropagation();
            e.preventDefault();
            leaf.toggle();
        }
    }, { capture: true });

    canvas.addEventListener('pointermove', (e: PointerEvent) => {
        if (rig.active) return;
        const leaf = pick(e.clientX, e.clientY);
        for (const l of doors.leaves) l.onHover(l === leaf ? ({} as never) : null);
        if (leaf) canvas.style.cursor = 'pointer';
    });
}
