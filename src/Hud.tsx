import { useEffect, useRef, useState } from 'react'
import { sanitizeNickname, saveIdentity, type Identity } from './game/identity'
import './Hud.css'

interface Props {
  identity: Identity
  score: number
  onIdentityChange: (id: Identity) => void
}

export function Hud({ identity, score, onIdentityChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(identity.nickname)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

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
        <span className="hud__score" aria-label="session score">{score}</span>
      </div>
    </div>
  )
}
