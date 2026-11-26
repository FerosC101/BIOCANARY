import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bird } from '../brand/Bird'
import { AlertList } from '../components/Alerts'
import { Dial } from '../components/Dial'
import { RANGE_NAMES, rangeOf, rangeText, severityWord } from '../lib/ranges'
import { LineChart } from '../components/LineChart'
import { Empty, Failed, Loading, Section } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { EXPOSED, REFERENCE } from '../lib/colors'
import { ago, num, time } from '../lib/format'
import type { Assessment, Overview, Station } from '../lib/types'

const SPANS = [
  [24, '24 h'],
  [72, '3 d'],
  [168, '7 d'],
] as const


















export function Dashboard() {
  const { station } = useApp()
  const [hours, setHours] = useState<number>(24)
  const q = useQuery({
    queryKey: ['station', station.code, 'overview', hours],
    queryFn: () => get<Overview>(`/stations/${station.code}/overview?hours=${hours}`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? keepPreviousData(prev) : undefined),
  })
  if (q.isError && !q.data) return <Failed error={q.error} retry={() => q.refetch()} />
  if (!q.data) return <Loading rows={4} />
  const { assessment: a, series, alerts } = q.data
  return (
    <div className={'page' + (q.isPlaceholderData ? ' stale' : '')}>
      <Lead data={q.data} />
      <div className="dash-grid">
        <Section
          title="Biological activity"
          note={`Reference and test chambers, ${series.activity_unit || 'activity'}. The shaded gap is the inhibition.`}
          actions={
            <div className="segmented" role="group" aria-label="Chart period">
              {SPANS.map(([h, label]) => (
                <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {series.has_data ? (
            <LineChart
              t={series.t}
              series={[
                { key: 'ref', label: 'Reference', color: REFERENCE, values: series.channels.ref_activity },
                { key: 'exp', label: 'Test', color: EXPOSED, values: series.channels.exp_activity },
              ]}
              unit={series.activity_unit}
              height={300}
              gap
              minSpan={10}
              marks={a?.detail.onset ? [{ at: +new Date(a.detail.onset), label: 'Response began to diverge' }] : []}
              label="Line chart of reference and test biological activity over time"
            />
          ) : (
            <Empty title="No measurements yet">The chart fills in as soon as the station sends its first valid reading.</Empty>
          )}
        </Section>
        <div className="dash-side">
          {a && <AiNote a={a} offline={q.data.station.status === 'offline'} />}
          <Section title="Alerts" actions={<span className="muted">{alerts.filter((x) => !x.ended_at).length} open</span>}>
            {alerts.length ? <AlertList alerts={alerts.slice(0, 4)} /> : <Empty title="No alerts recorded" />}
          </Section>
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
  const caption = offline ? 'Station offline · last known' : a ? rangeText(value, thresholds, severityWord(a.severity)) : 'Not assessed yet'
  return (
    <section className="lead" aria-label="Station that is selected">
      <div className="lead-text">
        <span className="lead-station">
          {station.name} · {station.code}
        </span>
        <h1>{offline ? (a ? 'Last known biological condition' : 'Waiting for the first reading') : (a?.detail.explanation.headline ?? station.status_reason)}</h1>
        <p>
          {offline && <>{station.status_reason} </>}
          {a?.detail.explanation.summary}
        </p>
        <dl className="tiles">
          <div className="ref">
            <dt>Reference</dt>
            <dd>
              {num(sig?.ref_activity)} <small>{sig?.ref_activity != null && series.activity_unit}</small>
            </dd>
          </div>
          <div className="test">
            <dt>Test</dt>
            <dd>
              {num(sig?.exp_activity)} <small>{sig?.exp_activity != null && series.activity_unit}</small>
            </dd>
          </div>
          <div>
            <dt>{a?.detail.onset ? 'Since' : 'Assessed'}</dt>
            <dd>{a?.detail.onset ? time(a.detail.onset) : a ? ago(a.assessed_at, now) : '–'}</dd>
          </div>
        </dl>
      </div>
      <Dial value={value} thresholds={thresholds} caption={caption} muted={offline || !a} />
    </section>
  )
}

function AiNote({ a, offline }: { a: Assessment; offline: boolean }) {
  const f = a.detail.factors.find((x) => x.strength !== 'none')
  const sig = a.detail.signals
  const quiet = a.severity === 'normal' || a.severity === 'unclassified'
  const text = f
    ? `${f.label} moved ${f.lead_minutes ? `${Math.round(f.lead_minutes)} min before` : 'with'} the response${f.rho !== null ? ` (correlation ${num(f.rho, 2)})` : ''}. A correlation, not proof of cause.`
    : offline
      ? 'No recent readings, so there is nothing new to compare with the supporting measurements.'
      : !sig.baseline_ready
        ? a.detail.explanation.abnormality
        : quiet && sig.z_response !== null
          ? `Nothing unusual to explain. The test-to-reference ratio is ${num(Math.abs(sig.z_response), 1)} robust SD from this station's usual value.`
          : 'No supporting measurement moved with this response, so no candidate factor is shown.'
  return (
    <aside className="ai-note" aria-label="AI note">
      <Bird className="ai-bird" />
      <div>
        <p>{text}</p>
        <Link to="/analysis">See the evidence →</Link>
      </div>
    </aside>
  )
}

function Fleet() {
  const { stations, station, selectStation } = useApp()
  return (
    <section aria-label="All stations">
      <div className="fleet-head">
        <h2>Stations</h2>
        <Link to="/plant">See them on the plant · how it works →</Link>
      </div>
      <div className="fleet">
        {stations.map((s) => (
          <StationCard key={s.code} s={s} current={s.code === station.code} onPick={() => selectStation(s.code)} />
        ))}
      </div>
    </section>
  )
}

function StationCard({ s, current, onPick }: { s: Station; current: boolean; onPick: () => void }) {
  const now = useNow()
  const l = s.latest_assessment
  const offline = s.status === 'offline'
  const value = offline ? null : (l?.inhibition ?? null)
  const zone = rangeOf(value, l?.thresholds ?? null)
  const word = offline ? 'Offline' : !l ? s.status_label : zone !== null ? `${RANGE_NAMES[zone]} range` : severityWord(l.severity)
  const ink = zone === null ? 'var(--ink-2)' : ['var(--ok-ink)', '#E6F07A', 'var(--warn-ink)', 'var(--crit-ink)'][zone]
  return (
    <button className={zone !== null && zone >= 2 ? 'hot' : undefined} aria-current={current} onClick={onPick}>
      <Dial value={value} thresholds={l?.thresholds ?? null} size={74} muted={offline || !l} label={`${s.name}: ${word}`} />
      <span>
        <b>{s.name}</b>
        <span className="word" style={{ color: ink }}>
          {word}
        </span>
        <small>
          {s.code} · {s.origin === 'simulated' ? 'simulated' : 'live hardware'} · {s.last_reading_at ? ago(s.last_reading_at, now) : 'no data yet'}
        </small>
      </span>
    </button>
  )
}
