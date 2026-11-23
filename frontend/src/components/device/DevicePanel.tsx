import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { get } from '../../lib/api'
import { useApp, useNow } from '../../lib/app'
import { ago, digitsFor, num } from '../../lib/format'
import type { DeviceState, SensorState, SystemStatus } from '../../lib/types'
import { Section } from '../ui'
import { DeviceModel } from './DeviceModel'
import type { Lamp, Lamps, Part, View } from './scene'

const TABS: { part: Part; label: string }[] = [
  { part: 'reference', label: 'Reference chamber' },
  { part: 'test', label: 'Test chamber' },
  { part: 'lines', label: 'Sample line' },
  { part: 'panel', label: 'Status panel' },
]
const ANGLES: { view: View; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'left', label: 'Left' },
  { view: 'right', label: 'Right' },
  { view: 'rear', label: 'Back' },
]
const ORDER = ['biological_activity', 'dissolved_oxygen', 'temperature']
const LAMP_TEXT: Record<Lamp, string> = { on: 'Lit', off: 'Not lit', warning: 'Amber', critical: 'Red' }

/** The device in 3D, with the latest reading for whichever part is selected. */
export function DevicePanel({ sensors, devices }: { sensors: SensorState[]; devices: DeviceState[] }) {
  const { station } = useApp()
  const now = useNow()
  const [part, setPart] = useState<Part>('reference')
  const [view, setView] = useState<View>('front')
  const system = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const simulated = station.origin === 'simulated'
  const reporting = !!station.last_reading_at && station.status !== 'offline'
  const mode = system.data?.cloud.mode
  const wifi: Lamp = reporting ? 'on' : 'off'
  const cloud: Lamp = mode === 'huawei_connected' ? 'on' : mode === 'huawei_partial' ? 'warning' : 'off'
  const status: Lamp = station.status === 'healthy' ? 'on' : station.status === 'warning' || station.status === 'critical' ? station.status : 'off'
  const lamps = useMemo<Lamps>(() => ({ wifi, cloud, status }), [wifi, cloud, status])

  const choose = (p: Part) => {
    setPart(p)
    setView(p)
  }
  const at = part === 'reference' ? 'reference' : part === 'test' ? 'exposed' : 'environment'
  const rows = sensors.filter((s) => s.location === at).sort((a, b) => ORDER.indexOf(a.quantity) - ORDER.indexOf(b.quantity))

  return (
    <Section
      title="Device"
      note={simulated ? 'The BIOCANARY device design. This station is simulated, so no physical unit is connected.' : 'The BIOCANARY device design. Readings beside it come from this station’s hardware.'}
    >
      <div className="dv-grid">
        <div className="dv-stage">
          <DeviceModel dark lamps={lamps} active={reporting} view={view} label="3D model of the BIOCANARY device: a blue reference chamber and a green test chamber on a white base, with a status panel on the right" markers={TABS} selected={part} onSelect={choose} />
          <div className="dv-under">
            <div className="segmented" role="group" aria-label="View angle">
              {ANGLES.map((a) => (
                <button key={a.view} aria-pressed={view === a.view} onClick={() => setView(a.view)}>
                  {a.label}
                </button>
              ))}
            </div>
            <span className="sub">Drag the model to turn it</span>
          </div>
        </div>
        <div className="dv-side">
          <div className="dv-tabs" role="group" aria-label="Device part">
            {TABS.map((t) => (
              <button key={t.part} aria-pressed={part === t.part} onClick={() => choose(t.part)}>
                <i className={`dv-dot dv-${t.part}`} />
                {t.label}
              </button>
            ))}
          </div>
          <div className="dv-info" aria-live="polite">
            {part === 'panel' && (
              <dl className="dv-lamps">
                <div>
                  <dt>Wireless</dt>
                  <dd>{LAMP_TEXT[wifi]}</dd>
                  <dd className="sub">
                    {reporting ? `Readings are arriving, last ${ago(station.last_reading_at!, now)}` : station.last_reading_at ? `No readings since ${ago(station.last_reading_at, now)}` : 'No readings received yet'}
                    {!simulated && devices[0] && `. Device ${devices[0].code} reports “${devices[0].state}”`}
                  </dd>
                </div>
                <div>
                  <dt>Cloud</dt>
                  <dd>{LAMP_TEXT[cloud]}</dd>
                  <dd className="sub">{system.data?.cloud.label ?? 'Checking'}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{status === 'on' ? 'Green' : LAMP_TEXT[status]}</dd>
                  <dd className="sub">{station.status_label}</dd>
                </div>
              </dl>
            )}
            {part !== 'panel' && (
              <>
                <dl className="dv-readings">
                  {rows.map((s) => {
                    const l = s.latest && s.latest.value !== null && s.connection !== 'invalid' && s.connection !== 'missing' ? s.latest : null
                    return (
                      <div key={s.code}>
                        <dt>{s.name.replace(/^(Reference|Exposed|Wastewater) /, '').replace(/^[a-oq-z]/, (c) => c.toUpperCase())}</dt>
                        <dd>
                          {num(l?.value, digitsFor(s.quantity))} <small>{l && s.quantity !== 'ph' ? s.unit : ''}</small>
                        </dd>
                        <dd className="sub">{l ? ago(l.recorded_at, now) : s.connection === 'never' ? 'Never reported' : 'No valid reading'}</dd>
                      </div>
                    )
                  })}
                </dl>
                {!rows.length && <p className="sub">No sensors are registered here.</p>}
              </>
            )}
          </div>
          <p className="dv-caption">
            Blue and green lighting identifies the chambers. It does not indicate microbial health.
            {!reporting && ' The model is dimmed because this station is not reporting.'}
          </p>
        </div>
      </div>
    </Section>
  )
}
