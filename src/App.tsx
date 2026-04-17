import { useEffect, useRef, useState, type PointerEvent } from 'react'
import './App.css'

const STEP = 20
const BIG_STEP = 100

export function App() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const origin = useRef({ x: 0, y: 0 })

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
    <div className="container">
      <div
        className={`dot${dragging ? ' dot--dragging' : ''}`}
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
      </div>
    </div>
  )
}
