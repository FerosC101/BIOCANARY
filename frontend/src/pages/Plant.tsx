import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { PlantCanvas, StationPin, type Pin } from '../components/plant/PlantCanvas'
import type { Anchor, Emphasis, Slot, ViewName } from '../components/plant/plantScene'
import { assign, lampsFor, LABELS } from '../components/plant/stations'
import { OriginTag } from '../components/ui'
import { get } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import type { Station, SystemStatus } from '../lib/types'

interface Step {
  view: ViewName
  title: string
  text: string
  emphasis: Emphasis
  visual?: 'device' | 'gap'
}

const quiet: Emphasis = { sewer: 0.35, industrial: 0.3, sample: 0, data: 0, alert: 0 }

function steps(where: string, every: string): Step[] {
  return [
    {
      view: 'overview',
      title: 'A treatment plant depends on living microorganisms',
      text: 'Bacteria in the aeration hall break down what arrives in the sewage. A toxic discharge can inhibit them, and the plant may only notice after its treatment has already slowed.',
      emphasis: { ...quiet, sewer: 0.8 },
    },
    {
      view: 'arrive',
      title: 'Wastewater arrives',
      text: 'Municipal sewage and industrial discharges reach the inlet works. BIOCANARY units sit on these inflows, upstream of the treatment biology.',
      emphasis: { ...quiet, sewer: 1, industrial: 1, sample: 0.5 },
    },
    {
      view: 'sample',
      title: 'A small stream is sampled',
      text: 'A pump draws a continuous sample from the channel into the unit beside it. The plant’s flow is not interrupted.',
      emphasis: { ...quiet, sewer: 0.9, sample: 1 },
    },
    {
      view: 'device',
      title: 'Two chambers, one culture',
      text: 'The same microbial culture grows in two chambers. The reference chamber is protected; the test chamber receives the sample. Probes measure activity, dissolved oxygen and temperature in both.',
      emphasis: { ...quiet, sample: 1 },
      visual: 'device',
    },
    {
      view: 'signal',
      title: 'Divergence is the signal',
      text: 'If something in the water inhibits life, test activity falls below the reference. That gap, as a share of the reference, is the inhibition indicator.',
      emphasis: { ...quiet, sewer: 0.7, industrial: 0.7, sample: 1 },
      visual: 'gap',
    },
    {
      view: 'analyse',
      title: 'Readings are analysed',
      text: `Each unit uploads readings ${every}. The analysis runs on ${where}: it compares the gap with the station’s own history and the protocol’s ranges. Other measurements that moved at the same time are shown as associations, not causes.`,
      emphasis: { ...quiet, sample: 0.6, data: 1 },
    },
    {
      view: 'alert',
      title: 'Operators are warned early',
      text: 'When the gap enters a range, the control room is alerted while that water is still upstream of the aeration hall. People decide what to do; BIOCANARY does not call water safe or unsafe.',
      emphasis: { ...quiet, sewer: 0.7, data: 0.7, alert: 1 },
    },
  ]
}

