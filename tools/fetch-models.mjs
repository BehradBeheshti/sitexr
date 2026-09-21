// Fetches the design models the build needs into `public/private/`.
//
// They live on a GitHub release rather than in the repository, so they stay out of git
// history and can be deleted. The release is public, so this needs no token and works on any
// build machine, which is what lets a host like Cloudflare build straight from the repo.
//
//   node tools/fetch-models.mjs            # skips quietly if the release has nothing
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const repo = process.env.MODELS_REPO ?? 'BehradBeheshti/sitexr';
const tag = process.env.MODELS_TAG ?? 'model-assets';
const dir = 'public/private';

const api = `https://api.github.com/repos/${repo}/releases/tags/${tag}`;

const main = async () => {
    const res = await fetch(api, { headers: { accept: 'application/vnd.github+json' } });
    if (res.status === 404) {
        console.log(`no "${tag}" release on ${repo}; building without the design models`);
        return;
    }
    if (!res.ok) throw new Error(`${res.status} from ${api}`);

    const { assets = [] } = await res.json();
    if (!assets.length) {
        console.log(`"${tag}" has no assets; building without the design models`);
        return;
    }

    await mkdir(dir, { recursive: true });
    for (const asset of assets) {
        const dest = join(dir, asset.name);
        const have = await stat(dest).then((s) => s.size, () => -1);
        if (have === asset.size) {
            console.log(`have ${asset.name} (${(have / 1e6).toFixed(2)} MB)`);
            continue;
        }
        const file = await fetch(asset.browser_download_url);
        if (!file.ok) throw new Error(`${file.status} downloading ${asset.name}`);
        await writeFile(dest, Buffer.from(await file.arrayBuffer()));
        console.log(`fetched ${asset.name} (${(asset.size / 1e6).toFixed(2)} MB)`);
    }
};

main().catch((err) => {
    console.error('could not fetch the design models:', err.message);
    process.exit(1);
});
