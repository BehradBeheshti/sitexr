// SiteXR — Immersive Construction Review. Bootstraps the splat viewer, decides between
// immersive VR and the desktop walkthrough, and wires the SiteXR layer on top.
import { Vec3, platform } from 'playcanvas';

import { ASSETS, EYE_HEIGHT, POIS, SPAWN, TOUR, VIEWER_SETTINGS } from './config';
import type { Poi, TourStop } from './config';
import { BUDGETS, settings } from './settings';
import { Screens } from './ui/screens';
import { createViewer } from './vendor/supersplat-viewer/index';
import type { Collision } from './vendor/supersplat-viewer/collision';
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

const main = async () => {
    const vrSupported = await detectVr();
    let collision: Collision | null = null;

    const screens = new Screens({
        onEnter: () => enter(),
        onTour: () => tour.toggle(),
        onTourNext: () => tour.next(),
        onTourPrev: () => tour.prev(),
        onTourStop: () => tour.stop(),
        onReset: () => resetDesktop(),
        onPoiGo: (poi) => desktopGoTo(poi.stand.x, poi.stand.z, poi.stand.look)
    });
    screens.setProgress(2, 'Connecting to site data…');

    const viewer = await createViewer({
        container: document.getElementById('viewer'),
        settings: VIEWER_SETTINGS,
        contentUrl: ASSETS.contentUrl,
        collisionUrl: ASSETS.collisionUrl,
        posterUrl: undefined,
        ui: false,
        nofx: true,
        // WebGL everywhere: WebXR requires it, and it avoids partial WebGPU implementations
        // (some Linux/Chrome GPU stacks reject small buffers and canvas uploads).
        renderer: 'webgl',
        budget: budgetFor(),
        controllerProfilesUrl: ASSETS.controllerProfilesUrl,
        floorHeightAt: (x, y, z) => (collision ? (collision.queryRay(x, y, z, 0, -1, 0, 40)?.y ?? null) : null)
    });

    const { app, state, events, internals } = viewer;
    const { camera } = internals;

    // loading progress: download first, then streaming reveal
    events.on('progress:changed', (p: number) => {
        if (!state.loaded) screens.setProgress(5 + p * 0.9, p < 100 ? 'Streaming site capture…' : 'Building the site…');
    });

    collision = await internals.collision;
    if (!collision) {
        console.warn('SiteXR: collision data missing, terrain following disabled');
    }

    // ---- SiteXR layer --------------------------------------------------------------------
    const layer = getUiLayer(app, camera);
    const rig = new XrRig(app, camera, collision, layer);

    let desktopMode = false;
    let vrPresenter: TourPresenter;
    let desktopPresenter: TourPresenter;

    const tour = new Tour(TOUR, { travel: async () => {}, caption: () => {}, end: () => {} }, () => {
        screens.setTourActive(tour.active);
    });

    const markers = new Markers(rig, POIS, {
        onDesktopSelect: (poi: Poi) => screens.showPoi(poi),
        onGoThere: (poi: Poi) => {
            const s = rig.findStand(poi.stand.x, poi.stand.z);
            rig.blinkTo(s.x, s.y, s.z, poi.stand.look);
        }
    });

    const tutorial = new Tutorial(rig, () => {
        if (rig.active) screensToastVr('Tutorial complete. Press B for the menu.');
    });

    const menu = new VrMenu(rig, {
        tourActive: () => tour.active,
        toggleTour: () => tour.toggle(),
        replayTutorial: () => tutorial.start()
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

    vrPresenter = {
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

    desktopPresenter = {
        travel: async (stop) => {
            await screens.fadeOut();
            desktopGoTo(stop.x, stop.z, stop.look);
            await new Promise((r) => setTimeout(r, 120));
            screens.fadeIn();
        },
        caption: (stop, i, n) => screens.showCaption(stop, i, n),
        end: () => screens.hideCaption()
    };

    // a small notice panel for VR (used after the tutorial and on tour end)
    const noticePanel = new Panel(app, layer, { name: 'notice', width: 0.7, height: 0.14, pixels: 768, overlay: true });
    let noticeTimer = 0;
    const screensToastVr = (text: string) => {
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

    // ---- desktop walkthrough helpers --------------------------------------------------------
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
        desktopGoTo(SPAWN.x, SPAWN.z, SPAWN.look);
        screens.toast('Position reset');
    };

    // ---- VR session lifecycle -------------------------------------------------------------------
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
            // B: menu
            if (markers.cardOpen) markers.closeCard();
            else menu.toggle();
        } else if (name === 'secondary' && hand === 'left') {
            // Y: reset position
            if (!menu.isOpen) rig.resetToSpawn();
        } else if (name === 'primary' && hand === 'left') {
            // X: guided tour
            if (!menu.isOpen) tour.toggle();
        } else if (name === 'primary' && hand === 'right') {
            // A while the tour runs and not pointing at UI: next stop
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
        screens.setEnterBusy(false);
        screens.setReady(true);
        screens.showWelcome('Session ended. Enter again to return to the site.');
        desktopMode = false;
        app.renderNextFrame = true;
    });
    tour.setPresenter(desktopPresenter);

    settings.events.on('change:quality', () => {
        app.scene.gsplat.splatBudget = budgetFor() * 1e6;
        app.renderNextFrame = true;
    });

    // ---- keyboard shortcuts (desktop) --------------------------------------------------------
    window.addEventListener('keydown', (e) => {
        if (rig.active || !desktopMode || screens.modalOpen) return;
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
    });

    // ---- enter --------------------------------------------------------------------------------------
    const enter = async () => {
        if (vrSupported) {
            screens.setEnterBusy(true);
            try {
                await rig.enterVr();
                screens.hideWelcome();
            } catch (err) {
                console.error('SiteXR: could not start the VR session', err);
                screens.setEnterBusy(false);
                screens.setReady(true);
                screens.showWelcome('The headset declined to start VR. Check that the Meta Quest Browser has permission and try again.');
            }
            return;
        }
        desktopMode = true;
        screens.hideWelcome();
        screens.showHud();
        state.cameraMode = 'walk';
        state.inputEnabled = true;
        markers.setVisible(true);
        app.renderNextFrame = true;
    };

    // ---- ready --------------------------------------------------------------------------------------
    const onLoaded = () => {
        state.cameraMode = 'walk';
        markers.setVisible(true);
        screens.setReady(vrSupported);
        app.renderNextFrame = true;
    };
    if (state.loaded) onLoaded();
    else events.once('loaded:changed', onLoaded);

    // Non-enumerable QA handle for the headless smoke test (not a user-facing control).
    Object.defineProperty(window, '__sitexr', {
        value: { viewer, rig, menu, tutorial, markers, tour, settings, pois: POIS },
        enumerable: false,
        configurable: true
    });

    // keep the desktop walkthrough responsive to modal state
    settings.events.on('change', () => {
        app.renderNextFrame = true;
    });
};

main().catch((err) => {
    console.error('SiteXR failed to start', err);
    const label = document.getElementById('progress-label');
    const note = document.getElementById('mode-note');
    const noGraphics = /webgl|graphics device|context/i.test(String(err?.message ?? err));
    if (label) {
        label.textContent = noGraphics
            ? '3D graphics are unavailable in this browser.'
            : 'The site could not be loaded. Please refresh to try again.';
    }
    if (note && noGraphics) {
        note.textContent =
            'Enable hardware acceleration (Chrome: Settings → System) or check the graphics driver, then reload. On a Meta Quest headset this works out of the box.';
    }
    const sub = document.getElementById('enter-sub');
    if (sub) sub.textContent = 'Unavailable';
    document.getElementById('overlay')?.setAttribute('data-state', 'error');
});
