import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Logo } from './brand/Logo'
import { Shell } from './components/Shell'
import { Empty, Failed } from './components/ui'
import { ApiError, get } from './lib/api'
import { AppProvider, useStations } from './lib/app'
import { isDemo } from './lib/demo'
import type { User } from './lib/types'
import { Analysis } from './pages/Analysis'
import { Dashboard } from './pages/Dashboard'
import { Facility } from './pages/Facility'
import { Login } from './pages/Login'
import { Monitoring } from './pages/Monitoring'
import { Plant } from './pages/Plant'
import { Reports } from './pages/Reports'
import { Wall } from './pages/Wall'

function DemoBanner() {
  if (!isDemo()) return null
  return (
    <p className="demo-banner" role="status">
      <b>Offline demo.</b> The BIOCANARY server is not connected, so this shows data recorded earlier from simulated stations. Nothing you do here is saved.{' '}
      <a href={location.pathname}>Try the live server</a>
    </p>
  )
}

export function App() {
  return (
    <>
      <DemoBanner />
      <Main />
    </>
  )
}

function Main() {
  const qc = useQueryClient()
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => get<User>('/auth/me').catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    refetchInterval: false,
  })
  const stations = useStations(!!me.data)

  useEffect(() => {
    const out = () => {
      if (qc.getQueryData(['me'])) {
        qc.clear()
        qc.setQueryData(['me'], null)
      }
    }
    window.addEventListener('biocanary:signed-out', out)
    return () => window.removeEventListener('biocanary:signed-out', out)
  }, [qc])

  if (me.isError) return <Splash><Failed error={me.error} retry={() => me.refetch()} /></Splash>
  if (me.isPending) return <Splash />
  if (me.data === null) return <Login onSignedIn={(u) => qc.setQueryData(['me'], u)} />
  if (stations.isError && !stations.data) return <Splash><Failed error={stations.error} retry={() => stations.refetch()} /></Splash>
  if (!stations.data) return <Splash />
  if (!stations.data.length)
    return (
      <Splash>
        <Empty title="No monitoring stations are registered">Register one with the operations CLI, then reload this page.</Empty>
      </Splash>
    )
  return (
    <AppProvider user={me.data} stations={stations.data}>
      <Routes>
        {/* Full-screen views (control-room wall, plant explainer); deliberately outside the shell and its five sections. */}
        <Route path="wall" element={<Wall />} />
        <Route path="plant" element={<Plant />} />
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="facility" element={<Facility />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="reports" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppProvider>
  )
}

function Splash({ children }: { children?: React.ReactNode }) {
  return (
    <main className="splash">
      <Logo className="splash-logo" tone="white" />
      {children}
    </main>
  )
}
