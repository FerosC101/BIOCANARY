// node optimize_web.mjs ../frontend/public/device/device.glb
// Needs: npm i --no-save @gltf-transform/core @gltf-transform/functions @gltf-transform/extensions
// Quantises only (no Draco or Meshopt), so the browser needs no WebAssembly decoder.
import { NodeIO } from '@gltf-transform/core'
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, quantize, weld } from '@gltf-transform/functions'

const file = process.argv[2]
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS)
const doc = await io.read(file)
await doc.transform(dedup(), weld(), prune({ keepExtras: true }), quantize({ quantizePosition: 15, quantizeNormal: 10 }))
await io.write(file, doc)
