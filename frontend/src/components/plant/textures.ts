import * as THREE from 'three'

/**
 * Procedural textures for the plant, drawn on canvases at load time so the scene needs no image
 * files. Everything tiles; normal maps are derived from the same height data.
 */

type Ctx = CanvasRenderingContext2D

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function canvas(w: number, h = w): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d', { willReadFrequently: true })!]
}

/** Soft round patches, drawn wrapped so the result tiles. */
function blotches(ctx: Ctx, w: number, h: number, n: number, colors: string[], r0: number, r1: number, alpha: number, rand: () => number) {
  for (let i = 0; i < n; i++) {
    const x = rand() * w
    const y = rand() * h
    const r = r0 + rand() * (r1 - r0)
    const c = colors[Math.floor(rand() * colors.length)]
    for (const dx of [-w, 0, w])
      for (const dy of [-h, 0, h]) {
        if (x + dx + r < 0 || x + dx - r > w || y + dy + r < 0 || y + dy - r > h) continue
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        g.addColorStop(0, c)
        g.addColorStop(1, 'transparent')
        ctx.globalAlpha = alpha * (0.5 + rand() * 0.5)
        ctx.fillStyle = g
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
  }
  ctx.globalAlpha = 1
}

/** Per-pixel brightness grain. */
function grain(ctx: Ctx, w: number, h: number, amount: number, rand: () => number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = (rand() - 0.5) * amount
    d[i] += v
    d[i + 1] += v
    d[i + 2] += v
  }
  ctx.putImageData(img, 0, 0)
}

/** Tangent-space normal map from a canvas's brightness. */
function normalFrom(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  const s = src.getContext('2d')!.getImageData(0, 0, w, h).data
  const [c, ctx] = canvas(w, h)
  const out = ctx.createImageData(w, h)
  const at = (x: number, y: number) => {
    const i = (((y + h) % h) * w + ((x + w) % w)) * 4
    return (s[i] + s[i + 1] + s[i + 2]) / 765
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const n = new THREE.Vector3(-dx, -dy, 1).normalize()
      const i = (y * w + x) * 4
      out.data[i] = (n.x * 0.5 + 0.5) * 255
      out.data[i + 1] = (n.y * 0.5 + 0.5) * 255
      out.data[i + 2] = (n.z * 0.5 + 0.5) * 255
      out.data[i + 3] = 255
    }
  ctx.putImageData(out, 0, 0)
  return c
}

function tex(c: HTMLCanvasElement, repeat: [number, number] = [1, 1], color = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(...repeat)
  t.anisotropy = 8
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface Surface {
  map: THREE.Texture
  normalMap?: THREE.Texture
  roughnessMap?: THREE.Texture
}

/** Mown grass with stripes, clover patches and worn spots. World UVs: one tile is `size` metres. */
export function grass(size: number, tint = '#4c7a37', seed = 3): Surface {
  const n = 512
  const rand = rng(seed)
  const [c, ctx] = canvas(n)
  ctx.fillStyle = tint
  ctx.fillRect(0, 0, n, n)
  blotches(ctx, n, n, 160, ['#4a6438', '#667f4a', '#748a52', '#425a33', '#837f55'], 20, 90, 0.4, rand)
  blotches(ctx, n, n, 50, ['#8a8f4f', '#6d7a3f'], 8, 30, 0.25, rand)
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,230,0.02)' : 'rgba(0,30,0,0.02)'
    ctx.fillRect(0, (i * n) / 8, n, n / 8)
  }
  grain(ctx, n, n, 34, rand)
  const t = tex(c, [1 / size, 1 / size])
  const nm = tex(normalFrom(c, 2.2), [1 / size, 1 / size], false)
  return { map: t, normalMap: nm }
}

/** Ploughed or cropped field rows, for the farmland around the site. */
export function field(base: string, row: string, seed: number): Surface {
  const n = 256
  const rand = rng(seed)
  const [c, ctx] = canvas(n)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, n, n)
  blotches(ctx, n, n, 40, [row, base, '#8b8a4e'], 20, 70, 0.3, rand)
  ctx.globalAlpha = 0.22
  ctx.fillStyle = row
  for (let x = 0; x < n; x += 8) ctx.fillRect(x, 0, 3, n)
  ctx.globalAlpha = 1
  grain(ctx, n, n, 22, rand)
  return { map: tex(c), normalMap: tex(normalFrom(c, 1.6), [1, 1], false) }
}

