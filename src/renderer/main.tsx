/** The main window's page: the app, its styles, and its hover notes. */
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'
import { installTooltips } from './app/tooltips.ts'
import './styles/index.css'

installTooltips()
createRoot(document.getElementById('root')!).render(<App />)
