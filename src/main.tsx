import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { installConsoleCapture } from './utils/log'

// Route every console.* line into the DevLog ring (and thereby the AI agent's
// get_logs tool) before anything else logs. Idempotent + StrictMode-safe.
installConsoleCapture()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
