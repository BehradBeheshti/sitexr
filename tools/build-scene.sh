#!/usr/bin/env bash
# Rebuilds public/scene from source-assets using splat-transform (Node, Linux/macOS).
# LOD 0 is the full scene with one SH band; LOD 1-3 are decimated copies; all four are
# bundled into a Streamed SOG so the engine can stream detail to fit the headset budget.
set -euo pipefail
cd "$(dirname "$0")/.."
WORK="${SCENE_WORK_DIR:-$(mktemp -d)}"
ST="npx splat-transform --no-tty -w"

echo "work dir: $WORK"
$ST source-assets/meta.json --filter-nan --filter-harmonics 1 "$WORK/lod0.ply"
$ST "$WORK/lod0.ply" -d 40% "$WORK/lod1.ply"
$ST "$WORK/lod0.ply" -d 15% "$WORK/lod2.ply"
$ST "$WORK/lod0.ply" -d 5%  "$WORK/lod3.ply"

rm -rf public/scene && mkdir -p public/scene
$ST "$WORK/lod0.ply" -l 0 "$WORK/lod1.ply" -l 1 "$WORK/lod2.ply" -l 2 "$WORK/lod3.ply" -l 3 \
    public/scene/lod-meta.json --lod-chunk-count 256 --lod-chunk-extent 12
cp source-assets/scene.voxel.json source-assets/scene.voxel.bin public/scene/
$ST public/scene/lod-meta.json --info null
du -sh public/scene
