import { useId } from 'react'
import { num } from '../lib/format'

interface Props {
  reference: number | null
  exposed: number | null
  unit: string
  muted?: boolean
}

/**
 * The brand's ring and gradient disc, used as a measurement: the ring's outer circle is reference
 * activity, the disc's area is exposed activity on the same scale. The visible ring is the shortfall.
 */
export function ResponseDisc({ reference, exposed, unit, muted }: Props) {
  const id = useId()
  const R = 92
  const cx = 130
  const cy = 112
  const known = reference !== null && exposed !== null && reference > 0
  const ratio = known ? exposed / reference : 0
  const scale = Math.max(1, ratio)
  const outer = R / Math.sqrt(scale)
  const inner = known ? outer * Math.sqrt(Math.max(0, ratio)) : 0
  const label = known
    ? `Exposed activity is ${Math.round(ratio * 100)} percent of reference activity`
    : 'No comparison available'
  const a1 = -0.62
  const a2 = 0.5
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  const [x1, y1] = p(outer, a1)
  const [x2, y2] = p(inner * 0.8, a2)
  return (
    <svg className={'disc' + (muted ? ' disc-muted' : '')} viewBox="0 0 360 224" role="img" aria-label={label}>
      <defs>
        <radialGradient id={id + 'd'} cx="0.1" cy="0.08" r="1.08">
          <stop offset="0.12" stopColor="#254F91" />
          <stop offset="0.36" stopColor="#3F7F8C" />
          <stop offset="0.56" stopColor="#60B985" />
          <stop offset="0.78" stopColor="#6FD68A" />
          <stop offset="1" stopColor="#83E6A3" />
        </radialGradient>
        <linearGradient id={id + 'r'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0.1" stopColor="#E6F7C6" />
          <stop offset="1" stopColor="#A6F684" />
        </linearGradient>
      </defs>
      {[R + 14, R + 30, R + 48].map((r) => (
        <circle key={r} className="disc-arc" cx={cx} cy={cy} r={r} />
      ))}
      {known ? (
        <>
          <circle className="disc-ref" cx={cx} cy={cy} r={outer} fill={`url(#${id}r)`} />
          <circle className="disc-exp" cx={cx} cy={cy} r={inner} fill={`url(#${id}d)`} />
          <circle className="disc-edge" cx={cx} cy={cy} r={outer} />
          <path className="disc-lead" d={`M${x1} ${y1}L258 ${y1 - 14}H268`} />
          <circle className="disc-dot" cx={x1} cy={y1} r="3" />
          <text className="disc-value" x="274" y={y1 - 14}>
            {num(reference)} <tspan className="disc-unit">{unit}</tspan>
          </text>
          <text className="disc-label" x="274" y={y1 + 3}>
            Reference
          </text>
          <path className="disc-lead" d={`M${x2} ${y2}L258 ${y2 + 20}H268`} />
          <circle className="disc-dot" cx={x2} cy={y2} r="3" />
          <text className="disc-value" x="274" y={y2 + 22}>
            {num(exposed)} <tspan className="disc-unit">{unit}</tspan>
          </text>
          <text className="disc-label" x="274" y={y2 + 39}>
            Exposed
          </text>
        </>
      ) : (
        <circle className="disc-empty" cx={cx} cy={cy} r={R} />
      )}
    </svg>
  )
}
