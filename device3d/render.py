"""Blender -b file.blend -P render.py -- out.png [samples] [scale%] [camera name]"""
import sys, bpy
a = sys.argv[sys.argv.index('--') + 1:]
s = bpy.context.scene
pr = bpy.context.preferences.addons['cycles'].preferences
for kind in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
    try: pr.compute_device_type = kind
    except TypeError: continue
    pr.get_devices()
    if any(d.type == kind for d in pr.devices): break
for d in pr.devices: d.use = d.type != 'CPU'
if len(a) > 1: s.cycles.samples = int(a[1])
if len(a) > 2: s.render.resolution_percentage = int(a[2])
if len(a) > 3:
    s.camera = bpy.data.objects[a[3]]
hero = s.camera.name == 'Reference camera'
for o in bpy.data.objects:            # the hero set is dressed for one viewpoint only
    if o.name in ('Studio floor', 'Floor wash') or o.name.startswith('Underglow'): o.hide_render = not hero
    if o.name == 'Studio floor (other views)': o.hide_render = hero
if not hero:
    for nm, k in (('Key left', .45), ('Rim right', .8), ('Front fill', 2.2), ('Back', 2.0)):
        bpy.data.objects[nm].data.energy *= k
if not hero:
    bpy.data.objects['Key left'].light_linking.receiver_collection = bpy.data.collections['BIOCANARY device']
if 'transparent' in a:                # cut-out for the web
    s.render.film_transparent = True
    for o in bpy.data.objects:
        if o.name.startswith(('Studio floor', 'Floor wash', 'Contact shadow', 'Underglow')): o.hide_render = True
    s.compositing_node_group = None
s.render.filepath = a[0]
bpy.ops.render.render(write_still=True)
