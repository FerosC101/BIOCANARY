"""Blender -b biocanary_device.blend -P export_glb.py -- out.glb

Web/AR copy of the device: studio removed, dense solids decimated, and the
Cycles materials replaced with glTF-compatible ones.
"""
import sys
import bpy
import numpy as np

out = sys.argv[sys.argv.index('--') + 1]
device = bpy.data.collections['BIOCANARY device']
keep = set(device.all_objects)
for o in list(bpy.data.objects):
    if o not in keep or o.hide_render or 'spill' in o.name or 'reflection' in o.name:
        bpy.data.objects.remove(o)


def node(m, kind):
    return next((n for n in m.node_tree.nodes if n.bl_idname == 'ShaderNode' + kind), None)


def principled(m, color, rough=.4, metal=0., alpha=1., emit=None, strength=0.):
    t = m.node_tree; t.nodes.clear()
    b = t.nodes.new('ShaderNodeBsdfPrincipled'); o = t.nodes.new('ShaderNodeOutputMaterial')
    t.links.new(b.outputs[0], o.inputs[0])
    b.inputs['Base Color'].default_value = color
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Alpha'].default_value = alpha
    if emit:
        b.inputs['Emission Color'].default_value = emit
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1: m.surface_render_method = 'BLENDED'


def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c) + (1,)


bezel = bpy.data.materials.new('Bezel satin'); bezel.use_nodes = True
principled(bezel, lin('6b757e'), .3, .35)
for m in list(bpy.data.materials):
    if not m.node_tree or m is bezel: continue
    n = m.name
    if n == 'Enclosure white and bezel':
        principled(m, lin('d6d9e4'), .36)
    elif n.startswith('Culture medium'):
        blue = 'blue' in n
        principled(m, lin('5f9fe6' if blue else '4fc088'), .1, 0, .5, lin('3f8fe8' if blue else '35c070'), .35)
    elif n.startswith('Bubbles'):
        principled(m, lin('e8f8ff'), .05, 0, .55, lin('cfefff' if 'blue' in n else 'd2ffe0'), .5)
    elif n.startswith('Gland'):
        principled(m, lin('0b1a45'), .3, 0, 1, lin('1f5fe0'), .25)
    elif node(m, 'BsdfGlass') or (node(m, 'BsdfAnisotropic') and node(m, 'BsdfTransparent')):
        em = node(m, 'Emission')
        c = tuple(em.inputs['Color'].default_value) if em else (.9, .94, 1, 1)
        glow = n.startswith(('Vessel', 'LED', 'Edge'))
        principled(m, c if glow else (.9, .94, 1, 1), .05, 0, .24 if glow else .06, c if glow else None, .5 if glow else 0)
    elif node(m, 'Emission') and not node(m, 'BsdfPrincipled'):
        e = node(m, 'Emission')
        c, st = tuple(e.inputs['Color'].default_value), e.inputs['Strength'].default_value
        principled(m, c, .5, 0, 1, c, min(st, 2.0))

dg = bpy.context.evaluated_depsgraph_get()
for o in list(bpy.data.objects):
    if o.type != 'MESH': continue
    if o.name == 'Enclosure shell':
        me = o.data
        val = np.zeros(len(me.vertices), np.float32); me.attributes['bezel'].data.foreach_get('value', val)
        me.materials.append(bezel)
        for p in me.polygons:
            p.material_index = int(np.mean([val[i] for i in p.vertices]) > 0)
        me.attributes.remove(me.attributes['bezel'])
    heavy = {'Enclosure shell': .16, 'Smoked fascia and deck': .10, 'Plinth': .08}.get(o.name)
    if heavy is None and len(o.data.polygons) > 12000: heavy = .4
    if heavy:
        d = o.modifiers.new('Decimate', 'DECIMATE'); d.ratio = heavy
root = bpy.data.objects.new('BIOCANARY', None); bpy.context.scene.collection.objects.link(root)
for o in bpy.data.objects:
    if o is not root and o.parent is None: o.parent = root
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_animations=False)
