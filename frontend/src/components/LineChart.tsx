import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dateTime, day, num, time } from '../lib/format'

export interface LineSeries {
  key: string
  label: string
  color: string
  values: (number | null)[]
}

interface Props {
  t: number[]
  series: LineSeries[]
  unit: string
  digits?: number
  height?: number
  /** Shade the difference between the first two series. */
  gap?: boolean
  guides?: { label: string; value: number }[]
  marks?: { at: number; label: string }[]
  includeZero?: boolean
  minSpan?: number
  label: string
  /** Shared hover position: charts given the same pair move together. */
  hover?: number | null
  onHover?: (t: number | null) => void
  onSelect?: (t: number) => void
  compact?: boolean
  legend?: boolean
  /** Other values the y axis must also cover, so paired charts share one scale. */
  alsoFit?: (number | null)[][]
  area?: boolean
}

function niceStep(span: number, target: number): number {
  const raw = span / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
}

const TIME_STEPS = [10, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 7200, 10080, 14400].map((m) => m * 60000)

function timeTicks(a: number, b: number, count: number): number[] {
  const step = TIME_STEPS.find((s) => (b - a) / s <= count) ?? TIME_STEPS[TIME_STEPS.length - 1]
  const offset = new Date(a).getTimezoneOffset() * 60000
  const out: number[] = []
  for (let x = Math.ceil((a - offset) / step) * step + offset; x <= b; x += step) out.push(x)
  return out
}

