import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import RecorderPage from './recorder/RecorderPage'
import DebugPage from './debug/DebugPage'

const root = createRoot(document.getElementById('root'))
const hash = window.location.hash

if (hash === '#recorder') {
  root.render(
    <StrictMode>
      <RecorderPage />
    </StrictMode>,
  )
} else if (hash === '#debug') {
  root.render(
    <StrictMode>
      <DebugPage />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
