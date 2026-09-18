#!/usr/bin/env python3
"""Converts an FBX (what Revit exports) to GLB, using assimp.

    python3 -m venv .venv && .venv/bin/pip install pyassimp trimesh scipy
    sudo apt install libassimp5            # the native library pyassimp binds to
    .venv/bin/python tools/fbx-to-glb.py model.fbx /tmp/model.glb

Then rescale and fix the axes, which FBX does not do for you:

    node tools/optimize-glb.mjs /tmp/model.glb public/bim/model.glb \
        --scale 0.3048 --z-up --double-sided

Revit FBX is usually in feet (0.3048) and Z-up. Check against something known: a wall
tagged 'Generic - 8"' should measure 0.667 units thick if the file is in feet.

Not FBX2glTF: it mishandles the transform inheritance Revit writes, and silently collapses
wall geometry to fragments. See the README.
"""
import argparse

import numpy as np
import pyassimp

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
a = ap.parse_args()

with pyassimp.load(a.src) as scene:
    def bounds(node, matrix, acc):
        m = matrix @ np.array(node.transformation)
        for mesh in node.meshes:
            v = np.array(mesh.vertices)
            if len(v):
                world = np.c_[v, np.ones(len(v))] @ m.T
                acc.append((world[:, :3].min(0), world[:, :3].max(0)))
        for child in node.children:
            bounds(child, m, acc)

    acc = []
    bounds(scene.rootnode, np.eye(4), acc)
    lo = np.min([x for x, _ in acc], axis=0)
    hi = np.max([x for _, x in acc], axis=0)
    faces = sum(len(m.faces) for m in scene.meshes)
    print(f'{len(scene.meshes)} meshes, {faces} triangles')
    print(f'bounds {np.round(lo, 2)} to {np.round(hi, 2)}, size {np.round(hi - lo, 2)} (source units)')
    pyassimp.export(scene, a.dst, file_type='glb2')
    print(f'wrote {a.dst}')
