import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ago, num } from '../../lib/format'
import type { Station } from '../../lib/types'
import { RangeGlyph } from '../ui'
import type { Anchor, Emphasis, Lamp, PlantScene, Slot, ViewName } from './plantScene'
import { reading } from './stations'

export interface Pin {
  anchor: Anchor
  key: string
  className?: string
  node: ReactNode
}

interface Props {
  view: ViewName
  emphasis: Emphasis
  lamps: Partial<Record<Slot, Lamp>>
  alerts?: Partial<Record<Slot, 'warning' | 'critical'>>
  focus?: Slot | null
  /** Keep the scene clear of a card over the lower left. */
  shift?: boolean
  pins: Pin[]
  label: string
  onState?: (s: 'loading' | 'ready' | 'failed') => void
}

/** The 3D plant with HTML pins that follow points in the scene. Loads three.js on demand. */
export function PlantCanvas({ view, emphasis, lamps, alerts, focus = null, shift = false, pins, label, onState }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scene = useRef<PlantScene | null>(null)
  const els = useRef<Map<string, { anchor: Anchor; el: HTMLElement }>>(new Map())
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => onState?.(state), [state, onState])

  useEffect(() => {
    let gone = false
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    import('./plantScene')
      .then(({ PlantScene }) => {
        if (gone || !canvas.current) return
        scene.current = new PlantScene({
          canvas: canvas.current,
          still,
          shift,
          onFrame: (project) => {
            for (const { anchor, el } of els.current.values()) {
              const q = project(anchor)
              el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`
              el.style.visibility = q.shown ? 'visible' : 'hidden'
            }
          },
          onLost: () => setState('failed'),
        })
        setState('ready')
      })
      .catch((e) => {
        console.warn('The 3D plant view is unavailable.', e)
        if (!gone) setState('failed')
      })
    return () => {
      gone = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [shift])

  useEffect(() => scene.current?.setEmphasis(emphasis), [emphasis, state])
  useEffect(() => scene.current?.setStations(lamps), [lamps, state])
  useEffect(() => scene.current?.setAlerts(alerts ?? {}), [alerts, state])
  useEffect(() => {
    if (focus) scene.current?.focus(focus)
    else scene.current?.setView(view)
  }, [view, focus, state])

  return (
    <div className={`plant-canvas plant-${state}`}>
      {state !== 'failed' && <canvas ref={canvas} role="img" aria-label={label} />}
      {state === 'ready' && (
        <div className="plant-pins">
          {pins.map((p) => (
            <div
              key={p.key}
              className={'plant-anchor' + (p.className ? ` ${p.className}` : '')}
              ref={(el) => {
                if (el) els.current.set(p.key, { anchor: p.anchor, el })
                else els.current.delete(p.key)
              }}
            >
              {p.node}
            </div>
          ))}
        </div>
      )}
      {state === 'failed' && <p className="plant-fallback">Interactive 3D is unavailable in this browser.</p>}
    </div>
  )
}

export function StationPin({ s, open, now, onToggle, onOpen, compact }: { s: Station; open: boolean; now: number; onToggle: () => void; onOpen?: () => void; compact?: boolean }) {
  const r = reading(s)
  return (
    <div className={'plant-pin' + (r.offline ? ' off' : '') + (r.zone !== null && r.zone >= 2 ? ' hot' : '')}>
      <button aria-expanded={onOpen ? open : undefined} aria-pressed={onOpen ? undefined : open} onClick={onToggle}>
        <RangeGlyph zone={r.zone} size={18} />
        <span>{s.name}</span>
        {!compact && r.value !== null && <b className="n">{num(r.value, r.value < 10 ? 1 : 0)}%</b>}
      </button>
      {open && onOpen && (
        <div className="plant-pop">
          <b>{s.name}</b>
          <span className="word" style={{ color: r.ink }}>
            {r.word}
          </span>
          <small>
            {s.code} · {s.origin === 'simulated' ? 'simulated' : 'live hardware'}
            {r.value !== null && ` · inhibition ${num(r.value)}%`}
            {' · '}
            {s.last_reading_at ? `last reading ${ago(s.last_reading_at, now)}` : 'no readings yet'}
          </small>
          <button className="link" onClick={onOpen}>
            Open on the dashboard →
          </button>
        </div>
      )}
    </div>
  )
}
