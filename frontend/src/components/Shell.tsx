import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LogOut } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { get, post } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { ago, exact } from '../lib/format'
import type { SystemStatus } from '../lib/types'
import { OriginTag, StatusIcon, useDismiss } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/analysis', label: 'AI Analysis' },
  { to: '/reports', label: 'Reports' },
]

export function Shell() {
  const { user, stream, station } = useApp()
  const qc = useQueryClient()
  const now = useNow()
  const signOut = async () => {
    await post('/auth/logout')
    qc.clear()
    qc.setQueryData(['me'], null)
  }
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <Logo className="top-logo" tone="white" />
        <nav className="tabs" aria-label="Primary">
          {NAV.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="top-right">
          <StationPicker />
          <OriginTag origin={station.origin} />
          <span className={`live ${station.status === 'offline' ? 'lost' : stream}`} title={station.last_reading_at ? `Last reading ${exact(station.last_reading_at)}` : undefined}>
            <i />
            {station.last_reading_at ? ago(station.last_reading_at, now) : 'No readings yet'}
          </span>
          <SystemMenu />
          <div className="who">
            <div>
              <b>{user.name}</b>
              <span>{user.role === 'admin' ? 'Administrator' : 'Operator'}</span>
            </div>
            <button onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={17} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      {stream === 'lost' && (
        <p className="notice" role="status">
          Live updates are disconnected. Reconnecting; figures refresh every minute meanwhile.
        </p>
      )}
      <div className="body">
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function StationPicker() {
  const { stations, station, selectStation } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="picker" ref={ref}>
      <button aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`pip s-${station.status}`}>
          <StatusIcon status={station.status} size={13} />
        </span>
        <span>
          <b>{station.name}</b>
          <small>{station.code}</small>
        </span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <ul className="popover">
          {stations.map((s) => (
            <li key={s.code}>
              <button
                aria-current={s.code === station.code}
                onClick={() => {
                  selectStation(s.code)
                  setOpen(false)
                }}
              >
                <span className={`pip s-${s.status}`}>
                  <StatusIcon status={s.status} size={13} />
                </span>
                <span>
                  <b>{s.name}</b>
                  <small>
                    {s.code} · {s.status_label} · {s.origin === 'simulated' ? 'Simulated' : 'Live hardware'}
                  </small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const STATE_LABEL = { connected: 'Connected', local: 'Local', error: 'Not connected' }

function SystemMenu() {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const { data } = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  if (!data) return null
  const { cloud } = data
  return (
    <div className="system" ref={ref}>
      <button className={`mode m-${cloud.mode}`} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        {cloud.label}
        <ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <div className="popover">
          <h3>Infrastructure</h3>
          <ul>
            {cloud.services.map((s) => (
              <li key={s.key}>
                <div>
                  <b>{s.name}</b>
                  <small>{s.responsibility}</small>
                  {s.state === 'error' ? <small className="error">{s.detail}</small> : <small>{s.detail}</small>}
                </div>
                <span className={`svc ${s.state}`}>{STATE_LABEL[s.state]}</span>
              </li>
            ))}
          </ul>
          <h3>Data sources</h3>
          <p>
            {data.data.simulated_stations} simulated {data.data.simulated_stations === 1 ? 'station' : 'stations'} and {data.data.live_stations} hardware{' '}
            {data.data.live_stations === 1 ? 'station' : 'stations'}. {data.data.live_data_received ? 'Hardware readings have been received.' : 'No hardware readings have been received yet.'}
          </p>
        </div>
      )}
    </div>
  )
}
