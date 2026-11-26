import { useQueries } from '@tanstack/react-query'
import { Maximize, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { Dial } from '../components/Dial'
import { OriginTag } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { EXPOSED, REFERENCE } from '../lib/colors'
import { ago, num, time } from '../lib/format'
import { rangeOf, rangeText, severityWord, ZONE } from '../lib/ranges'
import type { Alert, Overview, Station } from '../lib/types'

/**
 * Control-room display: every station at once, readable from across a room. Not a navigation section;
 * it opens full screen from the top bar and refreshes from the same live stream as the rest of the app.
 */
export function Wall() {
  const { stations, stream } = useApp()
  const now = useNow(1000)
  const size = useDialSize(stations.length)
  const views = useQueries({
    queries: stations.map((s) => ({
      queryKey: ['station', s.code, 'overview', 24],
      queryFn: () => get<Overview>(`/stations/${s.code}/overview?hours=24`),
    })),
  })
  const open = views
    .flatMap((v) => (v.data ? v.data.alerts.filter((a) => !a.ended_at).map((a) => ({ a, station: v.data.station })) : []))
    .sort((x, y) => +new Date(y.a.started_at) - +new Date(x.a.started_at))
  const simulated = stations.some((s) => s.origin === 'simulated')
  const facility = stations[0]?.facility

  return (
    <main className="wall" data-count={stations.length}>
      <svg className="wall-rings" viewBox="0 0 1000 1000" aria-hidden>
        {[220, 300, 390, 480].map((r, i) => (
          <circle key={r} cx="500" cy="500" r={r} fill="none" stroke={i ? '#8FB6FF' : '#A6F684'} strokeOpacity={[0.2, 0.14, 0.08, 0.05][i]} strokeWidth={i ? 1 : 1.5} />
        ))}
      </svg>
      <header className="wall-head">
        <Logo className="wall-logo" tone="white" />
        <span className="wall-place">{facility ? `${facility} · control room` : 'Control room'}</span>
        <span className="wall-fill" />
        {simulated && <OriginTag origin="simulated" />}
        <span className={`live ${stream}`}>
          <i />
          {stream === 'open' ? 'Live' : stream === 'connecting' ? 'Connecting' : 'Updates paused'}
        </span>
        <time className="wall-clock">{new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        <span className="wall-actions">
          <button onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} title="Full screen" aria-label="Full screen">
            <Maximize size={18} aria-hidden />
          </button>
          <Link to="/" title="Leave the wall display" aria-label="Leave the wall display">
            <X size={20} aria-hidden />
          </Link>
        </span>
      </header>

      <div className="wall-grid">
        {stations.map((s, i) => (
          <Tile key={s.code} s={s} data={views[i]?.data} size={size} now={now} />
        ))}
      </div>

      <footer className="wall-foot">
        <b className={open.length ? 'n hot' : 'n'}>{open.length}</b>
        <span>open {open.length === 1 ? 'alert' : 'alerts'}</span>
        {open.slice(0, 2).map(({ a, station }) => (
          <span key={a.id} className="wall-alert">
            {station.name} · {alertWord(a)} · {time(a.started_at)}
          </span>
        ))}
        <span className="wall-fill" />
        <span className="key">
          <i style={{ background: REFERENCE }} />
          Reference
        </span>
        <span className="key">
          <i style={{ background: EXPOSED }} />
          Test
        </span>
      </footer>
    </main>
  )
}

function Tile({ s, data, size, now }: { s: Station; data?: Overview; size: number; now: number }) {
  const l = s.latest_assessment
  const offline = s.status === 'offline'
  const thresholds = l?.thresholds ?? null
  const value = offline ? null : (l?.inhibition ?? null)
  const zone = offline ? null : rangeOf(value, thresholds)
  const word = offline ? 'Offline' : !l ? 'Waiting for data' : rangeText(value, thresholds, severityWord(l.severity))
  const ink = zone === null ? 'var(--ink-2)' : ZONE[zone]
  const a = data?.assessment
  const sig = a?.detail.signals
  const unit = data?.series.activity_unit ?? ''
  const sub = [
    s.code,
    s.origin === 'simulated' ? 'simulated' : 'live hardware',
    offline
      ? s.last_reading_at
        ? `last reading ${ago(s.last_reading_at, now)}`
        : 'no readings yet'
      : a?.detail.onset && zone !== null && zone > 0
        ? `since ${time(a.detail.onset)}`
        : null,
    !offline && sig?.ref_activity != null ? `reference ${num(sig.ref_activity)} ${unit}` : null,
    !offline && sig?.exp_activity != null ? `test ${num(sig.exp_activity)} ${unit}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className={'wall-tile' + (zone !== null && zone >= 2 ? ' hot' : '') + (offline ? ' off' : '')} aria-label={`${s.name}: ${word}`}>
      <Dial value={value} thresholds={thresholds} size={size} muted={offline || !l} label={`${s.name}: ${word}`} />
      <div className="wall-text">
        <h2>{s.name}</h2>
        <div className="wall-word" style={{ color: ink }}>
          {word}
        </div>
        {data?.series.has_data ? <Spark t={data.series.t} ref_={data.series.channels.ref_activity} exp={data.series.channels.exp_activity} dim={offline} /> : <div className="wall-spark empty">No readings in the last 24 h</div>}
        <div className="wall-sub n">{sub}</div>
      </div>
    </section>
  )
}

/** 24 h of both chambers on one scale; the shaded band is the gap between them. Gaps in data stay gaps. */
function Spark({ t, ref_, exp, dim }: { t: number[]; ref_: (number | null)[]; exp: (number | null)[]; dim: boolean }) {
  const W = 1000
  const H = 120
  const all = [...ref_, ...exp].filter((v): v is number => v !== null)
  if (all.length < 2 || t.length < 2) return <div className="wall-spark empty">Not enough readings to draw</div>
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2
    lo = mid - 5
    hi = mid + 5
  }
  const t0 = t[0]
  const span = t[t.length - 1] - t0 || 1
  const x = (i: number) => (((t[i] - t0) / span) * W).toFixed(1)
  const y = (v: number) => (H - 6 - ((v - lo) / (hi - lo)) * (H - 12)).toFixed(1)
  const line = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${x(i)} ${y(v)}`
      pen = true
    })
    return d
  }
  // Band between the chambers, drawn per run of points where both have a value.
  let band = ''
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) band += 'M' + run.map((i) => `${x(i)} ${y(ref_[i]!)}`).join('L') + 'L' + [...run].reverse().map((i) => `${x(i)} ${y(exp[i]!)}`).join('L') + 'Z'
    run = []
  }
  t.forEach((_, i) => (ref_[i] !== null && exp[i] !== null ? run.push(i) : flush()))
  flush()
  return (
    <svg className={'wall-spark' + (dim ? ' dim' : '')} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={band} fill="#FFB547" opacity="0.22" />
      <path d={line(ref_)} fill="none" stroke={REFERENCE} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 5px #2F6BFF)' }} />
      <path d={line(exp)} fill="none" stroke={EXPOSED} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 6px #4FD96B)' }} />
    </svg>
  )
}

function alertWord(a: Alert): string {
  if (a.kind === 'offline') return 'stopped reporting'
  if (a.kind === 'inhibition' && ['mild', 'moderate', 'severe'].includes(a.severity)) return `${a.severity} range`
  return a.title.toLowerCase()
}

/** Dial size from the screen height, so a 1080p wall and a laptop both fit without scrolling. */
function useDialSize(count: number): number {
  const calc = () => {
    const rows = Math.ceil(count / (count > 4 ? 3 : 2))
    const per = (window.innerHeight - 260) / Math.max(rows, 1)
    return Math.round(Math.min(260, Math.max(130, per * 0.7)))
  }
  const [size, setSize] = useState(calc)
  useEffect(() => {
    const on = () => setSize(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  })
  return size
}
