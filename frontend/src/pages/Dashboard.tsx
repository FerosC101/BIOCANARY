import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bird } from '../brand/Bird'
import { AlertList } from '../components/Alerts'
import { Dial } from '../components/Dial'
import { LineChart } from '../components/LineChart'
import { Dialog, Empty, Failed, Loading } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { EXPOSED, REFERENCE } from '../lib/colors'
import { ago, num, time } from '../lib/format'
import { RANGE_NAMES, rangeOf, rangeText, SEVERITY_ZONE, severityWord, ZONE } from '../lib/ranges'
import { resample, timeLabels } from '../lib/series'
import type { Alert, Assessment, Overview, Station } from '../lib/types'

export function Dashboard() {
  const { station } = useApp()
  const q = useQuery({
    queryKey: ['station', station.code, 'overview', 24],
    queryFn: () => get<Overview>(`/stations/${station.code}/overview?hours=24`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? keepPreviousData(prev) : undefined),
  })
  if (q.isError && !q.data) return <Failed error={q.error} retry={() => q.refetch()} />
  if (!q.data) return <Loading rows={4} />
  const { assessment: a, series, alerts } = q.data
  const view = resample(series, 60)
  return (
    <div className={'page dash' + (q.isPlaceholderData ? ' stale' : '')}>
      <Lead data={q.data} />
      <div className="b-row">
        <section className="b-card b-chart">
          <div className="b-head">
            <h2>Last 24 hours</h2>
            <div className="b-key">
              <span>
                <i style={{ background: '#8FB6FF', boxShadow: '0 0 6px #2F6BFF' }} />
                Reference
              </span>
              <span>
                <i style={{ background: '#7CF09A', boxShadow: '0 0 6px #4FD96B' }} />
                Test
              </span>
              <span>
                <i className="gap" />
                Gap
              </span>
            </div>
          </div>
          {series.has_data ? (
            <>
              <LineChart
                t={view.t}
                series={[
                  { key: 'ref', label: 'Reference', color: REFERENCE, values: view.channels.ref_activity },
                  { key: 'exp', label: 'Test', color: EXPOSED, values: view.channels.exp_activity },
                ]}
                unit={series.activity_unit}
                height={290}
                gap
                under="exp"
                smooth
                minimal
                legend={false}
                xAxis={false}
                yLabels={false}
                pad={{ l: 2, r: 8 }}
                minSpan={10}
                marks={a?.detail.onset ? [{ at: +new Date(a.detail.onset), label: 'Response began to diverge' }] : []}
                label="Hourly averages of reference and test biological activity over the last 24 hours. Hover for values."
              />
              <div className="b-times n">
                {timeLabels(view.t).map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
            </>
          ) : (
            <Empty title="No measurements yet">The chart fills in as soon as the station sends its first valid reading.</Empty>
          )}
        </section>
        <div className="b-side">
          {a && <AiNote a={a} offline={q.data.station.status === 'offline'} />}
          <AlertsCard alerts={alerts} />
        </div>
      </div>
      <Fleet />
    </div>
  )
}

function Lead({ data }: { data: Overview }) {
  const { station, assessment: a, series } = data
  const now = useNow()
  const offline = station.status === 'offline'
  const sig = a?.detail.signals
  const thresholds = a?.detail.threshold.used ? a.detail.threshold.values : null
  const value = a?.inhibition ?? null
  const zone = offline ? null : rangeOf(value, thresholds)
  const caption = offline ? 'Station offline · last known' : a ? rangeText(value, thresholds, severityWord(a.severity)) : 'Not assessed yet'
  const hot = zone !== null && zone >= 1
  const ink = zone === null ? '#EAF2FF' : zone === 0 ? '#C9FFD6' : '#FFE2B0'
  const glow = zone === null ? 'none' : `0 0 24px ${zone === 0 ? 'rgba(79,217,107,.7)' : 'rgba(255,181,71,.7)'}`
  return (
    <section className="b-lead" aria-label="Station that is selected">
      <div className="b-lead-text">
        <span className="b-kicker">
          {station.name} · {station.code}
        </span>
        <h1>
          {offline ? (
            a ? 'Last known condition' : 'Waiting for the first reading'
          ) : value === null || !sig ? (
            (a?.detail.explanation.headline ?? station.status_reason)
          ) : Math.abs(value) < 1 ? (
            <>
              Test culture is <span style={{ color: ink, textShadow: glow }}>level</span> with its reference
            </>
          ) : (
            <>
              Test culture is{' '}
              <span style={{ color: ink, textShadow: glow }}>
                {num(Math.abs(value), 0)}% {value > 0 ? 'below' : 'above'}
              </span>{' '}
              its reference
            </>
          )}
        </h1>
        {offline && <p className="b-sub">{station.status_reason}</p>}
        <dl className="b-tiles n">
          <div>
            <dt>Reference</dt>
            <dd className="ref">
              {num(sig?.ref_activity)} <small>{sig?.ref_activity != null && series.activity_unit}</small>
            </dd>
          </div>
          <div>
            <dt>Test</dt>
            <dd className="test">
              {num(sig?.exp_activity)} <small>{sig?.exp_activity != null && series.activity_unit}</small>
            </dd>
          </div>
          <div>
            <dt>{a?.detail.onset && hot ? 'Since' : 'Assessed'}</dt>
            <dd>{a?.detail.onset && hot ? time(a.detail.onset) : a ? ago(a.assessed_at, now) : '–'}</dd>
          </div>
        </dl>
      </div>
      <Dial value={value} thresholds={thresholds} caption={caption} muted={offline || !a} size={290} />
    </section>
  )
}

function AiNote({ a, offline }: { a: Assessment; offline: boolean }) {
  const f = a.detail.factors.find((x) => x.strength !== 'none')
  const sig = a.detail.signals
  const quiet = a.severity === 'normal' || a.severity === 'unclassified'
  const digits = f ? ({ ph: 2, conductivity: 0, dissolved_oxygen: 2 }[f.quantity] ?? 1) : 1
  return (
    <section className="b-card b-note" aria-label="AI note">
      <Bird className="b-bird" />
      <div>
        <p>
          {f ? (
            <>
              {f.label} {f.peak < f.baseline ? 'fell' : 'rose'} to <b>{num(f.peak, digits)}</b>
              {f.lead_minutes && f.lead_minutes > 0 ? ` about ${Math.round(f.lead_minutes)} minutes before the slowdown` : ' as the culture slowed'}. A correlation, not proof.
            </>
          ) : offline ? (
            'No recent readings, so there is nothing new to compare with the supporting measurements.'
          ) : !sig.baseline_ready ? (
            a.detail.explanation.abnormality
          ) : quiet && sig.z_response !== null ? (
            <>
              Nothing unusual to explain. The test-to-reference ratio is <b>{num(Math.abs(sig.z_response), 1)}</b> robust SD from this station’s usual value.
            </>
          ) : (
            'No supporting measurement moved with this response, so no candidate factor is shown.'
          )}
        </p>
        <Link to="/analysis">See evidence →</Link>
      </div>
    </section>
  )
}

function dotFor(x: Alert): string {
  if (x.kind === 'offline') return '#9FB4DA'
  if (x.kind === 'sensor') return '#FFB547'
  const zone = SEVERITY_ZONE[x.severity]
  return zone != null ? ZONE[zone] : '#FFB547'
}

function AlertsCard({ alerts }: { alerts: Alert[] }) {
  const { station } = useApp()
  const [open, setOpen] = useState(false)
  const openOnes = alerts.filter((x) => !x.ended_at)
  // Open alerts first, then past biological events; ended connectivity episodes stay in Reports.
  const shown = [...openOnes, ...alerts.filter((x) => x.ended_at && x.kind !== 'offline' && x.kind !== 'sensor')].slice(0, 3)
  return (
    <section className="b-card b-alerts">
      <div className="b-head">
        <h2>Alerts</h2>
        <span className={'b-count n' + (openOnes.length ? ' hot' : '')} title={`${openOnes.length} open`}>
          {openOnes.length}
        </span>
      </div>
      {shown.length ? (
        shown.map((x) => (
          <div key={x.id} className="b-alert">
            <i style={{ background: dotFor(x), boxShadow: `0 0 10px ${dotFor(x)}` }} />
            <div>
              <div className="t">{x.title}</div>
              <div className="m n">
                {station.name} · {time(x.started_at)}
                {x.ended_at ? ' · ended' : ''}
              </div>
            </div>
          </div>
        ))
      ) : (
        <p className="b-quiet">No alerts in the last 24 hours.</p>
      )}
      <button className="b-cta" onClick={() => setOpen(true)} disabled={!alerts.length}>
        Review alerts
      </button>
      {open && (
        <Dialog title={`Alerts at ${station.name}`} onClose={() => setOpen(false)}>
          <AlertList alerts={alerts} />
        </Dialog>
      )}
    </section>
  )
}

function Fleet() {
  const { stations, station, selectStation } = useApp()
  return (
    <section className="b-fleet" aria-label="Stations">
      {stations.map((s) => (
        <StationCard key={s.code} s={s} current={s.code === station.code} onPick={() => selectStation(s.code)} />
      ))}
    </section>
  )
}

function StationCard({ s, current, onPick }: { s: Station; current: boolean; onPick: () => void }) {
  const now = useNow()
  const l = s.latest_assessment
  const offline = s.status === 'offline'
  const value = offline ? null : (l?.inhibition ?? null)
  const zone = rangeOf(value, l?.thresholds ?? null)
  const word = offline ? 'Offline' : !l ? s.status_label : zone !== null ? (zone ? rangeText(value, l.thresholds, '') : `${RANGE_NAMES[zone]} range`) : severityWord(l.severity)
  const ink = zone === null ? '#C6D2EA' : ['#9FF5B4', '#E6F07A', '#FFD08A', '#FF8A80'][zone]
  const frame = zone !== null && zone >= 2 ? 'hot' : current ? 'current' : ''
  return (
    <button className={`b-station ${frame}`} aria-current={current} onClick={onPick}>
      <Dial value={value} thresholds={l?.thresholds ?? null} size={76} muted={offline || !l} label={`${s.name}: ${word}`} />
      <span>
        <span className="name">{s.name}</span>
        <span className="word" style={{ color: ink }}>
          {word}
        </span>
        <span className="foot n">
          {s.code} · {offline && s.last_reading_at ? `last ${time(s.last_reading_at)}` : s.last_reading_at ? ago(s.last_reading_at, now) : 'no data yet'}
        </span>
      </span>
    </button>
  )
}
