#!/usr/bin/env python3
"""Builds a navigation grid (floor height, ceiling, walkable mask) for a splat scene.

Input: a CSV exported by splat-transform (x,y,z,opacity columns; any LOD), in the file's
coordinate system. Output: <out>.json + <out>.bin read by src/xr/grid-collision.ts.
All distances below are in *scene units*; --scale is the metres-per-unit factor the app
applies, used to convert human dimensions (step height, standing band) into scene units.

  python3 tools/build-navgrid.py scene.csv out/nav --scale 1.7 --cell 0.1 \
      --box -20,-20,20,20 --seed 0,0 --ground-band 0.35 --stand-band 1.7
"""
import argparse, json, sys, numpy as np, pandas as pd
from collections import deque

ap = argparse.ArgumentParser()
ap.add_argument('csv'); ap.add_argument('out')
ap.add_argument('--scale', type=float, default=1.0, help='metres per scene unit')
ap.add_argument('--cell', type=float, default=0.1, help='cell size in scene units')
ap.add_argument('--box', default='-20,-20,20,20', help='xmin,zmin,xmax,zmax (world/viewer space)')
ap.add_argument('--ymin', type=float, default=-1e9); ap.add_argument('--ymax', type=float, default=1e9)
ap.add_argument('--seed', default='0,0', help='walkable seed x,z (world space)')
ap.add_argument('--floor-pct', type=float, default=8)
ap.add_argument('--min-count', type=int, default=6)
ap.add_argument('--step', type=float, default=0.35, help='max floor step between cells (m)')
ap.add_argument('--stand-band', type=float, default=1.75, help='standing clearance (m)')
ap.add_argument('--ground-band', type=float, default=0.32, help='ignore clutter below this (m)')
ap.add_argument('--obstacle-count', type=int, default=3)
ap.add_argument('--margin', type=float, default=0.3, help='keep-out margin around obstacles (m)')
ap.add_argument('--opacity', type=float, default=0.35)
ap.add_argument('--flip', default='1', help='1: viewer world = (-x,-y,z) of file (SOG/PLY default)')
ap.add_argument('--max-footprint', type=float, default=0.6, help='cap on splat footprint radius (scene units)')
ap.add_argument('--fill', type=int, default=3, help='fill unknown floor cells from neighbours within N cells')
ap.add_argument('--floor-band', default=None, help='lo,hi in scene units: for a flat slab, take the floor as the median of splats in this band (cells with none are filled from neighbours)')
a = ap.parse_args()

S = a.scale
xmin, zmin, xmax, zmax = map(float, a.box.split(','))
df = pd.read_csv(a.csv, usecols=['x', 'y', 'z', 'opacity', 'scale_0', 'scale_1', 'scale_2'])
if a.flip == '1':
    x = -df.x.values; y = -df.y.values; z = df.z.values
else:
    x = df.x.values; y = df.y.values; z = df.z.values
op = 1 / (1 + np.exp(-df.opacity.values))
# footprint radius: the splat's second-largest axis (a flat ground splat is a disc)
sc = np.sort(np.exp(np.stack([df.scale_0.values, df.scale_1.values, df.scale_2.values], 1)), axis=1)
rad = np.minimum(sc[:, 1], a.max_footprint)
m = (x >= xmin) & (x < xmax) & (z >= zmin) & (z < zmax) & (y > a.ymin) & (y < a.ymax) & (op > a.opacity)
x, y, z, rad = x[m], y[m], z[m], rad[m]
print(f'{len(x)} splats in box')
# spread large splats over the cells they cover (ground splats are big and few)
cell = a.cell
big = rad > cell * 0.75
if big.any():
    xs_, ys_, zs_ = [x[~big]], [y[~big]], [z[~big]]
    for r in np.unique(np.ceil(rad[big] / cell).astype(int)):
        sel = big & (np.ceil(rad / cell).astype(int) == r)
        for dz in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dz * dz > r * r or (dx == 0 and dz == 0):
                    continue
                xs_.append(x[sel] + dx * cell); ys_.append(y[sel]); zs_.append(z[sel] + dz * cell)
    xs_.append(x[big]); ys_.append(y[big]); zs_.append(z[big])
    x, y, z = np.concatenate(xs_), np.concatenate(ys_), np.concatenate(zs_)
    m2 = (x >= xmin) & (x < xmax) & (z >= zmin) & (z < zmax)
    x, y, z = x[m2], y[m2], z[m2]
    print(f'{len(x)} samples after footprint spreading')

W = int(np.ceil((xmax - xmin) / cell)); H = int(np.ceil((zmax - zmin) / cell))
ix = np.clip(((x - xmin) / cell).astype(int), 0, W - 1)
iz = np.clip(((z - zmin) / cell).astype(int), 0, H - 1)
lin = iz * W + ix
order = np.argsort(lin, kind='stable')
lin_s, y_s = lin[order], y[order]
starts = np.searchsorted(lin_s, np.arange(W * H))
ends = np.searchsorted(lin_s, np.arange(W * H), side='right')
count = ends - starts

