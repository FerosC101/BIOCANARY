import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Logo } from '../brand/Logo'
import { DeviceModel } from '../components/device/DeviceModel'
import type { Lamps } from '../components/device/scene'
import { get, post } from '../lib/api'
import type { User } from '../lib/types'

// A product illustration: no station is known before sign-in.
const LAMPS: Lamps = { wifi: 'on', cloud: 'on', status: 'on' }

export function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { data } = useQuery({ queryKey: ['public'], queryFn: () => get<{ demo: { email: string; password: string } | null }>('/system/public') })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      onSignedIn(await post<User>('/auth/login', { email, password }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
      setBusy(false)
    }
  }
  return (
    <main className="login">
      <div className="login-art">
        <svg viewBox="0 0 720 900" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs>
            <radialGradient id="disc" cx="0.1" cy="0.08" r="1.08">
              <stop offset="0.12" stopColor="#254F91" />
              <stop offset="0.36" stopColor="#3F7F8C" />
              <stop offset="0.56" stopColor="#60B985" />
              <stop offset="0.78" stopColor="#6FD68A" />
              <stop offset="1" stopColor="#83E6A3" />
            </radialGradient>
            <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F0FFD7" />
              <stop offset="1" stopColor="#A6F684" />
            </linearGradient>
          </defs>
          <g className="login-arcs">
            {[330, 392, 462, 540, 626].map((r) => (
              <circle key={r} cx="470" cy="330" r={r} />
            ))}
          </g>
          <circle cx="470" cy="330" r="268" fill="url(#ring)" />
          <circle cx="470" cy="330" r="214" fill="url(#disc)" />
        </svg>
        <DeviceModel dark lamps={LAMPS} active view="front" label="The BIOCANARY device, with a blue reference chamber beside a green test chamber" />
        <div className="login-copy">
          <p className="login-tag">
            Listen today. <br />A cleaner tomorrow.
          </p>
          <p>BIOCANARY compares microorganisms exposed to wastewater with a protected reference population, and warns you when they diverge.</p>
        </div>
      </div>
      <div className="login-form">
        <form onSubmit={submit}>
          <Logo className="login-logo" />
          <h1>Sign in</h1>
          <label>
            Email
            <input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary big" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {data?.demo && (
            <p className="demo">
              This is a local demonstration with simulated stations.{' '}
              <button
                type="button"
                onClick={() => {
                  setEmail(data.demo!.email)
                  setPassword(data.demo!.password)
                }}
              >
                Use the demo account
              </button>
            </p>
          )}
        </form>
      </div>
    </main>
  )
}
