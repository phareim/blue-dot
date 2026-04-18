import { useCallback, useState } from 'react'
import { Game } from './Game'
import { Hud } from './Hud'
import { loadIdentity, type Identity } from './game/identity'
import './App.css'

export function App() {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity())
  const [score, setScore] = useState(0)
  const onScoreChange = useCallback((s: number) => setScore(s), [])

  return (
    <>
      <Game identity={identity} onScoreChange={onScoreChange} />
      <Hud identity={identity} score={score} onIdentityChange={setIdentity} />
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