export function Plant() {
  const { stations, selectStation } = useApp()
  const navigate = useNavigate()
  const now = useNow()
  const system = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState<Slot | null>(null)
  const still = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  const where = system.data ? (system.data.cloud.mode === 'local' ? 'this computer (local development)' : system.data.cloud.label) : 'the analysis service'
  const interval = stations[0]?.expected_interval_seconds
  const list = useMemo(() => steps(where, interval ? `about every ${interval < 120 ? `${interval} s` : `${Math.round(interval / 60)} min`}` : 'continuously'), [where, interval])
  const step = list[i]
  const placed = useMemo(() => assign(stations), [stations])

  const lamps = useMemo(() => lampsFor(placed), [placed])

  useEffect(() => {
    if (!playing) return
    const id = setTimeout(() => (i < list.length - 1 ? setI(i + 1) : setPlaying(false)), 9000)
    return () => clearTimeout(id)
  }, [playing, i, list.length])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if (e.key === 'ArrowRight') setI((v) => Math.min(list.length - 1, v + 1))
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1))
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [list.length])

  const go = (n: number) => {
    setPlaying(false)
    setI(n)
  }
  const simulated = stations.some((s) => s.origin === 'simulated')
  const pins: Pin[] = [
    ...LABELS.filter(([, , slot]) => !slot || !placed[slot]).map(([a, label]) => ({ anchor: a, key: a, node: <span className="plant-label">{label}</span> })),
    ...(Object.entries(placed) as [Slot, Station][]).map(([slot, s]) => ({
      anchor: slot,
      key: s.code,
      className: open === slot ? 'open' : undefined,
      node: (
        <StationPin
          s={s}
          open={open === slot}
          now={now}
          compact
          onToggle={() => setOpen(open === slot ? null : slot)}
          onOpen={() => {
            selectStation(s.code)
            navigate('/')
          }}
        />
      ),
    })),
    ...(step.emphasis.data > 0.5 ? [{ anchor: 'hub' as Anchor, key: 'hub', node: <span className="plant-label hub">Analysis · {system.data?.cloud.label ?? 'service'}</span> }] : []),
  ]

  return (
    <main className={`plant plant-${state}`}>
      <PlantCanvas
        view={step.view}
        emphasis={step.emphasis}
        lamps={lamps}
        shift
        pins={pins}
        onState={setState}
        label="Illustration of a wastewater treatment plant with BIOCANARY units on its inflows"
      />

      <header className="plant-head">
        <Logo className="plant-logo" tone="white" />
        <span className="plant-title">How it works</span>
        <span className="wall-fill" />
        {simulated && <OriginTag origin="simulated" />}
        <Link to="/" className="plant-close" title="Back to the dashboard" aria-label="Back to the dashboard">
          <X size={20} aria-hidden />
        </Link>
      </header>

      <section className="plant-card" aria-live="polite" aria-label={`Step ${i + 1} of ${list.length}`}>
        <span className="plant-count n">
          {i + 1} / {list.length}
        </span>
        <h1>{step.title}</h1>
        <p>{step.text}</p>
        {step.visual === 'device' && (
          <figure className="plant-visual">
            <img src="/device/device.webp" alt="The BIOCANARY unit: a reference chamber lit blue and a test chamber lit green" width={1536} height={1024} />
            <figcaption>Blue and green light identify the chambers. They do not indicate microbial health.</figcaption>
          </figure>
        )}
        {step.visual === 'gap' && <GapSketch still={still} />}
        <div className="plant-nav">
          <button className="btn" onClick={() => go(Math.max(0, i - 1))} disabled={i === 0} aria-label="Previous step">
            <ArrowLeft size={16} aria-hidden />
          </button>
          <div className="plant-dots" role="group" aria-label="Steps">
            {list.map((s, n) => (
              <button key={n} aria-current={n === i ? 'step' : undefined} aria-label={`Step ${n + 1}: ${s.title}`} onClick={() => go(n)} />
            ))}
          </div>
          {!still && (
            <button className="btn" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause the tour' : 'Play the tour'}>
              {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
            </button>
          )}
          <button className="btn primary" onClick={() => go(Math.min(list.length - 1, i + 1))} disabled={i === list.length - 1}>
            Next <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      </section>

      <p className="plant-note">
        {state === 'failed'
          ? 'Interactive 3D is unavailable in this browser. The steps still describe how the system works.'
          : 'Illustration: the plant layout and unit positions are not your site. Lamps and labels on the units show each station’s live state. Drag to turn, scroll to zoom.'}
      </p>
    </main>
  )
}

/** Reference holds steady, test falls away; the shaded band is the inhibition. */
function GapSketch({ still }: { still: boolean }) {
  const ref = 'M0 30 C40 28 80 32 120 29 S200 31 240 30 S300 29 320 30'
  const exp = 'M0 33 C40 31 80 35 110 33 C130 32 140 60 160 66 S220 70 250 68 C275 66 290 44 320 38'
  const band = 'M110 29 C130 30 200 31 240 30 S300 29 320 30 L320 38 C290 44 275 66 250 68 S180 70 160 66 C140 60 130 32 110 33 Z'
  return (
    <figure className={'plant-visual gap' + (still ? ' still' : '')}>
      <svg viewBox="0 0 320 84" role="img" aria-label="Sketch: the reference line stays level while the test line drops below it; the space between them is the inhibition">
        <path d={band} fill="#FFB547" opacity="0.22" className="band" />
        <path d={ref} fill="none" stroke="#8FB6FF" strokeWidth="2.5" className="line" style={{ filter: 'drop-shadow(0 0 4px #2F6BFF)' }} />
        <path d={exp} fill="none" stroke="#7CF09A" strokeWidth="2.5" className="line" style={{ filter: 'drop-shadow(0 0 4px #4FD96B)' }} />
        <text x="252" y="56" className="gap-label">
          inhibition
        </text>
      </svg>
      <figcaption>
        <span className="key">
          <i style={{ background: '#8FB6FF' }} />
          Reference
        </span>
        <span className="key">
          <i style={{ background: '#7CF09A' }} />
          Test
        </span>
      </figcaption>
    </figure>
  )
}
