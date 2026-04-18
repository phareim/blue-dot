import { Game } from './Game'
import './App.css'

export function App() {
  return (
    <>
      <Game />
      <div className="hint" aria-hidden="true">
        <kbd>↑</kbd><kbd>↓</kbd> move
        <span className="hint__sep">·</span>
        <kbd>←</kbd><kbd>→</kbd> turn
        <span className="hint__sep">·</span>
        <kbd>Shift</kbd> fast
        <span className="hint__sep">·</span>
        <kbd>R</kbd> respawn
        <span className="hint__sep">·</span>
        click to go
      </div>
    </>
  )
}
