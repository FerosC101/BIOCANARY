import { time } from './format'
import type { Series } from './types'

/**
 * Average a series into coarser buckets for summary charts. Each bucket is the mean of the valid
 * values in it, so gaps with no valid reading stay gaps. Callers say "averages" wherever they use it.
 */
export function resample(s: Series, minutes: number): Series {
  if (!s.t.length || minutes <= s.bucket_minutes) return s
  const size = minutes * 60_000
  const first = Math.floor(s.t[0] / size) * size
  const n = Math.floor((s.t[s.t.length - 1] - first) / size) + 1
  const t = Array.from({ length: n }, (_, i) => first + i * size + size / 2)
  const channels: Series['channels'] = {}
  for (const [k, values] of Object.entries(s.channels)) {
    const sum = new Array<number>(n).fill(0)
    const count = new Array<number>(n).fill(0)
    values.forEach((v, i) => {
      if (v === null) return
      const b = Math.floor((s.t[i] - first) / size)
      sum[b] += v
      count[b] += 1
    })
    channels[k] = sum.map((v, i) => (count[i] ? v / count[i] : null))
  }
  // The newest bucket is partial; pin it to the latest reading time so the line ends at "now".
  t[n - 1] = Math.min(t[n - 1], s.t[s.t.length - 1])
  return { ...s, t, channels, bucket_minutes: minutes }
}

/** Five evenly spaced time labels ending in "Now", as on the design boards. */
export function timeLabels(t: number[]): string[] {
  if (t.length < 2) return []
  const a = t[0]
  const b = t[t.length - 1]
  return [0, 0.25, 0.5, 0.75, 1].map((f, i) => (i === 4 ? 'Now' : time(a + (b - a) * f)))
}
