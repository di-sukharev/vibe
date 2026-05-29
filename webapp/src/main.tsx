import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TooltipProvider } from '@/components/ui/tooltip'
import App from './App'
import { AuthProvider } from './lib/auth'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
