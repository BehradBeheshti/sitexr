// Dev server over HTTPS with a self-signed certificate, for testing WebXR on a headset
// on the same network before deploying. Not the delivery method: deploy to a real host.
import { defineConfig, mergeConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import base from './vite.config.js';

export default mergeConfig(
    base,
    defineConfig({
        plugins: [basicSsl()],
        server: { https: true, host: true, port: 5173 }
    })
);
