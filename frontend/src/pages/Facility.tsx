import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Dial } from '../components/Dial'
import { PlantCanvas, StationPin, type Pin } from '../components/plant/PlantCanvas'
import type { Anchor, Emphasis, Slot } from '../components/plant/plantScene'
import { assign, lampsFor, LABELS, reading } from '../components/plant/stations'
import { OriginTag } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { ago, num } from '../lib/format'
import type { Overview, Station, SystemStatus } from '../lib/types'

const LIVE: Emphasis = { sewer: 0.8, industrial: 0.8, sample: 1, data: 0.7, alert: 0 }
const CALM: Emphasis = { sewer: 0, industrial: 0, sample: 0, data: 0, alert: 0 }

/**
 * The facility in 3D: every station at its place in the plant, with live lamps, pins and flows.
 * The layout is an illustration; the station states are real.
 */
export function Facility() {
  const { stations, selectStation } = useApp()
  const navigate = useNavigate()
  const now = useNow()
  const system = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const [focus, setFocus] = useState<Slot | null>(null)
  const [flows, setFlows] = useState(true)
  const placed = useMemo(() => assign(stations), [stations])
  const lamps = useMemo(() => lampsFor(placed), [placed])
  const alerts = useMemo(() => {
    const out: Partial<Record<Slot, 'warning' | 'critical'>> = {}
    for (const [slot, s] of Object.entries(placed) as [Slot, Station][]) if (s.status === 'warning' || s.status === 'critical') out[slot] = s.status
    return out
  }, [placed])
  const anyAlert = Object.keys(alerts).length > 0
  const emphasis = useMemo(() => (flows ? { ...LIVE, alert: anyAlert ? 1 : 0 } : CALM), [flows, anyAlert])

  const selected = focus ? placed[focus] : undefined
  const reporting = stations.filter((s) => s.status !== 'offline').length
  const open = stations.reduce((n, s) => n + s.open_alerts, 0)
  const highest = stations
    .map((s) => ({ s, r: reading(s) }))
    .filter((x) => x.r.value !== null)
    .sort((a, b) => b.r.value! - a.r.value!)[0]
  const facility = stations[0]?.facility
  const simulated = stations.some((s) => s.origin === 'simulated')

  const pins: Pin[] = [
    ...LABELS.filter(([, , slot]) => !slot || !placed[slot]).map(([a, label]) => ({ anchor: a, key: a, node: <span className="plant-label">{label}</span> })),
    ...(Object.entries(placed) as [Slot, Station][]).map(([slot, s]) => ({
      anchor: slot,
      key: s.code,
      node: <StationPin s={s} open={focus === slot} now={now} onToggle={() => setFocus(focus === slot ? null : slot)} />,
    })),
    ...(flows ? [{ anchor: 'hub' as Anchor, key: 'hub', node: <span className="plant-label hub">Analysis · {system.data?.cloud.label ?? 'service'}</span> }] : []),
  ]

  return (
    <div className="facility">
      <section className="facility-stage" aria-label="3D view of the facility">
        <PlantCanvas view="overview" focus={focus} emphasis={emphasis} lamps={lamps} alerts={alerts} pins={pins} label="3D illustration of the treatment plant with each monitoring station at its place and its live status" />
        <div className="facility-head">
          <h1>{facility ?? 'Facility'}</h1>
          <span>
            {reporting} of {stations.length} stations reporting
          </span>
        </div>
        <div className="facility-tools">
          <div className="segmented" role="group" aria-label="View">
            <button aria-pressed={!focus} onClick={() => setFocus(null)}>
              Whole plant
            </button>
            {(Object.entries(placed) as [Slot, Station][]).map(([slot, s]) => (
              <button key={slot} aria-pressed={focus === slot} onClick={() => setFocus(slot)}>
                {s.name}
              </button>
            ))}
          </div>
          <label className="facility-toggle">
            <input type="checkbox" checked={flows} onChange={(e) => setFlows(e.target.checked)} />
            Show flows
          </label>
        </div>
        <p className="facility-note">
          {simulated && <OriginTag origin="simulated" />}
          Layout is an illustration, not the site plan. Lamps, pins and rings show live station state. Drag to turn, scroll to zoom.
        </p>
      </section>

      <aside className="facility-side">
        <dl className="facility-sum">
          <div>
            <dt>Reporting</dt>
            <dd className="n">
              {reporting}
              <small>/{stations.length}</small>
            </dd>
          </div>
          <div className={open ? 'hot' : undefined}>
            <dt>Open alerts</dt>
            <dd className="n">{open}</dd>
          </div>
          <div>
            <dt>Highest</dt>
            <dd className="n" style={highest ? { color: highest.r.ink } : undefined}>
              {highest ? `${num(highest.r.value, highest.r.value! < 10 ? 1 : 0)}%` : '–'}
            </dd>
            {highest && <small>{highest.s.name}</small>}
          </div>
        </dl>

        {selected ? (
          <Detail
            s={selected}
            now={now}
            onBack={() => setFocus(null)}
            onOpen={(to) => {
              selectStation(selected.code)
              navigate(to)
            }}
          />
        ) : (
          <ul className="facility-list" aria-label="Stations">
            {(Object.entries(placed) as [Slot, Station][]).map(([slot, s]) => {
              const r = reading(s)
              return (
                <li key={s.code}>
                  <button className={r.zone !== null && r.zone >= 2 ? 'hot' : undefined} onClick={() => setFocus(slot)}>
                    <Dial value={r.value} thresholds={r.thresholds} size={58} muted={r.offline || !s.latest_assessment} label={`${s.name}: ${r.word}`} />
                    <span>
                      <b>{s.name}</b>
                      <span className="word" style={{ color: r.ink }}>
                        {r.word}
                      </span>
                      <small>
                        {s.code} · {s.last_reading_at ? ago(s.last_reading_at, now) : 'no data yet'}
                      </small>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <Link className="facility-tour" to="/plant">
          How it works: guided tour of the plant →
        </Link>
      </aside>
    </div>
  )
}

function Detail({ s, now, onBack, onOpen }: { s: Station; now: number; onBack: () => void; onOpen: (to: string) => void }) {
  const r = reading(s)
  const q = useQuery({ queryKey: ['station', s.code, 'overview', 24], queryFn: () => get<Overview>(`/stations/${s.code}/overview?hours=24`) })
  const sig = q.data?.assessment?.detail.signals
  const unit = q.data?.series.activity_unit ?? ''
  return (
    <section className="facility-detail" aria-label={`${s.name} detail`}>
      <button className="link back" onClick={onBack}>
        ← All stations
      </button>
      <h2>{s.name}</h2>
      <small>
        {s.code} · {s.origin === 'simulated' ? 'simulated' : 'live hardware'} · {s.last_reading_at ? `last reading ${ago(s.last_reading_at, now)}` : 'no readings yet'}
      </small>
      <Dial value={r.value} thresholds={r.thresholds} size={190} muted={r.offline || !s.latest_assessment} caption={r.word} />
      {!r.offline && (
        <dl className="tiles">
          <div className="ref">
            <dt>Reference</dt>
            <dd>
              {num(sig?.ref_activity)} <small>{sig?.ref_activity != null && unit}</small>
            </dd>
          </div>
          <div className="test">
            <dt>Test</dt>
            <dd>
              {num(sig?.exp_activity)} <small>{sig?.exp_activity != null && unit}</small>
            </dd>
          </div>
        </dl>
      )}
      <p className="facility-reason">{s.status_reason}</p>
      {s.open_alerts > 0 && (
        <p className="facility-alerts">
          {s.open_alerts} open {s.open_alerts === 1 ? 'alert' : 'alerts'}
        </p>
      )}
      <div className="facility-actions">
        <button className="btn primary" onClick={() => onOpen('/')}>
          Dashboard
        </button>
        <button className="btn" onClick={() => onOpen('/monitoring')}>
          Monitoring
        </button>
        <button className="btn" onClick={() => onOpen('/analysis')}>
          AI Analysis
        </button>
      </div>
    </section>
  )
}
