import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Parts that can be selected, and the point each marker sits on (metres, Y up). */
export const PARTS = ['reference', 'test', 'lines', 'panel'] as const
export type Part = (typeof PARTS)[number]
export type View = 'front' | 'left' | 'right' | 'rear' | Part
export type Lamp = 'off' | 'on' | 'warning' | 'critical'
export interface Lamps {
  wifi: Lamp
  cloud: Lamp
  status: Lamp
}

const ANCHOR: Record<Part, [number, number, number]> = {
  reference: [-0.144, 0.332, 0.005],
  test: [0.037, 0.332, 0.005],
  lines: [0.07, 0.452, -0.085],
  panel: [0.172, 0.308, -0.078],
}
/** target, azimuth and elevation in degrees, distance in metres */
const VIEWS: Record<View, [[number, number, number], number, number, number]> = {
  front: [[0.0, 0.215, -0.06], 15, 7, 1.26],
  left: [[0.0, 0.212, -0.06], -42, 14, 1.4],
  right: [[0.0, 0.212, -0.06], 52, 12, 1.4],
  rear: [[0.0, 0.212, -0.06], 160, 14, 1.4],
  reference: [[-0.13, 0.222, -0.06], 8, 7, 0.82],
  test: [[0.05, 0.222, -0.06], 12, 7, 0.82],
  lines: [[-0.04, 0.35, -0.07], 16, 20, 0.92],
  panel: [[0.13, 0.222, -0.08], 26, 6, 0.8],
}
const LAMP: Record<Lamp, string> = { off: '#3b4754', on: '#35c8fa', warning: '#ffb020', critical: '#ff4d43' }

function glass(o: { tint: string; rim: string; base: number; edge: number; power: number; spec?: number }) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      tint: { value: new THREE.Color(o.tint) },
      rim: { value: new THREE.Color(o.rim) },
      k: { value: new THREE.Vector4(o.base, o.edge, o.power, o.spec ?? 0.5) },
      power: { value: 1 },
    },
    vertexShader: `varying vec3 n; varying vec3 v;
      void main(){ vec4 p = modelViewMatrix * vec4(position,1.); n = normalize(normalMatrix*normal); v = normalize(-p.xyz); gl_Position = projectionMatrix*p; }`,
    fragmentShader: `uniform vec3 tint; uniform vec3 rim; uniform vec4 k; uniform float power; varying vec3 n; varying vec3 v;
      void main(){
        vec3 N = normalize(n); vec3 V = normalize(v);
        float f = pow(1.-abs(dot(N,V)), k.z);
        float s = pow(max(dot(reflect(-normalize(vec3(-.55,.6,.6)),N),V),0.),48.)*k.w + pow(max(dot(reflect(-normalize(vec3(.8,.5,.35)),N),V),0.),80.)*k.w*.5;
        float a = clamp(k.x + k.y*f*power + s, 0., 1.);
        gl_FragColor = vec4(mix(mix(tint,rim,f), vec3(1.), clamp(s,0.,1.)), a);
        #include <colorspace_fragment>
      }`,
  })
}

function liquid(deep: string, bright: string, y0: number, y1: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { deep: { value: new THREE.Color(deep) }, bright: { value: new THREE.Color(bright) }, y: { value: new THREE.Vector2(y0, y1) }, power: { value: 1 } },
    vertexShader: `varying vec3 n; varying vec3 v; varying float h;
      void main(){ vec4 p = modelViewMatrix * vec4(position,1.); h = (modelMatrix*vec4(position,1.)).y; n = normalize(normalMatrix*normal); v = normalize(-p.xyz); gl_Position = projectionMatrix*p; }`,
    fragmentShader: `uniform vec3 deep; uniform vec3 bright; uniform vec2 y; uniform float power; varying vec3 n; varying vec3 v; varying float h;
      void main(){
        float f = pow(1.-abs(dot(normalize(n),normalize(v))), 2.2);
        float low = pow(1.-clamp((h-y.x)/(y.y-y.x),0.,1.), 4.);
        float g = clamp(f*.8 + low*.95, 0., 1.)*power;
        gl_FragColor = vec4(mix(deep,bright,g), clamp(.62 + f*.22 + low*.3, 0., .97));
        #include <colorspace_fragment>
      }`,
  })
}