/** Weathered concrete: mottling, rain streaks, formwork joints. */
export function concrete(seed = 5, base = '#bfc3c9', joints = 4): Surface {
  const n = 512
  const rand = rng(seed)
  const [c, ctx] = canvas(n)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, n, n)
  blotches(ctx, n, n, 120, ['#a9aeb5', '#d0d3d8', '#9fa39f', '#c8c4ba'], 10, 70, 0.35, rand)
  ctx.globalAlpha = 0.07
  for (let i = 0; i < 70; i++) {
    const x = rand() * n
    ctx.fillStyle = '#4a4e52'
    ctx.fillRect(x, rand() * n * 0.4, 1 + rand() * 3, 30 + rand() * 180)
  }
  ctx.globalAlpha = 0.22
  ctx.fillStyle = '#7d8187'
  for (let i = 1; i < joints; i++) {
    ctx.fillRect((i * n) / joints, 0, 2, n)
    ctx.fillRect(0, (i * n) / joints, n, 2)
  }
  ctx.globalAlpha = 1
  grain(ctx, n, n, 26, rand)
  return { map: tex(c), normalMap: tex(normalFrom(c, 1.4), [1, 1], false) }
}

/** Asphalt road strip: across U, along V. Edge lines and centre dashes. */
export function road(): Surface {
  const w = 256
  const h = 512
  const rand = rng(11)
  const [c, ctx] = canvas(w, h)
  ctx.fillStyle = '#4b4f56'
  ctx.fillRect(0, 0, w, h)
  blotches(ctx, w, h, 60, ['#3f434a', '#585c62', '#44474d'], 10, 50, 0.4, rand)
  grain(ctx, w, h, 40, rand)
  ctx.fillStyle = 'rgba(235,235,225,0.75)'
  ctx.fillRect(10, 0, 5, h)
  ctx.fillRect(w - 15, 0, 5, h)
  ctx.fillStyle = 'rgba(240,240,230,0.7)'
  for (let y = 0; y < h; y += 128) ctx.fillRect(w / 2 - 3, y, 6, 64)
  return { map: tex(c), normalMap: tex(normalFrom(c, 1.2), [1, 1], false) }
}

/** Plain asphalt for yards and parking. */
export function asphalt(): Surface {
  const n = 256
  const rand = rng(17)
  const [c, ctx] = canvas(n)
  ctx.fillStyle = '#50545b'
  ctx.fillRect(0, 0, n, n)
  blotches(ctx, n, n, 40, ['#45494f', '#5c6066'], 10, 40, 0.4, rand)
  grain(ctx, n, n, 40, rand)
  return { map: tex(c), normalMap: tex(normalFrom(c, 1.2), [1, 1], false) }
}

/** Ripples for water surfaces; scroll the offset to animate. Built from integer-frequency waves so it tiles. */
export function ripples(seed = 23): THREE.Texture {
  const n = 256
  const rand = rng(seed)
  const [c, ctx] = canvas(n)
  const img = ctx.createImageData(n, n)
  const waves = Array.from({ length: 14 }, () => ({ kx: Math.round((rand() - 0.5) * 16), ky: Math.round((rand() - 0.5) * 16), p: rand() * Math.PI * 2, a: 0.4 + rand() }))
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0
      for (const w of waves) v += Math.sin(((w.kx * x + w.ky * y) / n) * Math.PI * 2 + w.p) * w.a
      const g = 128 + v * 9
      const i = (y * n + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = g
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  return tex(normalFrom(c, 3), [1, 1], false)
}

/** Corrugated metal roofing: ribs across U. */
export function corrugated(base = '#d6dbe2'): Surface {
  const w = 256
  const h = 64
  const rand = rng(29)
  const [c, ctx] = canvas(w, h)
  for (let x = 0; x < w; x++) {
    const v = Math.sin((x / w) * Math.PI * 2 * 16)
    const l = 200 + v * 40
    ctx.fillStyle = `rgb(${l},${l},${l})`
    ctx.fillRect(x, 0, 1, h)
  }
  const height = normalFrom(c, 4)
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = 'source-over'
  blotches(ctx, w, h, 20, ['#a8a59a', '#c2c6cc'], 6, 24, 0.25, rand)
  return { map: tex(c), normalMap: tex(height, [1, 1], false) }
}

/** Steel panels with seams, for digester domes and tanks (U runs around). */
export function panels(base = '#b8c0cb', count = 24): Surface {
  const w = 1024
  const h = 256
  const rand = rng(31)
  const [c, ctx] = canvas(w, h)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `rgba(${rand() > 0.5 ? '255,255,255' : '40,50,60'},${0.03 + rand() * 0.06})`
    ctx.fillRect((i * w) / count, 0, w / count, h)
  }
  blotches(ctx, w, h, 40, ['#8f9488', '#d6dae0'], 10, 50, 0.2, rand)
  ctx.fillStyle = 'rgba(40,46,56,0.55)'
  for (let i = 0; i < count; i++) ctx.fillRect((i * w) / count, 0, 2, h)
  ctx.fillRect(0, h * 0.5, w, 2)
  grain(ctx, w, h, 14, rand)
  return { map: tex(c), normalMap: tex(normalFrom(c, 2), [1, 1], false) }
}

