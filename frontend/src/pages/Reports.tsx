import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { LineChart } from '../components/LineChart'
import { Empty, Failed, Loading, RangePicker, Section, SeverityBadge } from '../components/ui'
import { get, post } from '../lib/api'
import { useApp } from '../lib/app'
import { EXPOSED, INDICATOR, REFERENCE } from '../lib/colors'
import { bytes, dateTime, day, duration, num, percent } from '../lib/format'
import { query, resolve, type Range } from '../lib/range'
import type { ReportFile, ReportSummary, Severity } from '../lib/types'

const SEVERITY_FILTERS: Record<string, { label: string; values: Severity[] }> = {
  any: { label: 'Any severity', values: [] },
  mild: { label: 'Mild and above', values: ['mild', 'moderate', 'severe'] },
  moderate: { label: 'Moderate and above', values: ['moderate', 'severe'] },
  severe: { label: 'Severe only', values: ['severe'] },
  withheld: { label: 'Not classified', values: ['unclassified', 'inconclusive'] },
}

export function Reports() {
  const { station, stations, selectStation } = useApp()
  const qc = useQueryClient()
  const [range, setRange] = useState<Range>({ preset: '30d' })
  const [filter, setFilter] = useState('any')
  const sev = SEVERITY_FILTERS[filter].values
  const q = useQuery({
    queryKey: ['station', station.code, 'report', range, sev],
    queryFn: () => get<ReportSummary>(`/stations/${station.code}/report?${query(range, sev.length ? { severity: sev.join(',') } : {})}`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? prev : undefined),
    staleTime: 60_000,
  })
  const files = useQuery({ queryKey: ['reports'], queryFn: () => get<ReportFile[]>('/reports') })
  const make = useMutation({
    mutationFn: (format: 'pdf' | 'csv') => post<ReportFile>('/reports', { station: station.code, ...resolve(range), severities: sev, format }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['reports'] })
      download(r)
    },
  })
  const r = q.data
  return (
    <div className="page">
      <div className="filters">
        <RangePicker value={range} onChange={setRange} presets={['7d', '30d', '90d']} />
        <label>
          <span className="vh">Monitoring station</span>
          <select value={station.code} onChange={(e) => selectStation(e.target.value)}>
            {stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="vh">Event severity</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            {Object.entries(SEVERITY_FILTERS).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <div className="export">
          <button className="btn" disabled={make.isPending || !r} onClick={() => make.mutate('csv')}>
            Export CSV
          </button>
          <button className="btn primary" disabled={make.isPending || !r} onClick={() => make.mutate('pdf')}>
            {make.isPending ? 'Preparing…' : 'Export PDF'}
          </button>
        </div>
      </div>
      {make.isError && <p className="error" role="alert">{make.error.message}</p>}
      {q.isError && !r && <Failed error={q.error} retry={() => q.refetch()} />}
      {!r && !q.isError && <Loading rows={4} />}
      {r && (
        <div className={'stack' + (q.isPlaceholderData ? ' stale' : '')}>
          <dl className="summary">
            <div>
              <dt>Abnormal events</dt>
              <dd>{r.events.length}</dd>
            </div>
            <div>
              <dt>Peak inhibition</dt>
              <dd>{r.inhibition.max === null ? '–' : `${num(r.inhibition.max)}%`}</dd>
            </div>
            <div>
              <dt>Median inhibition</dt>
              <dd>{r.inhibition.median === null ? '–' : `${num(r.inhibition.median)}%`}</dd>
            </div>
            <div>
              <dt>AI assessments</dt>
              <dd>{r.assessments.total.toLocaleString('en-GB')}</dd>
            </div>
            <div>
              <dt>Paired data coverage</dt>
              <dd>{percent(r.performance.paired)}</dd>
            </div>
          </dl>
          <Section title="Biological activity trends" note={`Reference and exposed chambers, ${r.protocol.activity_unit}`}>
            {r.has_data ? (
              <>
                <LineChart
                  t={r.series.t}
                  series={[
                    { key: 'ref', label: 'Reference', color: REFERENCE, values: r.series.channels.ref_activity },
                    { key: 'exp', label: 'Exposed', color: EXPOSED, values: r.series.channels.exp_activity },
                  ]}
                  unit={r.protocol.activity_unit}
                  height={240}
                  gap
                  minSpan={10}
                  label="Reference and exposed activity over the report period"
                />
                <h3 className="chart-title">Inhibition indicator (%)</h3>
                <LineChart
                  t={r.series.t}
                  series={[{ key: 'i', label: 'Inhibition indicator', color: INDICATOR, values: r.series.channels.inhibition }]}
                  unit="%"
                  height={160}
                  area
                  includeZero
                  minSpan={15}
                  guides={(['mild', 'moderate', 'severe'] as const).flatMap((k) => (r.series.thresholds[k] === null ? [] : [{ label: k[0].toUpperCase() + k.slice(1), value: r.series.thresholds[k] as number }]))}
                  label="Inhibition indicator over the report period"
                />
              </>
            ) : (
              <Empty title="No measurements in this period" />
            )}
          </Section>
          <Section title="Inhibition events" note={sev.length ? `Filter: ${SEVERITY_FILTERS[filter].label.toLowerCase()}` : undefined}>
            {r.events.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Severity</th>
                      <th className="r">Duration</th>
                      <th className="r">Peak</th>
                      <th>Associated measurements</th>
                      <th>Acknowledged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.events.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap">{dateTime(e.started_at)}</td>
                        <td>
                          <SeverityBadge severity={e.severity} />
                        </td>
                        <td className="r nowrap">{e.ended_at ? duration(e.hours * 60) : `${duration(e.hours * 60)}, open`}</td>
                        <td className="r">{e.peak_inhibition === null ? '–' : `${num(e.peak_inhibition, 0)}%`}</td>
                        <td>{e.factors.join(', ') || 'None detected'}</td>
                        <td>{e.acknowledged_by ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No events match this period and filter" />
            )}
          </Section>
          <div className="grid-2 uneven">
            <Section title="Sensor summary" note="Valid readings only">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sensor</th>
                      <th className="r">Min</th>
                      <th className="r">Median</th>
                      <th className="r">Max</th>
                      <th className="r">Coverage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.sensors.map((s) => (
                      <tr key={s.code}>
                        <td>
                          {s.name} <small className="muted">{s.unit === 'pH' ? '' : s.unit}</small>
                        </td>
                        <td className="r">{num(s.min, 2)}</td>
                        <td className="r">{num(s.median, 2)}</td>
                        <td className="r">{num(s.max, 2)}</td>
                        <td className="r">{percent(s.coverage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
            <div className="stack">
              <Section title="AI assessments">
                {r.assessments.total ? (
                  <ul className="bars">
                    {r.assessments.by_severity.map((a) => (
                      <li key={a.severity}>
                        <span>{a.label}</span>
                        <span className="track">
                          <i style={{ width: `${(a.count / r.assessments.total) * 100}%` }} />
                        </span>
                        <b>{a.count.toLocaleString('en-GB')}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty title="No assessments in this period" />
                )}
              </Section>
              <Section title="Monitoring system performance">
                <dl className="evidence">
                  <div>
                    <dt>
                      Station reporting<small>Share of expected {r.performance.interval_minutes}-minute intervals</small>
                    </dt>
                    <dd>{percent(r.performance.reporting)}</dd>
                  </div>
                  <div>
                    <dt>
                      Both chambers valid<small>Share of expected intervals</small>
                    </dt>
                    <dd>{percent(r.performance.paired)}</dd>
                  </div>
                  <div>
                    <dt>
                      Excluded readings<small>Missing, invalid, suspect</small>
                    </dt>
                    <dd>
                      {r.performance.missing}, {r.performance.invalid}, {r.performance.suspect}
                    </dd>
                  </div>
                </dl>
              </Section>
            </div>
          </div>
        </div>
      )}
      <Section title="Generated reports" note={files.data?.length ? `Stored in ${files.data[0].object_provider === 'huawei_obs' ? 'Huawei Cloud OBS' : 'local storage'}` : undefined}>
        {files.isError && !files.data && <Failed error={files.error} retry={() => files.refetch()} />}
        {files.data?.length === 0 && <Empty title="No reports generated yet">Export a PDF or CSV to keep a copy here.</Empty>}
        {files.data && files.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Station</th>
                  <th>Period</th>
                  <th>Data</th>
                  <th>Generated</th>
                  <th className="r">Size</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.data.map((f) => (
                  <tr key={f.id}>
                    <td>{f.format.toUpperCase()}</td>
                    <td>{f.station_name}</td>
                    <td className="nowrap">
                      {day(f.period_start)} to {day(f.period_end)}
                    </td>
                    <td>{f.origin === 'simulated' ? 'Simulated' : 'Hardware'}</td>
                    <td className="nowrap">
                      {dateTime(f.created_at)} <small className="muted">{f.created_by}</small>
                    </td>
                    <td className="r nowrap">{bytes(f.size_bytes)}</td>
                    <td className="r">
                      <button className="icon" onClick={() => download(f)} aria-label={`Download ${f.filename}`} title={f.filename}>
                        <Download size={16} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

function download(f: ReportFile) {
  const a = document.createElement('a')
  a.href = `/api/v1/reports/${f.id}/download`
  a.download = f.filename
  a.click()
}