export function LineChart(props: Props) {
  const { t, series, unit, digits = 1, gap, guides = [], marks = [], includeZero, minSpan = 1, label, onHover, onSelect, compact, area, alsoFit } = props
  const height = props.height ?? 240
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [own, setOwn] = useState<number | null>(null)
  const clip = useId()
  const hoverT = onHover ? (props.hover ?? null) : own
  const setHover = useCallback((v: number | null) => (onHover ? onHover(v) : setOwn(v)), [onHover])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(220, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const direct = series.length > 1 && !compact && width > 460

  const { lo, hi, ticks } = useMemo(() => {
    const all = [...series.map((s) => s.values), ...(alsoFit ?? [])].flatMap((x) => x.filter((v): v is number => v !== null))
    if (!all.length) return { lo: 0, hi: 1, ticks: [] as number[] }
    let a = Math.min(...all)
    let b = Math.max(...all)
    if (includeZero) {
      a = Math.min(0, a)
      b = Math.max(b, 0)
    }
    if (b - a < minSpan) {
      const mid = (a + b) / 2
      a = includeZero && a >= 0 ? 0 : mid - minSpan / 2
      b = a + minSpan
    }
    const pad = (b - a) * 0.06
    const step = niceStep(b - a + pad * 2, compact ? 3 : 5)
    // Below zero the axis ends just under the data instead of at a full tick.
    a = includeZero ? (a === 0 ? 0 : a - pad) : Math.floor((a - pad) / step) * step
    b = Math.ceil((b + pad) / step) * step
    const list: number[] = []
    for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + step / 1000; v += step) list.push(Math.round(v * 1e6) / 1e6)
    return { lo: a, hi: b, ticks: list }
  }, [series, includeZero, minSpan, compact, alsoFit])

  const tickText = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(hi - lo) < 1 ? 2 : 1))
  const m = { l: Math.max(compact ? 30 : 38, 14 + Math.max(0, ...ticks.map((v) => tickText(v).length)) * 7), r: compact ? 14 : width > 460 ? 82 : guides.length ? 64 : 12, t: 10, b: 24 }
  const w = width - m.l - m.r
  const h = height - m.t - m.b


  const t0 = t[0] ?? 0
  const t1 = t[t.length - 1] ?? 1
  const x = (v: number) => m.l + ((v - t0) / Math.max(1, t1 - t0)) * w
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo || 1)) * h

  const line = (values: (number | null)[]) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${x(t[i]).toFixed(1)} ${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const areas = (top: (number | null)[], bottom: (number | null)[] | null) => {
    let d = ''
    let run: number[] = []
    const flush = () => {
      if (run.length > 1) {
        d += run.map((i, k) => `${k ? 'L' : 'M'}${x(t[i]).toFixed(1)} ${y(top[i] as number).toFixed(1)}`).join('')
        d += [...run].reverse().map((i) => `L${x(t[i]).toFixed(1)} ${y(bottom ? (bottom[i] as number) : Math.max(lo, 0)).toFixed(1)}`).join('') + 'Z'
      }
      run = []
    }
    top.forEach((v, i) => (v !== null && (!bottom || bottom[i] !== null) ? run.push(i) : flush()))
    flush()
    return d
  }

  const index = useMemo(() => {
    if (hoverT === null || !t.length) return null
    let best = 0
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - hoverT) < Math.abs(t[best] - hoverT)) best = i
    return best
  }, [hoverT, t])

  const locate = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return t0 + ((e.clientX - r.left - m.l) / w) * (t1 - t0)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return setHover(null)
    if (e.key === 'Enter' && onSelect && index !== null) return onSelect(t[index])
    const delta = { ArrowLeft: -1, ArrowRight: 1, PageUp: -12, PageDown: 12 }[e.key]
    if (!delta || !t.length) return
    e.preventDefault()
    const from = index ?? t.length - 1
    setHover(t[Math.min(t.length - 1, Math.max(0, from + delta))])
  }

  const ends = series
    .map((s) => {
      for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) return { s, i, v: s.values[i] as number, at: y(s.values[i] as number) }
      return null
    })
    .filter((e) => e !== null)
  const labels = ends.map((e) => ({ ...e, ly: e.at })).sort((a, b) => a.at - b.at)
  for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 16)

  const tipLeft = index !== null ? x(t[index]) : 0
  const span = t1 - t0
  const xt = timeTicks(t0, t1, Math.max(2, Math.floor(w / 92)))

  return (
    <div className="chart" ref={box}>
      {series.length > 1 && props.legend !== false && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        className={onSelect ? 'selectable' : undefined}
        onPointerMove={(e) => setHover(locate(e))}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={onKey}
        onClick={(e) => onSelect?.(locate(e as unknown as PointerEvent<SVGSVGElement>))}
      >
        <clipPath id={clip}>
          <rect x={m.l} y={0} width={Math.max(0, w)} height={height} />
        </clipPath>
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={m.l} x2={m.l + w} y1={y(v)} y2={y(v)} />
            <text className="tick" x={m.l - 8} y={y(v) + 3.5} textAnchor="end">
              {tickText(v)}
            </text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={v} className="tick" x={x(v)} y={height - 6} textAnchor={x(v) > width - 22 ? 'end' : 'middle'}>
            {span > 36 * 3600_000 ? day(v) : time(v)}
          </text>
        ))}
        {guides
          .filter((g) => g.value > lo && g.value < hi)
          .map((g) => (
            <g key={g.label}>
              <line className="guide" x1={m.l} x2={m.l + w} y1={y(g.value)} y2={y(g.value)} />
              <text className="tick" x={m.l + w + 6} y={y(g.value) + 3.5}>
                {g.label}
              </text>
            </g>
          ))}
        <g clipPath={`url(#${clip})`}>
          {gap && series.length > 1 && <path className="gap" d={areas(series[0].values, series[1].values)} />}
          {area && series.length === 1 && <path d={areas(series[0].values, null)} fill={series[0].color} opacity="0.09" />}
          {series.map((s) => (
            <path key={s.key} className="line" d={line(s.values)} stroke={s.color} />
          ))}
        </g>
        {marks
          .filter((k) => k.at >= t0 && k.at <= t1)
          .map((k, i) => (
            <g key={i}>
              <line className="mark" x1={x(k.at)} x2={x(k.at)} y1={m.t} y2={m.t + h} />
              <path className="mark-flag" d={`M${x(k.at)} ${m.t - 2}l5 5l-5 5l-5-5z`}>
                <title>{`${k.label}, ${dateTime(k.at)}`}</title>
              </path>
            </g>
          ))}
        {labels.map((e) => (
          <g key={e.s.key}>
            <circle className="dot" cx={x(t[e.i])} cy={e.at} r={4} fill={e.s.color} />
            {direct && (
              <text className="direct" x={m.l + w + 10} y={e.ly + 4}>
                {e.s.label}
              </text>
            )}
          </g>
        ))}
        {index !== null && (
          <g>
            <line className="cross" x1={x(t[index])} x2={x(t[index])} y1={m.t} y2={m.t + h} />
            {series.map((s) =>
              s.values[index] === null ? null : <circle key={s.key} className="dot" cx={x(t[index])} cy={y(s.values[index] as number)} r={4} fill={s.color} />,
            )}
          </g>
        )}
      </svg>
      {index !== null && (
        <div className="tip" style={{ left: tipLeft, transform: `translateX(${tipLeft > width * 0.6 ? 'calc(-100% - 12px)' : '12px'})` }}>
          <time>{dateTime(t[index])}</time>
          {series.map((s) => (
            <div key={s.key}>
              <i style={{ background: s.color }} />
              <b>{s.values[index] === null ? 'No valid data' : `${num(s.values[index], digits)} ${unit}`}</b>
              {series.length > 1 && <span>{s.label}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
