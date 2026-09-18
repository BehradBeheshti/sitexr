// SiteXR — Immersive Construction Review. Bootstraps the splat viewer for the chosen site,
// decides between immersive VR and the desktop walkthrough, and wires the SiteXR layer.
import { Vec3, platform } from 'playcanvas';
import type { Entity } from 'playcanvas';

import { ASSETS, DEFAULT_SITE, EYE_HEIGHT, SITES, viewerSettings } from './config';
import type { Poi, Site, TourStop } from './config';
import { BUDGETS, settings } from './settings';
import { Screens } from './ui/screens';
import { createViewer } from './vendor/supersplat-viewer/index';
import type { Collision } from './vendor/supersplat-viewer/collision';
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
};

const main = async () => {
    const vrSupported = await detectVr();
    let session: Session | null = null;
    let starting: Promise<Session> | null = null;

    let stored: string | null = null;
    try {
        stored = localStorage.getItem(SITE_KEY);
    } catch {
        stored = null;
    }
    let selected = SITES.find((s) => s.id === stored) ?? SITES.find((s) => s.id === DEFAULT_SITE) ?? SITES[0];

    const screens = new Screens({
        sites: SITES,
        selected: selected.id,
        onSelectSite: (id) => selectSite(id),
        onEnter: () => enter(),
        onTour: () => sessionTour()?.toggle(),
        onTourNext: () => sessionTour()?.next(),
        onTourPrev: () => sessionTour()?.prev(),
        onTourStop: () => sessionTour()?.stop(),
        onReset: () => sessionApi()?.resetDesktop(),
        onPoiGo: (poi) => sessionApi()?.desktopGoTo(poi.stand.x, poi.stand.z, poi.stand.look),
        onChangeSite: () => screens.showWelcome()
    });

    // per-session API reachable from the screens callbacks
    type Api = { tour: Tour; resetDesktop: () => void; desktopGoTo: (x: number, z: number, look: [number, number, number]) => void };
    let api: Api | null = null;
    const sessionTour = () => api?.tour ?? null;
    const sessionApi = () => api;

    const selectSite = async (id: string) => {
        const site = SITES.find((s) => s.id === id);
        if (!site || site.id === selected.id) return;
        selected = site;
        try {
            localStorage.setItem(SITE_KEY, id);
        } catch {
            // ignore
        }
        screens.setSelected(id);
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
            site.collision.type === 'grid' ? GridCollision.load(site.collision.url) : undefined;
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
            contentUrl: site.contentUrl,
            // voxel collision is loaded by the viewer from a url; a navigation grid is
            // ours, and mesh collision is read off the model once it is in the scene
            collisionUrl: site.collision.type === 'voxel' ? site.collision.url : undefined,
            collision: collisionPromise,
            modelUrl: site.model?.url,
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
        const rig = new XrRig(app, camera, collision, layer, { spawn: site.spawn, walkRadius: site.walkRadius });

        const tour = new Tour(site.tour, { travel: async () => {}, caption: () => {}, end: () => {} }, () => {
            screens.setTourActive(tour.active);
        });

        const markers = new Markers(rig, site.pois, {
            onDesktopSelect: (poi: Poi) => screens.showPoi(poi),
            onGoThere: (poi: Poi) => {
                const s = rig.findStand(poi.stand.x, poi.stand.z);
                rig.blinkTo(s.x, s.y, s.z, poi.stand.look);
            }
        });

        const tutorial = new Tutorial(rig, () => {
            if (rig.active) toastVr('Tutorial complete. Press B for the menu.');
        });

        const menu = new VrMenu(rig, {
            tourActive: () => tour.active,
            toggleTour: () => tour.toggle(),
            replayTutorial: () => tutorial.start(),
            switchSite: () => {
                rig.exitVr();
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
                const s = rig.findStand(stop.x, stop.z);
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
            app.scene.gsplat.splatBudget = budgetFor() * 1e6;
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
            app.scene.gsplat.splatBudget = budgetFor() * 1e6;
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
        };
        if (state.loaded) onLoaded();
        else events.once('loaded:changed', onLoaded);

        api = { tour, resetDesktop, desktopGoTo };

        // Non-enumerable QA handle for the headless smoke test (not a user-facing control).
        Object.defineProperty(window, '__sitexr', {
            value: { viewer, rig, menu, tutorial, markers, tour, settings, pois: site.pois, site },
            enumerable: false,
            configurable: true
        });

        return {
            site,
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

    await startSelected();
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
