import { useEffect, useRef, useState } from 'react'
import type { LeaderboardEntry } from './Game'
import { sanitizeNickname, saveIdentity, type Identity } from './game/identity'
import './Hud.css'

interface Props {
  identity: Identity
  score: number
  leaderboard: LeaderboardEntry[]
  connected: boolean
  onIdentityChange: (id: Identity) => void
}

export function Hud({ identity, score, leaderboard, connected, onIdentityChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(identity.nickname)
  const [scorePulse, setScorePulse] = useState(0)
  const [offlineVisible, setOfflineVisible] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevScore = useRef(score)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (score > prevScore.current) setScorePulse((n) => n + 1)
    prevScore.current = score
  }, [score])

  // Delay showing the "reconnecting" pill so transient blips don't flash it.
  useEffect(() => {
    if (connected) {
      setOfflineVisible(false)
      return
    }
    const t = setTimeout(() => setOfflineVisible(true), 700)
    return () => clearTimeout(t)
  }, [connected])

  const commit = () => {
    const next: Identity = { ...identity, nickname: sanitizeNickname(draft) }
    saveIdentity(next)
    onIdentityChange(next)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(identity.nickname)
    setEditing(false)
  }

  return (
    <div className="hud">
      <div className="hud__card">
        <span className="hud__swatch" style={{ background: identity.color }} />
        {editing ? (
          <input
            ref={inputRef}
            className="hud__input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') cancel()
            }}
            maxLength={24}
            aria-label="nickname"
          />
        ) : (
          <button
            className="hud__name"
            onClick={() => {
              setDraft(identity.nickname)
              setEditing(true)
            }}
            title="click to rename"
          >
            {identity.nickname}
          </button>
        )}
        <span
          key={scorePulse}
          className={'hud__score' + (scorePulse > 0 ? ' hud__score--pulse' : '')}
          aria-label="session score"
        >
          {score}
        </span>
      </div>
      {leaderboard.length > 0 && (
        <ol className="hud__board" aria-label="top players">
          {leaderboard.map((e, i) => (
            <li
              key={e.id}
              className={'hud__row' + (e.isSelf ? ' hud__row--self' : '')}
            >
              <span className="hud__rank">{i + 1}</span>
              <span className="hud__swatch hud__swatch--sm" style={{ background: e.color }} />
              <span className="hud__board-name">{e.nickname}</span>
              <span className="hud__board-score">{e.score}</span>
            </li>
          ))}
        </ol>
      )}
      {offlineVisible && (
        <div className="hud__status" role="status" aria-live="polite">
          <span className="hud__status-dot" aria-hidden="true" />
          reconnecting…
        </div>
      )}
    </div>
  )
}
