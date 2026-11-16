import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(<App />)

if (import.meta.env.DEV) import('./store/useSign').then((m) => ((window as unknown as { __sign: unknown }).__sign = m.useSign))
if (import.meta.env.DEV) import('./render3d/capture').then((m) => ((window as unknown as { __capture: unknown }).__capture = m.capture3d))
if (import.meta.env.DEV) import('./anim/bind').then((m) => ((window as unknown as { __engine: unknown }).__engine = m.engine))
if (import.meta.env.DEV) import('./export/animation').then((m) => ((window as unknown as { __renderAnimation: unknown }).__renderAnimation = m.renderAnimation))
