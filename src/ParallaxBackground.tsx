import type { CSSProperties } from 'react'
import './ParallaxBackground.css'

interface Props {
  x: number
  y: number
}

export function ParallaxBackground({ x, y }: Props) {
  const style = { '--dx': `${x}px`, '--dy': `${y}px` } as CSSProperties
  return (
    <div className="parallax" aria-hidden="true" style={style}>
      <div className="parallax__layer parallax__layer--far" />
      <div className="parallax__layer parallax__layer--mid" />
      <div className="parallax__layer parallax__layer--near" />
    </div>
  )
}
