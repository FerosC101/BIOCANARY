import type { Series, Severity } from './types'

export type Thresholds = Series['thresholds']
export const RANGE_NAMES = ['Normal', 'Mild', 'Moderate', 'Severe']
/** Zone colours for normal, mild, moderate, severe. */
export const ZONE = ['#7CF09A', '#E6F07A', '#FFB547', '#FF6B5E']
/** Zone index for a classified severity; null for anything without validated ranges. */
export const SEVERITY_ZONE: Partial<Record<string, number>> = { normal: 0, mild: 1, moderate: 2, severe: 3 }

/** Where a value sits among the protocol's ranges; null when no validated ranges apply. */
export function rangeOf(value: number | null, t: Thresholds | null): number | null {
  if (value === null || !t || t.mild === null || t.moderate === null || t.severe === null) return null
  return value < t.mild ? 0 : value < t.moderate ? 1 : value < t.severe ? 2 : 3
}

export function rangeText(value: number | null, t: Thresholds | null, fallback: string): string {
  const i = rangeOf(value, t)
  if (i === null || !t) return fallback
  const cuts = [0, t.mild!, t.moderate!, t.severe!]
  return i === 3 ? `Severe range · ${cuts[3]}% and above` : i === 0 ? `Normal range · below ${cuts[1]}%` : `${RANGE_NAMES[i]} range · ${cuts[i]}–${cuts[i + 1]}%`
}

const SEVERITY_WORD: Record<Severity, string> = {
  normal: 'Normal',
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  unclassified: 'Unclassified',
  inconclusive: 'Inconclusive',
  insufficient: 'Not enough data',
}
export const severityWord = (s: Severity) => SEVERITY_WORD[s]

