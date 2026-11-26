import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { asphalt, chainLink, concrete, corrugated, facade, field, grass, leaves, panels, ripples, road, type Surface } from './textures'

/**
 * An illustrative treatment plant, built procedurally (metres, Y up, inflow at the north, -Z).
 * Layout follows the usual order: inlet works, equalisation, primary settling, aeration hall,
 * secondary clarifiers, outfall to the river. BIOCANARY units sit beside the inflows.
 */

export type Anchor =
  | 'inlet'
  | 'eq'
  | 'industrial'
  | 'lab'
  | 'hub'
  | 'u-inlet'
  | 'u-eq'
  | 'u-primary'
  | 'u-aeration'
  | 'u-clarifier'
  | 'u-digesters'
  | 'u-control'
  | 'u-river'
export const STATION_SLOTS = ['inlet', 'eq', 'industrial', 'lab'] as const
export type Slot = (typeof STATION_SLOTS)[number]
export type Lamp = 'healthy' | 'warning' | 'critical' | 'offline' | 'pending'
export type ViewName = 'overview' | 'arrive' | 'sample' | 'device' | 'signal' | 'analyse' | 'alert'
export interface Emphasis {
  sewer: number
  industrial: number
  sample: number
  data: number
  alert: number
}

/** Where each BIOCANARY unit stands; its sample is drawn from the point beside it. */
const UNIT: Record<Slot, { at: [number, number]; face: number; from: [number, number] }> = {
  inlet: { at: [-33, -23.2], face: 0, from: [-33, -26] },
  eq: { at: [-10, -15.6], face: 0, from: [-10, -17.4] },
  industrial: { at: [-17.2, -44.8], face: -0.9, from: [-20.4, -45.6] },
  lab: { at: [-29.4, 24], face: Math.PI / 2, from: [-31, 24] },
}
/** Site boundary (lawn and fence). */
const SITE: [number, number][] = [
  [-56, -56],
  [56, -56],
  [68, -30],
  [68, 30],
  [40, 58],
  [-52, 58],
  [-58, 0],
]
const HUB: [number, number, number] = [16, 28, 0]
const CONTROL: [number, number] = [-36, 26]

const ANCHORS: Record<Anchor, [number, number, number]> = {
  inlet: [UNIT.inlet.at[0], 3.4, UNIT.inlet.at[1]],
  eq: [UNIT.eq.at[0], 3.4, UNIT.eq.at[1]],
  industrial: [UNIT.industrial.at[0], 3.4, UNIT.industrial.at[1]],
  lab: [UNIT.lab.at[0], 3.4, UNIT.lab.at[1]],
  hub: [HUB[0], HUB[1] + 3, HUB[2]],
  'u-inlet': [-42, 7, -36],
  'u-eq': [-10, 2.4, -26],
  'u-primary': [9, 5, -17],
  'u-aeration': [30, 8, -26],
  'u-clarifier': [40, 3.5, 6],
  'u-digesters': [-19, 8, 1],
  'u-control': [CONTROL[0] - 4, 6, CONTROL[1]],
  'u-river': [-63, 1.5, 6],
}

/** target, azimuth and elevation in degrees, distance */
const VIEWS: Record<ViewName, [[number, number, number], number, number, number]> = {
  overview: [[2, 0, -4], 22, 40, 142],
  arrive: [[-30, 0, -36], 32, 36, 58],
  sample: [[-33, 0.8, -24.6], 24, 22, 15],
  device: [[-33, 1.1, -23.4], 14, 14, 8.5],
  signal: [[-22, 0, -32], 46, 44, 62],
  analyse: [[-8, 9, -12], 18, 26, 118],
  alert: [[-20, 6, -2], -22, 32, 96],
}

const C = {
  bg: '#071733',
  ground: '#0f2b22',
  lawn: '#18402f',
  road: '#38425a',
  concrete: '#c4cad6',
  concreteDark: '#8d96a8',
  water: '#0c1d36',
  yellow: '#f0c23a',
  dome: '#aab4c4',
  roof: '#d9dee8',
  sewer: '#8FB6FF',
  industrial: '#C6B8FF',
  sample: '#A6F684',
  data: '#EAF2FF',
}
const LAMP: Record<Lamp, string> = { healthy: '#4FD96B', warning: '#FFB547', critical: '#FF6B5E', offline: '#3b4754', pending: '#9fb4da' }

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const path = (pts: [number, number][], y = 0.5) => new THREE.CatmullRomCurve3(pts.map(([x, z]) => v3(x, y, z)), false, 'centripetal')

function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

/** A flat strip following a curve, for roads and the river. */
function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, n = 240): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const len = curve.getLength()
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n)
    const t = curve.getTangentAt(i / n)
    const side = v3(-t.z, 0, t.x).normalize().multiplyScalar(width / 2)
    pos.push(p.x + side.x, p.y, p.z + side.z, p.x - side.x, p.y, p.z - side.z)
    const v = ((i / n) * len) / (width * 2)
    uv.push(0, v, 1, v)
    if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3) // counter-clockwise from above
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Soft round points, additive, so flows read as light moving through the plant. */
function glowPoints(count: number, color: string, size: number) {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { color: { value: new THREE.Color(color) }, size: { value: size }, scale: { value: 600 }, power: { value: 1 } },
    vertexShader: `uniform float size; uniform float scale; void main(){ vec4 p = modelViewMatrix*vec4(position,1.); gl_PointSize = size*scale/-p.z; gl_Position = projectionMatrix*p; }`,
    fragmentShader: `uniform vec3 color; uniform float power; void main(){ float d = length(gl_PointCoord-.5); float a = smoothstep(.5,.0,d); gl_FragColor = vec4(color*(.55+a), a*a*power); }`,
  })
  const p = new THREE.Points(g, m)
  p.frustumCulled = false
  return p
}

interface Flow {
  curve: THREE.Curve<THREE.Vector3>
  points: THREE.Points
  offsets: Float32Array
  speed: number
  length: number
  layer: keyof Emphasis
  /** How the layer's emphasis maps to brightness: some flows stay faintly visible at rest. */
  rest: number
}

