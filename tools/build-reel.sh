#!/usr/bin/env bash
# Cuts the per-site demo clips into one short reel (under 30 seconds), with a short dip
# to black between sites. Needs the per-site MP4s from tools/record-demo.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=media/sitexr-demo.mp4
TMP=$(mktemp -d)

# site : start : length (seconds)
CUTS=(
  "komatsu:0:10"
  "excavator:3.5:9"
  "scaffold:1.5:9"
)

LIST="$TMP/list.txt"
: > "$LIST"
for c in "${CUTS[@]}"; do
    IFS=: read -r site start len <<< "$c"
    src="media/${site}-vr-demo.mp4"
    [ -f "$src" ] || { echo "missing $src"; exit 1; }
    fadeout=$(python3 -c "print(max(0, $len - 0.4))")
    ffmpeg -y -loglevel error -ss "$start" -t "$len" -i "$src" \
        -vf "fade=t=in:st=0:d=0.4,fade=t=out:st=$fadeout:d=0.4,setpts=PTS-STARTPTS" \
        -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -r 24 "$TMP/$site.mp4"
    echo "file '$TMP/$site.mp4'" >> "$LIST"
done

ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy "$OUT"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | xargs printf 'reel duration: %s s\n'
ls -lh "$OUT"
rm -rf "$TMP"