floor = np.full(W * H, np.nan, np.float32)
band = tuple(float(v) for v in a.floor_band.split(',')) if a.floor_band else None
for c in np.nonzero(count >= a.min_count)[0]:
    ys = y_s[starts[c]:ends[c]]
    if band is not None:
        ys = ys[(ys >= band[0]) & (ys <= band[1])]
        if ys.size < a.min_count:
            continue
        floor[c] = np.median(ys)
    else:
        floor[c] = np.percentile(ys, a.floor_pct)
floor = floor.reshape(H, W)

# median smooth the floor (3x3) and fill single-cell holes
def med3(f):
    out = f.copy()
    for zi in range(H):
        for xi in range(W):
            n = f[max(0, zi - 1):zi + 2, max(0, xi - 1):xi + 2]
            v = n[~np.isnan(n)]
            if v.size >= 4:
                out[zi, xi] = np.median(v)
    return out
floor = med3(floor)
# fill small unknown patches from the nearest known cells
for _ in range(a.fill if not a.floor_band else max(a.fill, 40)):
    nan = np.isnan(floor)
    if not nan.any():
        break
    acc = np.zeros_like(floor); n = np.zeros_like(floor)
    for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(floor, dz, axis=0), dx, axis=1)
        ok = ~np.isnan(sh)
        acc[ok] += sh[ok]; n[ok] += 1
    fillable = nan & (n >= 2)
    floor[fillable] = acc[fillable] / n[fillable]

# ceiling (lowest thing well above head) and obstacles in the standing band
ceiling = np.full((H, W), np.nan, np.float32)
obst = np.zeros((H, W), np.uint8)
gb = a.ground_band / S; sb = a.stand_band / S
fl = floor.reshape(-1)
for c in np.nonzero(count > 0)[0]:
    f = fl[c]
    if np.isnan(f):
        continue
    ys = y_s[starts[c]:ends[c]]
    band = ys[(ys > f + gb) & (ys < f + sb)]
    if band.size >= a.obstacle_count:
        obst.reshape(-1)[c] = 1
    above = ys[ys >= f + sb]
    if above.size >= 3:
        ceiling.reshape(-1)[c] = np.percentile(above, 5)

# flood fill walkable region from the seed
sx, sz = map(float, a.seed.split(','))
si = (int((sz - zmin) / cell), int((sx - xmin) / cell))
if np.isnan(floor[si]):
    # search nearby for a valid floor cell
    best = None
    for r in range(1, 40):
        for dz in range(-r, r + 1):
            for dx in range(-r, r + 1):
                zi, xi = si[0] + dz, si[1] + dx
                if 0 <= zi < H and 0 <= xi < W and not np.isnan(floor[zi, xi]) and not obst[zi, xi]:
                    best = (zi, xi); break
            if best: break
        if best: break
    si = best
print('seed cell', si, 'floor', floor[si])
walk = np.zeros((H, W), np.uint8)
step = a.step / S
q = deque([si]); walk[si] = 1
while q:
    zi, xi = q.popleft()
    f = floor[zi, xi]
    for dz, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nz, nx = zi + dz, xi + dx
        if 0 <= nz < H and 0 <= nx < W and not walk[nz, nx] and not obst[nz, nx]:
            g = floor[nz, nx]
            if not np.isnan(g) and abs(g - f) <= step:
                walk[nz, nx] = 1; q.append((nz, nx))

# keep-out margin: erode walkable by margin cells
r = int(np.ceil(a.margin / S / cell))
if r > 0:
    er = walk.copy()
    blocked = (walk == 0)
    for dz in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dz * dz + dx * dx > r * r:
                continue
            sh = np.roll(np.roll(blocked, dz, axis=0), dx, axis=1)
            er[sh] = 0
    walk = er
print(f'walkable cells {int(walk.sum())} of {W*H} ({walk.sum()*cell*cell*S*S:.0f} m²)')

meta = {'version': 1, 'cell': cell, 'width': W, 'height': H, 'origin': [xmin, zmin], 'scale': S,
        'seed': [sx, sz], 'layers': ['floor:f32', 'ceiling:f32', 'walk:u8']}
json.dump(meta, open(a.out + '.json', 'w'))
with open(a.out + '.bin', 'wb') as fh:
    fh.write(floor.astype('<f4').tobytes()); fh.write(ceiling.astype('<f4').tobytes()); fh.write(walk.tobytes())

# ascii preview (every k cells)
k = max(1, int(2.0 / S / cell))
print('walkable preview (# walkable, . floor, x obstacle, blank unknown); rows z, cols x; 1 char =', k * cell, 'units')
hdr = '       ' + ''.join(('%d' % int(xmin + xi * cell)).rjust(1) if (xi // k) % 5 == 0 else ' ' for xi in range(0, W, k))
for zi in range(0, H, k):
    row = f'{zmin + zi*cell:6.1f} '
    for xi in range(0, W, k):
        row += '#' if walk[zi, xi] else ('x' if obst[zi, xi] else ('.' if not np.isnan(floor[zi, xi]) else ' '))
    print(row)
