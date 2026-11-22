import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { get } from './api'
import type { Station, User } from './types'

interface AppState {
  user: User
  stations: Station[]
  station: Station
  selectStation: (code: string) => void
  stream: 'connecting' | 'open' | 'lost'
}

const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}

const STORAGE = 'biocanary.station'

/** Live updates: the server announces new data and the affected queries refetch. */
function useStream(): AppState['stream'] {
  const qc = useQueryClient()
  const [state, setState] = useState<AppState['stream']>('connecting')
  useEffect(() => {
    let source: EventSource
    let opened = false
    let last = Date.now()
    const connect = () => {
      last = Date.now()
      source = new EventSource('/api/v1/stream')
      source.onopen = () => {
        last = Date.now()
        setState('open')
        // Anything announced while disconnected was missed, so refresh once on reconnect.
        if (opened) qc.invalidateQueries({ queryKey: ['station'] })
        opened = true
      }
      source.onerror = () => setState('lost')
      source.onmessage = (e) => {
        last = Date.now()
        const message = JSON.parse(e.data) as { type: string; station?: string }
        if (!message.station) return
        qc.invalidateQueries({ queryKey: ['stations'] })
        qc.invalidateQueries({ queryKey: ['station', message.station] })
      }
    }
    connect()
    // The server sends at least a heartbeat every 15 s; silence means the stream is dead even if it looks open.
    const watchdog = setInterval(() => {
      if (Date.now() - last < 35_000) return
      setState('lost')
      source.close()
      connect()
    }, 5000)
    return () => {
      clearInterval(watchdog)
      source.close()
    }
  }, [qc])
  return state
}

export function AppProvider({ user, stations, children }: { user: User; stations: Station[]; children: ReactNode }) {
  const [code, setCode] = useState(() => localStorage.getItem(STORAGE) ?? '')
  const stream = useStream()
  const station = stations.find((s) => s.code === code) ?? stations[0]
  const value = useMemo<AppState>(
    () => ({
      user,
      stations,
      station,
      stream,
      selectStation: (c) => {
        localStorage.setItem(STORAGE, c)
        setCode(c)
      },
    }),
    [user, stations, station, stream],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useStations = (enabled: boolean) =>
  useQuery({ queryKey: ['stations'], queryFn: () => get<Station[]>('/stations'), enabled, refetchInterval: 60_000 })

/** Re-renders on an interval so relative times stay truthful. */
export function useNow(ms = 5000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
