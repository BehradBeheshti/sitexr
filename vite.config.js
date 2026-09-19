import { rmSync } from 'node:fs';
import { defineConfig } from 'vite';

// `public/private/` holds client-owned models. It is not committed, and it must not leave
// this machine by accident either: Vite copies the whole public directory into dist, so a
// build that is not explicitly meant to carry those files drops them again afterwards.
const includePrivate = () =>
    process.env.VITE_INCLUDE_PRIVATE === '1' || !!process.env.VITE_ASSET_BASE;

const dropPrivateAssets = () => ({
    name: 'sitexr-drop-private-assets',
    apply: 'build',
    closeBundle() {
        if (includePrivate()) return;
        rmSync('dist/private', { recursive: true, force: true });
        this.warn('removed dist/private — set VITE_INCLUDE_PRIVATE=1 to publish those models');
    }
});

// SiteXR is a static site. BASE_PATH lets the same build be served from a sub-path
// (GitHub Pages project sites) or the root (Cloudflare Pages, custom domains).
export default defineConfig({
    base: process.env.BASE_PATH ?? '/',
    plugins: [dropPrivateAssets()],
    server: { host: true, port: 5173 },
    preview: { host: true, port: 4173 },
    build: {
        target: 'es2022',
        sourcemap: false,
        chunkSizeWarningLimit: 4000
    }
});
