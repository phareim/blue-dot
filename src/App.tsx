import { useCallback, useState } from 'react'
import { Game, type LeaderboardEntry } from './Game'
import { Hud } from './Hud'
import { loadIdentity, type Identity } from './game/identity'
import './App.css'

export function App() {
  const [identity, setIdentity] = useState<Identity>(() => loadIdentity())
  const [score, setScore] = useState(0)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [connected, setConnected] = useState(true)
  const onScoreChange = useCallback((s: number) => setScore(s), [])
  const onLeaderboard = useCallback((entries: LeaderboardEntry[]) => setLeaderboard(entries), [])
  const onConnectionChange = useCallback((c: boolean) => setConnected(c), [])

  return (
    <>
      <Game
        identity={identity}
        onScoreChange={onScoreChange}
        onLeaderboard={onLeaderboard}
        onConnectionChange={onConnectionChange}
      />
      <Hud
        identity={identity}
        score={score}
        leaderboard={leaderboard}
        connected={connected}
        onIdentityChange={setIdentity}
      />
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
        <span className="hint__sep">·</span>
        <kbd>+</kbd><kbd>-</kbd> zoom
      </div>
    </>
  )
}
