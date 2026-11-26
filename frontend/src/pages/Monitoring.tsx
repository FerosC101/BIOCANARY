import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DeviceModel } from '../components/device/DeviceModel'
import type { Lamp, Lamps, View } from '../components/device/scene'
import { LineChart } from '../components/LineChart'
import { Dialog, Empty, Failed, Loading, Section } from '../components/ui'
import { Dial } from '../components/Dial'
import { get, post } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { ago, dateTime, digitsFor, exact, num, percent, time, toLocalInput } from '../lib/format'
import { query, type Range } from '../lib/range'
import { timeLabels } from '../lib/series'
import { rangeOf, rangeText, severityWord } from '../lib/ranges'
import type { Connection, DeviceState, Overview, ProcessEvent, Quality, Reading, SensorState, Series, SystemStatus } from '../lib/types'

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

const CELLS: Partial<Record<string, number>> = { '6h': 24, '24h': 48, '7d': 56, '30d': 60 }
const SPANS: { preset: '6h' | '24h' | '7d' | '30d'; label: string }[] = [
  { preset: '6h', label: '6 h' },
  { preset: '24h', label: '24 h' },
  { preset: '7d', label: '7 d' },
  { preset: '30d', label: '30 d' },
]
const WHERE = { reference: 'Ref', exposed: 'Test', environment: 'Sample' }
const WHAT: Record<string, string> = { biological_activity: 'activity', dissolved_oxygen: 'DO', temperature: 'temp.', ph: 'pH', conductivity: 'conductivity', flow: 'flow' }
const shortName = (x: SensorState) => `${WHERE[x.location]} ${WHAT[x.quantity] ?? x.quantity}`
const SHORT: Record<string, string> = { '6h': '6 h', '24h': '24 h', '7d': '7 d', '30d': '30 d' }

interface QualityGrid {
  cell_minutes: number
  sensors: { code: string; name: string; location: string; cells: (Quality | 'none')[]; valid: number | null }[]
}

