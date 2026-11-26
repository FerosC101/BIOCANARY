import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { Logo } from '../brand/Logo'
import { LineChart } from '../components/LineChart'
import { Failed, Loading, RangePicker } from '../components/ui'
import { get, post } from '../lib/api'
import { useApp } from '../lib/app'
import { bytes, dateTime, day, duration, num, percent } from '../lib/format'
import { query, resolve, type Range } from '../lib/range'
import { resample } from '../lib/series'
import type { ReportFile, ReportSummary, Severity } from '../lib/types'

const SEVERITY_FILTERS: Record<string, { label: string; values: Severity[] }> = {
  any: { label: 'All events', values: [] },
  mild: { label: 'Mild range and above', values: ['mild', 'moderate', 'severe'] },
  moderate: { label: 'Moderate range and above', values: ['moderate', 'severe'] },
  severe: { label: 'Severe range only', values: ['severe'] },
  withheld: { label: 'Not classified only', values: ['unclassified', 'inconclusive'] },
}

const INCLUDE = [
  { key: 'verdicts', label: 'Verdicts', note: 'AI assessment counts by range' },
  { key: 'charts', label: 'Charts', note: 'Activity and inhibition charts' },
  { key: 'events', label: 'Events', note: 'Inhibition events table' },
  { key: 'quality', label: 'Data quality', note: 'Sensor summary and reporting performance' },
  { key: 'raw', label: 'Raw readings', note: 'CSV only: every individual reading with its quality, instead of 10-minute rows' },
] as const
type Part = (typeof INCLUDE)[number]['key']
const SEV_INK: Partial<Record<Severity, string>> = { severe: '#9B1C12', moderate: '#7A4300', mild: '#6B6000' }

