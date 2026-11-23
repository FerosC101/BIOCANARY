import { num } from '../lib/format'
import { rangeOf, ZONE, type Thresholds } from '../lib/ranges'

interface Props {
  value: number | null
  thresholds: Thresholds | null
  size?: number
  caption?: string
  /** Offline or not assessed: show the ring without colour. */
  muted?: boolean
  label?: string
}

/**
 * Inhibition on a 270° ring. The ranges are drawn as faint zones with ticks at their boundaries, so
 * the level reads from position and the caption's words, never from colour alone.
 */
export function Dial({ value, thresholds, size = 280, caption, muted, label }: Props) {
  const big = size >= 160
  const stroke = Math.max(6, Math.round(size * 0.05))
  const c = size / 2
  const r = c - stroke / 2 - (big ? 18 : 2)
  const valid = rangeOf(0, thresholds) !== null
  const max = valid ? Math.max(60, Math.ceil((thresholds!.severe! * 1.2) / 10) * 10) : 100
  const ang = (v: number) => ((135 + (270 * Math.min(Math.max(v, 0), max)) / max) * Math.PI) / 180
  const pt = (v: number, rr = r) => [c + rr * Math.cos(ang(v)), c + rr * Math.sin(ang(v))]
  const arc = (a: number, b: number) => {
    const [x1, y1] = pt(a)
    const [x2, y2] = pt(b)
    return `M${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 ${((b - a) / max) * 270 > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
  }
  const cuts = valid ? [0, thresholds!.mild!, thresholds!.moderate!, thresholds!.severe!, max] : [0, max]
  const gap = max * 0.008
  const zone = rangeOf(value, thresholds)
  const color = muted || value === null ? '#6F86B3' : zone === null ? '#C6D2EA' : ZONE[zone]
  const tone = muted || value === null || zone === null ? 'flat' : zone === 0 ? 'calm' : 'hot'
  return (
    <figure className={`dial ${tone}`} style={{ width: size, height: size }} role="img" aria-label={label ?? `Inhibition ${value === null ? 'not available' : `${num(value)} percent`}. ${caption ?? ''}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={c} cy={c} r={r - stroke * 1.2} fill={tone === 'flat' ? 'rgb(255 255 255 / 3%)' : `${color}12`} />
        {cuts.slice(0, -1).map((a, i) => (
          <path key={i} d={arc(a + (i ? gap : 0), cuts[i + 1] - (i < cuts.length - 2 ? gap : 0))} fill="none" stroke={valid ? ZONE[i] : '#6F86B3'} strokeOpacity={muted ? 0.12 : 0.24} strokeWidth={stroke} />
        ))}
        {value !== null && !muted && value > 0.2 && <path d={arc(0, value)} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 ${big ? 10 : 5}px ${color})` }} />}
        {big &&
          valid &&
          cuts.slice(1, -1).map((v) => {
            const [x1, y1] = pt(v, r - stroke * 0.9)
            const [x2, y2] = pt(v, r + stroke * 0.9)
            const [lx, ly] = pt(v, r + stroke + 12)
            return (
              <g key={v}>
                <path d={`M${x1} ${y1}L${x2} ${y2}`} stroke="#EAF2FF" strokeOpacity="0.7" strokeWidth="2" />
                <text className="dial-tick" x={lx} y={ly + 4} textAnchor="middle">
                  {v}%
                </text>
              </g>
            )
          })}
        {big && value !== null && !muted && (() => {
          const [x, y] = pt(value)
          return <circle cx={x} cy={y} r={stroke * 0.62} fill="#FFF3DC" style={{ filter: `drop-shadow(0 0 8px ${color})` }} />
        })()}
      </svg>
      <div className="dial-core">
        <b style={{ fontSize: size * (big ? 0.23 : 0.26) }}>{value === null ? '–' : `${num(value, value < 10 ? 1 : 0)}%`}</b>
        {big && <span>inhibition</span>}
      </div>
      {caption && big && <figcaption className="dial-caption">{caption}</figcaption>}
    </figure>
  )
}