/** A building facade: wall cladding with rows of windows and a door. Glass is a separate emissive map. */
export function facade(o: { cols: number; rows: number; door?: boolean; wall?: string; lit?: boolean; seed?: number }): Surface & { emissiveMap: THREE.Texture } {
  const w = 512
  const h = 256
  const rand = rng(o.seed ?? 37)
  const [c, ctx] = canvas(w, h)
  const [e, ectx] = canvas(w, h)
  ctx.fillStyle = o.wall ?? '#d9dce1'
  ctx.fillRect(0, 0, w, h)
  ectx.fillStyle = '#000'
  ectx.fillRect(0, 0, w, h)
  // horizontal cladding lines
  ctx.fillStyle = 'rgba(0,0,0,0.07)'
  for (let y = 0; y < h; y += 16) ctx.fillRect(0, y, w, 1)
  blotches(ctx, w, h, 30, ['#b9bcc0', '#eef0f2'], 10, 60, 0.25, rand)
  ctx.fillStyle = 'rgba(60,64,70,0.35)'
  ctx.fillRect(0, h - 14, w, 14) // plinth
  const cw = w / o.cols
  const rh = (h - 30) / o.rows
  for (let r = 0; r < o.rows; r++)
    for (let k = 0; k < o.cols; k++) {
      if (o.door && r === o.rows - 1 && k === Math.floor(o.cols / 2)) {
        ctx.fillStyle = '#4a5260'
        ctx.fillRect(k * cw + cw * 0.25, h - 14 - rh * 0.85, cw * 0.5, rh * 0.85)
        continue
      }
      const x = k * cw + cw * 0.18
      const y = 12 + r * rh + rh * 0.2
      const ww = cw * 0.64
      const hh = rh * 0.55
      ctx.fillStyle = '#5d6672'
      ctx.fillRect(x - 3, y - 3, ww + 6, hh + 6)
      const g = ctx.createLinearGradient(x, y, x, y + hh)
      g.addColorStop(0, '#9fb6cc')
      g.addColorStop(1, '#3c4b5e')
      ctx.fillStyle = g
      ctx.fillRect(x, y, ww, hh)
      if (o.lit && rand() > 0.35) {
        ectx.fillStyle = `rgba(255,${200 + rand() * 30},${140 + rand() * 40},${0.5 + rand() * 0.5})`
        ectx.fillRect(x, y, ww, hh)
      }
    }
  grain(ctx, w, h, 12, rand)
  return { map: tex(c), normalMap: tex(normalFrom(c, 1.2), [1, 1], false), emissiveMap: tex(e) }
}

/** Leafy canopy texture for tree crowns. */
export function leaves(): Surface {
  const n = 256
  const rand = rng(41)
  const [c, ctx] = canvas(n)
  ctx.fillStyle = '#7d8f6a'
  ctx.fillRect(0, 0, n, n)
  blotches(ctx, n, n, 400, ['#56684a', '#9aae84', '#6f8260', '#b8c79a', '#46573c'], 3, 12, 0.7, rand)
  grain(ctx, n, n, 30, rand)
  return { map: tex(c, [2, 2]), normalMap: tex(normalFrom(c, 3), [2, 2], false) }
}

/** Chain-link mesh as an alpha map. */
export function chainLink(): THREE.Texture {
  const n = 64
  const [c, ctx] = canvas(n)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, n, n)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(n, n)
  ctx.moveTo(n, 0)
  ctx.lineTo(0, n)
  ctx.stroke()
  return tex(c, [1, 1], false)
}
