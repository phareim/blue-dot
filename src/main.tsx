import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// No StrictMode: its double mount would build the WebGL game twice.
createRoot(document.getElementById('root')!).render(<App />)
