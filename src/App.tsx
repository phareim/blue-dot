import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { ParallaxBackground } from './ParallaxBackground'
import './App.css'

const STEP = 20
const BIG_STEP = 100
const SUMMON_MS = 350

export function App() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [summoning, setSummoning] = useState(false)
  const origin = useRef({ x: 0, y: 0 })
  const summonTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
    setDragging(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setPos({ x: e.clientX - origin.current.x, y: e.clientY - origin.current.y })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  const onContainerClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    setPos({ x: e.clientX - cx, y: e.clientY - cy })
    setSummoning(true)
    if (summonTimer.current) clearTimeout(summonTimer.current)
    summonTimer.current = setTimeout(() => setSummoning(false), SUMMON_MS)
  }

  useEffect(() => () => {
    if (summonTimer.current) clearTimeout(summonTimer.current)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const step = e.shiftKey ? BIG_STEP : STEP
      switch (e.key) {
        case 'ArrowUp':
          setPos((p) => ({ ...p, y: p.y - step }))
          break
        case 'ArrowDown':
          setPos((p) => ({ ...p, y: p.y + step }))
          break
        case 'ArrowLeft':
          setPos((p) => ({ ...p, x: p.x - step }))
          break
        case 'ArrowRight':
          setPos((p) => ({ ...p, x: p.x + step }))
          break
        case 'r':
        case 'R':
        case 'Home':
          setPos({ x: 0, y: 0 })
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="container" onClick={onContainerClick}>
      <ParallaxBackground x={pos.x} y={pos.y} />
      <div
        className={`dot${dragging ? ' dot--dragging' : ''}${summoning ? ' dot--summoning' : ''}`}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="hint" aria-hidden="true">
        <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> move
        <span className="hint__sep">·</span>
        <kbd>Shift</kbd> big step
        <span className="hint__sep">·</span>
        <kbd>R</kbd> reset
        <span className="hint__sep">·</span>
        click to summon
      </div>
    </div>
  )
}
