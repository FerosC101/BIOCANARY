import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DevicePanel } from '../components/device/DevicePanel'
import { LineChart } from '../components/LineChart'
import { Dialog, Empty, Failed, Loading, RangePicker, Section } from '../components/ui'
import { get, post } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { EXPOSED, INDICATOR, REFERENCE, SUPPORT } from '../lib/colors'
import { ago, dateTime, digitsFor, exact, num, percent, toLocalInput } from '../lib/format'
import { query, type Range } from '../lib/range'
import type { Connection, DeviceState, ProcessEvent, Protocol, Quality, Reading, SensorState, Series } from '../lib/types'

const CONNECTION: Record<Connection, string> = {
  ok: 'Reporting',
  suspect: 'Suspect value',
  invalid: 'Invalid value',
  missing: 'Value missing',
  offline: 'Offline',
  never: 'Never reported',
}
const KIND = { sampling: 'Sampling', discharge: 'Discharge', maintenance: 'Maintenance', other: 'Other event' }

interface SensorsView {
  sensors: SensorState[]
  devices: DeviceState[]
  last_reading_at: string | null
}

export function Monitoring() {
  const { station } = useApp()
  const [range, setRange] = useState<Range>({ preset: '24h' })
  const [hover, setHover] = useState<number | null>(null)
  const [logging, setLogging] = useState(false)
  const key = (name: string) => ['station', station.code, name, range]
  const same = <T,>(prev: T | undefined, pq: { queryKey: readonly unknown[] } | undefined) => (pq?.queryKey[1] === station.code ? prev : undefined)
  const series = useQuery({ queryKey: key('series'), queryFn: () => get<Series>(`/stations/${station.code}/series?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const sensors = useQuery({ queryKey: key('sensors'), queryFn: () => get<SensorsView>(`/stations/${station.code}/sensors?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const events = useQuery({ queryKey: key('events'), queryFn: () => get<ProcessEvent[]>(`/stations/${station.code}/events?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const protocol = useQuery({ queryKey: ['station', station.code, 'protocol'], queryFn: () => get<Protocol>(`/stations/${station.code}/protocol`) })

  const s = series.data
  const marks = (events.data ?? []).map((e) => ({ at: +new Date(e.occurred_at), label: KIND[e.kind] + (e.note ? `: ${e.note}` : '') }))
  const shared = s ? { t: s.t, hover, onHover: setHover } : null
  const env = (sensors.data?.sensors ?? []).filter((x) => x.location === 'environment')
  const formula = protocol.data?.formulas[protocol.data.config.formula]

  return (
    <div className="page">
      <div className="filters">
        <RangePicker value={range} onChange={setRange} presets={['6h', '24h', '7d', '30d']} />
        <button className="btn" onClick={() => setLogging(true)}>
          <Plus size={16} aria-hidden /> Log event
        </button>
      </div>
      <DevicePanel sensors={sensors.data?.sensors ?? []} devices={sensors.data?.devices ?? []} />
      {series.isError && !s && <Failed error={series.error} retry={() => series.refetch()} />}
      {!s && !series.isError && <Loading rows={4} />}
      {s && shared && (
        <div className={series.isPlaceholderData ? 'stack stale' : 'stack'}>
          <div className="chambers">
            <Chamber title="Reference chamber" note="Control population under protected conditions" prefix="ref" color={REFERENCE} location="reference" series={s} sensors={sensors.data?.sensors ?? []} hover={hover} onHover={setHover} />
            <Chamber title="Exposed chamber" note="Population receiving wastewater sample" prefix="exp" color={EXPOSED} location="exposed" series={s} sensors={sensors.data?.sensors ?? []} hover={hover} onHover={setHover} />
          </div>
          <Section title="Biological comparison" note="Both chambers on one scale, with the inhibition indicator below. Diamonds mark logged events.">
            {s.has_data ? (
              <>
                <LineChart
                  {...shared}
                  series={[
                    { key: 'ref', label: 'Reference', color: REFERENCE, values: s.channels.ref_activity },
                    { key: 'exp', label: 'Exposed', color: EXPOSED, values: s.channels.exp_activity },
                  ]}
                  unit={s.activity_unit}
                  height={250}
                  gap
                  minSpan={10}
                  marks={marks}
                  label="Reference and exposed biological activity"
                />
                <h3 className="chart-title">Inhibition indicator (%)</h3>
                <LineChart
                  {...shared}
                  series={[{ key: 'inh', label: 'Inhibition indicator', color: INDICATOR, values: s.channels.inhibition }]}
                  unit="%"
                  height={190}
                  area
                  includeZero
                  minSpan={15}
                  guides={(['mild', 'moderate', 'severe'] as const).flatMap((k) => (s.thresholds[k] === null ? [] : [{ label: k[0].toUpperCase() + k.slice(1), value: s.thresholds[k] as number }]))}
                  marks={marks}
                  label="Inhibition indicator over time"
                />
                {formula && (
                  <p className="formula">
                    <code>{formula.expression}</code> {formula.note}{' '}
                    {protocol.data?.validation_status === 'demonstration' && 'Class boundaries are demonstration values, not experimental ones.'}
                    {protocol.data?.validation_status === 'unvalidated' && 'No class boundaries are shown because none have been validated for this station.'}
                  </p>
                )}
              </>
            ) : (
              <Empty title="No valid measurements in this period">{station.origin === 'live' && !station.last_reading_at ? 'This station is waiting for its first hardware reading.' : 'Choose a different date range.'}</Empty>
            )}
          </Section>
          <Section title="Supporting measurements" note="Wastewater sample line">
            {env.length ? (
              <div className="supports wide">
                {env.map((x) => (
                  <div key={x.code} className="support">
                    <h3>
                      {x.name.replace('Wastewater ', '').replace(/^[a-oq-z]/, (c) => c.toUpperCase())} <small>{x.quantity === 'ph' ? '' : x.unit}</small>
                    </h3>
                    {s.channels[`env_${x.quantity}`]?.some((v) => v !== null) ? (
                      <LineChart
                        {...shared}
                        series={[{ key: x.code, label: x.name, color: SUPPORT, values: s.channels[`env_${x.quantity}`] }]}
                        unit={x.quantity === 'ph' ? '' : x.unit}
                        digits={digitsFor(x.quantity)}
                        height={140}
                        compact
                        minSpan={x.quantity === 'ph' ? 0.5 : 1}
                        label={`${x.name} over time`}
                      />
                    ) : (
                      <p className="sub">No valid readings in this period</p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              sensors.isPending && <Loading rows={2} />
            )}
          </Section>
        </div>
      )}
      <Section title="Sensor connectivity" note="Current state, and data quality over the selected period">
        {sensors.isError && !sensors.data ? <Failed error={sensors.error} retry={() => sensors.refetch()} /> : sensors.data ? <SensorTable view={sensors.data} /> : <Loading />}
      </Section>
      <Readings key={station.code} range={range} sensors={sensors.data?.sensors ?? []} />
      <Section title="Logged events" note="Sampling, discharge and maintenance, used as context by the AI analysis">
        {events.data?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Note</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap">{dateTime(e.occurred_at)}</td>
                    <td>{KIND[e.kind]}</td>
                    <td>{e.note || '–'}</td>
                    <td>{e.recorded_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : events.isPending ? (
          <Loading rows={2} />
        ) : (
          <Empty title="No events logged in this period">Logging discharges and samples lets the analysis relate them to a biological response.</Empty>
        )}
      </Section>
      {logging && <LogEvent onClose={() => setLogging(false)} />}
    </div>
  )
}

function Chamber(p: {
  title: string
  note: string
  prefix: 'ref' | 'exp'
  color: string
  location: 'reference' | 'exposed'
  series: Series
  sensors: SensorState[]
  hover: number | null
  onHover: (t: number | null) => void
}) {
  const own = p.sensors.filter((s) => s.location === p.location)
  const find = (q: string) => own.find((s) => s.quantity === q)
  const other = p.prefix === 'ref' ? 'exp' : 'ref'
  const states = own.map((s) => s.connection)
  const status = !own.length || states.every((c) => c === 'never') ? 'Awaiting data' : states.every((c) => c === 'offline' || c === 'never') ? 'Offline' : states.every((c) => c === 'ok') ? 'All sensors reporting' : 'Sensor attention needed'
  const tone = status === 'All sensors reporting' ? 'healthy' : status === 'Sensor attention needed' ? 'warning' : 'offline'
  const values = p.series.channels[`${p.prefix}_activity`]
  const doValues = p.series.channels[`${p.prefix}_dissolved_oxygen`]
  const fig = (q: string, label: string) => {
    const s = find(q)
    const ok = s?.latest && (s.connection === 'ok' || s.connection === 'suspect' || s.connection === 'offline')
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {num(ok ? s.latest!.value : null, digitsFor(q))} <small>{ok && s.unit}</small>
        </dd>
      </div>
    )
  }
  return (
    <Section
      className="chamber"
      title={
        <>
          <i className="key" style={{ background: p.color }} />
          {p.title}
        </>
      }
      note={p.note}
      actions={<span className={`badge s-${tone}`}>{status}</span>}
    >
      <dl className="figures">
        {fig('biological_activity', 'Activity')}
        {fig('dissolved_oxygen', 'Dissolved oxygen')}
        {fig('temperature', 'Temperature')}
      </dl>
      {values?.some((v) => v !== null) ? (
        <>
          <h3 className="chart-title">Biological activity ({p.series.activity_unit})</h3>
          <LineChart t={p.series.t} hover={p.hover} onHover={p.onHover} series={[{ key: 'a', label: 'Activity', color: p.color, values }]} unit={p.series.activity_unit} height={150} compact minSpan={10} alsoFit={[p.series.channels[`${other}_activity`] ?? []]} label={`${p.title} activity`} />
          {doValues && (
            <>
              <h3 className="chart-title">Dissolved oxygen (mg/L)</h3>
              <LineChart t={p.series.t} hover={p.hover} onHover={p.onHover} series={[{ key: 'd', label: 'Dissolved oxygen', color: p.color, values: doValues }]} unit="mg/L" digits={2} height={120} compact minSpan={1} alsoFit={[p.series.channels[`${other}_dissolved_oxygen`] ?? []]} label={`${p.title} dissolved oxygen`} />
            </>
          )}
        </>
      ) : (
        <Empty title="No activity measured in this period" />
      )}
    </Section>
  )
}

function SensorTable({ view }: { view: SensorsView }) {
  const now = useNow()
  return (
    <>
      {view.devices.map((d) => (
        <p key={d.code} className={'device' + (d.state === 'fault' || d.faults.length ? ' bad' : '')}>
          Device {d.code}: {d.last_seen_at ? `last contact ${ago(d.last_seen_at, now)}, reported state ${d.state}` : 'has not connected yet'}
          {d.firmware && `, firmware ${d.firmware}`}
          {d.faults.length > 0 && `. Faults: ${d.faults.join('; ')}`}
        </p>
      ))}
      {!view.devices.length && <p className="device">No device has been provisioned for this station.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sensor</th>
              <th>State</th>
              <th className="r">Latest</th>
              <th>Received</th>
              <th className="r">Valid</th>
              <th className="r">Missing</th>
              <th className="r">Invalid</th>
              <th className="r">Suspect</th>
            </tr>
          </thead>
          <tbody>
            {view.sensors.map((s) => {
              const c = s.counts ?? { valid: 0, missing: 0, invalid: 0, suspect: 0 }
              const total = c.valid + c.missing + c.invalid + c.suspect
              return (
                <tr key={s.code}>
                  <td>
                    {s.name} <small className="muted">{s.code}</small>
                  </td>
                  <td>
                    <span className={`conn c-${s.connection}`}>{CONNECTION[s.connection]}</span>
                  </td>
                  <td className="r nowrap">{s.latest && s.latest.value !== null ? `${num(s.latest.value, digitsFor(s.quantity))} ${s.quantity === 'ph' ? '' : s.unit}` : '–'}</td>
                  <td className="nowrap">{s.latest ? ago(s.latest.recorded_at, now) : '–'}</td>
                  <td className="r">{total ? percent(c.valid / total) : '–'}</td>
                  <td className="r">{c.missing}</td>
                  <td className="r">{c.invalid}</td>
                  <td className="r">{c.suspect}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Readings({ range, sensors }: { range: Range; sensors: SensorState[] }) {
  const { station } = useApp()
  const [sensor, setSensor] = useState('')
  const [quality, setQuality] = useState<'' | Quality | 'problem'>('')
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [station.code, range, sensor, quality])
  const extra: Record<string, string> = { page: String(page), size: '15', ...(sensor && { sensor }), ...(quality && { quality }) }
  const q = useQuery({
    queryKey: ['station', station.code, 'readings', range, extra],
    queryFn: () => get<{ total: number; rows: Reading[]; size: number }>(`/stations/${station.code}/readings?${query(range, extra)}`),
    placeholderData: (prev, pq) => (pq?.queryKey[1] === station.code ? prev : undefined),
  })
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / q.data.size)) : 1
  return (
    <Section
      title="Measurement history"
      note={q.data ? `${q.data.total.toLocaleString('en-GB')} individual readings` : undefined}
      actions={
        <div className="selects">
          <label>
            <span className="vh">Sensor</span>
            <select value={sensor} onChange={(e) => setSensor(e.target.value)}>
              <option value="">All sensors</option>
              {sensors.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="vh">Quality</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}>
              <option value="">Any quality</option>
              <option value="problem">Missing, invalid or suspect</option>
              <option value="valid">Valid only</option>
              <option value="missing">Missing</option>
              <option value="invalid">Invalid</option>
              <option value="suspect">Suspect</option>
            </select>
          </label>
        </div>
      }
    >
      {q.isError && !q.data && <Failed error={q.error} retry={() => q.refetch()} />}
      {!q.data && !q.isError && <Loading />}
      {q.data && !q.data.rows.length && <Empty title="No readings match these filters" />}
      {q.data && q.data.rows.length > 0 && (
        <>
          <div className={'table-wrap' + (q.isPlaceholderData ? ' stale' : '')}>
            <table>
              <thead>
                <tr>
                  <th>Recorded</th>
                  <th>Sensor</th>
                  <th className="r">Value</th>
                  <th>Quality</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap" title={`Received ${exact(r.received_at)}`}>
                      {exact(r.recorded_at)}
                    </td>
                    <td>{r.name}</td>
                    <td className="r nowrap">{r.value === null ? '–' : `${r.value} ${r.unit === 'pH' ? '' : r.unit}`}</td>
                    <td>
                      <span className={`conn c-${r.quality === 'valid' ? 'ok' : r.quality}`}>{r.quality[0].toUpperCase() + r.quality.slice(1)}</span>
                      {r.reason && <small className="muted"> {r.reason}</small>}
                    </td>
                    <td>{r.origin === 'simulated' ? 'Simulated' : 'Hardware'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <span>
              Page {page} of {pages.toLocaleString('en-GB')}
            </span>
            <button className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

function LogEvent({ onClose }: { onClose: () => void }) {
  const { station } = useApp()
  const qc = useQueryClient()
  const [kind, setKind] = useState<ProcessEvent['kind']>('sampling')
  const [at, setAt] = useState(toLocalInput(new Date()))
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => post(`/stations/${station.code}/events`, { kind, note, occurred_at: new Date(at).toISOString() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['station', station.code] })
      onClose()
    },
  })
  return (
    <Dialog title={`Log event at ${station.name}`} onClose={onClose}>
      <label>
        Event
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          {Object.entries(KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time
        <input type="datetime-local" value={at} max={toLocalInput(new Date())} onChange={(e) => setAt(e.target.value)} />
      </label>
      <label>
        Note (optional)
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {m.isError && <p className="error">{m.error.message}</p>}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={m.isPending || !at} onClick={() => m.mutate()}>
          Log event
        </button>
      </div>
    </Dialog>
  )
}
