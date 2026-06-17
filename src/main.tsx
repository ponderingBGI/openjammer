import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { installConsoleCapture } from './utils/log'
import './components/AppErrorBoundary.css'

// Route every console.* line into the DevLog ring (and thereby the AI agent's
// get_logs tool) before anything else logs. Idempotent + StrictMode-safe.
installConsoleCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)
