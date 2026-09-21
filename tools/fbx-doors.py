#!/usr/bin/env python3
"""Extracts openable door leaves from an FBX, for models that have no IFC to read.

An IFC states which edge is hinged, how wide the leaf is and which way it swings.
An FBX states none of that, so this works from the geometry and the element name:

  * a door's parts are grouped by the element id in its name;
  * the leaf is the thin part, and a pair of leaves that face each other is a double door;
  * a double door hinges each leaf on its outer edge, which is not a guess;
  * a single leaf has to be guessed at, so every one is rendered and looked at.

Sliding doors are left alone. A pocket slider that swings is worse than one that does not
move, and the name says plainly which is which.

    python3 tools/fbx-doors.py model.fbx out.json [--scale 0.3048] [--z-up]

Writes the same shape as tools/ifc-doors.py, so the app needs no change to read it.
"""
import argparse
import json
import math
import re
from collections import defaultdict

import numpy as np
import pyassimp

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--z-up', action='store_true')
ap.add_argument('--max-angle', type=float, default=85.0)
ap.add_argument('--color', default='0.62,0.50,0.36')
a = ap.parse_args()

GENERIC = re.compile(r'\$AssimpFbx\$|^Body$|^Composite Part$|^Polygon Mesh$|^Solid$|'
                     r'^\d*D? ?(Solid|Face Set)$|^Geometry_\d+$|^$', re.I)
SLIDING = re.compile(r'slider|sliding|pocket', re.I)
DOOR = re.compile(r'\bdoor', re.I)

PRE = np.eye(4)
PRE[:3, :3] *= a.scale
if a.z_up:
    R = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float) * a.scale
    PRE[:3, :3] = R


def quat_from_matrix(m):
    t = m[0, 0] + m[1, 1] + m[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        return [(m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s, 0.25 * s]
    if m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        return [0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s, (m[2, 1] - m[1, 2]) / s]
    if m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        return [(m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s, (m[0, 2] - m[2, 0]) / s]
    s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
    return [(m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s, (m[1, 0] - m[0, 1]) / s]


def normals_of(v, idx):
    n = np.zeros_like(v)
    tri = v[idx]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3):
        np.add.at(n, idx[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(ln == 0, 1, ln)


# ---- read every mesh part that sits under a door-named element -------------------------
parts = defaultdict(list)
with pyassimp.load(a.src) as scene:
    def walk(node, matrix, label):
        m = matrix @ np.array(node.transformation)
        name = node.name or ''
        if not GENERIC.search(name):
            label = name
        for mesh in node.meshes:
            v = np.array(mesh.vertices)
            if not len(v) or not DOOR.search(label):
                continue
            world = (np.c_[v, np.ones(len(v))] @ m.T)[:, :3]
            world = (PRE[:3, :3] @ world.T).T + PRE[:3, 3]
            faces = np.array(mesh.faces, dtype=np.int64)
            if faces.ndim != 2 or faces.shape[1] != 3:
                continue
            # elements repeat their family name, so key on the id in brackets
            ids = re.findall(r'\[(\d+)\]', label)
            key = (label.split('[')[0].strip(), ids[0] if ids else label)
            parts[key].append((world, faces))
        for child in node.children:
            walk(child, m, label)

    walk(scene.rootnode, np.eye(4), '')

colour = [float(x) for x in a.color.split(',')]
leaves = []
skipped = []

for (family, ident), pieces in parts.items():
    if SLIDING.search(family):
        skipped.append((family, 'slides rather than swings'))
        continue

    # a leaf is thin, and the thin direction is horizontal
    candidates = []
    for verts, faces in pieces:
        size = verts.max(0) - verts.min(0)
        horiz = [size[0], size[2]]
        if size[1] < 0.9:                       # too short to be a leaf
            continue
        if min(horiz) > 0.25:                   # too thick
            continue
        if max(horiz) < 0.4:                    # too narrow: a jamb or a handle
            continue
        candidates.append((verts, faces, size))

    if not candidates:
        skipped.append((family, 'no part looks like a leaf'))
        continue

    # A leaf and the glass in it are separate parts sitting in the same place. Left apart
    # they would swing away from each other, so anything sharing a footprint is one leaf.
    merged = []
    for verts, faces, size in candidates:
        centre = (verts.max(0) + verts.min(0)) / 2
        for group in merged:
            if abs(group['c'][0] - centre[0]) < 0.35 and abs(group['c'][2] - centre[2]) < 0.35:
                base = len(group['v'])
                group['v'] = np.vstack([group['v'], verts])
                group['f'] = np.vstack([group['f'], faces + base])
                group['c'] = (group['v'].max(0) + group['v'].min(0)) / 2
                break
        else:
            merged.append({'v': verts, 'f': faces, 'c': centre})
    candidates = [(g['v'], g['f'], g['v'].max(0) - g['v'].min(0)) for g in merged]

    # a pair facing each other is a double door, and then each hinges on its outer edge
    centres = np.array([(v.max(0) + v.min(0)) / 2 for v, _, _ in candidates])
    pair_centre = centres.mean(axis=0)

    for verts, faces, size in candidates:
        lo, hi = verts.min(0), verts.max(0)
        wide = 0 if size[0] >= size[2] else 2   # the horizontal axis the leaf runs along
        thin = 2 if wide == 0 else 0
        centre = (lo + hi) / 2

        # outer edge of the pair, which for a single leaf is simply the far edge
        outward = 1.0 if centre[wide] >= pair_centre[wide] else -1.0
        hinge = centre.copy()
        hinge[wide] = hi[wide] if outward > 0 else lo[wide]
        hinge[1] = lo[1]

        width_dir = np.zeros(3)
        width_dir[wide] = -outward              # local +X runs from the hinge into the leaf
        up = np.array([0.0, 1.0, 0.0])
        z = np.cross(width_dir, up)
        rot = np.column_stack([width_dir, up, z])

        local = (rot.T @ (verts - hinge).T).T
        idx = faces
        leaves.append({
            'door': f'{family} [{ident}]',
            'guid': ident,
            'operation': 'FBX_SWING',
            'side': 'right' if outward > 0 else 'left',
            'fixed': False,
            'position': [round(float(v), 5) for v in hinge],
            'rotation': [round(v, 6) for v in quat_from_matrix(rot)],
            'sign': float(outward),
            'maxAngle': a.max_angle,
            'width': round(float(size[wide]), 4),
            'height': round(float(size[1]), 4),
            'thickness': round(float(size[thin]), 4),
            'color': colour,
            'positions': [round(float(v), 5) for v in local.reshape(-1)],
            'normals': [round(float(v), 4) for v in normals_of(local, idx).reshape(-1)],
            'indices': idx.reshape(-1).tolist()
        })

json.dump({'units': 'metres, Y-up', 'leaves': leaves, 'frames': {'positions': [], 'indices': []}},
          open(a.dst, 'w'))

print(f'{len(leaves)} openable leaves from {len(parts)} door elements')
for leaf in leaves:
    print(f"  {leaf['door'][:52]:<52} {leaf['side']:<5} "
          f"{leaf['width']:.2f} x {leaf['height']:.2f} x {leaf['thickness']:.3f} m  "
          f"at {[round(v, 1) for v in leaf['position']]}")
for family, why in skipped:
    print(f'  skipped {family[:52]}: {why}')