/** Bubbles rise through the vessel: round sprites drawn as bright rings. */
function bubbles(cx: number, color: string, count = 260) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 3)
  let r = 7 + Math.round(cx * 100)
  const rnd = () => ((r = (r * 16807) % 2147483647) & 0xffff) / 0xffff
  for (let i = 0; i < 12; i++) rnd()
  for (let i = 0; i < count; i++) {
    const centre = i < count * 0.22
    const rad = (centre ? 0.012 : 0.056) * Math.sqrt(rnd())
    const a = rnd() * Math.PI * 2
    pos.set([cx + rad * Math.cos(a), 0, -0.0735 + rad * Math.sin(a)], i * 3)
    seed.set([rnd(), 0.035 + rnd() * 0.06, 0.9 + rnd() * rnd() * 3.4], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 3))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0.2, -0.0735), 0.15)
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { t: { value: 0 }, scale: { value: 1 }, color: { value: new THREE.Color(color) }, power: { value: 1 } },
    vertexShader: `attribute vec3 seed; uniform float t; uniform float scale; varying float fade;
      void main(){
        float k = fract(seed.x + t*seed.y/.14);
        k = k*k*.35 + k*.65;                       // slow near the floor, where most of them gather
        vec3 p = position; p.y = .134 + k*.134;
        p.x += sin(t*1.7+seed.x*40.)*.0012; p.z += cos(t*1.4+seed.x*31.)*.0012;
        vec4 mv = modelViewMatrix*vec4(p,1.);
        fade = smoothstep(0.,.03,k)*(1.-smoothstep(.9,1.,k))*(1.-.55*k);
        gl_PointSize = max(2., seed.z*.0021*scale/-mv.z); gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float power; varying float fade;
      void main(){
        float d = length(gl_PointCoord-.5)*2.;
        float ring = smoothstep(1.,.86,d)*smoothstep(.5,.84,d);
        float glint = smoothstep(.34,.0,length(gl_PointCoord-vec2(.36,.34)));
        float a = (ring + glint*.7 + .05*step(d,1.))*fade*power;
        if(a<.01) discard;
        gl_FragColor = vec4(color*a, a);
        #include <colorspace_fragment>
      }`,
  })
  const points = new THREE.Points(g, m)
  points.renderOrder = 3
  return points
}

