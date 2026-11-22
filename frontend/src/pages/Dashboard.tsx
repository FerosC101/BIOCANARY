import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ResponseDisc } from '../brand/ResponseDisc'
import { AlertList } from '../components/Alerts'
import { LineChart } from '../components/LineChart'
import { Empty, Failed, Loading, Section, StatusIcon } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { EXPOSED, REFERENCE, SUPPORT } from '../lib/colors'
import { ago, confidence, dateTime, digitsFor, num } from '../lib/format'
import type { Overview } from '../lib/types'

const SPANS = [
  [24, '24 hours'],
  [72, '3 days'],
  [168, '7 days'],
] as const
const SUPPORTING = ['dissolved_oxygen', 'ph', 'temperature']

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
  const { assessment, series, alerts, sensors } = q.data
  return (
    <div className={'page' + (q.isPlaceholderData ? ' stale' : '')}>
      <Hero data={q.data} />
      <div className="grid-main">
        <Section
          title="Biological activity"
          note={`Reference and wastewater-exposed chambers, ${series.activity_unit || 'activity'}`}
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
                { key: 'exp', label: 'Exposed', color: EXPOSED, values: series.channels.exp_activity },
              ]}
              unit={series.activity_unit}
              height={392}
              gap
              minSpan={10}
              marks={assessment?.detail.onset ? [{ at: +new Date(assessment.detail.onset), label: 'Response began to diverge' }] : []}
              label="Line chart of reference and exposed biological activity over time"
            />
          ) : (
            <Empty title="No measurements yet">The chart fills in as soon as the station sends its first valid reading.</Empty>
          )}
        </Section>
        <Section title="Recent alerts">
          {alerts.length ? <AlertList alerts={alerts} /> : <Empty title="No alerts recorded" />}
        </Section>
      </div>
      <Section title="Supporting measurements" note="Wastewater sample line">
        <div className="supports">
          {SUPPORTING.map((quantity) => {
            const s = sensors.find((x) => x.location === 'environment' && x.quantity === quantity)
            const values = series.channels[`env_${quantity}`]
            const value = s?.latest && s.connection !== 'missing' && s.connection !== 'invalid' ? s.latest.value : null
            return (
              <div key={quantity} className="support">
                <h3>{{ dissolved_oxygen: 'Dissolved oxygen', ph: 'pH', temperature: 'Temperature' }[quantity]}</h3>
                <p className="figure">
                  {num(value, digitsFor(quantity))} {value !== null && quantity !== 'ph' && <small>{s?.unit}</small>}
                </p>
                <p className="sub">{!s ? 'No sensor registered' : !s.latest ? 'Never reported' : value === null ? `Last reading ${s.latest.quality}` : s.connection === 'offline' ? `Last known, ${dateTime(s.latest.recorded_at)}` : `Latest reading, ${s.latest.quality}`}</p>
                {values?.some((v) => v !== null) && (
                  <LineChart
                    t={series.t}
                    series={[{ key: quantity, label: s?.name ?? quantity, color: SUPPORT, values }]}
                    unit={quantity === 'ph' ? '' : (s?.unit ?? '')}
                    digits={digitsFor(quantity)}
                    height={110}
                    compact
                    minSpan={quantity === 'ph' ? 0.5 : 1}
                    label={`${s?.name ?? quantity} over time`}
                  />
                )}
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

function Hero({ data }: { data: Overview }) {
  const { station, assessment: a } = data
  const now = useNow()
  const offline = station.status === 'offline'
  const sig = a?.detail.signals
  return (
    <section className={`hero s-${station.status}`} aria-label="Overall biological status">
      <div className="hero-text">
        <p className="hero-status">
          <StatusIcon status={station.status} size={22} />
          {station.status_label}
        </p>
        <h1>{offline ? (a ? 'Last known biological condition' : 'Waiting for the first reading') : (a?.detail.explanation.headline ?? station.status_reason)}</h1>
        <p className="hero-summary">
          {offline && <>{station.status_reason} </>}
          {offline && a && <>At the last reading: </>}
          {a?.detail.explanation.summary}
        </p>
        {a && (
          <p className="hero-meta">
            AI summary from {station.origin === 'simulated' ? 'simulated' : 'measured'} readings.{' '}
            <Link to="/analysis">
              View full analysis <ArrowRight size={14} aria-hidden />
            </Link>
          </p>
        )}
      </div>
      <ResponseDisc reference={sig?.ref_activity ?? null} exposed={sig?.exp_activity ?? null} unit={data.series.activity_unit} muted={offline} />
      <dl className="kpis">
        <div>
          <dt>Inhibition indicator</dt>
          <dd>{a?.inhibition == null ? '–' : `${num(a.inhibition)}%`}</dd>
          <dd className="sub">{a ? (offline ? `Last known: ${a.severity_label.toLowerCase()}` : a.severity_label) : 'Not assessed'}</dd>
        </div>
        <div>
          <dt>Inhibition risk</dt>
          <dd>{offline ? 'Unknown' : (a?.risk ?? '–')}</dd>
          <dd className="sub">{offline ? 'No current data' : a ? (a.confidence !== null ? `Confidence ${confidence(a.confidence).toLowerCase()}` : a.risk === 'Not rated' ? 'No validated thresholds' : 'Confidence not available') : ''}</dd>
        </div>
        <div>
          <dt>Reference activity</dt>
          <dd>
            {num(sig?.ref_activity)} <small>{sig?.ref_activity != null && data.series.activity_unit}</small>
          </dd>
          <dd className="sub">{sig?.reference_shift_pct != null ? `${sig.reference_shift_pct > 0 ? '+' : ''}${num(sig.reference_shift_pct)}% from its baseline` : ''}</dd>
        </div>
        <div>
          <dt>Exposed activity</dt>
          <dd>
            {num(sig?.exp_activity)} <small>{sig?.exp_activity != null && data.series.activity_unit}</small>
          </dd>
          <dd className="sub">{sig?.ref_activity && sig.exp_activity !== null ? `${Math.round((sig.exp_activity / sig.ref_activity) * 100)}% of reference` : ''}</dd>
        </div>
        <div>
          <dt>Latest analysis</dt>
          <dd>{a ? ago(a.assessed_at, now) : '–'}</dd>
          <dd className="sub">{a ? `Data to ${dateTime(a.data_until)}` : ''}</dd>
        </div>
      </dl>
    </section>
  )
}
