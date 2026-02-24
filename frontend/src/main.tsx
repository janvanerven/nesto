import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="flex items-center justify-center min-h-dvh">
      <h1 className="text-4xl font-extrabold text-primary">Nesto</h1>
    </div>
  </StrictMode>,
)