function shellMaterial() {
  // The satin bezel between the fascia and the white rim, in the same terms as device3d/housing.py.
  const m = new THREE.MeshStandardMaterial({ color: '#e3e6f0', roughness: 0.38 })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 wp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nwp = (modelMatrix*vec4(position,1.)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 wp;
        float rint2(float a,float b,float r){ vec2 u=max(vec2(r+a,r+b),0.); return min(-r,max(a,b))+length(u); }
        float bezel(){
          vec3 p = vec3(wp.x,-wp.z,wp.y)/0.0005;
          float c = rint2(rint2(226.-p.z,(p.y-134.)*.64279-(p.z-284.)*.76604,70.),p.y-166.,36.);
          float right = (p.x-321.6)*.90631-(p.y+40.)*.42262;
          return min(min(min(c-1.1,12.5-c),p.x-270.),min(-3.-right,621.-p.z));
        }`,
      )
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat bz = bezel(); float bw = fwidth(bz); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.16,.19,.22), smoothstep(-bw,bw,bz));')
  }
  return m
}

function glowTexture(stops: [number, string][]) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128)
  for (const [at, col] of stops) g.addColorStop(at, col)
  x.fillStyle = g
  x.fillRect(0, 0, 256, 256)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface SceneOptions {
  canvas: HTMLCanvasElement
  dark: boolean
  still: boolean
  onFrame: (project: (p: Part) => { x: number; y: number; shown: boolean }) => void
  onLost: () => void
}

export class DeviceScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(24, 1, 0.05, 10)
  private controls: OrbitControls
  private root = new THREE.Group()
  private lamps: Partial<Record<keyof Lamps, THREE.MeshBasicMaterial[]>> = {}
  private glowing: { m: THREE.MeshBasicMaterial; on: THREE.Color }[] = []
  private animated: THREE.ShaderMaterial[] = []
  private lit: THREE.ShaderMaterial[] = []
  private power = 1
  private goal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null
  private view: View = 'front'
  private visible = true
  private dirty = true
  private raf = 0
  private last = 0
  private clock = 0
  private watch: ResizeObserver
  private seen: IntersectionObserver
  private o: SceneOptions
  private gone = false

  constructor(o: SceneOptions) {
    this.o = o
    const r = new THREE.WebGLRenderer({ canvas: o.canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.toneMapping = THREE.NoToneMapping
    this.renderer = r
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.03).texture
    this.scene.environmentIntensity = 0.5
    pm.dispose()
    const key = new THREE.DirectionalLight('#ffffff', 0.85)
    key.position.set(-1.4, 1.1, 1)
    const rim = new THREE.DirectionalLight('#dfe7ff', 0.55)
    rim.position.set(1.6, 0.8, 0.3)
    const back = new THREE.DirectionalLight('#f2f5ff', 0.75)
    back.position.set(0.5, 0.9, -1.6)
    this.scene.add(key, rim, back, this.root)

    this.controls = new OrbitControls(this.camera, o.canvas)
    Object.assign(this.controls, { enableZoom: false, enablePan: false, enableDamping: !o.still, dampingFactor: 0.08, minPolarAngle: 0.75, maxPolarAngle: 1.62, rotateSpeed: 0.7 })
    o.canvas.style.touchAction = 'pan-y' // leave vertical swipes to the page
    this.controls.addEventListener('change', () => (this.dirty = true))
    this.controls.addEventListener('start', () => (this.goal = null))
    this.jump('front')

    this.watch = new ResizeObserver(() => this.resize())
    this.watch.observe(o.canvas.parentElement!)
    this.seen = new IntersectionObserver(([e]) => (this.visible = e.isIntersecting))
    this.seen.observe(o.canvas)
    o.canvas.addEventListener('webglcontextlost', this.lost)
    this.resize()
    this.raf = requestAnimationFrame(this.frame)
  }

  private lost = (e: Event) => {
    e.preventDefault()
    this.o.onLost()
  }

  async load(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url)
    if (this.gone) return
    const line = this.o.dark ? '#dfe9ff' : '#4a5c8c'
    const cache = new Map<string, THREE.Material>()
    gltf.scene.traverse((n) => {
      const mesh = n as THREE.Mesh
      if (!mesh.isMesh) return
      let host: THREE.Object3D = mesh
      while (host.parent && !host.name.includes('__')) host = host.parent
      const [group, raw = ''] = host.name.split('__')
      const name = raw.replaceAll('_', ' ')
      const [m, order] = this.material(group, name, mesh.material as THREE.MeshStandardMaterial, line, cache)
      mesh.material = m
      mesh.renderOrder = order
    })
    this.root.add(gltf.scene)
    const a = bubbles(-0.144, '#c6efff')
    const b = bubbles(0.037, '#cfffe0')
    this.animated.push(a.material as THREE.ShaderMaterial, b.material as THREE.ShaderMaterial)
    this.lit.push(...this.animated)
    this.root.add(a, b)

    const flat = (w: number, d: number, t: THREE.Texture, x: number, z: number, blending: THREE.Blending, opacity = 1) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending, opacity }))
      p.rotation.x = -Math.PI / 2
      p.position.set(x, 0.0012, z)
      p.renderOrder = -1
      this.root.add(p)
    }
    const shade = this.o.dark ? 0.75 : 0.4
    flat(0.86, 0.5, glowTexture([[0, `rgba(8,18,44,${shade})`], [0.55, `rgba(8,18,44,${shade * 0.75})`], [0.8, `rgba(8,18,44,${shade * 0.16})`], [1, 'rgba(8,18,44,0)']]), 0, -0.07, THREE.NormalBlending)
    flat(0.4, 0.13, glowTexture([[0, 'rgba(70,160,255,.55)'], [0.5, 'rgba(70,160,255,.18)'], [1, 'rgba(70,160,255,0)']]), -0.02, 0.085, THREE.NormalBlending)
    this.resize()
    this.setActive(this.power > 0.5)
  }

  private material(group: string, name: string, src: THREE.MeshStandardMaterial, line: string, cache: Map<string, THREE.Material>): [THREE.Material, number] {
    if (group === 'wifi' || group === 'cloud' || group === 'status') {
      const m = new THREE.MeshBasicMaterial({ color: LAMP.off, side: THREE.DoubleSide })
      ;(this.lamps[group] ??= []).push(m)
      return [m, 0]
    }
    const is = (...p: string[]) => p.some((x) => name.startsWith(x))
    const once = (make: () => THREE.Material) => {
      if (!cache.has(name)) cache.set(name, make())
      return cache.get(name)!
    }
    const blue = name.endsWith('blue')
    const hue = blue ? '#59c4ff' : '#4fee90'
    const glow = (make: () => THREE.ShaderMaterial) =>
      once(() => {
        const m = make()
        this.lit.push(m)
        return m
      })
    if (is('Enclosure white and bezel')) return [once(shellMaterial), 0]
    if (is('Enclosure white')) return [once(() => new THREE.MeshStandardMaterial({ color: '#e3e6f0', roughness: 0.38, side: THREE.DoubleSide })), 0]
    if (is('Culture medium')) return [glow(() => (blue ? liquid('#4b8fe4', '#b4ecff', 0.128, 0.272) : liquid('#3fae77', '#b0ffce', 0.128, 0.272))), 2]
    if (is('Vessel glass')) return [glow(() => glass({ tint: hue, rim: blue ? '#8fe2ff' : '#86ffb4', base: 0.05, edge: 0.95, power: 2.6, spec: 0.35 })), 4]
    if (is('Sleeve', 'Sheath')) return [once(() => glass({ tint: '#ffffff', rim: hue, base: 0.02, edge: 0.16, power: 3, spec: 0.25 })), 5]
    if (is('Acrylic lit', 'Chamber wall')) return [once(() => glass({ tint: '#ffffff', rim: hue, base: 0.03, edge: 0.14, power: 3, spec: 0.16 })), 6]
    if (is('Acrylic edge')) return [once(() => glass({ tint: blue ? '#e6eeff' : '#e6fbee', rim: blue ? '#7fa6f2' : '#73cf9c', base: 0.3, edge: 0.5, power: 1.6, spec: 0.9 })), 7]
    if (is('Edge light')) return [once(() => glass({ tint: '#ffffff', rim: hue, base: 0.5, edge: 0.3, power: 1 })), 7]
    if (is('LED lens')) return [glow(() => glass({ tint: hue, rim: hue, base: 0.34, edge: 0.4, power: 2 })), 7]
    if (is('Gauge fluid')) return [once(() => glass({ tint: '#ffffff', rim: line, base: 0.05, edge: 0.4, power: 2 })), 7]
    if (is('Clear', 'Column shell', 'Gauge')) return [once(() => glass({ tint: '#f4f7ff', rim: line, base: 0.08, edge: name === 'Column shell' ? 0.42 : 0.85, power: 1.8, spec: 0.85 })), name.startsWith('Column') ? 9 : 8]
    if (src.userData.kind === 'glow') {
      if (is('Label lettering')) return [once(() => new THREE.MeshBasicMaterial({ color: '#f4f8ff', side: THREE.DoubleSide })), 0]
      return [
        once(() => {
          const on = src.color.clone()
          if (is('LED')) on.set(blue ? '#e2f6ff' : '#e0ffec')
          const m = new THREE.MeshBasicMaterial({ color: on, side: THREE.DoubleSide })
          this.glowing.push({ m, on })
          return m
        }),
        is('Vessel', 'Meniscus', 'LED') ? 3 : 0,
      ]
    }
    return [
      once(() => {
        const m = new THREE.MeshStandardMaterial({ color: src.color, roughness: src.roughness, metalness: src.metalness, side: THREE.DoubleSide })
        if (is('Moulded', 'Rubber', 'Probe')) Object.assign(m, { roughness: 0.34, color: new THREE.Color(is('Probe') ? (name.includes('blue') ? '#0a1233' : '#0a1712') : '#101319') })
        if (is('Smoked')) Object.assign(m, { roughness: 0.28, color: new THREE.Color('#10161e') })
        if (is('Plinth')) m.color.set('#1b2029')
        if (is('Light base')) {
          m.emissive.set(blue ? '#0a3fd0' : '#0f8f48')
          m.emissiveIntensity = 0.7
        }
        if (is('Label', 'Brand')) m.roughness = 0.7
        m.envMapIntensity = is('Moulded', 'Rubber', 'Probe', 'Plinth') ? 0.55 : 1
        return m
      }),
      0,
    ]
  }

  setLamps(l: Lamps) {
    for (const k of ['wifi', 'cloud', 'status'] as const) for (const m of this.lamps[k] ?? []) m.color.set(k === 'status' && l[k] === 'on' ? '#35e884' : LAMP[l[k]])
    this.dirty = true
  }

  /** Unlit when no device is reporting. */
  setActive(on: boolean) {
    this.power = on ? 1 : 0
    for (const m of this.lit) if (m.uniforms.power) m.uniforms.power.value = on ? 1 : 0.12
    for (const { m, on: c } of this.glowing) m.color.copy(c).multiplyScalar(on ? 1 : 0.28)
    this.dirty = true
  }

  private place(v: View) {
    const [t, az, el, d] = VIEWS[v]
    const aspect = this.camera.aspect || 1.5
    const fit = d * Math.max(1, 1.38 / aspect)
    const a = THREE.MathUtils.degToRad(az)
    const e = THREE.MathUtils.degToRad(el)
    const target = new THREE.Vector3(...t)
    return { target, pos: target.clone().add(new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(fit)) }
  }

  private jump(v: View) {
    this.view = v
    const { pos, target } = this.place(v)
    this.camera.position.copy(pos)
    this.controls.target.copy(target)
    this.controls.update()
    this.dirty = true
  }

  setView(v: View) {
    if (this.o.still) return this.jump(v)
    this.view = v
    this.goal = this.place(v)
  }

  private resize() {
    const box = this.o.canvas.parentElement!.getBoundingClientRect()
    if (!box.width || !box.height) return
    this.renderer.setSize(box.width, box.height, false)
    this.camera.aspect = box.width / box.height
    this.camera.updateProjectionMatrix()
    for (const m of this.animated) m.uniforms.scale.value = (box.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(12)))
    this.jump(this.view)
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now
    if (!this.visible || document.hidden) return
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 5)
      // swing round the device rather than through it
      const s = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target))
      const g = new THREE.Spherical().setFromVector3(this.goal.pos.clone().sub(this.goal.target))
      let dθ = g.theta - s.theta
      if (dθ > Math.PI) dθ -= Math.PI * 2
      if (dθ < -Math.PI) dθ += Math.PI * 2
      s.set(s.radius + (g.radius - s.radius) * k, s.phi + (g.phi - s.phi) * k, s.theta + dθ * k)
      this.controls.target.lerp(this.goal.target, k)
      this.camera.position.setFromSpherical(s).add(this.controls.target)
      if (Math.abs(dθ) < 0.002 && this.controls.target.distanceTo(this.goal.target) < 0.001 && Math.abs(g.radius - s.radius) < 0.002) this.goal = null
      this.dirty = true
    }
    this.controls.update()
    if (!this.o.still && this.power) {
      this.clock += dt
      for (const m of this.animated) m.uniforms.t.value = this.clock
      if (this.animated.length) this.dirty = true
    }
    if (!this.dirty) return
    this.dirty = false
    this.renderer.render(this.scene, this.camera)
    const el = this.o.canvas
    const away = this.camera.position.clone().sub(this.controls.target)
    this.o.onFrame((p) => {
      const q = new THREE.Vector3(...ANCHOR[p]).project(this.camera)
      return { x: ((q.x + 1) / 2) * el.clientWidth, y: ((1 - q.y) / 2) * el.clientHeight, shown: p === 'lines' || away.z > 0.35 * Math.abs(away.x) }
    })
  }

  dispose() {
    this.gone = true
    cancelAnimationFrame(this.raf)
    this.watch.disconnect()
    this.seen.disconnect()
    this.o.canvas.removeEventListener('webglcontextlost', this.lost)
    this.controls.dispose()
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh
      m.geometry?.dispose()
      for (const x of [m.material].flat()) (x as THREE.Material | undefined)?.dispose()
    })
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss() // browsers allow only a few live contexts
  }
}
