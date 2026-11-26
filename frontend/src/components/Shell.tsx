import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, LogOut, Tv } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { get, post } from '../lib/api'
import { useApp, useNow } from '../lib/app'
import { ago, exact, time } from '../lib/format'
import type { SystemStatus } from '../lib/types'
import { OriginTag, StatusIcon, useDismiss } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/facility', label: 'Facility' },
  { to: '/monitoring', label: 'Monitoring' },
  { to: '/analysis', label: 'AI Analysis' },
  { to: '/reports', label: 'Reports' },
]

/** Ring decoration per page, placed as on the design boards. */
const RINGS: Record<string, React.CSSProperties> = {
  '/': { right: -60, top: -220 },
  '/monitoring': { left: '50%', top: -240, transform: 'translateX(-50%)' },
  '/analysis': { right: -60, top: -200 },
  '/reports': { right: -160, top: -380 },
}

export function Shell() {
  const { stream, station } = useApp()
  const { pathname } = useLocation()
  const qc = useQueryClient()
  const now = useNow()
  const signOut = async () => {
    await post('/auth/logout')
    qc.clear()
    qc.setQueryData(['me'], null)
  }
  const live = (
    <span className={`nav-live ${station.status === 'offline' ? 'lost' : stream}`} title={station.last_reading_at ? `Last reading ${exact(station.last_reading_at)}` : undefined}>
      <i />
      {station.status === 'offline' ? 'Offline' : stream === 'lost' ? 'Reconnecting' : 'Live'} · {station.last_reading_at ? ago(station.last_reading_at, now) : 'no readings yet'}
    </span>
  )
  const assessed = station.latest_assessment ? `assessed ${time(station.latest_assessment.data_until)}` : 'not assessed yet'
  const right =
    pathname === '/monitoring' || pathname === '/facility' ? (
      <StationPicker />
    ) : pathname === '/analysis' ? (
      <StationPicker plain label={`${station.name} · ${assessed}`} />
    ) : pathname === '/' ? (
      live
    ) : null
  return (
    <div className={`shell bio${station.status === 'warning' || station.status === 'critical' ? ' hot' : ''}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <svg className="bio-rings" style={RINGS[pathname] ?? RINGS['/']} width="900" height="900" viewBox="0 0 900 900" aria-hidden>
        {[180, 250, 330, 420].map((r, i) => (
          <circle key={r} cx="450" cy="450" r={r} fill="none" stroke={i ? '#8FB6FF' : '#A6F684'} strokeOpacity={[0.2, 0.15, 0.09, 0.05][i]} strokeWidth={i ? 1 : 1.5} />
        ))}
      </svg>
      <div className="bio-wrap">
        <header className="bio-nav">
          <Logo className="bio-logo" tone="white" />
          <nav className="tabs" aria-label="Primary">
            {NAV.map(({ to, label }) => (
              <NavLink key={to} to={to} end={to === '/'}>
                {label}
              </NavLink>
            ))}
          </nav>
          <span className="bio-fill" />
          {right}
          <OriginTag origin={station.origin} />
          <AccountMenu onSignOut={signOut} />
        </header>
        {stream === 'lost' && (
          <p className="notice" role="status">
            Live updates are disconnected. Reconnecting; figures refresh every minute meanwhile.
          </p>
        )}
        <main id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function StationPicker({ plain = false, label }: { plain?: boolean; label?: string }) {
  const { stations, station, selectStation } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  return (
    <div className="picker" ref={ref}>
      <button className={plain ? 'pick-plain' : 'pick-pill'} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Station: ${station.name}. Change station`}>
        {label ?? `${station.name} · ${station.code}`}
        {!plain && <ChevronDown size={14} aria-hidden />}
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

function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const { data } = useQuery({ queryKey: ['system'], queryFn: () => get<SystemStatus>('/system/status') })
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const mode = data?.cloud.mode ?? 'local'
  return (
    <div className="system account" ref={ref}>
      <button className="avatar" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Account and system: ${user.name}${data ? `, ${data.cloud.label}` : ''}`}>
        {initials}
        <i className={`mode-dot m-${mode}`} title={data?.cloud.label} />
      </button>
      {open && (
        <div className="popover account-menu">
          <div className="account-who">
            <b>{user.name}</b>
            <span>{user.role === 'admin' ? 'Administrator' : 'Operator'}</span>
          </div>
          {data && (
            <>
              <h3>
                Infrastructure <span className={`mode m-${mode}`}>{data.cloud.label}</span>
              </h3>
              <ul>
                {data.cloud.services.map((s) => (
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
            </>
          )}
          <div className="account-actions">
            <Link to="/wall" onClick={() => setOpen(false)}>
              <Tv size={16} aria-hidden /> Wall display
            </Link>
            <Link to="/plant" onClick={() => setOpen(false)}>
              How it works
            </Link>
            <button onClick={onSignOut}>
              <LogOut size={16} aria-hidden /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
