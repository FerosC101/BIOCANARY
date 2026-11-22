# BIOCANARY device model

3D model of the benchtop device, built in Blender 5.2 to match `reference.png`.

| File | What it is |
| --- | --- |
| `biocanary_device.blend` | Full scene: device, materials, studio lighting, eight cameras |
| `biocanary_device.glb` | Device only, for web or AR. Simplified materials, no studio |
| `export_web.py`, `optimize_web.mjs` | Make `frontend/public/device/device.glb`, the light copy the web app loads |
| `renders/` | `hero.png` (the reference view, 3072 x 2048), other angles, `comparison.png`, `overlay.png` |
| `build_device.py` | Rebuilds the `.blend` from scratch |
| `camera.py` | Camera recovered from the reference, and pixel-to-3D projection |
| `housing.py` | Enclosure, fascia and plinth surfaces |
| `kit.py`, `materials.py` | Modelling helpers and Cycles materials |

## Rebuild and render

    BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
    $BLENDER -b --factory-startup -P build_device.py -- biocanary_device.blend --voxel 2.2
    $BLENDER -b biocanary_device.blend -P render.py -- renders/hero.png 300 200
    $BLENDER -b biocanary_device.blend -P render.py -- renders/rear.png 96 100 "Rear camera"
    $BLENDER -b biocanary_device.blend -P export_glb.py -- biocanary_device.glb

For the web app (the viewer is `frontend/src/components/device/scene.ts`):

    $BLENDER -b biocanary_device.blend -P export_web.py -- ../frontend/public/device/device.glb
    node optimize_web.mjs ../frontend/public/device/device.glb
    $BLENDER -b biocanary_device.blend -P render.py -- poster.png 128 100 "Reference camera" transparent

Convert `poster.png` to `frontend/public/device/device.webp`; it is shown while the model loads and when WebGL is unavailable.

Use absolute output paths if you run these from another folder. The first GPU render on a
machine compiles kernels and can take ten minutes or more; later ones take seconds to a few minutes.

## Scale and structure

1 reference pixel = 0.5 mm, chosen so the device is a plausible benchtop size
(about 562 x 247 x 465 mm including tubing). **No real dimension was supplied**; change `P` in
`camera.py` to rescale. Collections follow the device description: Enclosure, Status panel,
Branding, Reference chamber, Test chamber, Level columns, Tubing.

## What is and is not from the reference

- Everything visible in the reference is placed from its pixel position.
- The reference does not obey a single perspective (its chambers and housing imply different
  vanishing points), so depths are the best consistent fit. The flared side wall is part of that fit.
- Not visible in the reference, so assumed: the back (vents, power, Ethernet, three fluid
  connectors), the left side, all depths, and the second rear level column.
- The front carries the official logo from `docs/brand/biocanary-logo.svg`. The reference image shows a
  slightly different bird; the brand file takes precedence.
- Blue and green lighting is visual only and does not represent microbial health.
- This is a visual model, not manufacturing CAD: no wall thicknesses, seals, threads or tolerances.

Fonts: Figtree (SIL Open Font License, `fonts/OFL.txt`).
