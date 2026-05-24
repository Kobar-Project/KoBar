import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import PipPlayer from './components/layout/PipPlayer.tsx'

const urlParams = new URLSearchParams(window.location.search);
const isPipMode = urlParams.get('pip') === 'true';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPipMode ? <PipPlayer /> : <App />}
  </StrictMode>,
)
