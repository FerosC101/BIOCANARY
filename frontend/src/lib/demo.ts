import { ApiError, setOffline } from './api'
import type { Severity, SystemStatus } from './types'

/**
 * Offline demo. When the BIOCANARY server cannot be reached (or the site is built with VITE_DEMO=1,
 * or opened with ?demo), the app serves responses recorded from simulated stations by
 * scripts/capture-demo.mjs. Times are moved forward so the recording reads as recent, nothing is
 * saved, and no cloud service is ever reported as connected. The app shows a banner throughout.
 */

interface Snapshot {
  captured_at: string
  responses: Record<string, unknown>
}

let snap: Snapshot | null = null
const SIGNED_IN = 'biocanary.demo.signed-in'

export const isDemo = () => snap !== null

export async function startDemoIfOffline(): Promise<boolean> {
  const params = new URLSearchParams(location.search)
  const forced = import.meta.env.VITE_DEMO === '1' || params.has('demo')
  if (!forced) {
    try {
      const r = await fetch('/api/v1/health', { signal: AbortSignal.timeout(4000) })
      // A static host may answer any path with the app's own page; only a JSON health reply counts.
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return false
    } catch {
      // unreachable: fall through to the demo
    }
  }
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}demo/snapshot.json`)
    if (!r.ok) return false
    const raw = (await r.json()) as Snapshot
    snap = { ...raw, responses: shift(raw.responses, Date.now() - +new Date(raw.captured_at)) as Record<string, unknown> }
  } catch {
    return false
  }
  setOffline(handle)
  return true
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Move every timestamp forward by `ms`, so "12 s ago" means 12 s after the recording. */
function shift(v: unknown, ms: number, key = ''): unknown {
  if (typeof v === 'string') {
    if (ISO.test(v)) return new Date(+new Date(v) + ms).toISOString()
    if (DATE.test(v)) return new Date(+new Date(v + 'T12:00:00Z') + Math.round(ms / 86400_000) * 86400_000).toISOString().slice(0, 10)
    return v
  }
  if (Array.isArray(v)) return key === 't' ? v.map((x) => (typeof x === 'number' ? x + ms : x)) : v.map((x) => shift(x, ms))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x, ms, k)]))
  return v
}

const HOURS: [string, number][] = [
  ['6h', 6],
  ['24h', 24],
  ['7d', 168],
  ['30d', 720],
]

/** The recorded period closest to the one asked for. */
function nearest(q: URLSearchParams, allowed = HOURS): string {
  const start = q.get('start')
  const end = q.get('end')
  const hours = start && end ? (+new Date(end) - +new Date(start)) / 3600_000 : 24
  return allowed.reduce((best, cur) => (Math.abs(Math.log(cur[1] / hours)) < Math.abs(Math.log(best[1] / hours)) ? cur : best))[0]
}

function pick<T>(key: string): T {
  const v = snap?.responses[key]
  if (v === undefined) throw new ApiError(404, 'This view is not included in the offline demo.')
  return structuredClone(v) as T
}

const READ_ONLY = 'This is an offline demo with recorded data, so nothing can be saved. Start the BIOCANARY server to use this.'

async function handle(method: string, full: string): Promise<unknown> {
  const [path, qs = ''] = full.split('?')
  const q = new URLSearchParams(qs)
  if (method === 'POST' && path === '/auth/login') {
    sessionStorage.setItem(SIGNED_IN, '1')
    return pick('/auth/me')
  }
  if (method === 'POST' && path === '/auth/logout') {
    sessionStorage.removeItem(SIGNED_IN)
    return undefined
  }
  if (method !== 'GET') throw new ApiError(503, READ_ONLY)
  if (path === '/auth/me') {
    if (!sessionStorage.getItem(SIGNED_IN)) throw new ApiError(401, 'Not signed in.')
    return pick('/auth/me')
  }
  if (path === '/system/status') return status()
  if (path === '/reports') return []
  if (path === '/stations' || path === '/model' || path === '/system/public') return pick(path)
  const m = path.match(/^(\/stations\/[^/]+)\/([a-z]+)$/)
  if (!m) throw new ApiError(404, 'This view is not included in the offline demo.')
  const [, at, view] = m
  if (['overview', 'analysis', 'assessments', 'protocol'].includes(view)) return pick(`${at}/${view}`)
  if (['series', 'sensors', 'events', 'quality'].includes(view)) return pick(`${at}/${view}#${nearest(q)}`)
  if (view === 'readings') {
    const page = Number(q.get('page') ?? 1)
    const r = pick<{ rows: unknown[] }>(`${at}/readings#${nearest(q)}#${q.get('quality') === 'problem' ? 'problem' : 'all'}`)
    return page > 1 ? { ...r, rows: [], page } : r
  }
  if (view === 'report') {
    const r = pick<{ events: { severity: Severity }[] }>(`${at}/report#${nearest(q, HOURS.slice(1))}`)
    const sev = q.get('severity')?.split(',')
    return sev ? { ...r, events: r.events.filter((e) => sev.includes(e.severity)) } : r
  }
  throw new ApiError(404, 'This view is not included in the offline demo.')
}

/** Every service is shown as not connected: the demo talks to nothing. */
function status(): SystemStatus {
  const stations = pick<{ origin: string }[]>('/stations')
  const svc = (key: string, name: string, responsibility: string) => ({ key, name, responsibility, provider: 'none', huawei: false, state: 'local' as const, detail: 'Not connected: offline demo with recorded data', latency_ms: null })
  return {
    environment: 'demo',
    cloud: {
      mode: 'local',
      label: 'Offline demo',
      services: [
        svc('compute', 'ECS', 'Application and API host'),
        svc('database', 'RDS', 'Measurements, assessments and alerts'),
        svc('cache', 'Redis (DCS)', 'Latest readings and live state'),
        svc('objects', 'OBS', 'Raw datasets and generated reports'),
        svc('inference', 'ModelArts', 'Model inference'),
      ],
    },
    data: { simulated_stations: stations.filter((s) => s.origin === 'simulated').length, live_stations: stations.filter((s) => s.origin !== 'simulated').length, live_data_received: false },
  }
}
