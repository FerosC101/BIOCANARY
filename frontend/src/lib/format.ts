const dt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', o)
const timeF = dt({ hour: '2-digit', minute: '2-digit' })
const dayF = dt({ day: 'numeric', month: 'short' })
const fullF = dt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const longF = dt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

type D = string | number | Date
export const time = (v: D) => timeF.format(new Date(v))
export const day = (v: D) => dayF.format(new Date(v))
export const dateTime = (v: D) => fullF.format(new Date(v))
export const exact = (v: D) => longF.format(new Date(v))

export function num(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '–' : v.toFixed(digits)
}

export function ago(v: D, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(v).getTime()) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}

export const confidence = (v: number) => (v > 0.99 ? 'Above 99%' : `${Math.round(v * 100)}%`)
export const percent = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`
export const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`)
export const digitsFor = (quantity: string) => ({ ph: 2, dissolved_oxygen: 2, conductivity: 0 })[quantity] ?? 1

export function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = minutes / 60
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${Math.round(h / 24)} d`
}

export const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
