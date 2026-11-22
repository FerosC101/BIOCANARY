export type Preset = '6h' | '24h' | '7d' | '30d' | '90d'
export type Range = { preset: Preset } | { start: string; end: string }

export const PRESET_LABEL: Record<Preset, string> = {
  '6h': 'Last 6 hours',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
}
const HOURS: Record<Preset, number> = { '6h': 6, '24h': 24, '7d': 168, '30d': 720, '90d': 2160 }

/** Resolved at request time, so a preset always ends now. */
export function resolve(range: Range): { start: string; end: string } {
  if ('start' in range) return range
  const end = new Date()
  return { start: new Date(end.getTime() - HOURS[range.preset] * 3600_000).toISOString(), end: end.toISOString() }
}

export const query = (range: Range, extra: Record<string, string> = {}) => new URLSearchParams({ ...resolve(range), ...extra }).toString()
