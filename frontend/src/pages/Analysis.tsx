import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LineChart } from '../components/LineChart'
import { MethodPanel } from '../components/Method'
import { Dial } from '../components/Dial'
import { rangeText, severityWord } from '../lib/ranges'
import { Empty, Failed, Loading, Section, SeverityBadge } from '../components/ui'
import { get, post } from '../lib/api'
import { useApp } from '../lib/app'
import { INDICATOR } from '../lib/colors'
import { confidence, dateTime, day, duration, num } from '../lib/format'
import { query } from '../lib/range'
import type { AnalysisView, Assessment, AssessmentRow, Factor, Patterns, Series } from '../lib/types'

export function Analysis() {
  const { station } = useApp()
  const qc = useQueryClient()
  const [id, setId] = useState<number | null>(null)
  useEffect(() => setId(null), [station.code])
  const q = useQuery({
    queryKey: ['station', station.code, 'analysis', id],
    queryFn: () => get<AnalysisView>(`/stations/${station.code}/analysis${id ? `?id=${id}` : ''}`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? prev : undefined),
  })
  const history = useQuery({
    queryKey: ['station', station.code, 'assessments'],
    queryFn: () => get<AssessmentRow[]>(`/stations/${station.code}/assessments?${query({ preset: '7d' }, { limit: '1500' })}`),
  })
  const run = useMutation({
    mutationFn: () => post(`/stations/${station.code}/analysis/run`),
    onSuccess: () => {
      setId(null)
      qc.invalidateQueries({ queryKey: ['station', station.code] })
    },
  })
  if (q.isError && !q.data) return <Failed error={q.error} retry={() => q.refetch()} />
  if (!q.data) return <Loading rows={4} />
  const { assessment: a, patterns, is_latest } = q.data
  if (!a)
    return (
      <div className="page">
        <Section title="AI analysis">
          <Empty title="Nothing to assess yet">Assessments start when both chambers send valid activity readings. Anomaly detection starts once a baseline has been collected.</Empty>
        </Section>
        <MethodPanel />
      </div>
    )
  return (
    <div className={'page' + (q.isPlaceholderData ? ' stale' : '')}>
      {!is_latest && (
        <p className="notice inline">
          You are viewing a past assessment from {dateTime(a.data_until)}.{' '}
          <button className="link" onClick={() => setId(null)}>
            Return to the latest
          </button>
        </p>
      )}
      <Verdict a={a} onRun={() => run.mutate()} running={run.isPending} />
      {run.isError && <p className="error">{run.error.message}</p>}
      <div className="grid-2">
        <Section title="What was measured" note={`Unusual pattern: ${a.detail.explanation.abnormality.charAt(0).toLowerCase()}${a.detail.explanation.abnormality.slice(1)}`}>
          <dl className="evidence">
            {a.detail.explanation.evidence.map((e) => (
              <div key={e.label}>
                <dt>
                  {e.label}
                  <small>{e.note}</small>
                </dt>
                <dd>{e.value}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <Section title="Recommended next steps">
          <ol className="steps">
            {a.detail.explanation.recommendations.map((r) => (
              <li key={r.action}>
                <b>{r.action}</b>
                <span>{r.reason}</span>
              </li>
            ))}
          </ol>
          <p className="caution">This assessment supports a decision by qualified personnel. It does not establish that wastewater is safe or unsafe, and does not replace laboratory testing.</p>
        </Section>
      </div>
      <Factors a={a} />
      <Section title="Assessment history" note="Inhibition indicator over the last 7 days. Select a point to open that assessment.">
        {history.data && history.data.length > 1 ? (
          <History rows={history.data} thresholds={a.detail.threshold.used ? a.detail.threshold.values : null} onSelect={setId} current={a} />
        ) : history.isPending ? (
          <Loading rows={2} />
        ) : (
          <Empty title="No assessments in the last 7 days" />
        )}
      </Section>
      {patterns && <PatternPanel p={patterns} />}
      <MethodPanel assessment={a} />
    </div>
  )
}

function Verdict({ a, onRun, running }: { a: Assessment; onRun: () => void; running: boolean }) {
  const d = a.detail
  const ranges = d.threshold.used && a.severity !== 'inconclusive' ? d.threshold.values : null
  const status = { severe: 'critical', moderate: 'warning', mild: 'warning', normal: 'healthy', unclassified: a.anomaly ? 'warning' : 'pending', inconclusive: 'warning', insufficient: 'offline' }[a.severity]
  return (
    <section className={`verdict s-${status}`} aria-label="Current assessment">
      <div className="verdict-head verdict-top">
        <div>
          <SeverityBadge severity={a.severity} />
          <h1>{d.explanation.headline}</h1>
          <p>{d.explanation.summary}</p>
          <button className="btn" onClick={onRun} disabled={running} style={{ marginTop: 18 }}>
            <RefreshCw size={15} aria-hidden className={running ? 'spin' : ''} /> Analyse now
          </button>
        </div>
        <Dial
          value={a.inhibition}
          thresholds={ranges}
          size={250}
          caption={ranges ? rangeText(a.inhibition, ranges, severityWord(a.severity)) : severityWord(a.severity)}
          muted={a.severity === 'insufficient'}
        />
      </div>
      {!ranges && <p className="scale-off">No ranges drawn. {a.severity === 'inconclusive' ? 'The reference chamber is outside its normal range.' : d.threshold.reason}</p>}
      <dl className="verdict-facts">
        <div>
          <dt>Confidence</dt>
          <dd>{a.confidence === null ? 'Not available' : confidence(a.confidence)}</dd>
          <dd className="sub">{d.confidence_reason}</dd>
        </div>
        <div>
          <dt>Classified by</dt>
          <dd>{d.method === 'none' ? 'Not classified' : d.method[0].toUpperCase() + d.method.slice(1)}</dd>
          <dd className="sub">{d.threshold.reason}</dd>
        </div>
        <div>
          <dt>Trained model</dt>
          <dd>{!d.model.used ? 'Not applied' : d.agreement === null ? 'Applied' : d.agreement ? 'Agrees' : `Disagrees: ${d.model.prediction?.label}`}</dd>
          <dd className="sub">{d.model.reason}</dd>
        </div>
        <div>
          <dt>{d.onset ? 'Response began' : 'Data to'}</dt>
          <dd>{dateTime(d.onset ?? a.data_until)}</dd>
          <dd className="sub">{d.onset ? `${duration((+new Date(a.data_until) - +new Date(d.onset)) / 60000)} before the latest reading assessed` : `Assessed ${dateTime(a.assessed_at)}`}</dd>
        </div>
      </dl>
    </section>
  )
}


function Factors({ a }: { a: Assessment }) {
  const d = a.detail
  const abnormal = a.anomaly || ['mild', 'moderate', 'severe'].includes(a.severity)
  return (
    <Section title="Potential contributing factors" note="Supporting measurements that changed around the same time. These are associations, not proven causes.">
      {!abnormal ? (
        <p className="sub">There is no abnormal response to relate to other measurements.</p>
      ) : (
        <>
          {d.factors.length ? (
            <div className="factors">
              {d.factors.map((f) => (
                <FactorRow key={f.quantity} f={f} />
              ))}
            </div>
          ) : (
            <p className="sub">No supporting measurement has enough history for a comparison.</p>
          )}
          <h3 className="chart-title">Recorded events before the response</h3>
          {d.nearby_events.length ? (
            <ul className="plain">
              {d.nearby_events.map((e) => (
                <li key={e.occurred_at + e.kind}>
                  <b>{e.kind[0].toUpperCase() + e.kind.slice(1)}</b>, {dateTime(e.occurred_at)}
                  {e.note && `. ${e.note}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub">No sampling, discharge or maintenance events were logged in the 12 hours before the response.</p>
          )}
        </>
      )}
    </Section>
  )
}

const STRENGTH = { strong: 'Strong association', moderate: 'Changed in the same period', none: 'No unusual change' }

function FactorRow({ f }: { f: Factor }) {
  const z = Math.max(-12, Math.min(12, f.deviation_z))
  const digits = { ph: 2, conductivity: 0, dissolved_oxygen: 2 }[f.quantity] ?? 1
  return (
    <div className={`factor ${f.strength}`}>
      <b>{f.label}</b>
      <span className="tnum">
        {num(f.baseline, digits)} → {num(f.peak, digits)}
      </span>
      <svg viewBox="-13 0 26 10" preserveAspectRatio="none" role="img" aria-label={`Deviation ${num(f.deviation_z)} standard deviations from baseline`}>
        <rect className="track" x="-12" y="4.2" width="24" height="1.6" rx="0.8" />
        <rect className="bar" x={Math.min(0, z)} y="2.6" width={Math.abs(z)} height="4.8" />
        <rect className="zero" x="-0.06" y="0" width="0.12" height="10" />
      </svg>
      <span className="tnum">{f.deviation_z > 0 ? '+' : ''}{num(f.deviation_z)} SD</span>
      <span className="factor-note">
        {STRENGTH[f.strength]}
        {f.lead_minutes !== null && <small>{f.lead_minutes > 0 ? `Began ${duration(f.lead_minutes)} before the response` : f.lead_minutes < 0 ? `Began ${duration(-f.lead_minutes)} after the response` : 'Began with the response'}</small>}
        {f.strength !== 'none' && f.rho !== null && (
          <small>
            Rank correlation {num(f.rho, 2)} at {f.lag_minutes} min lag, about {num(f.effective_n, 0)} independent points
          </small>
        )}
      </span>
    </div>
  )
}

function History({ rows, thresholds, onSelect, current }: { rows: AssessmentRow[]; thresholds: Series['thresholds'] | null; onSelect: (id: number) => void; current: Assessment }) {
  const asc = [...rows].reverse()
  const t = asc.map((r) => +new Date(r.data_until))
  const nearest = (x: number) => asc.reduce((best, r) => (Math.abs(+new Date(r.data_until) - x) < Math.abs(+new Date(best.data_until) - x) ? r : best))
  return (
    <LineChart
      t={t}
      series={[{ key: 'i', label: 'Inhibition indicator', color: INDICATOR, values: asc.map((r) => r.inhibition) }]}
      unit="%"
      height={190}
      includeZero
      area
      minSpan={15}
      guides={thresholds ? (['mild', 'moderate', 'severe'] as const).map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: thresholds[k]! })) : []}
      marks={[{ at: +new Date(current.data_until), label: 'Assessment shown' }]}
      onSelect={(x) => onSelect(nearest(x).id)}
      label="Inhibition indicator from stored assessments. Press Enter on a point to open it."
    />
  )
}

const HOURS = ['00–03', '03–06', '06–09', '09–12', '12–15', '15–18', '18–21', '21–24']

function PatternPanel({ p }: { p: Patterns }) {
  const days: Patterns['daily'] = []
  const by = new Map(p.daily.map((d) => [d.date, d]))
  for (let i = p.days - 1; i >= 0; i--) {
    const date = new Date(+new Date(p.to) - i * 86400_000).toLocaleDateString('en-CA', { timeZone: p.timezone })
    days.push(by.get(date) ?? { date, max_inhibition: null, severity: 'insufficient', withheld: 0, count: 0 })
  }
  const top = Math.max(1, ...p.by_hour)
  return (
    <Section title="Historical patterns" note={`${p.episode_count} abnormal ${p.episode_count === 1 ? 'event' : 'events'} in ${p.days} days${p.median_hours ? `, typically lasting ${duration(p.median_hours * 60)}` : ''}`}>
      <h3 className="chart-title">Highest severity each day</h3>
      <div className="days">
        {days.map((d) => (
          <span
            key={d.date}
            tabIndex={0}
            className={`day sev-${d.count ? d.severity : 'none'}`}
            data-tip={`${day(d.date + 'T12:00')}: ${d.count ? d.severity + (d.max_inhibition !== null ? `, peak ${num(d.max_inhibition, 0)}%` : '') + (d.withheld ? ', some withheld' : '') : 'no assessments'}`}
          />
        ))}
      </div>
      <div className="day-key">
        <span>
          {day(days[0].date + 'T12:00')} to {day(days[days.length - 1].date + 'T12:00')}
        </span>
        {(['normal', 'mild', 'moderate', 'severe', 'none'] as const).map((s) => (
          <span key={s}>
            <i className={`day sev-${s}`} />
            {s === 'none' ? 'No assessments' : s[0].toUpperCase() + s.slice(1)}
          </span>
        ))}
      </div>
      <div className="grid-3">
        <div>
          <h3 className="chart-title">Events by time of day ({p.timezone})</h3>
          <div className="hours">
            {p.by_hour.map((n, i) => (
              <div key={HOURS[i]} tabIndex={0} data-tip={`${HOURS[i]}: ${n} ${n === 1 ? 'event' : 'events'}`}>
                <span className="col">
                  <i style={{ height: `${(n / top) * 100}%` }} />
                </span>
                <small>{HOURS[i].slice(0, 2)}</small>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="chart-title">Associated measurements in {p.past_count} earlier {p.past_count === 1 ? 'event' : 'events'}</h3>
          {p.factors.length ? (
            <ul className="plain">
              {p.factors.map((f) => (
                <li key={f.label}>
                  <b>{f.label}</b>, in {f.count} of {p.past_count}
                </li>
              ))}
            </ul>
          ) : (
            <p className="sub">No supporting measurement changed with earlier events.</p>
          )}
        </div>
        <div>
          <h3 className="chart-title">{p.similar.length ? 'Similar earlier events' : 'Earlier events'}</h3>
          <ul className="plain">
            {(p.similar.length ? p.similar : p.episodes.filter((e) => e.ended_at).slice(0, 3)).map((e) => (
              <li key={e.id}>
                <b>{day(e.started_at)}</b>, {e.severity}
                {e.peak_inhibition !== null && `, peak ${num(e.peak_inhibition, 0)}%`}, {duration(e.hours * 60)}
              </li>
            ))}
            {!p.episodes.some((e) => e.ended_at) && <li className="sub">None recorded.</li>}
          </ul>
        </div>
      </div>
    </Section>
  )
}
