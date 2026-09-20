import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/theme.css'

const host = document.getElementById('root')
if (!host) {
  throw new Error('[玄] 找不到 #root 挂载点。')
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
