#!/usr/bin/env bash
# Rebuilds the served scene data from source-assets/ (Node only; Linux/macOS).
#
#   tools/build-scene.sh excavator   full SOG -> 4-level streamed SOG + voxel collision copy
#   tools/build-scene.sh komatsu     streamed SOG -> lighter 3-level cut
#   tools/build-scene.sh scaffold    streamed SOG -> lighter 3-level cut
#
# Navigation grids are built separately, see tools/build-navgrid.py and the README.
set -euo pipefail
cd "$(dirname "$0")/.."
SITE="${1:-excavator}"
ST="npx splat-transform --no-tty -w"
WORK="${SCENE_WORK_DIR:-$(mktemp -d)}"
echo "work dir: $WORK"

case "$SITE" in
excavator)
    # LOD 0 is the full scene with one SH band; 1-3 are decimated copies.
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
    ;;
komatsu | scaffold)
    # These arrive as streamed SOG already. Drop the full-detail level (far more than a
    # headset budget can use) and reduce spherical harmonics to one band.
    SRC="source-assets/$SITE"
    OUT="public/scene-$SITE"
    [ -d "$SRC" ] || { echo "missing $SRC — run tools/fetch-scene.mjs first (see README)"; exit 1; }
    rm -rf "$OUT" && mkdir -p "$OUT"
    $ST "$SRC/lod-meta.json" -L 1,2,3 "$OUT/lod-meta.json" \
        --filter-nan --filter-harmonics 1 --lod-chunk-count 256 --lod-chunk-extent 12
    $ST "$OUT/lod-meta.json" --info null
    du -sh "$OUT"
    ;;
*)
    echo "unknown site: $SITE" >&2
    exit 1
    ;;
esac
