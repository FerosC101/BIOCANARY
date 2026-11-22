"""Blender -b biocanary_device.blend -P export_web.py -- ../frontend/public/device/device.glb

Light copy for the web app. Parts are merged by group and material, and each
material carries a `kind` (glass, liquid, glow) that the viewer turns into its
own shader. Bubbles are left out: the viewer animates its own.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
import numpy as np
import housing as H
from camera import P

out = sys.argv[sys.argv.index('--') + 1]
keep = set(bpy.data.collections['BIOCANARY device'].all_objects)
for o in list(bpy.data.objects):
    if o not in keep or o.hide_render or 'spill' in o.name or 'reflection' in o.name or 'bubbles' in o.name:
        bpy.data.objects.remove(o)


def group(o):
    n, c = o.name, o.users_collection[0].name
    if c == 'Status panel':
        return 'wifi' if n.startswith('Wi-Fi') else 'cloud' if n.startswith('Cloud') else 'status' if n.startswith('Status ring') or n.startswith('Status tick') else 'enclosure'
    if c in ('Reference chamber', 'Test chamber', 'Tubing'):
        return 'reference' if n.startswith('Reference') else 'test'
    if c == 'Level columns': return 'columns'
    return 'enclosure'


def has(m, kind): return next((k for k in m.node_tree.nodes if k.bl_idname == 'ShaderNode' + kind), None)


def simplify(m):
    n = m.name
    if n == 'Enclosure white and bezel': kind, col = 'shell', None
    elif n.startswith('Culture medium'): kind, col = 'liquid', None
    elif n.startswith('Gland'): kind, col = 'solid', (.01, .03, .12, 1)
    elif has(m, 'BsdfGlass') or (has(m, 'BsdfAnisotropic') and has(m, 'BsdfTransparent')): kind, col = 'glass', None
    elif has(m, 'Emission') and not has(m, 'BsdfPrincipled'):
        kind, col = 'glow', tuple(has(m, 'Emission').inputs['Color'].default_value)
    else: return
    t = m.node_tree; t.nodes.clear()
    b = t.nodes.new('ShaderNodeBsdfPrincipled'); o = t.nodes.new('ShaderNodeOutputMaterial'); t.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Base Color'].default_value = col or (.8, .82, .87, 1)
    b.inputs['Roughness'].default_value = .36
    m['kind'] = kind


def bake(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
    o.modifiers.clear(); o.data = me


def count(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)


SOLID = {'Enclosure shell': (H.shell, 34000), 'Smoked fascia and deck': (H.panel, 7000), 'Plinth': (H.plinth, 6000)}
for o in list(bpy.data.objects):
    if o.type != 'MESH': continue
    bake(o)
    tri = count(o)
    f, target = SOLID.get(o.name, (None, None))
    if f is None and tri > 500:
        target = max(420, int(tri * (.12 if tri > 8000 else .2 if tri > 2500 else .3)))
    if 'text' in o.name or o.name in ('Logo', 'Tagline'): target = None
    if target and tri > target:
        d = o.modifiers.new('d', 'DECIMATE'); d.ratio = target / tri; d.use_collapse_triangulate = True
        bake(o)
    if f:                                   # exact normals again after decimating
        me = o.data
        v = np.array([k.co[:] for k in me.vertices]) / P
        me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
        nr = H.normal(f, v)
        if o.name == 'Enclosure shell':     # the seam is a hard cut
            seam = np.abs(v[:, 2] - (H.SEAM_Z + H.SEAM_SLOPE * (v[:, 1] + 60))) < .6
            nr[seam, 2] = 0; nr /= np.linalg.norm(nr, axis=1, keepdims=True)
        me.normals_split_custom_set_from_vertices([tuple(k) for k in nr])
    for a in list(o.data.attributes):
        if a.name in ('bezel',): o.data.attributes.remove(a)

for m in bpy.data.materials:
    if m.node_tree: simplify(m)

parts = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.materials:
        parts.setdefault((group(o), o.data.materials[0].name), []).append(o)
for (g, mn), obs in parts.items():
    if len(obs) > 1:
        with bpy.context.temp_override(active_object=obs[0], selected_editable_objects=obs, selected_objects=obs, object=obs[0]):
            bpy.ops.object.join()
    obs[0].name = f'{g}__{mn}'
    obs[0].parent = None
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('web meshes', len(meshes), 'triangles', sum(count(o) for o in meshes))
for o in sorted(meshes, key=count)[-8:]: print('  ', o.name, count(o))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=False, export_yup=True, export_extras=True, export_texcoords=False,
                          export_cameras=False, export_lights=False, export_animations=False)
