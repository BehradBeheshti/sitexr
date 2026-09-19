#!/usr/bin/env python3
"""Builds a labelled contact sheet from a folder of images, for picking figures quickly.

    python3 tools/contact-sheet.py <in-dir> <out.jpg> [--cols 5] [--width 420]
"""
import argparse
import os

from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--cols', type=int, default=5)
ap.add_argument('--width', type=int, default=420)
ap.add_argument('--title', default='')
a = ap.parse_args()

files = sorted(
    os.path.join(dp, f)
    for dp, _, fn in os.walk(a.src)
    for f in fn
    if f.lower().endswith(('.png', '.jpg', '.jpeg'))
)
if not files:
    raise SystemExit(f'no images in {a.src}')


def load_font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


font = load_font(13)
title_font = load_font(22)

probe = Image.open(files[0])
cell_w = a.width
cell_h = round(cell_w * probe.height / probe.width)
label_h = 20
pad = 8
cols = a.cols
rows = (len(files) + cols - 1) // cols
head = 40 if a.title else 0

sheet = Image.new('RGB', (cols * (cell_w + pad) + pad,
                          head + rows * (cell_h + label_h + pad) + pad), (22, 24, 28))
draw = ImageDraw.Draw(sheet)
if a.title:
    draw.text((pad, 10), a.title, font=title_font, fill=(240, 240, 240))

for i, f in enumerate(files):
    c, r = i % cols, i // cols
    x = pad + c * (cell_w + pad)
    y = head + pad + r * (cell_h + label_h + pad)
    im = Image.open(f).convert('RGB').resize((cell_w, cell_h), Image.LANCZOS)
    sheet.paste(im, (x, y))
    name = os.path.relpath(f, a.src)
    while draw.textlength(name, font=font) > cell_w and len(name) > 4:
        name = name[1:]
    draw.text((x, y + cell_h + 3), name, font=font, fill=(170, 175, 185))

sheet.save(a.dst, quality=90)
print(f'{a.dst}: {len(files)} images, {sheet.width}x{sheet.height}')
