#!/usr/bin/env python3
"""Converts an IFC building model to a GLB the app can load and walk through.

BIM models arrive as IFC; the browser wants triangles. This uses IfcOpenShell's glTF
serializer, which triangulates every product's geometry and writes one GLB with the
material colours from the IFC.

    pip install --user ifcopenshell
    python3 tools/ifc-to-glb.py model.ifc public/bim/model.glb [--exclude IfcSpace,IfcOpeningElement]

Notes:
  - IFC is Z-up and usually in millimetres or metres; the serializer writes metres, Y-up,
    which is what the viewer's world space expects.
  - IfcSpace and IfcOpeningElement are excluded by default: they are volumes, not fabric,
    and would enclose the visitor in invisible boxes.
"""
import argparse
import multiprocessing
import os
import sys

import ifcopenshell
import ifcopenshell.geom

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--exclude', default='IfcSpace,IfcOpeningElement',
                help='comma-separated IFC classes to leave out')
ap.add_argument('--include', default='', help='only these classes, if given')
ap.add_argument('--threads', type=int, default=0)
a = ap.parse_args()

model = ifcopenshell.open(a.src)
print(f'{os.path.basename(a.src)}: schema {model.schema}, {len(model.by_type("IfcProduct"))} products')

settings = ifcopenshell.geom.settings()
settings.set('use-world-coords', True)
settings.set('weld-vertices', True)
settings.set('apply-default-materials', True)

ser_settings = ifcopenshell.geom.serializer_settings()
try:
    ser_settings.set('use-element-guids', True)
except Exception:
    pass

os.makedirs(os.path.dirname(os.path.abspath(a.dst)) or '.', exist_ok=True)
serializer = ifcopenshell.geom.serializers.gltf(a.dst, settings, ser_settings)
serializer.setFile(model)
serializer.setUnitNameAndMagnitude('METER', 1.0)
serializer.writeHeader()

exclude = [c.strip() for c in a.exclude.split(',') if c.strip()]
include = [c.strip() for c in a.include.split(',') if c.strip()]
threads = a.threads or multiprocessing.cpu_count()
if include:
    it = ifcopenshell.geom.iterator(settings, model, threads, include=include)
else:
    it = ifcopenshell.geom.iterator(settings, model, threads, exclude=exclude)

written = 0
if it.initialize():
    while True:
        serializer.write(it.get())
        written += 1
        if not it.next():
            break
serializer.finalize()

size = os.path.getsize(a.dst)
print(f'wrote {a.dst}: {written} elements, {size / 1e6:.1f} MB')
if written == 0:
    sys.exit('no geometry written — check the include/exclude filters')
