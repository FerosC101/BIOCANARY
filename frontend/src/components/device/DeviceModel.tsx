import { useEffect, useRef, useState } from 'react'
import type { DeviceScene, Lamps, Part, View } from './scene'

interface Props {
  lamps: Lamps
  active: boolean
  view: View
  dark?: boolean
  /** Text alternative for the model. */
  label: string
  markers?: { part: Part; label: string }[]
  selected?: Part | null
  onSelect?: (p: Part) => void
}

/** Interactive 3D device. Shows a still image until the model is ready, or if WebGL is unavailable. */
export function DeviceModel({ lamps, active, view, dark = false, label, markers, selected, onSelect }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const pins = useRef<Partial<Record<Part, HTMLButtonElement | null>>>({})
  const scene = useRef<DeviceScene | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    let gone = false
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    import('./scene')
      .then(async ({ DeviceScene }) => {
        if (gone || !canvas.current) return
        const s = new DeviceScene({
          canvas: canvas.current,
          dark,
          still,
          onFrame: (project) => {
            for (const [part, el] of Object.entries(pins.current)) {
              if (!el) continue
              const q = project(part as Part)
              el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`
              el.style.visibility = q.shown ? 'visible' : 'hidden'
            }
          },
          onLost: () => setState('failed'),
        })
        scene.current = s
        await s.load('/device/device.glb')
        if (!gone) setState('ready')
      })
      .catch((e) => {
        console.warn('The 3D device view is unavailable.', e)
        if (!gone) setState('failed')
      })
    return () => {
      gone = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [dark])

  useEffect(() => scene.current?.setLamps(lamps), [lamps, state])
  useEffect(() => scene.current?.setActive(active), [active, state])
  useEffect(() => scene.current?.setView(view), [view, state])

  return (
    <div className={`dv dv-${state}${dark ? ' dv-dark' : ''}`}>
      <img src="/device/device.webp" alt={state === 'ready' ? '' : label} width={1536} height={1024} aria-hidden={state === 'ready'} />
      {state !== 'failed' && <canvas ref={canvas} role="img" aria-label={label} />}
      {state === 'ready' &&
        markers?.map((m) => (
          <button
            key={m.part}
            ref={(el) => {
              pins.current[m.part] = el
            }}
            className="dv-pin"
            aria-pressed={selected === m.part}
            aria-label={m.label}
            title={m.label}
            onClick={() => onSelect?.(m.part)}
          >
            <i />
          </button>
        ))}
      {state === 'failed' && <p className="dv-note">Interactive 3D is unavailable in this browser. This still image does not reflect the station’s state.</p>}
    </div>
  )
}