export function Monitoring() {
  const { station } = useApp()
  const [preset, setPreset] = useState<'6h' | '24h' | '7d' | '30d'>('24h')
  const range: Range = { preset }
  const [hover, setHover] = useState<number | null>(null)
  const [logging, setLogging] = useState(false)
  const [all, setAll] = useState(false)
  const key = (name: string) => ['station', station.code, name, range]
  const same = <T,>(prev: T | undefined, pq: { queryKey: readonly unknown[] } | undefined) => (pq?.queryKey[1] === station.code ? prev : undefined)
  const series = useQuery({ queryKey: key('series'), queryFn: () => get<Series>(`/stations/${station.code}/series?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const sensors = useQuery({ queryKey: key('sensors'), queryFn: () => get<SensorsView>(`/stations/${station.code}/sensors?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const events = useQuery({ queryKey: key('events'), queryFn: () => get<ProcessEvent[]>(`/stations/${station.code}/events?${query(range)}`), placeholderData: (p, pq) => same(p, pq) })
  const grid = useQuery({ queryKey: key('quality'), queryFn: () => get<QualityGrid>(`/stations/${station.code}/quality?${query(range, { cells: String(CELLS[preset] ?? 48) })}`), placeholderData: (p, pq) => same(p, pq) })
  const overview = useQuery({ queryKey: ['station', station.code, 'overview', 24], queryFn: () => get<Overview>(`/stations/${station.code}/overview?hours=24`) })

  const s = series.data
  const list = sensors.data?.sensors ?? []

  return (
    <div className="page mon">
      <ChamberHero sensors={list} unit={s?.activity_unit ?? ''} />
      <div className="b-row">
        <section className={'b-card b-channels' + (series.isPlaceholderData ? ' stale' : '')}>
          <div className="b-head">
            <h2>Channels</h2>
            <div className="b-seg" role="group" aria-label="Range">
              {SPANS.map((x) => (
                <button key={x.preset} aria-pressed={preset === x.preset} onClick={() => setPreset(x.preset)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          {series.isError && !s && <Failed error={series.error} retry={() => series.refetch()} />}
          {!s && !series.isError && <Loading rows={4} />}
          {s && !s.has_data && <Empty title="No valid measurements in this period">{station.origin === 'live' && !station.last_reading_at ? 'This station is waiting for its first hardware reading.' : 'Choose a different period.'}</Empty>}
          {s && s.has_data && <Lanes s={s} hover={hover} onHover={setHover} events={events.data ?? []} />}
        </section>
        <div className="b-side">
          <InhibitionCard data={overview.data} s={s} />
          <section className="b-card b-sensors">
            <h2 className="b-h2">Sensors</h2>
            {!sensors.data ? (
              <Loading rows={3} />
            ) : (
              list.map((x) => (
                <div key={x.code} className="b-sensor" title={x.latest?.reason || undefined}>
                  <i className={`c-${x.connection}`} />
                  <span>
                    {shortName(x)} <span className="st">· {CONNECTION[x.connection].toLowerCase()}</span>
                  </span>
                  <span className="n v">
                    {x.latest?.value != null ? num(x.latest.value, digitsFor(x.quantity)) : '–'}
                    {x.latest?.value != null && x.unit !== 'pH' ? ` ${x.unit}` : ''}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
      <div className="b-row">
        <HealthGrid grid={grid.data} span={SHORT[preset]} />
        <ToCheck range={range} span={SHORT[preset]} all={all} onAll={() => setAll(!all)} />
      </div>
      {all && (
        <>
          <div className="filters">
            <button className="btn" onClick={() => setLogging(true)}>
              <Plus size={16} aria-hidden /> Log event
            </button>
          </div>
          <Section title="Sensor connectivity" note="Current state, and data quality over the selected period">
            {sensors.isError && !sensors.data ? <Failed error={sensors.error} retry={() => sensors.refetch()} /> : sensors.data ? <SensorTable view={sensors.data} /> : <Loading />}
          </Section>
          <Readings key={station.code} range={range} sensors={list} />
          <Logged events={events.data} pending={events.isPending} />
        </>
      )}
      {logging && <LogEvent onClose={() => setLogging(false)} />}
    </div>
  )
}

/** Reference and test figures either side of the device, as on the board. */
function ChamberHero({ sensors, unit }: { sensors: SensorState[]; unit: string }) {
  const { station } = useApp()
  const system = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const [view, setView] = useState<View>('front')
  const reporting = !!station.last_reading_at && station.status !== 'offline'
  const mode = system.data?.cloud.mode
  const wifi: Lamp = reporting ? 'on' : 'off'
  const cloud: Lamp = mode === 'huawei_connected' ? 'on' : mode === 'huawei_partial' ? 'warning' : 'off'
  const status: Lamp = station.status === 'healthy' ? 'on' : station.status === 'warning' || station.status === 'critical' ? station.status : 'off'
  const lamps = useMemo<Lamps>(() => ({ wifi, cloud, status }), [wifi, cloud, status])
  const side = (location: 'reference' | 'exposed', title: string, cls: string) => {
    const own = sensors.filter((x) => x.location === location)
    const val = (q: string) => own.find((x) => x.quantity === q)?.latest?.value ?? null
    const act = val('biological_activity')
    return (
      <div className={`b-chamber ${cls}`}>
        <span className="label">{title}</span>
        <span className="value n">
          {num(act)}
          {act !== null && <small> {unit}</small>}
        </span>
        <span className="sub n">
          DO {num(val('dissolved_oxygen'), 2)} mg/L · {num(val('temperature'))} °C · {own.filter((x) => x.connection === 'ok').length} / {own.length} sensors
        </span>
      </div>
    )
  }
  return (
    <section className="b-hero" aria-label="Chambers">
      {side('reference', 'REFERENCE CHAMBER', 'ref')}
      <figure className="b-device">
        <DeviceModel
          dark
          fill
          lamps={lamps}
          active={reporting}
          view={view}
          label={`3D model of the BIOCANARY device: a blue reference chamber and a green test chamber.${station.origin === 'simulated' ? ' This station is simulated, so no physical unit is connected.' : ''}`}
          markers={[
            { part: 'reference', label: 'Reference chamber' },
            { part: 'test', label: 'Test chamber' },
          ]}
          selected={view === 'reference' || view === 'test' ? view : null}
          onSelect={(p) => setView(view === p ? 'front' : p)}
        />
        <figcaption>Drag to turn · lighting identifies the chambers, not their health</figcaption>
      </figure>
      {side('exposed', 'TEST CHAMBER', 'test')}
    </section>
  )
}

interface LaneDef {
  key: string
  name: string
  unit: string
  digits: number
  minSpan: number
  lines: { key: string; label: string; color: string; values: (number | null)[] }[]
  gap?: boolean
  area?: boolean
  includeZero?: boolean
  guides?: { label: string; value: number }[]
}

const EVENT_COLOR: Record<string, string> = { sampling: '#8FB6FF', discharge: '#FFB547', maintenance: '#C6B8FF', other: '#9FB4DA' }

/** Channels on one shared time axis, then the events row and the time labels, as on the board. */
function Lanes({ s, hover, onHover, events }: { s: Series; hover: number | null; onHover: (t: number | null) => void; events: ProcessEvent[] }) {
  const c = s.channels
  const t0 = s.t[0]
  const t1 = s.t[s.t.length - 1]
  const marks = events.map((e) => ({ at: +new Date(e.occurred_at), label: KIND[e.kind] + (e.note ? `: ${e.note}` : '') }))
  const lanes: LaneDef[] = [
    {
      key: 'act',
      name: 'Activity',
      unit: `${s.activity_unit}, ref / test`,
      digits: 1,
      minSpan: 10,
      gap: true,
      lines: [
        { key: 'ref', label: 'Reference', color: '#8FB6FF', values: c.ref_activity ?? [] },
        { key: 'exp', label: 'Test', color: '#7CF09A', values: c.exp_activity ?? [] },
      ],
    },
    {
      key: 'do',
      name: 'Dissolved O₂',
      unit: 'mg/L, ref / test',
      digits: 2,
      minSpan: 1,
      lines: [
        { key: 'rdo', label: 'Reference', color: '#8FB6FF', values: c.ref_dissolved_oxygen ?? [] },
        { key: 'edo', label: 'Test', color: '#7CF09A', values: c.exp_dissolved_oxygen ?? [] },
      ],
    },
    {
      key: 'inh',
      name: 'Inhibition',
      unit: s.thresholds.moderate !== null ? `%, moderate at ${s.thresholds.moderate}` : '%',
      digits: 1,
      minSpan: 15,
      area: true,
      includeZero: true,
      guides: s.thresholds.moderate !== null ? [{ label: 'Moderate', value: s.thresholds.moderate }] : [],
      lines: [{ key: 'inh', label: 'Inhibition', color: '#FFB547', values: c.inhibition ?? [] }],
    },
    { key: 'ph', name: 'Sample pH', unit: 'pH', digits: 2, minSpan: 0.5, lines: [{ key: 'ph', label: 'Sample pH', color: '#C6B8FF', values: c.env_ph ?? [] }] },
    { key: 'cond', name: 'Conductivity', unit: 'µS/cm', digits: 0, minSpan: 40, lines: [{ key: 'cond', label: 'Conductivity', color: '#C6B8FF', values: c.env_conductivity ?? [] }] },
  ].filter((l) => l.lines.some((x) => x.values.some((v) => v !== null)))
  const at = (v: (number | null)[]) => {
    if (hover !== null) {
      let best = 0
      for (let i = 1; i < s.t.length; i++) if (Math.abs(s.t[i] - hover) < Math.abs(s.t[best] - hover)) best = i
      return v[best]
    }
    for (let i = v.length - 1; i >= 0; i--) if (v[i] !== null) return v[i]
    return null
  }
  const x = (ms: number) => `${(((ms - t0) / Math.max(1, t1 - t0)) * 100).toFixed(2)}%`
  return (
    <>
      {lanes.map((l) => (
        <div key={l.key} className="b-lane">
          <div>
            <div className="nm">{l.name}</div>
            <div className="un">{l.unit}</div>
          </div>
          <LineChart
            t={s.t}
            hover={hover}
            onHover={onHover}
            series={l.lines}
            unit={l.unit.split(',')[0]}
            digits={l.digits}
            height={l.lines.length > 1 ? 82 : 66}
            compact
            minimal
            legend={false}
            xAxis={false}
            yLabels={false}
            pad={{ l: 2, r: 2 }}
            gap={l.gap}
            area={l.area}
            includeZero={l.includeZero}
            guides={l.guides}
            minSpan={l.minSpan}
            marks={marks}
            label={`${l.name} over time`}
          />
          <div className="vals n">
            {l.lines.map((ln) => (
              <div key={ln.key} style={{ color: ln.color }}>
                {num(at(ln.values), l.digits)}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="b-lane events">
        <span className="nm">Events</span>
        <div className="evs">
          {events
            .filter((e) => +new Date(e.occurred_at) >= t0 && +new Date(e.occurred_at) <= t1)
            .slice(0, 8)
            .map((e) => (
              <div key={e.id} className="ev" style={{ left: x(+new Date(e.occurred_at)) }} title={`${KIND[e.kind]} ${dateTime(e.occurred_at)}${e.note ? `: ${e.note}` : ''}`}>
                <i style={{ background: EVENT_COLOR[e.kind], boxShadow: `0 0 10px ${EVENT_COLOR[e.kind]}` }} />
                <span>{KIND[e.kind]}</span>
              </div>
            ))}
          {!events.length && <span className="none">None logged</span>}
        </div>
        <span className="n cur">{hover !== null ? `cursor ${time(hover)}` : ''}</span>
      </div>
      <div className="b-lane times n">
        <span />
        <span className="row">
          {timeLabels(s.t).map((l, i) => (
            <span key={i}>{l}</span>
          ))}
        </span>
        <span />
      </div>
    </>
  )
}

function InhibitionCard({ data, s }: { data?: Overview; s?: Series }) {
  const a = data?.assessment
  const offline = data?.station.status === 'offline'
  const t = a?.detail.threshold.used ? a.detail.threshold.values : null
  const value = offline ? null : (a?.inhibition ?? null)
  const zone = rangeOf(value, t)
  const ink = zone === null ? '#C6D2EA' : ['#9FF5B4', '#E6F07A', '#FFD08A', '#FF8A80'][zone]
  const vals = (s?.channels.inhibition ?? []).filter((v): v is number => v !== null)
  const peak = vals.length ? Math.max(...vals) : null
  return (
    <section className="b-card b-inh" aria-label="Inhibition">
      <Dial value={value} thresholds={t} size={120} muted={offline || !a} label={`Inhibition ${value === null ? 'not available' : `${num(value)} percent`}`} />
      <div>
        <div className="ttl">Inhibition</div>
        <div className="rng" style={{ color: ink }}>
          {offline ? 'Station offline' : a ? rangeText(value, t, severityWord(a.severity)) : 'Not assessed yet'}
        </div>
        <div className="sub n">
          {a?.detail.onset && zone !== null && zone > 0 ? `since ${time(a.detail.onset)} · ` : ''}
          {peak !== null ? `peak ${num(peak)}%` : ''}
        </div>
      </div>
    </section>
  )
}

const Q_LABEL: Record<Quality | 'none', string> = { valid: 'Valid', suspect: 'Suspect', missing: 'Missing', invalid: 'Invalid', none: 'No reading' }

function HealthGrid({ grid, span }: { grid?: QualityGrid; span: string }) {
  const rows = grid?.sensors ?? []
  const fractions = rows.map((r) => r.valid).filter((v): v is number => v !== null)
  const valid = fractions.length ? fractions.reduce((a, b) => a + b, 0) / fractions.length : null
  const cell = grid ? (grid.cell_minutes >= 60 ? `${Math.round(grid.cell_minutes / 60)}-hour` : `${grid.cell_minutes}-min`) : ''
  return (
    <section className="b-card b-health">
      <div className="b-head">
        <h2>Sensor health · {span}</h2>
        {grid && (
          <span className="aside">
            {cell} cells{valid !== null ? ` · ${percent(valid)} valid` : ''}
          </span>
        )}
      </div>
      {!grid ? (
        <Loading rows={3} />
      ) : (
        <>
          {rows.map((r) => (
            <div key={r.code} className="hrow">
              <span className="hn">{r.name.replace('Wastewater', 'Sample')}</span>
              <div className="hc" style={{ gridTemplateColumns: `repeat(${r.cells.length}, minmax(0, 1fr))` }}>
                {r.cells.map((q, i) => (
                  <i key={i} className={`q-${q}`} title={Q_LABEL[q]} />
                ))}
              </div>
              <span className="n hp">{r.valid === null ? '–' : percent(r.valid, 0)}</span>
            </div>
          ))}
          <div className="hkey">
            {(['valid', 'suspect', 'missing', 'invalid'] as const).map((q) => (
              <span key={q}>
                <i className={`q-${q}`} />
                {Q_LABEL[q]}
              </span>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

const Q_COLOR: Record<string, string> = { suspect: '#FFB547', invalid: '#FF6B5E', missing: '#9FB4DA', valid: '#7CF09A' }

function ToCheck({ range, span, all, onAll }: { range: Range; span: string; all: boolean; onAll: () => void }) {
  const { station } = useApp()
  const q = useQuery({
    queryKey: ['station', station.code, 'readings', range, 'problem'],
    queryFn: () => get<{ total: number; rows: Reading[] }>(`/stations/${station.code}/readings?${query(range, { quality: 'problem', size: '5' })}`),
  })
  return (
    <section className="b-card b-check">
      <div className="b-head">
        <h2>Readings to check</h2>
        {q.data && (
          <span className="aside">
            {q.data.total.toLocaleString('en-GB')} in {span}
          </span>
        )}
      </div>
      {!q.data ? (
        <Loading rows={3} />
      ) : !q.data.rows.length ? (
        <p className="b-quiet">Every reading in this period is valid.</p>
      ) : (
        q.data.rows.map((r) => (
          <div key={r.id} className="crow">
            <i style={{ background: Q_COLOR[r.quality], boxShadow: `0 0 8px ${Q_COLOR[r.quality]}` }} />
            <div>
              <b>{r.name.replace('Wastewater', 'Sample')}</b> <span style={{ color: Q_COLOR[r.quality], fontWeight: 600 }}>{r.quality}</span>
              <div className="rs">{r.reason || 'No value reported'}</div>
            </div>
            <span className="n cv">
              {r.value === null ? '–' : `${num(r.value, 2)} ${r.unit === 'pH' ? '' : r.unit}`}
              <br />
              <small>{time(r.recorded_at)}</small>
            </span>
          </div>
        ))
      )}
      <button className="link b-more" aria-expanded={all} onClick={onAll}>
        {all ? 'Hide all readings and events' : 'All readings and events →'}
      </button>
    </section>
  )
}

function Logged({ events, pending }: { events?: ProcessEvent[]; pending: boolean }) {
  return (
    <Section title="Logged events" note="Sampling, discharge and maintenance, used as context by the AI analysis">
      {events?.length ? (
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
              {events.map((e) => (
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
      ) : pending ? (
        <Loading rows={2} />
      ) : (
        <Empty title="No events logged in this period">Logging discharges and samples lets the analysis relate them to a biological response.</Empty>
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
