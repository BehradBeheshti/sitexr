#!/usr/bin/env python3
"""Converts a SketchUp model to GLB, without the Trimble SDK.

    python3 -m venv .venv && .venv/bin/pip install openskp trimesh scipy
    .venv/bin/python tools/skp-to-glb.py model.skp /tmp/model.glb

OpenSKP writes millimetres, so follow with the metre rescale:

    node tools/optimize-glb.mjs /tmp/model.glb public/bim/model.glb --scale 0.001 --double-sided
"""
import argparse

from openskp import SkpFile
from openskp.export import glb

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--no-textures', action='store_true')
a = ap.parse_args()

# SkpFile.open parses read-only. openskp's open_existing() is the editing path and
# re-encodes materials, which fails on textures it cannot rewrite.
f = SkpFile.open(a.src)
f.parse()
out = glb.export(f, a.dst, coordinate_system='y-up', units='mm', textures=not a.no_textures)
print(f'wrote {out}')
