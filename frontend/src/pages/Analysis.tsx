import { useQuery } from '@tanstack/react-query'
import { Check, Minus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { LineChart } from '../components/LineChart'
import { MethodPanel } from '../components/Method'
import { Dial } from '../components/Dial'
import { rangeText, severityWord } from '../lib/ranges'
import { Empty, Failed, Loading, Section } from '../components/ui'
import { get } from '../lib/api'
import { useApp } from '../lib/app'
import { INDICATOR } from '../lib/colors'
import { confidence, dateTime, day, duration, num, percent, time } from '../lib/format'
import { query } from '../lib/range'
import { timeLabels } from '../lib/series'
import type { Alert, AnalysisView, Assessment, AssessmentRow, Patterns, Series } from '../lib/types'

export function Analysis() {
  const { station } = useApp()
  const [id, setId] = useState<number | null>(null)
  const [more, setMore] = useState(false)
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
  const day = { preset: '24h' } as const
  const series = useQuery({ queryKey: ['station', station.code, 'series', day], queryFn: () => get<Series>(`/stations/${station.code}/series?${query(day)}`) })
  if (q.isError && !q.data) return <Failed error={q.error} retry={() => q.refetch()} />
  if (!q.data) return <Loading rows={4} />
  const { assessment: a, patterns, is_latest, alert } = q.data
  if (!a)
    return (
      <div className="page">
        <Section title="AI analysis">
          <Empty title="Nothing to assess yet">Assessments start when both chambers send valid activity readings. Anomaly detection starts once a baseline has been collected.</Empty>
        </Section>
        <MethodPanel />
      </div>
    )
  const abnormal = a.anomaly || ['mild', 'moderate', 'severe'].includes(a.severity)
  return (
    <div className={'page ai' + (q.isPlaceholderData ? ' stale' : '')}>
      {!is_latest && (
        <p className="notice inline">
          You are viewing a past assessment from {dateTime(a.data_until)}.{' '}
          <button className="link" onClick={() => setId(null)}>
            Return to the latest
          </button>
        </p>
      )}
      <Verdict a={a} />
      <Facts a={a} alert={alert} rows={history.data} />
      {series.data?.has_data && is_latest && <Unfolded a={a} alert={alert} s={series.data} />}
      <div className="b-row">
        <Moved a={a} abnormal={abnormal} />
        <Checks a={a} />
      </div>
      {patterns && <DayStrip p={patterns} />}
      <section className="b-card b-more-card">
        <div className="b-head">
          <h2>Assessment history</h2>
          <button className="btn" aria-expanded={more} onClick={() => setMore(!more)}>
            {more ? 'Hide' : 'Show'}
          </button>
        </div>
        {more && (
          <>
            <p className="b-quiet">Inhibition indicator, last 7 days. Select a point to open that assessment.</p>
            {history.data && history.data.length > 1 ? <History rows={history.data} thresholds={a.detail.threshold.used ? a.detail.threshold.values : null} onSelect={setId} current={a} /> : <Loading rows={2} />}
            {patterns && <PatternDetails p={patterns} />}
          </>
        )}
      </section>
      <MethodPanel assessment={a} />
    </div>
  )
}

function Verdict({ a }: { a: Assessment }) {
  const d = a.detail
  const ranges = d.threshold.used && a.severity !== 'inconclusive' ? d.threshold.values : null
  const word = ranges ? rangeText(a.inhibition, ranges, severityWord(a.severity)).split(' · ')[0] : severityWord(a.severity)
  const pred = d.model.prediction
  const chips: { text: string; warn?: boolean }[] = [
    { text: d.model.used ? `Classifier ${(pred?.model_version ?? a.model_version).replace(/-[0-9a-f]{6}$/, '')}` : 'No classifier applied' },
    { text: d.threshold.used ? (d.origin === 'simulated' ? 'Demonstration thresholds' : 'Validated thresholds') : 'No validated ranges' },
    ...(pred ? [{ text: `Trained on ${pred.training_origin} data${pred.training_origin === 'simulated' ? ' only' : ''}`, warn: pred.training_origin === 'simulated' }] : []),
  ]
  return (
    <section className="b-verdict" aria-label="Current assessment">
      <div className="txt">
        <h1>{d.explanation.headline}</h1>
        <p>{d.explanation.summary}</p>
        <div className="b-chips">
          {chips.map((c) => (
            <span key={c.text} className={c.warn ? 'warn' : undefined}>
              {c.text}
            </span>
          ))}
        </div>
        {!ranges && <p className="scale-off">No ranges drawn. {a.severity === 'inconclusive' ? 'The reference chamber is outside its normal range.' : d.threshold.reason}</p>}
      </div>
      <Dial value={a.inhibition} thresholds={ranges} size={260} caption={`${word}${a.confidence !== null ? ` · confidence ${confidence(a.confidence).toLowerCase()}` : ''}`} muted={a.severity === 'insufficient'} />
    </section>
  )
}

/** Five figures: about the event when there is one, otherwise about how trustworthy the reading is. */
function Facts({ a, alert, rows }: { a: Assessment; alert: Alert | null; rows?: AssessmentRow[] }) {
  const d = a.detail
  const sig = d.signals
  const z = sig.z_response
  const onset = d.onset ? +new Date(d.onset) : null
  const until = +new Date(a.data_until)
  const after = onset && rows ? rows.filter((r) => +new Date(r.data_until) >= onset && r.inhibition !== null).map((r) => r.inhibition as number) : []
  const peak = after.length ? Math.max(...after) : null
  const facts: { label: string; value: string; note: string }[] = onset
    ? [
        { label: 'Onset', value: time(onset), note: 'gap opened' },
        { label: 'Detected', value: alert ? time(alert.started_at) : '–', note: alert ? `${duration(Math.max(0, (+new Date(alert.started_at) - onset) / 60000))} later` : 'not yet confirmed' },
        { label: 'Duration', value: duration((until - onset) / 60000), note: alert?.ended_at ? 'ended' : 'still open' },
        { label: 'Peak', value: peak !== null ? `${num(peak)}%` : '–', note: 'since onset' },
        { label: 'Anomaly score', value: z === null ? '–' : num(z, 1), note: 'robust z' },
      ]
    : [
        { label: 'Anomaly score', value: z === null ? '–' : num(z, 1), note: 'robust z · flagged beyond ±4' },
        { label: 'Reference', value: sig.reference_shift_pct === null ? '–' : `${sig.reference_shift_pct > 0 ? '+' : ''}${num(sig.reference_shift_pct)}%`, note: 'against its own baseline' },
        { label: 'Paired readings', value: percent(sig.valid_fraction, 0), note: 'valid in the window' },
        { label: 'Baseline', value: sig.baseline_ready ? duration(sig.baseline_hours * 60) : 'collecting', note: 'history compared against' },
        { label: 'Confidence', value: a.confidence === null ? '–' : confidence(a.confidence), note: a.confidence === null ? 'no calibrated model' : 'calibrated model' },
      ]
  return (
    <section className="b-facts" aria-label="Key facts">
      {facts.map((f) => (
        <div key={f.label}>
          <div className="l">{f.label}</div>
          <div className="v n">{f.value}</div>
          <div className="t">{f.note}</div>
        </div>
      ))}
    </section>
  )
}

/**
 * Inhibition over the last 24 hours with the most associated supporting measurement drawn in the
 * same frame, as on the design board. The supporting line has its own scale and no axis: it shows
 * timing, and its values are given on hover.
 */
function Unfolded({ a, alert, s }: { a: Assessment; alert: Alert | null; s: Series }) {
  const [hover, setHover] = useState<number | null>(null)
  const d = a.detail
  const top = [...d.factors].filter((f) => f.strength !== 'none').sort((x, y) => Math.abs(y.rho ?? 0) - Math.abs(x.rho ?? 0))[0]
  const quantity = top?.quantity ?? 'ph'
  const name = top ? top.label : 'Sample pH'
  const inh = s.channels.inhibition ?? []
  const sup = s.channels[`env_${quantity}`] ?? []
  const t0 = s.t[0]
  const t1 = s.t[s.t.length - 1]
  const W = 1000
  const H = 200
  const x = (ms: number) => ((ms - t0) / Math.max(1, t1 - t0)) * W
  const inhVals = inh.filter((v): v is number => v !== null)
  const top100 = Math.max(55, Math.ceil(Math.max(0, ...inhVals) * 1.15))
  const low = Math.min(0, ...inhVals)
  const yI = (v: number) => H - 8 - ((v - low) / (top100 - low)) * (H - 16)
  const supVals = sup.filter((v): v is number => v !== null)
  const sLo = Math.min(...supVals)
  const sHi = Math.max(...supVals)
  const pad = Math.max((sHi - sLo) * 0.2, quantity === 'ph' ? 0.25 : 1)
  const yS = (v: number) => 20 + (1 - (v - (sLo - pad)) / (sHi - sLo + pad * 2)) * 80
  const path = (vals: (number | null)[], y: (v: number) => number) => {
    let out = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) return void (pen = false)
      out += `${pen ? 'L' : 'M'}${x(s.t[i]).toFixed(1)} ${y(v).toFixed(1)}`
      pen = true
    })
    return out
  }
  const inhLine = path(inh, yI)
  let area = ''
  {
    let run: number[] = []
    const flush = () => {
      if (run.length > 1) area += `M${x(s.t[run[0]]).toFixed(1)} ${yI(low).toFixed(1)}` + run.map((i) => `L${x(s.t[i]).toFixed(1)} ${yI(inh[i] as number).toFixed(1)}`).join('') + `L${x(s.t[run[run.length - 1]]).toFixed(1)} ${yI(low).toFixed(1)}Z`
      run = []
    }
    inh.forEach((v, i) => (v === null ? flush() : run.push(i)))
    flush()
  }
  const th = d.threshold.used ? d.threshold.values : null
  const marks = [
    ...(d.onset && top?.lead_minutes ? [{ at: +new Date(d.onset) - top.lead_minutes * 60000, label: `${name.replace('Wastewater ', '').replace('Sample ', '')} ${top.peak < top.baseline ? 'drop' : 'rise'}`, cls: 'sup' }] : []),
    ...(d.onset ? [{ at: +new Date(d.onset), label: 'onset', cls: 'onset' }] : []),
    ...(alert ? [{ at: +new Date(alert.started_at), label: 'detected', cls: 'det' }] : []),
  ].filter((m) => m.at >= t0 && m.at <= t1)
  const index = hover === null ? null : s.t.reduce((b, v, i) => (Math.abs(v - hover) < Math.abs(s.t[b] - hover) ? i : b), 0)
  return (
    <section className="b-card b-unfold">
      <div className="b-head">
        <h2>How it unfolded</h2>
        <div className="b-key">
          <span>
            <i style={{ background: '#FFB547', boxShadow: '0 0 6px #FFB547' }} />
            Inhibition %
          </span>
          <span>
            <i style={{ background: '#C6B8FF' }} />
            {name}
          </span>
        </div>
      </div>
      <div
        className="plot"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Inhibition indicator and ${name} over the last 24 hours${marks.length ? `: ${marks.map((m) => `${m.label} ${time(m.at)}`).join(', ')}` : ''}`}>
          <defs>
            <linearGradient id="inhFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#FFB547" stopOpacity=".35" />
              <stop offset="1" stopColor="#FFB547" stopOpacity="0" />
            </linearGradient>
          </defs>
          {th?.mild != null && <path d={`M0 ${yI(th.mild)}H${W}`} stroke="#E6F07A" strokeOpacity=".4" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />}
          {th?.moderate != null && <path d={`M0 ${yI(th.moderate)}H${W}`} stroke="#FFB547" strokeOpacity=".5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />}
          <path d={area} fill="url(#inhFill)" />
          <path d={inhLine} fill="none" stroke="#FFB547" strokeWidth="2.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 7px #FFB547)' }} />
          <path d={path(sup, yS)} fill="none" stroke="#C6B8FF" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {marks.map((m) => (
            <path key={m.cls} d={`M${x(m.at)} 0V${H}`} stroke="rgba(255,255,255,.3)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          ))}
          {index !== null && <path d={`M${x(s.t[index])} 0V${H}`} stroke="rgba(255,255,255,.45)" vectorEffect="non-scaling-stroke" />}
        </svg>
        {marks.map((m, i) => (
          <span key={m.cls} className={`mk ${m.cls}`} style={{ left: `${(x(m.at) / W) * 100}%`, top: i === 1 ? 22 : 2 }}>
            {m.label} {time(m.at)}
          </span>
        ))}
        {th?.moderate != null && (
          <span className="gl mod" style={{ top: yI(th.moderate) - 14 }}>
            moderate {th.moderate}%
          </span>
        )}
        {th?.mild != null && (
          <span className="gl mild" style={{ top: yI(th.mild) - 14 }}>
            mild {th.mild}%
          </span>
        )}
        {index !== null && (
          <div className="tip" style={{ left: `${(x(s.t[index]) / W) * 100}%` }}>
            <time>{dateTime(s.t[index])}</time>
            <div>
              <i style={{ background: '#FFB547' }} />
              <b>{inh[index] === null ? 'No valid data' : `${num(inh[index])}%`}</b> <span>Inhibition</span>
            </div>
            <div>
              <i style={{ background: '#C6B8FF' }} />
              <b>{sup[index] === null ? 'No valid data' : num(sup[index], 2)}</b> <span>{name}</span>
            </div>
          </div>
        )}
      </div>
      <div className="b-times n">
        {timeLabels(s.t).map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
    </section>
  )
}

const BAR_COLORS = ['#C6B8FF', '#8FB6FF', '#6F86B3', '#6F86B3']

function Moved({ a, abnormal }: { a: Assessment; abnormal: boolean }) {
  const d = a.detail
  const rows = [...d.factors].sort((x, y) => Math.abs(y.rho ?? 0) - Math.abs(x.rho ?? 0))
  return (
    <section className="b-card b-moved">
      <div className="b-head">
        <h2>What moved with it</h2>
        <span className="aside">correlation, not cause</span>
      </div>
      {!abnormal ? (
        <p className="b-quiet">No abnormal response, so there is nothing to relate the other measurements to. This fills in when the test culture diverges.</p>
      ) : (
        <>
          {rows.map((f, i) => {
            const digits = { ph: 2, conductivity: 0, dissolved_oxygen: 2 }[f.quantity] ?? 1
            const moved = f.strength !== 'none'
            const c = moved ? BAR_COLORS[Math.min(i, 3)] : '#6F86B3'
            return (
              <div key={f.quantity} className="mrow">
                <div>
                  <div className="nm">
                    {f.label} {moved ? (f.peak < f.baseline ? 'fell' : 'rose') : ''}
                  </div>
                  <div className="dt n">
                    {moved ? `${num(f.baseline, digits)} → ${num(f.peak, digits)}${f.lead_minutes ? ` · ${duration(Math.abs(f.lead_minutes))} ${f.lead_minutes > 0 ? 'before' : 'after'} onset` : ''}` : `stable near ${num(f.baseline, digits)}`}
                  </div>
                </div>
                <span className="bar">
                  <span style={{ width: `${Math.min(100, Math.abs(f.rho ?? 0) * 100)}%`, background: c, boxShadow: `0 0 10px ${c}` }} />
                </span>
                <span className="n v">{f.rho === null ? '—' : `ρ ${num(f.rho, 2)}`}</span>
              </div>
            )
          })}
          {d.nearby_events.map((e) => (
            <div key={e.occurred_at + e.kind} className="mrow">
              <div>
                <div className="nm">Logged {e.kind}</div>
                <div className="dt n">
                  {time(e.occurred_at)} · context only{e.note && ` · ${e.note}`}
                </div>
              </div>
              <span className="bar" />
              <span className="n v">—</span>
            </div>
          ))}
          {!rows.length && !d.nearby_events.length && <p className="b-quiet">No supporting measurement has enough history for a comparison.</p>}
        </>
      )}
    </section>
  )
}

/** The conditions a result has to meet before the system states it. */
function Checks({ a }: { a: Assessment }) {
  const d = a.detail
  const sig = d.signals
  const checks = [
    { name: 'Reference steady', detail: 'rules out culture or device drift', ok: !sig.reference_suspect, value: sig.reference_shift_pct === null ? '–' : `±${num(Math.abs(sig.reference_shift_pct))}%` },
    { name: 'Clean data', detail: 'valid, paired readings in the window', ok: sig.sufficient, value: percent(sig.valid_fraction, 1) },
    { name: 'Enough history', detail: 'baseline before the onset', ok: sig.baseline_ready, value: sig.baseline_ready ? `${Math.round(sig.baseline_hours / 24)} days` : `${num(sig.baseline_hours, 0)} h so far` },
    { name: 'Protocol allows a severity', detail: d.threshold.used ? `${d.origin} station, ${d.origin === 'simulated' ? 'demonstration' : 'validated'} thresholds` : d.threshold.reason, ok: d.threshold.used, value: d.threshold.used ? 'yes' : 'no' },
    { name: 'Classifier agrees', detail: d.model.used ? 'independent check by the trained model' : d.model.reason, ok: d.model.used && d.agreement !== false, value: !d.model.used ? 'not applied' : d.agreement === false ? `says ${d.model.prediction?.label}` : 'yes' },
  ]
  const passed = checks.filter((c) => c.ok).length
  return (
    <section className="b-card b-checks">
      <div className="b-head">
        <h2>Checks before a verdict</h2>
        <span className="aside">
          {passed} of {checks.length} passed
        </span>
      </div>
      {checks.map((c) => (
        <div key={c.name} className={'crow ' + (c.ok ? 'ok' : 'no')}>
          <span className="tk">{c.ok ? <Check size={13} strokeWidth={3.4} aria-label="passed" /> : <Minus size={13} strokeWidth={3.4} aria-label="not met" />}</span>
          <div>
            <div className="nm">{c.name}</div>
            <div className="dt">{c.detail}</div>
          </div>
          <span className="n v">{c.value}</span>
        </div>
      ))}
      <p className="b-fine">Supports a decision by qualified personnel. Does not establish that wastewater is safe or unsafe.</p>
    </section>
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

function days(p: Patterns): Patterns['daily'] {
  const out: Patterns['daily'] = []
  const by = new Map(p.daily.map((d) => [d.date, d]))
  for (let i = p.days - 1; i >= 0; i--) {
    const date = new Date(+new Date(p.to) - i * 86400_000).toLocaleDateString('en-CA', { timeZone: p.timezone })
    out.push(by.get(date) ?? { date, max_inhibition: null, severity: 'insufficient', withheld: 0, count: 0 })
  }
  return out
}

const DAY_COLOR: Partial<Record<string, string>> = { normal: '#7CF09A', mild: '#E6F07A', moderate: '#FFB547', severe: '#FF6B5E' }

function DayStrip({ p }: { p: Patterns }) {
  const list = days(p)
  const at = (f: number) => list[Math.min(list.length - 1, Math.round(f * (list.length - 1)))]
  return (
    <section className="b-card b-days">
      <div className="b-head">
        <h2>Last {p.days} days</h2>
        <div className="b-key dots">
          {(['normal', 'mild', 'moderate', 'severe'] as const).map((k) => (
            <span key={k}>
              <i style={{ background: DAY_COLOR[k] }} />
              {k[0].toUpperCase() + k.slice(1)}
            </span>
          ))}
          <span>
            <i className="ring" />
            Not classified
          </span>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}>
        {list.map((d, i) => {
          const c = d.count ? DAY_COLOR[d.severity] : undefined
          const label = `${day(d.date + 'T12:00')}: ${d.count ? d.severity + (d.max_inhibition !== null ? `, peak ${num(d.max_inhibition, 0)}%` : '') + (d.withheld ? ', some withheld' : '') : 'no assessments'}`
          return <span key={d.date} tabIndex={0} title={label} aria-label={label} className={c ? 'dot' : 'dot ring'} style={c ? { background: c, opacity: i === list.length - 1 ? 1 : 0.7, boxShadow: i === list.length - 1 ? `0 0 12px ${c}` : undefined } : undefined} />
        })}
      </div>
      <div className="b-times n">
        {[0, 0.25, 0.5, 0.75].map((f) => (
          <span key={f}>{day(at(f).date + 'T12:00')}</span>
        ))}
        <span>Today</span>
      </div>
    </section>
  )
}

function PatternDetails({ p }: { p: Patterns }) {
  const top = Math.max(1, ...p.by_hour)
  return (
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
  )
}
