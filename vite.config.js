import { defineConfig } from 'vite';

// SiteXR is a static site. BASE_PATH lets the same build be served from a sub-path
// (GitHub Pages project sites) or the root (Cloudflare Pages, custom domains).
export default defineConfig({
    base: process.env.BASE_PATH ?? '/',
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    build: {
        target: 'es2022',
        sourcemap: false,
        chunkSizeWarningLimit: 4000
    }
});
