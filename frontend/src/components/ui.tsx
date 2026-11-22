import { AlertTriangle, Check, CircleDashed, CircleHelp, OctagonAlert, WifiOff, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { dateTime } from '../lib/format'
import { PRESET_LABEL, type Preset, type Range } from '../lib/range'
import type { Origin, Severity, Status } from '../lib/types'

const STATUS_ICON: Record<Status, LucideIcon> = { healthy: Check, warning: AlertTriangle, critical: OctagonAlert, offline: WifiOff, pending: CircleDashed }

export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  const Icon = STATUS_ICON[status]
  return <Icon size={size} strokeWidth={2.4} aria-hidden />
}

export function StatusBadge({ status, label }: { status: Status; label: string }) {
  return (
    <span className={`badge s-${status}`}>
      <StatusIcon status={status} size={13} />
      {label}
    </span>
  )
}

const SEV: Record<Severity, [Status, string]> = {
  normal: ['healthy', 'Normal'],
  mild: ['warning', 'Mild inhibition'],
  moderate: ['warning', 'Moderate inhibition'],
  severe: ['critical', 'Severe inhibition'],
  unclassified: ['pending', 'Unclassified'],
  inconclusive: ['pending', 'Inconclusive'],
  insufficient: ['offline', 'Not enough data'],
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const [status, label] = SEV[severity]
  const Icon = severity === 'unclassified' || severity === 'inconclusive' ? CircleHelp : STATUS_ICON[status]
  return (
    <span className={`badge s-${status} sev-${severity}`}>
      <Icon size={13} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  )
}

export function OriginTag({ origin }: { origin: Origin }) {
  return origin === 'simulated' ? (
    <span className="origin simulated" title="These readings come from the simulator, not from hardware.">
      Simulated data
    </span>
  ) : (
    <span className="origin live" title="Readings from this station come from BIOCANARY hardware.">
      Live hardware
    </span>
  )
}

export function Section({ title, note, actions, children, className = '' }: { title: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <section className={'section ' + className} aria-labelledby={id}>
      <header>
        <div>
          <h2 id={id}>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loading" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <svg viewBox="0 0 64 64" width="44" height="44" aria-hidden>
        <circle cx="32" cy="32" r="30" fill="none" stroke="#A6F684" strokeWidth="2" />
        <circle cx="32" cy="32" r="18" fill="none" stroke="#83E6A3" strokeWidth="2" />
      </svg>
      <b>{title}</b>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="failed" role="alert">
      <AlertTriangle size={18} aria-hidden />
      <span>{error instanceof Error ? error.message : 'This could not be loaded.'}</span>
      <button className="btn" onClick={retry}>
        Try again
      </button>
    </div>
  )
}

export function RangePicker({ value, onChange, presets }: { value: Range; onChange: (r: Range) => void; presets: Preset[] }) {
  const custom = 'start' in value
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [error, setError] = useState('')
  const ref = useDismiss(open, () => setOpen(false))
  const apply = () => {
    const a = new Date(start)
    const b = new Date(end)
    if (Number.isNaN(+a) || Number.isNaN(+b)) return setError('Enter both a start and an end.')
    if (a >= b) return setError('The start must be before the end.')
    if (+b - +a > 366 * 86400_000) return setError('Choose a period of at most 366 days.')
    setError('')
    setOpen(false)
    onChange({ start: a.toISOString(), end: b.toISOString() })
  }
  return (
    <div className="range" role="group" aria-label="Date range" ref={ref}>
      {presets.map((p) => (
        <button key={p} aria-pressed={!custom && value.preset === p} onClick={() => onChange({ preset: p })}>
          {PRESET_LABEL[p].replace('Last ', '')}
        </button>
      ))}
      <button aria-pressed={custom} aria-expanded={open} onClick={() => setOpen(!open)}>
        {custom ? `${dateTime(value.start)} – ${dateTime(value.end)}` : 'Custom'}
      </button>
      {open && (
        <div className="popover">
          <label>
            From
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" onClick={apply}>
            Apply range
          </button>
        </div>
      )}
    </div>
  )
}

/** Closes a popover on outside click or Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && close()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])
  return ref
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </dialog>
  )
}
