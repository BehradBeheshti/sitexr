// Downloads a published SuperSplat scene (streamed SOG or plain SOG) into source-assets/.
// Only run this for scenes whose author has enabled downloads under a licence that allows
// reuse — see the credits in src/config.ts.
//
//   node tools/fetch-scene.mjs <sceneHash> <outDir> [version]
import { mkdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const [hash, outDir, version = 'v1'] = process.argv.slice(2);
if (!hash || !outDir) {
    console.error('usage: node tools/fetch-scene.mjs <sceneHash> <outDir> [version]');
    process.exit(1);
}
const base = `https://d28zzqy0iyovbz.cloudfront.net/${hash}/${version}/`;

const get = async (rel) => {
    const dst = join(outDir, rel);
    if (existsSync(dst) && statSync(dst).size > 0) return dst;
    mkdirSync(dirname(dst), { recursive: true });
    const res = await fetch(base + rel);
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    await writeFile(dst, Buffer.from(await res.arrayBuffer()));
    return dst;
};

mkdirSync(outDir, { recursive: true });
// streamed SOG (lod-meta.json) or single SOG (meta.json)
let index = 'lod-meta.json';
try {
    await get(index);
} catch {
    index = 'meta.json';
    await get(index);
}
await get('settings.json').catch(() => null);
const meta = JSON.parse(await readFile(join(outDir, index), 'utf8'));

const files = [];
if (index === 'lod-meta.json') {
    for (const chunk of meta.filenames) {
        const m = JSON.parse(await readFile(await get(chunk), 'utf8'));
        const dir = dirname(chunk);
        for (const key of ['means', 'quats', 'scales', 'sh0', 'shN']) {
            for (const f of meta[key]?.files ?? m[key]?.files ?? []) files.push(`${dir}/${f}`);
        }
    }
    if (meta.environment) files.push(meta.environment);
} else {
    for (const key of ['means', 'quats', 'scales', 'sh0', 'shN']) {
        for (const f of meta[key]?.files ?? []) files.push(f);
    }
}

console.log(`${hash}: ${files.length} texture files`);
let done = 0;
const queue = [...files];
const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
        const f = queue.shift();
        await get(f);
        if (++done % 25 === 0) console.log(`  ${done}/${files.length}`);
    }
});
await Promise.all(workers);
writeFileSync(join(outDir, 'SOURCE.txt'), `https://superspl.at/scene/${hash} (${version})\n`);
console.log(`done -> ${outDir}`);
