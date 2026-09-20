#!/usr/bin/env python3
"""Extracts openable door leaves from an IFC, for a walkthrough that lets you open them.

A Revit door arrives as one element holding a frame and a panel. Only the panel should
swing, so this splits them: within each door's triangulated shape, the sub-mesh whose width
and height match the door's own OverallWidth and OverallHeight is the panel, and the rest is
the frame. That test is the door telling us which part it is, rather than a guess from
thickness or material naming.

Each leaf is written in a hinge frame: vertices relative to its hinge, plus the rigid
transform that puts that hinge in the world. Opening it is then one rotation about the node's
own vertical axis, with no matrix work at run time.

    python3 tools/ifc-doors.py model.ifc public/private/doors.json

Output (metres, Y-up, matching the viewer's world):
    leaves[]  position, rotation (quaternion), positions/normals/indices, sign, maxAngle,
              and width/height/thickness for the collision rectangle
    frames    one merged static mesh
"""
import argparse
import json
import math
import re

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.placement as up
import ifcopenshell.util.unit as uu

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--max-angle', type=float, default=85.0)
a = ap.parse_args()

model = ifcopenshell.open(a.src)
scale = uu.calculate_unit_scale(model)

settings = ifcopenshell.geom.settings()
settings.set('use-world-coords', False)

# IFC is Z-up; the viewer is Y-up. (x, y, z) -> (x, z, -y), which is what the glTF
# serializer does to the rest of the model, so the two have to agree exactly.
R = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=float)


def quat_from_matrix(m):
    """Rotation matrix to (x, y, z, w). Uses the largest diagonal term for conditioning."""
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


def normals_of(verts, idx):
    n = np.zeros_like(verts)
    tri = verts[idx]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    for k in range(3):
        np.add.at(n, idx[:, k], fn)
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.where(ln == 0, 1, ln)


