import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/figtree'
import '@fontsource-variable/outfit'
import { App } from './App'
import { ApiError } from './lib/api'
import { startDemoIfOffline } from './lib/demo'
import './index.css'

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchInterval: 60_000,
      retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
    },
  },
})

// Without a reachable server the app runs as a labelled offline demo on recorded data.
startDemoIfOffline().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  ),
)
