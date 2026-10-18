import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Game } from './blue/game'
import { Store, initialHud, loadBest, loadMuted } from './blue/store'
import { Hud } from './ui/Hud'

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const store = useMemo(() => new Store(initialHud(loadBest(), loadMuted())), [])
  const [game, setGame] = useState<Game | null>(null)
  const [failed, setFailed] = useState(false)
  const hud = useSyncExternalStore(store.subscribe, store.get)

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas || !overlay) return
    let g: Game
    try {
      g = new Game(canvas, overlay, store)
    } catch (err) {
      console.error(err)
      setFailed(true)
      return
    }
    setGame(g)
    ;(window as unknown as { blue?: Game }).blue = g
    return () => g.dispose()
  }, [store])

  return (
    <div className="blue">
      <canvas ref={canvasRef} className="blue__canvas" />
      <div ref={overlayRef} className="blue__overlay" />
      {failed ? (
        <div className="screen">
          <p className="tagline">This game needs WebGL 2, which this browser did not give it.</p>
        </div>
      ) : (
        <Hud hud={hud} game={game} />
      )}
    </div>
  )
}
