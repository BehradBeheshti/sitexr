// Minimal WebXR typing for feature detection (the engine handles the session itself).
interface Navigator {
    xr?: {
        isSessionSupported(mode: string): Promise<boolean>;
    };
}