export class PlantScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(38, 1.6, 1, 4000)
  private controls: OrbitControls
  private flows: Flow[] = []
  private bridges: THREE.Object3D[] = []
  private waterMaps: THREE.Texture[] = []
  private lamps: Partial<Record<Slot, THREE.MeshBasicMaterial[]>> = {}
  private halos: Partial<Record<Slot, THREE.Mesh>> = {}
  private links: { slot: Slot | 'control'; mesh: THREE.Mesh }[] = []
  private alertRing: THREE.Mesh
  private rings: Partial<Record<Slot, THREE.Mesh>> = {}
  private ringLevel: Partial<Record<Slot, number>> = {}
  private focusGoal: Slot | null = null
  private hub: THREE.Group
  private emphasis: Emphasis = { sewer: 1, industrial: 1, sample: 0.4, data: 0.4, alert: 0 }
  private reporting = new Set<Slot>()
  private goal: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null
  private view: ViewName = 'overview'
  private raf = 0
  private last = performance.now()
  private clock = 0
  private visible = true
  private watch: ResizeObserver
  private o: { canvas: HTMLCanvasElement; still: boolean; shift?: boolean; onFrame: (project: (a: Anchor) => { x: number; y: number; shown: boolean }) => void; onLost: () => void }

  constructor(o: PlantScene['o']) {
    this.o = o
    const r = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 0.68
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    this.renderer = r

    // Late-afternoon sky: physical sky dome, its reflection as the environment, a low warm sun.
    const sunDir = v3(-0.62, 0.3, 0.72).normalize()
    const sky = new Sky()
    sky.scale.setScalar(3500)
    const u = sky.material.uniforms
    u.turbidity.value = 5
    u.rayleigh.value = 1.4
    u.mieCoefficient.value = 0.005
    u.mieDirectionalG.value = 0.82
    u.sunPosition.value.copy(sunDir)
    this.scene.add(sky)
    const pm = new THREE.PMREMGenerator(r)
    const envScene = new THREE.Scene()
    const envSky = new Sky()
    envSky.scale.setScalar(100)
    Object.assign(envSky.material.uniforms.sunPosition.value, sunDir)
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) envSky.material.uniforms[k].value = u[k].value
    envScene.add(envSky)
    this.scene.environment = pm.fromScene(envScene, 0.04).texture
    this.scene.environmentIntensity = 0.16
    pm.dispose()
    this.scene.fog = new THREE.Fog('#c9ccc8', 320, 1400)

    const hemi = new THREE.HemisphereLight('#dfe8ff', '#4a5636', 0.55)
    const sun = new THREE.DirectionalLight('#ffd6a6', 6.5)
    sun.position.copy(sunDir).multiplyScalar(160)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 20, far: 400 })
    sun.shadow.camera.updateProjectionMatrix()
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.25
    this.scene.add(hemi, sun)

    this.build()
    this.alertRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: '#FFB547', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
    this.alertRing.rotation.x = -Math.PI / 2
    this.alertRing.position.set(CONTROL[0], 0.3, CONTROL[1])
    this.scene.add(this.alertRing)
    this.hub = this.buildHub()

    this.controls = new OrbitControls(this.camera, o.canvas)
    Object.assign(this.controls, { enableDamping: !o.still, dampingFactor: 0.07, minPolarAngle: 0.25, maxPolarAngle: 1.36, minDistance: 6, maxDistance: 230, enablePan: true, screenSpacePanning: false, rotateSpeed: 0.6, zoomSpeed: 0.8 })
    this.controls.addEventListener('start', () => (this.goal = null))
    this.jump('overview')

    this.watch = new ResizeObserver(() => this.resize())
    this.watch.observe(o.canvas.parentElement!)
    o.canvas.addEventListener('webglcontextlost', this.lost)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.resize()
    this.setEmphasis(this.emphasis)
    this.raf = requestAnimationFrame(this.frame)
  }

  private lost = (e: Event) => {
    e.preventDefault()
    this.o.onLost()
  }
  private onVisibility = () => (this.visible = !document.hidden)

  // ---- construction ------------------------------------------------------------------------

  private mat(color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o })
  }

  private add<T extends THREE.Object3D>(obj: T, shadow = true): T {
    obj.traverse((n) => {
      const m = n as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = shadow
        m.receiveShadow = true
      }
    })
    this.scene.add(obj)
    return obj
  }

  /** A textured standard material; repeat is applied to copies so surfaces can share one drawing. */
  private surf(src: Surface, repeat: [number, number], o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    const r = (t?: THREE.Texture) => {
      if (!t) return undefined
      const c = t.clone()
      c.repeat.set(t.repeat.x * repeat[0], t.repeat.y * repeat[1])
      c.needsUpdate = true
      return c
    }
    return new THREE.MeshStandardMaterial({ roughness: 0.9, map: r(src.map), normalMap: r(src.normalMap), ...o })
  }

  private waterMat(color: string, scale = 0.08) {
    const n = this.tex.ripples.clone()
    n.repeat.set(scale * 10, scale * 10)
    n.needsUpdate = true
    this.waterMaps.push(n)
    return new THREE.MeshStandardMaterial({ color, roughness: 0.06, metalness: 0.15, normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.3 })
  }

  private tex = {
    concrete: concrete(5),
    concreteDark: concrete(9, '#9ea3aa', 3),
    ripples: ripples(),
    panels: panels(),
    roof: corrugated(),
    leaves: leaves(),
  }

  private build() {
    const T = this.tex
    const conc = (rx: number, ry: number, o = {}) => this.surf(T.concrete, [rx, ry], { normalScale: new THREE.Vector2(0.6, 0.6), ...o })
    const concDark = this.surf(T.concreteDark, [2, 1])
    const gravel = this.surf(asphalt(), [3, 3], { color: '#8c8f93' })

    // ---- land: farmland beyond the fence, mown lawn inside, a river along the west --------------
    const g0 = grass(30, '#5a7442', 13)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: g0.map, normalMap: g0.normalMap, roughness: 1 }))
    ;[g0.map, g0.normalMap!].forEach((t) => t.repeat.set(3000 / 30, 3000 / 30))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    const fields: [number, number, number, number, string, string][] = [
      [90, -150, 170, 120, '#8d8a4a', '#6f6a35'],
      [150, -20, 120, 130, '#6f8a3e', '#56702c'],
      [40, 130, 200, 90, '#a59658', '#857742'],
      [-170, -60, 120, 160, '#7a8f44', '#5e7232'],
      [-170, 120, 120, 120, '#9a8f55', '#7b7040'],
      [-40, -150, 120, 80, '#6c8a43', '#52702f'],
    ]
    fields.forEach(([x, z, w, d, base, row], i) => {
      const f = field(base, row, 50 + i)
      ;[f.map, f.normalMap!].forEach((t) => t.repeat.set(w / 24, d / 24))
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normalMap, roughness: 1 }))
      m.rotation.set(-Math.PI / 2, 0, i % 2 ? 0 : Math.PI / 2)
      m.position.set(x, 0.01, z)
      m.receiveShadow = true
      this.scene.add(m)
    })
    const lawnTex = grass(14, '#5f7e45', 3)
    const lawn = new THREE.Mesh(new THREE.ShapeGeometry(this.siteShape(), 24), new THREE.MeshStandardMaterial({ map: lawnTex.map, normalMap: lawnTex.normalMap, roughness: 1, side: THREE.DoubleSide }))
    lawn.rotation.x = Math.PI / 2
    lawn.position.y = 0.02
    lawn.receiveShadow = true
    this.scene.add(lawn)
    const river = path(
      [
        [-70, -400],
        [-64, -60],
        [-67, -10],
        [-62, 40],
        [-66, 400],
      ],
      0.06,
    )
    const bankTex = grass(10, '#4f6e34', 19)
    const bank = new THREE.Mesh(ribbon(path(river.points.map((p) => [p.x, p.z] as [number, number]), 0.04), 16, 300), new THREE.MeshStandardMaterial({ map: bankTex.map, normalMap: bankTex.normalMap, color: '#c9c09a', roughness: 1 }))
    bank.receiveShadow = true
    this.scene.add(bank)
    const riverMesh = new THREE.Mesh(ribbon(river, 10, 300), this.waterMat('#2a4a4e', 0.12))
    riverMesh.receiveShadow = true
    this.scene.add(riverMesh)

    // ---- roads, yards and paths -----------------------------------------------------------------
    const roadTex = road()
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTex.map, normalMap: roadTex.normalMap, roughness: 0.95 })
    const ring = new THREE.CatmullRomCurve3(
      (
        [
          [-50, -46],
          [-8, -52],
          [50, -46],
          [60, -24],
          [60, 20],
          [36, 30],
          [26, 46],
          [-6, 52],
          [-46, 50],
          [-55, 10],
        ] as [number, number][]
      ).map(([x, z]) => v3(x, 0.14, z)),
      true,
      'centripetal',
    )
    this.scene.add(Object.assign(new THREE.Mesh(ribbon(ring, 5, 400), roadMat), { receiveShadow: true }))
    const access = path(
      [
        [-8, -52],
        [-6, -90],
        [-2, -200],
      ],
      0.14,
    )
    this.scene.add(Object.assign(new THREE.Mesh(ribbon(access, 6, 120), roadMat), { receiveShadow: true }))
    const pathMat = this.surf(T.concrete, [1, 1], { color: '#d8d6cf' })
    for (const s of [
      path(
        [
          [-46, -10],
          [-20, -12],
          [20, -6],
          [56, -6],
        ],
        0.11,
      ),
      path(
        [
          [-28, 50],
          [-28, 14],
          [-40, -4],
        ],
        0.11,
      ),
    ])
      this.scene.add(Object.assign(new THREE.Mesh(ribbon(s, 2.4), pathMat), { receiveShadow: true }))
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), gravel)
    yard.rotation.x = -Math.PI / 2
    yard.position.set(-36, 0.12, 38)
    yard.receiveShadow = true
    this.scene.add(yard)
    this.parking(-36, 38)

    // ---- inlet works: screen house and open channel ---------------------------------------------
    const inlet = new THREE.Group()
    inlet.add(this.building(9, 5, 7, -42, -36, { cols: 3, rows: 1, door: true, wall: '#d4d2cb', seed: 2 }))
    for (const z of [-27.6, -24.4]) inlet.add(this.box(22, 1.1, 0.4, conc(4, 0.3), -35, 0.55, z))
    const ch = new THREE.Mesh(new THREE.PlaneGeometry(22, 2.8), this.waterMat('#4b4535', 0.05))
    ch.rotation.x = -Math.PI / 2
    ch.position.set(-35, 0.7, -26)
    inlet.add(ch)
    for (const x of [-40, -37]) inlet.add(this.box(0.3, 1.8, 3.4, this.mat('#6f7884', { metalness: 0.6, roughness: 0.4 }), x, 1.2, -26))
    this.add(inlet)
    this.rail([v3(-46, 1.1, -27.8), v3(-24, 1.1, -27.8)])
    this.rail([v3(-46, 1.1, -24.2), v3(-36, 1.1, -24.2)])

    // ---- equalisation basin ----------------------------------------------------------------------
    const eq = new THREE.Group()
    for (const [w, d, x, z] of [
      [15, 0.5, -10, -27.3],
      [15, 0.5, -10, -18.7],
      [0.5, 9.1, -17.3, -23],
      [0.5, 9.1, -2.7, -23],
    ])
      eq.add(this.box(w, 1.6, d, conc(w / 6, 0.3), x, 0.8, z))
    const eqw = new THREE.Mesh(new THREE.PlaneGeometry(14.2, 8.2), this.waterMat('#3f3d2f', 0.06))
    eqw.rotation.x = -Math.PI / 2
    eqw.position.set(-10, 1.2, -23)
    eq.add(eqw)
    const steel = this.mat('#8b95a3', { metalness: 0.6, roughness: 0.35 })
    for (const x of [-14, -6]) eq.add(this.cyl(0.5, 0.5, 2.4, steel, x, 1.6, -23))
    eq.add(this.box(15, 0.25, 1.2, this.mat('#6b7688', { metalness: 0.5, roughness: 0.5 }), -10, 2.6, -23))
    this.add(eq)
    this.rail([v3(-17.5, 1.6, -27.6), v3(-2.5, 1.6, -27.6), v3(-2.5, 1.6, -18.4), v3(-17.5, 1.6, -18.4), v3(-17.5, 1.6, -27.6)])

    // ---- primary settling: covered round tanks ---------------------------------------------------
    for (const z of [-26, -12]) {
      const g = new THREE.Group()
      g.add(this.cyl(5.2, 5.2, 2.2, conc(10, 0.4), 9, 1.1, z, 64))
      const roof = new THREE.Mesh(new THREE.ConeGeometry(5.5, 2.2, 64, 1, true), this.surf(T.panels, [1, 1], { metalness: 0.55, roughness: 0.4, color: '#e8ebef', side: THREE.DoubleSide }))
      roof.position.set(9, 3.3, z)
      g.add(roof)
      g.add(this.cyl(0.5, 0.5, 0.6, steel, 9, 4.6, z, 16))
      this.add(g)
    }

    // ---- aeration hall: long building with a saw-tooth corrugated roof ---------------------------
    const hall = new THREE.Group()
    hall.add(this.building(36, 4, 14, 31, -26, { cols: 12, rows: 1, wall: '#cfd2d6', seed: 4 }, false))
    const roofMat = this.surf(T.roof, [1.8, 1], { metalness: 0.55, roughness: 0.42 })
    const glass = this.mat('#5f7f9c', { metalness: 0.9, roughness: 0.08 })
    const slope = Math.hypot(7, 2.2)
    const tilt = Math.atan2(2.2, 7)
    for (let i = 0; i < 6; i++) {
      const cx = 16 + i * 6
      for (const side of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(5.8, slope), side < 0 ? roofMat : glass)
        p.rotation.set(-Math.PI / 2 + side * tilt, 0, 0)
        p.rotation.order = 'YXZ'
        p.position.set(cx, 4 + 1.1, -26 + side * 3.5)
        hall.add(p)
        // the -Z slope is glazed in alternate bays, like north lights
        if (side > 0 && i % 2) p.material = roofMat
      }
      const gable = new THREE.Shape()
      gable.moveTo(-7, 0)
      gable.lineTo(0, 2.2)
      gable.lineTo(7, 0)
      gable.closePath()
      for (const end of [-2.9, 2.9]) {
        const gm = new THREE.Mesh(new THREE.ShapeGeometry(gable), this.mat('#c9ccd1', { side: THREE.DoubleSide }))
        gm.rotation.y = Math.PI / 2
        gm.position.set(cx + end, 4, -26)
        hall.add(gm)
      }
    }
    hall.add(this.building(4, 3, 3, 48.6, -20, { cols: 1, rows: 1, door: true, seed: 6 }))
    for (let i = 0; i < 3; i++) hall.add(this.cyl(0.9, 0.9, 2.2, this.surf(T.panels, [0.3, 1], { metalness: 0.5, roughness: 0.4, color: '#f2f4f7' }), 14 + i * 2.4, 1.1, -17.5, 20))
    this.add(hall)

    // ---- digesters: concrete drums with steel domes, gas holders, a stair tower -----------------
    for (const [x, z] of [
      [-26, -1],
      [-12, 6],
    ]) {
      const g = new THREE.Group()
      g.add(this.cyl(6.4, 6.4, 4, conc(12, 0.5), x, 2, z, 72))
      const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 72, 20, 0, Math.PI * 2, 0, Math.PI * 0.5), this.surf(T.panels, [1, 1], { metalness: 0.75, roughness: 0.32, color: '#c3cad4' }))
      dome.scale.y = 0.42
      dome.position.set(x, 4, z)
      g.add(dome)
      g.add(this.cyl(0.6, 0.6, 1, steel, x, 6.9, z))
      g.add(this.box(1.4, 6.5, 1.4, this.mat('#7a8492', { metalness: 0.5, roughness: 0.5 }), x + 6.9, 3.25, z, true))
      this.add(g)
    }
    for (const [x, z] of [
      [-40, 6],
      [-37, 12],
    ])
      this.add(this.cyl(2.2, 2.2, 4.2, this.surf(T.panels, [0.5, 1], { metalness: 0.35, roughness: 0.45, color: '#f4f6f8' }), x, 2.1, z, 40))

    // ---- pipework between process units ---------------------------------------------------------
    const pipeMat = this.mat('#8a95a5', { metalness: 0.65, roughness: 0.38 })
    for (const pts of [
      [v3(-2.5, 0.6, -23), v3(3.5, 0.6, -23), v3(3.8, 0.6, -26)],
      [v3(14.2, 0.6, -26), v3(13, 0.6, -26)],
      [v3(9, 0.6, -6.8), v3(9, 0.6, -2), v3(-12, 0.6, -2), v3(-12, 0.6, -0.4)],
      [v3(49, 0.6, -18), v3(52, 0.6, -10), v3(44, 0.6, -6)],
      [v3(-26, 0.6, 5.4), v3(-26, 0.6, 9), v3(-35, 0.6, 12)],
    ])
      this.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05), 40, 0.32, 10, false), pipeMat))

    // ---- final clarifiers: open round tanks with rotating bridges --------------------------------
    this.clarifier(40, 6, 13, conc)
    this.clarifier(4, 30, 15, conc)

    // ---- control room --------------------------------------------------------------------------
    this.add(this.building(12, 5, 8, CONTROL[0], CONTROL[1], { cols: 5, rows: 2, door: true, lit: true, wall: '#e2e4e8', seed: 8 }))
    this.add(this.box(12.6, 0.4, 8.6, concDark, CONTROL[0], 5.2, CONTROL[1]))
    for (const [dx, dz] of [
      [-3, -2],
      [2, 1],
    ])
      this.add(this.box(1.6, 1, 1.2, this.mat('#9aa3ae', { metalness: 0.5, roughness: 0.5 }), CONTROL[0] + dx, 5.9, CONTROL[1] + dz))

    // ---- site edge: fence and street lamps ---------------------------------------------------------
    this.fence()
    this.streetLamps(ring)

    // BIOCANARY units
    for (const s of STATION_SLOTS) this.unit(s)

    this.trees()
    this.buildFlows()
  }

  private siteShape() {
    const s = new THREE.Shape()
    s.moveTo(SITE[0][0], SITE[0][1])
    for (const [x, z] of SITE.slice(1)) s.lineTo(x, z)
    s.closePath()
    return s
  }

  private box(w: number, h: number, d: number, m: THREE.Material | THREE.Material[], x: number, y: number, z: number, shadow = true) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
    b.position.set(x, y, z)
    b.castShadow = shadow
    return b
  }

  private cyl(rt: number, rb: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 24) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)
    c.position.set(x, y, z)
    return c
  }

  /** A box building with window facades scaled to each wall and a gravel roof. */
  private building(w: number, h: number, d: number, x: number, z: number, f: Parameters<typeof facade>[0], roof = true) {
    const long = facade(f)
    const short = facade({ ...f, cols: Math.max(1, Math.round((f.cols * d) / w)), door: false, seed: (f.seed ?? 1) + 50 })
    const side = (s: ReturnType<typeof facade>) =>
      new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, emissiveMap: s.emissiveMap, emissive: f.lit ? '#ffffff' : '#000000', emissiveIntensity: f.lit ? 1.4 : 0, roughness: 0.75 })
    const top = roof ? this.surf(asphalt(), [w / 6, d / 6], { color: '#9a9ca0' }) : this.mat('#8c9098')
    const bottom = this.mat('#555a60')
    return this.box(w, h, d, [side(short), side(short), top, bottom, side(long), side(long)], x, h / 2, z)
  }

  private clarifier(x: number, z: number, r: number, conc: (rx: number, ry: number, o?: object) => THREE.MeshStandardMaterial) {
    const g = new THREE.Group()
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.8, 128, 1, true), conc(Math.round(r * 1.5), 0.3, { side: THREE.DoubleSide }))
    wall.position.set(x, 0.9, z)
    g.add(wall)
    const rim = new THREE.Mesh(new THREE.RingGeometry(r - 0.2, r + 0.6, 128), conc(3, 3))
    rim.rotation.x = -Math.PI / 2
    rim.position.set(x, 1.81, z)
    g.add(rim)
    const weir = new THREE.Mesh(new THREE.RingGeometry(r - 1.3, r - 0.9, 128), this.mat('#5b6472', { metalness: 0.4, roughness: 0.5 }))
    weir.rotation.x = -Math.PI / 2
    weir.position.set(x, 1.5, z)
    g.add(weir)
    const w = new THREE.Mesh(new THREE.CircleGeometry(r - 0.2, 128), this.waterMat('#151c1e', 0.1))
    w.rotation.x = -Math.PI / 2
    w.position.set(x, 1.45, z)
    g.add(w)
    g.add(this.cyl(1.1, 1.1, 2.4, conc(2, 0.5), x, 1.5, z))
    const bridge = new THREE.Group()
    bridge.position.set(x, 2.5, z)
    const yellow = this.mat(C.yellow, { roughness: 0.45, metalness: 0.3 })
    const deck = this.mat('#6d737c', { metalness: 0.7, roughness: 0.45 })
    bridge.add(this.box(r + 0.4, 0.2, 1.5, deck, r / 2, 0.1, 0))
    for (const side of [-0.75, 0.75]) {
      bridge.add(this.box(r + 0.4, 0.3, 0.12, yellow, r / 2, -0.1, side))
      bridge.add(this.box(r + 0.4, 0.06, 0.06, yellow, r / 2, 1, side, false))
      bridge.add(this.box(r + 0.4, 0.05, 0.05, yellow, r / 2, 0.55, side, false))
    }
    for (let i = 0; i <= 8; i++) for (const side of [-0.75, 0.75]) bridge.add(this.box(0.06, 1, 0.06, yellow, (i / 8) * r, 0.5, side, false))
    bridge.add(this.box(1.4, 1.3, 1.9, this.mat('#3f4a5e', { metalness: 0.4, roughness: 0.5 }), r - 0.2, -0.5, 0))
    bridge.add(this.box(0.2, 1.3, 1.5, this.mat('#2a3348'), r * 0.55, -0.8, 0))
    bridge.rotation.y = rng(Math.round(x * 13 + z))() * Math.PI * 2
    g.add(bridge)
    this.bridges.push(bridge)
    this.add(g)
    // handrail on the rim
    const posts = 64
    const rail = new THREE.Mesh(new THREE.TorusGeometry(r + 0.35, 0.04, 6, 128), this.mat('#b8bec6', { metalness: 0.6, roughness: 0.4 }))
    rail.rotation.x = Math.PI / 2
    rail.position.set(x, 2.85, z)
    this.scene.add(rail)
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5), rail.material, posts)
    const m = new THREE.Matrix4()
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2
      pm.setMatrixAt(i, m.makeTranslation(x + Math.cos(a) * (r + 0.35), 2.35, z + Math.sin(a) * (r + 0.35)))
    }
    this.scene.add(pm)
  }

  /** Handrail along a polyline: two rails and posts every 1.5 m. */
  private rail(pts: THREE.Vector3[]) {
    const mat = this.mat('#c2c8cf', { metalness: 0.6, roughness: 0.4 })
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const len = a.distanceTo(b)
      const mid = a.clone().lerp(b, 0.5)
      const ang = Math.atan2(b.z - a.z, b.x - a.x)
      for (const h of [1, 0.55]) {
        const r = this.box(len, 0.05, 0.05, mat, mid.x, a.y + h, mid.z, false)
        r.rotation.y = -ang
        this.scene.add(r)
      }
      const n = Math.max(1, Math.round(len / 1.5))
      for (let k = 0; k <= n; k++) {
        const p = a.clone().lerp(b, k / n)
        this.scene.add(this.box(0.05, 1, 0.05, mat, p.x, a.y + 0.5, p.z, false))
      }
    }
  }

  private fence() {
    const pts = [...SITE, SITE[0]].map(([x, z]) => v3(x * 1.04, 0, z * 1.04))
    const link = chainLink()
    const posts: THREE.Vector3[] = []
    const pos: number[] = []
    const uv: number[] = []
    let run = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const len = a.distanceTo(b)
      pos.push(a.x, 0, a.z, b.x, 0, b.z, b.x, 2, b.z, a.x, 2, a.z)
      uv.push(run / 0.18, 0, (run + len) / 0.18, 0, (run + len) / 0.18, 2 / 0.18, run / 0.18, 2 / 0.18)
      run += len
      const n = Math.round(len / 3)
      for (let k = 0; k < n; k++) posts.push(a.clone().lerp(b, k / n))
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(Array.from({ length: pos.length / 12 }, (_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]).flat())
    g.computeVertexNormals()
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#8d969f', metalness: 0.5, roughness: 0.5, alphaMap: link, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide }))
    this.scene.add(mesh)
    const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 6), this.mat('#7b848e', { metalness: 0.5, roughness: 0.5 }), posts.length)
    const m = new THREE.Matrix4()
    posts.forEach((p, i) => pm.setMatrixAt(i, m.makeTranslation(p.x, 1.1, p.z)))
    pm.castShadow = true
    this.scene.add(pm)
  }

  private streetLamps(ring: THREE.Curve<THREE.Vector3>) {
    const n = 26
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 6, 6), this.mat('#6b737d', { metalness: 0.6, roughness: 0.4 }), n)
    const head = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.18, 0.4), new THREE.MeshStandardMaterial({ color: '#4a4f56', emissive: '#ffe2a8', emissiveIntensity: 1.2 }), n)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    for (let i = 0; i < n; i++) {
      const t = i / n
      const p = ring.getPointAt(t)
      const tan = ring.getTangentAt(t)
      const side = v3(-tan.z, 0, tan.x).normalize().multiplyScalar(3.4)
      const at = p.clone().add(side)
      pole.setMatrixAt(i, m.makeTranslation(at.x, 3, at.z))
      q.setFromAxisAngle(v3(0, 1, 0), Math.atan2(-side.z, side.x))
      head.setMatrixAt(i, m.compose(at.clone().sub(side.clone().setLength(0.5)).setY(6), q, v3(1, 1, 1)))
    }
    pole.castShadow = true
    this.scene.add(pole, head)
  }

  private parking(cx: number, cz: number) {
    const line = new THREE.MeshBasicMaterial({ color: '#e8e8e0' })
    for (let i = 0; i <= 6; i++) {
      const l = this.box(0.12, 0.02, 4.4, line, cx - 7.5 + i * 2.5, 0.14, cz + 2.8, false)
      this.scene.add(l)
    }
    const rand = rng(99)
    const colors = ['#c9ccd2', '#1d2a44', '#7a1f24', '#e9eaec', '#2f3236', '#4d6a8a']
    for (let i = 0; i < 5; i++) {
      if (i === 3) continue
      const x = cx - 6.25 + i * 2.5
      const c = this.mat(colors[Math.floor(rand() * colors.length)], { metalness: 0.7, roughness: 0.3 })
      const car = new THREE.Group()
      car.add(this.box(1.8, 0.75, 4.2, c, 0, 0.55, 0))
      car.add(this.box(1.6, 0.6, 2.2, this.mat('#28303a', { metalness: 0.8, roughness: 0.15 }), 0, 1.2, -0.2))
      car.position.set(x, 0, cz + 2.8 + (rand() - 0.5) * 0.4)
      this.add(car)
    }
  }

  /** A BIOCANARY unit: weatherproof cabinet, two lit chamber windows, a status lamp on a mast. */
  private unit(slot: Slot) {
    const { at, face } = UNIT[slot]
    const g = new THREE.Group()
    g.position.set(at[0], 0, at[1])
    g.rotation.y = face
    g.add(this.box(2.6, 0.2, 1.8, this.mat(C.concreteDark), 0, 0.1, 0))
    g.add(this.box(1.6, 1.9, 0.9, this.mat('#eef1f6', { roughness: 0.4 }), 0, 1.15, 0))
    g.add(this.box(0.5, 0.8, 0.04, new THREE.MeshBasicMaterial({ color: '#7ab8ff' }), -0.38, 1.3, 0.47, false))
    g.add(this.box(0.5, 0.8, 0.04, new THREE.MeshBasicMaterial({ color: '#7cf09a' }), 0.38, 1.3, 0.47, false))
    g.add(this.cyl(0.05, 0.05, 1.3, this.mat('#9aa4b8'), 0.65, 2.75, -0.3, 8))
    const lamp = new THREE.MeshBasicMaterial({ color: LAMP.pending })
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), lamp)
    bulb.position.set(0.65, 3.45, -0.3)
    g.add(bulb)
    this.add(g)
    const halo = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), this.haloMaterial('#9fd8ff'))
    halo.rotation.x = -Math.PI / 2
    halo.position.set(at[0], 0.12, at[1])
    this.scene.add(halo)
    ;(this.lamps[slot] ??= []).push(lamp)
    this.halos[slot] = halo
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: '#FFB547', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }))
    ring.rotation.x = -Math.PI / 2
    ring.position.set(at[0], 0.25, at[1])
    this.scene.add(ring)
    this.rings[slot] = ring
  }

  private haloMaterial(color: string) {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(color) }, power: { value: 0.6 } },
      vertexShader: `varying vec2 u; void main(){ u = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 color; uniform float power; varying vec2 u; void main(){ float d = length(u-.5)*2.; gl_FragColor = vec4(color, pow(1.-clamp(d,0.,1.),2.2)*.55*power); }`,
    })
  }

  private trees() {
    const rand = rng(7)
    const spots: [number, number][] = []
    const belt = (x0: number, x1: number, z0: number, z1: number, n: number) => {
      for (let i = 0; i < n; i++) spots.push([x0 + rand() * (x1 - x0), z0 + rand() * (z1 - z0)])
    }
    belt(-58, 74, -80, -62, 90)
    belt(72, 90, -70, 70, 50)
    belt(-50, 80, 62, 80, 70)
    belt(-84, -75, -120, 120, 50)
    belt(-56, -52, -45, 45, 14)
    for (const [cx, cz, n] of [
      [52, 40, 8],
      [62, -48, 6],
      [-50, -52, 7],
      [-50, 34, 5],
      [24, -46, 4],
      [-2, -42, 3],
      [30, 18, 3],
      [-20, 20, 3],
    ] as [number, number, number][])
      for (let i = 0; i < n; i++) spots.push([cx + (rand() - 0.5) * 10, cz + (rand() - 0.5) * 10])

    // lumpy crown: an icosphere pushed in and out
    const crownGeo = new THREE.IcosahedronGeometry(1, 3)
    const p = crownGeo.getAttribute('position') as THREE.BufferAttribute
    const vr = rng(3)
    const bumps = Array.from({ length: 9 }, () => v3(vr() - 0.5, vr() - 0.5, vr() - 0.5).normalize())
    for (let i = 0; i < p.count; i++) {
      const v = v3(p.getX(i), p.getY(i), p.getZ(i))
      let k = 0
      for (const b of bumps) k += Math.max(0, v.dot(b)) ** 3
      v.multiplyScalar(0.85 + k * 0.28 + (vr() - 0.5) * 0.04)
      p.setXYZ(i, v.x, v.y, v.z)
    }
    crownGeo.computeVertexNormals()
    const L = this.tex.leaves
    const leafMat = new THREE.MeshStandardMaterial({ map: L.map, normalMap: L.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95 })
    const conifers = spots.filter((_, i) => i % 4 === 0)
    const broad = spots.filter((_, i) => i % 4 !== 0)
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7), this.mat('#4a3a2e'), spots.length)
    const crown = new THREE.InstancedMesh(crownGeo, leafMat, broad.length * 2)
    const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.4, 9, 3), leafMat, conifers.length * 2)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const greens = ['#4f7a3a', '#5d8a40', '#6c9447', '#466e35', '#7d9a4e', '#587f3c']
    const firs = ['#2f5a34', '#36633a', '#2a4f30']
    let t = 0
    broad.forEach(([x, z], i) => {
      const s = 1.8 + rand() * 2
      m.compose(v3(x, 1.3, z), q.identity(), v3(1, 1, 1))
      trunk.setMatrixAt(t++, m)
      const color = new THREE.Color(greens[Math.floor(rand() * greens.length)])
      m.compose(v3(x, 2.4 + s * 0.9, z), q.setFromEuler(new THREE.Euler(rand(), rand() * 6, rand())), v3(s, s * (0.9 + rand() * 0.3), s))
      crown.setMatrixAt(i * 2, m)
      crown.setColorAt(i * 2, color)
      const o = s * 0.55
      m.compose(v3(x + (rand() - 0.5) * o * 2, 2.2 + s * 0.7, z + (rand() - 0.5) * o * 2), q.setFromEuler(new THREE.Euler(rand(), rand() * 6, 0)), v3(s * 0.7, s * 0.65, s * 0.7))
      crown.setMatrixAt(i * 2 + 1, m)
      crown.setColorAt(i * 2 + 1, color.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.06))
    })
    conifers.forEach(([x, z], i) => {
      const s = 1.6 + rand() * 1.4
      m.compose(v3(x, 1.3, z), q.identity(), v3(1, 1, 1))
      trunk.setMatrixAt(t++, m)
      const color = new THREE.Color(firs[Math.floor(rand() * firs.length)])
      m.compose(v3(x, 2 + s * 1.2, z), q.identity(), v3(s * 1.2, s * 1.6, s * 1.2))
      cone.setMatrixAt(i * 2, m)
      cone.setColorAt(i * 2, color)
      m.compose(v3(x, 2 + s * 2.8, z), q.identity(), v3(s * 0.85, s * 1.3, s * 0.85))
      cone.setMatrixAt(i * 2 + 1, m)
      cone.setColorAt(i * 2 + 1, color)
    })
    for (const im of [trunk, crown, cone]) {
      im.castShadow = true
      im.receiveShadow = true
    }
    this.scene.add(trunk, crown, cone)

    // low shrubs along building fronts and paths
    const shrubSpots: [number, number][] = []
    for (let x = -47; x < -37; x += 1.6) shrubSpots.push([x, -40.5])
    for (let x = -41; x < -31; x += 1.4) shrubSpots.push([x, 31])
    for (let z = -20; z < 4; z += 1.8) shrubSpots.push([-48 + rand(), z])
    const shrub = new THREE.InstancedMesh(crownGeo, leafMat, shrubSpots.length)
    shrubSpots.forEach(([x, z], i) => {
      const s = 0.6 + rand() * 0.4
      shrub.setMatrixAt(i, m.compose(v3(x, s * 0.6, z), q.setFromEuler(new THREE.Euler(0, rand() * 6, 0)), v3(s, s * 0.8, s)))
      shrub.setColorAt(i, new THREE.Color(greens[Math.floor(rand() * greens.length)]).offsetHSL(0, 0, -0.05))
    })
    shrub.castShadow = true
    this.scene.add(shrub)
  }

  private buildFlows() {
    const sewer = path([
      [-42, -110],
      [-42, -44],
      [-42, -32],
      [-44, -26],
      [-30, -26],
      [-24, -26],
      [-17, -23],
      [-10, -23],
      [-3, -23],
      [4, -26],
      [9, -26],
      [9, -12],
      [14, -18],
      [18, -26],
      [30, -26],
      [46, -26],
      [52, -14],
      [44, 2],
      [40, 6],
      [26, 14],
      [12, 24],
      [4, 30],
      [-8, 42],
      [-30, 46],
      [-52, 44],
      [-63, 40],
    ])
    const industrial = path([
      [2, -110],
      [-6, -70],
      [-17.6, -51.4],
      [-24, -38],
      [-28, -28],
      [-30, -26],
    ])
    this.flow(sewer, 900, C.sewer, 7, 'sewer', 0.35, 1.3)
    this.flow(industrial, 260, C.industrial, 8, 'industrial', 0.3, 1.05)
    for (const s of STATION_SLOTS) {
      const { from, at } = UNIT[s]
      const c = new THREE.LineCurve3(v3(from[0], 0.9, from[1]), v3(at[0], 1.2, at[1]))
      this.flow(c, 10, C.sample, 1.1, 'sample', 0, 1.2, s)
    }
    // readings leave each unit for the analysis service, which notifies the control room
    for (const s of STATION_SLOTS) {
      const a = v3(UNIT[s].at[0], 3.5, UNIT[s].at[1])
      const b = v3(...HUB)
      const mid = a.clone().lerp(b, 0.5).add(v3(0, 12, 0))
      this.link(new THREE.QuadraticBezierCurve3(a, mid, b), s)
    }
    const top = v3(CONTROL[0], 5.6, CONTROL[1])
    this.link(new THREE.QuadraticBezierCurve3(v3(...HUB), v3(...HUB).lerp(top, 0.5).add(v3(0, 10, 0)), top), 'control')
  }

  private flow(curve: THREE.Curve<THREE.Vector3>, count: number, color: string, speed: number, layer: keyof Emphasis, rest: number, size: number, slot?: Slot) {
    const points = glowPoints(count, color, size)
    const rand = rng(count * 31 + Math.round(speed * 100))
    const offsets = new Float32Array(count)
    for (let i = 0; i < count; i++) offsets[i] = rand()
    const f: Flow & { slot?: Slot; jitter: Float32Array } = { curve, points, offsets, speed, length: curve.getLength(), layer, rest, slot, jitter: new Float32Array(count * 2) }
    for (let i = 0; i < count * 2; i++) f.jitter[i] = (rand() - 0.5) * (layer === 'sample' ? 0.08 : 1.1)
    this.flows.push(f)
    this.place(f)
    this.scene.add(points)
  }

  private link(curve: THREE.Curve<THREE.Vector3>, slot: Slot | 'control') {
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 64, 0.08, 6, false),
      new THREE.MeshBasicMaterial({ color: C.data, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending }),
    )
    this.scene.add(tube)
    this.links.push({ slot, mesh: tube })
    this.flow(curve, 6, slot === 'control' ? '#FFB547' : C.data, 9, slot === 'control' ? 'alert' : 'data', 0, 2.6, slot === 'control' ? undefined : slot)
  }

  private buildHub() {
    const g = new THREE.Group()
    g.position.set(...HUB)
    const ring = (r: number, o: number) =>
      new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 8, 96), new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: o, depthWrite: false, blending: THREE.AdditiveBlending }))
    const a = ring(3.2, 0.8)
    const b = ring(4.6, 0.35)
    a.rotation.x = b.rotation.x = Math.PI / 2
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.4, 1), new THREE.MeshBasicMaterial({ color: '#A6F684', wireframe: true }))
    g.add(a, b, core)
    this.scene.add(g)
    return g
  }

  private place(f: Flow & { jitter?: Float32Array }) {
    const pos = f.points.geometry.getAttribute('position') as THREE.BufferAttribute
    const p = new THREE.Vector3()
    for (let i = 0; i < f.offsets.length; i++) {
      f.curve.getPointAt(f.offsets[i] % 1, p)
      pos.setXYZ(i, p.x + (f.jitter?.[i * 2] ?? 0), p.y, p.z + (f.jitter?.[i * 2 + 1] ?? 0))
    }
    pos.needsUpdate = true
  }

  // ---- state -------------------------------------------------------------------------------

  /** Lamps follow each station's real status; a unit with no station or no readings stays dark. */
  setStations(slots: Partial<Record<Slot, Lamp>>) {
    this.reporting.clear()
    for (const s of STATION_SLOTS) {
      const lamp = slots[s]
      for (const m of this.lamps[s] ?? []) m.color.set(LAMP[lamp ?? 'offline'])
      const halo = this.halos[s]
      if (halo) {
        const u = (halo.material as THREE.ShaderMaterial).uniforms
        u.color.value.set(lamp && lamp !== 'offline' ? LAMP[lamp] : '#3b4754')
        u.power.value = lamp && lamp !== 'offline' ? 0.7 : 0.25
      }
      if (lamp && lamp !== 'offline') this.reporting.add(s)
    }
    this.setEmphasis(this.emphasis)
  }

  setEmphasis(e: Emphasis) {
    this.emphasis = e
    for (const f of this.flows as (Flow & { slot?: Slot })[]) {
      // no samples and no uploads from a unit that is not reporting
      const live = !f.slot || this.reporting.has(f.slot)
      const v = live ? Math.max(f.rest, e[f.layer]) : 0
      ;(f.points.material as THREE.ShaderMaterial).uniforms.power.value = v
    }
    for (const l of this.links) {
      const live = l.slot === 'control' || this.reporting.has(l.slot)
      ;(l.mesh.material as THREE.MeshBasicMaterial).opacity = live ? 0.06 + 0.3 * (l.slot === 'control' ? e.alert : e.data) : 0.03
    }
    this.hub.visible = e.data > 0.2 || e.alert > 0.2
  }

  /** Pulsing rings at units whose station has an open alert or is in a warning range. */
  setAlerts(levels: Partial<Record<Slot, 'warning' | 'critical'>>) {
    for (const s of STATION_SLOTS) {
      const l = levels[s]
      this.ringLevel[s] = l ? 1 : 0
      ;(this.rings[s]!.material as THREE.MeshBasicMaterial).color.set(l === 'critical' ? '#FF6B5E' : '#FFB547')
    }
  }

  /** Fly to one unit, or back to the given view. */
  focus(slot: Slot | null, fallback: ViewName = 'overview') {
    this.focusGoal = slot
    if (!slot) return this.setView(fallback)
    const [x, z] = UNIT[slot].at
    const a = THREE.MathUtils.degToRad(slot === 'industrial' ? 40 : 24)
    const e = THREE.MathUtils.degToRad(30)
    const target = v3(x, 1.4, z)
    const pos = target.clone().add(v3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(30))
    if (this.o.still) {
      this.camera.position.copy(pos)
      this.controls.target.copy(target)
      this.controls.update()
    } else this.goal = { pos, target }
  }

  private placeView(v: ViewName) {
    const [t, az, el, d] = VIEWS[v]
    const aspect = this.camera.aspect || 1.6
    const fit = d * Math.max(1, 1.5 / aspect)
    const a = THREE.MathUtils.degToRad(az)
    const e = THREE.MathUtils.degToRad(el)
    const target = v3(...t)
    return { target, pos: target.clone().add(v3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).multiplyScalar(fit)) }
  }

  private jump(v: ViewName) {
    this.view = v
    const { pos, target } = this.placeView(v)
    this.camera.position.copy(pos)
    this.controls.target.copy(target)
    this.controls.update()
  }

  setView(v: ViewName) {
    this.focusGoal = null
    if (this.o.still) return this.jump(v)
    this.view = v
    this.goal = this.placeView(v)
  }

  private resize() {
    const box = this.o.canvas.parentElement!.getBoundingClientRect()
    if (!box.width || !box.height) return
    this.renderer.setSize(box.width, box.height, false)
    // On wide screens the step card covers the lower left, so centre the scene in the space to its right.
    const shift = this.o.shift && box.width > 860 ? Math.min(380, box.width * 0.24) : 0
    this.camera.aspect = (box.width + shift) / box.height
    if (shift) this.camera.setViewOffset(box.width + shift, box.height, 0, 0, box.width, box.height)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
    const scale = (box.height * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(19)))
    for (const f of this.flows) (f.points.material as THREE.ShaderMaterial).uniforms.scale.value = scale
    if (this.focusGoal) this.focus(this.focusGoal)
    else this.jump(this.view)
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min((now - this.last) / 1000, 0.1)
    this.last = now
    if (!this.visible) return
    if (this.goal) {
      const k = 1 - Math.exp(-dt * 2.6)
      this.camera.position.lerp(this.goal.pos, k)
      this.controls.target.lerp(this.goal.target, k)
      if (this.camera.position.distanceTo(this.goal.pos) < 0.05) this.goal = null
    }
    this.controls.update()
    if (!this.o.still) {
      this.clock += dt
      for (const b of this.bridges) b.rotation.y += dt * 0.05
      for (const [i, w] of this.waterMaps.entries()) w.offset.set(this.clock * 0.006 * (i % 2 ? 1 : -1), this.clock * 0.004)
      for (const f of this.flows) {
        if ((f.points.material as THREE.ShaderMaterial).uniforms.power.value <= 0) continue
        const step = (f.speed * dt) / f.length
        for (let i = 0; i < f.offsets.length; i++) f.offsets[i] = (f.offsets[i] + step) % 1
        this.place(f)
      }
      this.hub.rotation.y += dt * 0.4
      const a = this.emphasis.alert
      const ring = (this.clock * 0.5) % 1
      this.alertRing.scale.setScalar(3 + ring * 16)
      ;(this.alertRing.material as THREE.MeshBasicMaterial).opacity = a * (1 - ring) * 0.8
      for (const s of STATION_SLOTS) {
        const r = this.rings[s]!
        const k = (this.clock * 0.6 + STATION_SLOTS.indexOf(s) * 0.27) % 1
        r.scale.setScalar(1.5 + k * 9)
        ;(r.material as THREE.MeshBasicMaterial).opacity = (this.ringLevel[s] ?? 0) * (1 - k) * 0.9
      }
    } else {
      for (const s of STATION_SLOTS) {
        this.rings[s]!.scale.setScalar(6)
        ;(this.rings[s]!.material as THREE.MeshBasicMaterial).opacity = (this.ringLevel[s] ?? 0) * 0.7
      }
      this.alertRing.scale.setScalar(10)
      ;(this.alertRing.material as THREE.MeshBasicMaterial).opacity = this.emphasis.alert * 0.6
    }
    this.renderer.render(this.scene, this.camera)
    const el = this.o.canvas
    this.o.onFrame((a) => {
      const q = v3(...ANCHORS[a]).project(this.camera)
      return { x: ((q.x + 1) / 2) * el.clientWidth, y: ((1 - q.y) / 2) * el.clientHeight, shown: q.z < 1 && Math.abs(q.x) < 1.05 && Math.abs(q.y) < 1.05 }
    })
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.watch.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.o.canvas.removeEventListener('webglcontextlost', this.lost)
    this.controls.dispose()
    this.scene.traverse((n) => {
      const m = n as THREE.Mesh
      m.geometry?.dispose()
      for (const x of [m.material].flat()) (x as THREE.Material | undefined)?.dispose()
    })
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
