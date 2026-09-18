// Copies the WebXR input profiles (controller models) SiteXR self-hosts into public/.
// Re-run after bumping @webxr-input-profiles/assets. Node only, no platform-specific tools.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@webxr-input-profiles/assets/dist/profiles');
const dst = join(root, 'public/controllers');

// Quest 3 advertises these profiles, most specific first; the generic ones are fallbacks.
const profiles = [
    'meta-quest-touch-plus',
    'meta-quest-touch-plus-v2',
    'oculus-touch-v3'
];

rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const p of profiles) {
    cpSync(join(src, p), join(dst, p), { recursive: true });
}
console.log(`copied ${profiles.length} controller profiles to public/controllers`);
