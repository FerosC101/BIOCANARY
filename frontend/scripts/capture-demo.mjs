// Records the API responses the web app needs into public/demo/snapshot.json, so the app can run as an
// offline demo when no backend is reachable. Run against a running stack with simulated stations:
//   node scripts/capture-demo.mjs [http://127.0.0.1:8710]
// Only simulated stations should be recorded; the snapshot is labelled as recorded sample data in the app.
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8710') + '/api/v1'
const PRESETS = { '6h': 6, '24h': 24, '7d': 168, '30d': 720 }
const CELLS = { '6h': 24, '24h': 48, '7d': 56, '30d': 60 }

const login = await fetch(BASE + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'operator@biocanary.demo', password: 'listen-today' }),
})
if (!login.ok) throw new Error(`Sign-in failed: ${login.status}`)
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const out = {}
const get = async (path, key = path) => {
  const r = await fetch(BASE + path, { headers: { cookie } })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  out[key] = await r.json()
}
const now = new Date()
const period = (p) => new URLSearchParams({ start: new Date(+now - PRESETS[p] * 3600_000).toISOString(), end: now.toISOString() })

await get('/auth/me')
await get('/stations')
await get('/model')
await get('/system/public')
const stations = out['/stations']
const live = stations.filter((s) => s.origin !== 'simulated' && s.last_reading_at)
if (live.length) throw new Error(`Refusing to record hardware data: ${live.map((s) => s.code).join(', ')}`)

for (const s of stations) {
  const at = `/stations/${s.code}`
  await get(`${at}/overview?hours=24`, `${at}/overview`)
  await get(`${at}/analysis`, `${at}/analysis`)
  await get(`${at}/assessments?${period('7d')}&limit=1500`, `${at}/assessments`)
  await get(`${at}/protocol`)
  for (const p of Object.keys(PRESETS)) {
    const q = period(p)
    await get(`${at}/series?${q}`, `${at}/series#${p}`)
    await get(`${at}/sensors?${q}`, `${at}/sensors#${p}`)
    await get(`${at}/events?${q}`, `${at}/events#${p}`)
    await get(`${at}/quality?${q}&cells=${CELLS[p]}`, `${at}/quality#${p}`)
    await get(`${at}/readings?${q}&page=1&size=15`, `${at}/readings#${p}#all`)
    await get(`${at}/readings?${q}&quality=problem&size=5`, `${at}/readings#${p}#problem`)
    if (p !== '6h') await get(`${at}/report?${q}`, `${at}/report#${p}`)
  }
}

const json = JSON.stringify({ captured_at: now.toISOString(), responses: out })
mkdirSync(new URL('../public/demo/', import.meta.url), { recursive: true })
writeFileSync(new URL('../public/demo/snapshot.json', import.meta.url), json)
console.log(`Recorded ${Object.keys(out).length} responses, ${(json.length / 1e6).toFixed(1)} MB (${(gzipSync(json).length / 1e6).toFixed(2)} MB gzipped)`)