def compact(verts, tris):
    """Drop unused vertices and reindex."""
    used = np.unique(tris)
    remap = np.full(len(verts), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return verts[used], remap[tris]


_COLOUR_CACHE = {}


def style_colour(material_name, fallback=(0.78, 0.74, 0.68)):
    """Colour for a geometry material, looked up from the surface style it names."""
    if material_name in _COLOUR_CACHE:
        return _COLOUR_CACHE[material_name]
    rgb = list(fallback)
    match = re.search(r'(\d+)$', material_name or '')
    if match:
        try:
            style = model.by_id(int(match.group(1)))
            colour = getattr(style, 'SurfaceColour', None)
            if colour is not None:
                rgb = [float(colour.Red), float(colour.Green), float(colour.Blue)]
        except Exception:
            pass
    _COLOUR_CACHE[material_name] = rgb
    return rgb


leaves = []
frame_v = []
frame_i = []
frame_c = []
skipped = []

for door in model.by_type('IfcDoor'):
    try:
        shape = ifcopenshell.geom.create_shape(settings, door)
    except Exception as exc:                       # a door with no body
        skipped.append((door.Name, f'no shape: {exc}'))
        continue

    g = shape.geometry
    verts = np.array(g.verts, dtype=float).reshape(-1, 3)
    tris = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
    mat_id = np.array(g.material_ids, dtype=np.int64)
    # The material objects the geometry engine hands back crash this build when asked for
    # their colour, but they carry the style's entity id in their name, and the style itself
    # reads fine off the file.
    colours = [style_colour(m.name) for m in g.materials]

    want_w = (door.OverallWidth or 0) * scale
    want_h = (door.OverallHeight or 0) * scale

    # Which material group is the panel? The one whose width and height are the door's own.
    best, best_err = None, 1e9
    for i in set(mat_id.tolist()):
        sel = tris[mat_id == i]
        if not len(sel):
            continue
        pts = verts[np.unique(sel)]
        size = pts.max(0) - pts.min(0)
        if want_w <= 0 or want_h <= 0:
            continue
        err = abs(size[0] - want_w) / want_w + abs(size[2] - want_h) / want_h
        if err < best_err:
            best, best_err = i, err

    if best is None or best_err > 0.18:
        skipped.append((door.Name, f'no panel matched (best error {best_err:.2f})'))
        panel_ids = set()
    else:
        panel_ids = {best}

    # everything that is not the panel is frame, and stays where it is
    world = up.get_local_placement(door.ObjectPlacement).copy()
    world[:3, 3] *= scale

    static = tris[~np.isin(mat_id, list(panel_ids))] if panel_ids else tris
    if len(static):
        sv, si = compact(verts, static)
        sw = (world[:3, :3] @ sv.T).T + world[:3, 3]
        sw = (R @ sw.T).T
        base = len(frame_v)
        frame_v.extend(sw.tolist())
        frame_i.extend((si + base).tolist())
        col = colours[int(mat_id[~np.isin(mat_id, list(panel_ids))][0])] if len(static) else [0.8, 0.8, 0.8]
        frame_c.extend([col] * len(sv))

    if not panel_ids:
        continue

    panel = tris[mat_id == best]
    pts = verts[np.unique(panel)]
    lo, hi = pts.min(0), pts.max(0)
    thickness = float(hi[1] - lo[1])

    op = (door.OperationType or 'NOTDEFINED').upper()
    wide = (hi[0] - lo[0]) > 1.3
    opens = 'right' if (op.endswith('RIGHT') or op == 'NOTDEFINED') else 'left'
    if op.startswith('DOUBLE') or (wide and op in ('NOTDEFINED',)) or ('FIXED' in op and wide):
        # two leaves. SWING_FIXED_* means one of them is a fixed panel, and the suffix
        # names the one that actually swings.
        cx = 0.5 * (lo[0] + hi[0])
        centroid = verts[panel].mean(axis=1)[:, 0]
        pair = [(panel[centroid < cx], 'left'), (panel[centroid >= cx], 'right')]
        if 'FIXED' in op:
            groups = [(t, side if side == opens else None) for t, side in pair]
        else:
            groups = pair
    elif 'FIXED' in op:
        groups = [(panel, None)]
    else:
        groups = [(panel, opens)]

    # Which way does it swing? Toward whichever side of the panel has room in the frame.
    frame_pts = verts[np.unique(tris[mat_id != best])] if (mat_id != best).any() else pts
    swing = -1.0 if (0.5 * (lo[1] + hi[1])) > (0.5 * (frame_pts.min(0)[1] + frame_pts.max(0)[1])) else 1.0

    for leaf_tris, side in groups:
        if not len(leaf_tris):
            continue
        lv, li = compact(verts, leaf_tris)
        llo, lhi = lv.min(0), lv.max(0)
        hinge_x = float(lhi[0] if side == 'right' else llo[0])  # a fixed leaf hinges nowhere
        hinge = np.array([hinge_x, 0.5 * (llo[1] + lhi[1]), 0.0])

        local = (lv - hinge)
        local_y_up = (R @ local.T).T
        n = normals_of(local_y_up, li)

        # node transform: world placement, moved to the hinge, expressed in the viewer's frame
        T = np.eye(4)
        T[:3, 3] = hinge
        N = world @ T
        rot = R @ N[:3, :3] @ R.T
        pos = R @ N[:3, 3]

        sign = swing * (1.0 if side == 'right' else -1.0)
        leaves.append({
            'door': door.Name,
            'guid': door.GlobalId,
            'operation': op,
            'side': side,
            'fixed': side is None,
            'position': [round(float(v), 5) for v in pos],
            'rotation': [round(v, 6) for v in quat_from_matrix(rot)],
            'sign': float(sign),
            'maxAngle': 0.0 if side is None else a.max_angle,
            'width': round(float(lhi[0] - llo[0]), 4),
            'height': round(float(lhi[2] - llo[2]), 4),
            'thickness': round(thickness, 4),
            'color': colours[best],
            'positions': [round(float(v), 5) for v in local_y_up.reshape(-1)],
            'normals': [round(float(v), 4) for v in n.reshape(-1)],
            'indices': li.reshape(-1).tolist()
        })

out = {
    'units': 'metres, Y-up',
    'leaves': leaves,
    'frames': {
        'positions': [round(float(v), 5) for v in np.array(frame_v).reshape(-1)] if frame_v else [],
        'indices': list(np.array(frame_i, dtype=np.int64).reshape(-1)) if frame_i else [],
        'colors': [round(float(v), 4) for v in np.array(frame_c).reshape(-1)] if frame_c else []
    }
}
if frame_v:
    fv = np.array(frame_v)
    fi = np.array(frame_i, dtype=np.int64)
    out['frames']['normals'] = [round(float(v), 4) for v in normals_of(fv, fi).reshape(-1)]
    out['frames']['indices'] = fi.reshape(-1).tolist()

with open(a.dst, 'w') as fh:
    json.dump(out, fh)

movable = [l for l in leaves if l['maxAngle'] > 0]
print(f'{len(leaves)} leaves from {len(model.by_type("IfcDoor"))} doors '
      f'({len(movable)} openable), frame mesh {len(frame_v)} verts')
for name, why in skipped:
    print(f'  skipped {name}: {why}')
