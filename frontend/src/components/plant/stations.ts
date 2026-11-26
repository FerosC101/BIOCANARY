import { rangeOf, rangeText, severityWord, ZONE } from '../../lib/ranges'
import type { Station } from '../../lib/types'
import type { Anchor, Lamp, Slot } from './plantScene'

/** Place each station on the illustration by what it monitors; anything unmatched takes a free unit. */
export function assign(stations: Station[]): Partial<Record<Slot, Station>> {
  const out: Partial<Record<Slot, Station>> = {}
  const rest: Station[] = []
  for (const s of stations) {
    const n = s.name.toLowerCase()
    const slot: Slot | null = n.includes('influent') || n.includes('inlet') ? 'inlet' : n.includes('equal') ? 'eq' : n.includes('industr') ? 'industrial' : s.origin === 'live' ? 'lab' : null
    if (slot && !out[slot]) out[slot] = s
    else rest.push(s)
  }
  for (const s of rest) {
    const free = (['inlet', 'eq', 'industrial', 'lab'] as Slot[]).find((k) => !out[k])
    if (free) out[free] = s
  }
  return out
}

export function lampsFor(placed: Partial<Record<Slot, Station>>): Partial<Record<Slot, Lamp>> {
  const out: Partial<Record<Slot, Lamp>> = {}
  for (const [slot, s] of Object.entries(placed) as [Slot, Station][]) out[slot] = s.status
  return out
}

/** Range, words and colour for a station's newest assessment. Offline stations show no range. */
export function reading(s: Station) {
  const l = s.latest_assessment
  const offline = s.status === 'offline'
  const thresholds = l?.thresholds ?? null
  const value = offline ? null : (l?.inhibition ?? null)
  const zone = offline ? null : rangeOf(value, thresholds)
  const word = offline ? 'Offline' : !l ? 'Waiting for data' : rangeText(value, thresholds, severityWord(l.severity))
  return { offline, thresholds, value, zone, word, ink: zone === null ? 'var(--ink-2)' : ZONE[zone] }
}


/** Plant labels; one is dropped when a station of the same name already marks the spot. */
export const LABELS: [Anchor, string, Slot?][] = [
  ['u-inlet', 'Inlet works'],
  ['u-eq', 'Equalisation basin', 'eq'],
  ['u-primary', 'Primary settling'],
  ['u-aeration', 'Aeration hall'],
  ['u-digesters', 'Sludge digesters'],
  ['u-clarifier', 'Final clarifiers'],
  ['u-control', 'Control room'],
  ['u-river', 'River'],
]