export function Reports() {
  const { station, stations, selectStation } = useApp()
  const qc = useQueryClient()
  const [range, setRange] = useState<Range>({ preset: '7d' })
  const [filter, setFilter] = useState('mild')
  const [include, setInclude] = useState<Set<Part>>(new Set(['verdicts', 'charts', 'events', 'quality']))
  const sev = SEVERITY_FILTERS[filter].values
  const q = useQuery({
    queryKey: ['station', station.code, 'report', range, sev],
    queryFn: () => get<ReportSummary>(`/stations/${station.code}/report?${query(range, sev.length ? { severity: sev.join(',') } : {})}`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? prev : undefined),
    staleTime: 60_000,
  })
  const files = useQuery({ queryKey: ['reports'], queryFn: () => get<ReportFile[]>('/reports') })
  const make = useMutation({
    mutationFn: (format: 'pdf' | 'csv') => post<ReportFile>('/reports', { station: station.code, ...resolve(range), severities: sev, format, include: [...include] }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      download(r)
    },
  })
  const r = q.data
  const period = resolve(range)
  const toggle = (k: Part) => {
    const next = new Set(include)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setInclude(next)
  }
  return (
    <div className="page rep">
      <header className="b-rep-head">
        <h1>Reports</h1>
        <p>Choose what goes in. The page on the right previews what you will export.</p>
      </header>
      <div className="b-row">
        <form className="b-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Station
            <select value={station.code} onChange={(e) => selectStation(e.target.value)}>
              {stations.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} · {s.code}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Period</legend>
            <RangePicker value={range} onChange={setRange} presets={['24h', '7d', '30d']} />
            <span className="n per">
              {stamp(period.start)} → {stamp(period.end)}
            </span>
          </fieldset>
          <fieldset>
            <legend>Include</legend>
            <div className="chips">
              {INCLUDE.map((x) => (
                <label key={x.key} className={include.has(x.key) ? 'on' : undefined} title={x.note}>
                  <input type="checkbox" checked={include.has(x.key)} onChange={() => toggle(x.key)} />
                  {x.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Events from
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {Object.entries(SEVERITY_FILTERS).map(([k, f]) => (
                <option key={k} value={k}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {make.isError && (
            <p className="error" role="alert">
              {make.error.message}
            </p>
          )}
          <div className="acts">
            <button type="button" className="pdf" disabled={make.isPending || !r} onClick={() => make.mutate('pdf')}>
              {make.isPending ? 'Preparing…' : 'Export PDF'}
            </button>
            <button type="button" className="csv" disabled={make.isPending || !r} onClick={() => make.mutate('csv')}>
              Export CSV
            </button>
          </div>
        </form>
        <section className="b-preview" aria-label="Report preview">
          {q.isError && !r && <Failed error={q.error} retry={() => q.refetch()} />}
          {!r && !q.isError && <Loading rows={4} />}
          {r && <Paper r={r} stale={q.isPlaceholderData} include={include} period={period} />}
        </section>
      </div>
      <section className="b-card b-archive">
        <h2 className="b-h2">Earlier reports</h2>
        {files.isError && !files.data && <Failed error={files.error} retry={() => files.refetch()} />}
        {files.data?.length === 0 && <p className="b-quiet">No reports generated yet. Export a PDF or CSV to keep a copy here.</p>}
        {files.data?.slice(0, 6).map((f) => (
          <div key={f.id} className="arow">
            <span className={`kind ${f.format}`}>{f.format.toUpperCase()}</span>
            <div>
              <div className="nm">
                {f.station_name} · {day(f.period_start)} – {day(f.period_end)}
              </div>
              <div className="dt n">
                {f.origin === 'simulated' ? 'Simulated' : 'Hardware'} · {dateTime(f.created_at)} · {f.created_by} · {bytes(f.size_bytes)} · {f.object_provider === 'huawei_obs' ? 'Huawei Cloud OBS' : 'local storage'}
              </div>
            </div>
            <button className="dl" onClick={() => download(f)} title={f.filename}>
              Download
            </button>
          </div>
        ))}
      </section>
    </div>
  )
}

const stamp = (v: string) => new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '')

function Paper({ r, stale, include, period }: { r: ReportSummary; stale: boolean; include: Set<Part>; period: { start: string; end: string } }) {
  const { station } = useApp()
  const view = resample(r.series, r.series.t.length > 400 ? 120 : 60)
  const events = r.events.slice(0, 4)
  return (
    <article className={'b-paper' + (stale ? ' stale' : '')}>
      <div className="ptop">
        <svg aria-hidden viewBox="0 0 520 110" preserveAspectRatio="none">
          <path d="M0 92 C 100 72, 200 112, 300 92 S 460 72, 520 90 L520 110 L0 110 Z" fill="#FBFDF7" />
        </svg>
        <div className="row">
          <Logo className="logo" tone="white" />
          {station.origin === 'simulated' && <span className="tag">Simulated data</span>}
        </div>
        <div className="ttl">
          {station.name} · {day(period.start)}–{day(period.end)}
        </div>
      </div>
      <div className="body">
        <div className="stats">
          <div>
            <div>Assessments</div>
            <b className="n">{r.assessments.total.toLocaleString('en-GB')}</b>
          </div>
          <div>
            <div>Events</div>
            <b className="n">{r.events.length}</b>
          </div>
          <div className="peak">
            <div>Peak</div>
            <b className="n">{r.inhibition.max === null ? '–' : `${num(r.inhibition.max)}%`}</b>
          </div>
          <div className="ok">
            <div>Data valid</div>
            <b className="n">{percent(r.performance.paired)}</b>
          </div>
        </div>
        {include.has('charts') && r.has_data && (
          <div>
            <div className="h">Reference and test activity</div>
            <LineChart
              t={view.t}
              series={[
                { key: 'ref', label: 'Reference', color: '#254F91', values: view.channels.ref_activity },
                { key: 'exp', label: 'Test', color: '#1FA34A', values: view.channels.exp_activity },
              ]}
              unit={r.protocol.activity_unit}
              height={100}
              gap
              minimal
              legend={false}
              xAxis={false}
              yLabels={false}
              pad={{ l: 2, r: 2 }}
              minSpan={10}
              label="Reference and test activity over the report period"
            />
          </div>
        )}
        {include.has('events') && (
          <div>
            <div className="h">Inhibition events</div>
            {events.length ? (
              <div className="ev n">
                <span className="hd">Start</span>
                <span className="hd">Duration</span>
                <span className="hd">Peak</span>
                <span className="hd">Range</span>
                {events.map((e) => (
                  <Fragment key={e.id}>
                    <span>{stamp(e.started_at)}</span>
                    <span>
                      {duration(e.hours * 60)}
                      {e.ended_at ? '' : ' (open)'}
                    </span>
                    <span>{e.peak_inhibition === null ? '–' : `${num(e.peak_inhibition)}%`}</span>
                    <b style={{ color: SEV_INK[e.severity] ?? '#0B2D6B' }}>{e.severity_label.replace(' inhibition', '')}</b>
                  </Fragment>
                ))}
              </div>
            ) : (
              <p className="none">No events match this period and filter.</p>
            )}
            {r.events.length > events.length && <p className="none">and {r.events.length - events.length} more in the report</p>}
          </div>
        )}
        {(include.has('verdicts') || include.has('quality')) && (
          <p className="more">
            Also in the PDF: {[include.has('verdicts') && 'AI assessment counts', include.has('quality') && 'sensor summary and data quality', 'method and limitations'].filter(Boolean).join(', ')}.
          </p>
        )}
        <p className="foot">Correlation is not cause. This report does not certify water as safe or unsafe.{r.protocol.validation_status === 'validated' ? '' : ' Ranges use demonstration thresholds.'}</p>
      </div>
    </article>
  )
}

function download(f: ReportFile) {
  const a = document.createElement('a')
  a.href = `/api/v1/reports/${f.id}/download`
  a.download = f.filename
  a.click()
}
