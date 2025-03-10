import { useEffect, useState, useCallback } from '@lynx-js/react'
import './App.css'

// Define touch event types
interface TouchEvent {
  touches: Array<{
    clientX: number;
    clientY: number;
  }>;
}

export function App() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [startTouch, setStartTouch] = useState({ x: 0, y: 0 })

  useEffect(() => {
    console.info('Blue Dot App loaded')
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Get the touch coordinates
    const touch = e.touches[0]
    setIsDragging(true)
    setStartTouch({ x: touch.clientX, y: touch.clientY })
    setStartPos({ ...position })
  }, [position])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return
    
    // Calculate new position based on touch movement
    const touch = e.touches[0]
    const deltaX = touch.clientX - startTouch.x
    const deltaY = touch.clientY - startTouch.y
    
    // Update position
    setPosition({
      x: startPos.x + deltaX,
      y: startPos.y + deltaY
    })
  }, [isDragging, startTouch, startPos])

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Create the transform style based on the current position
  const dotStyle = {
    transform: `translate(${position.x}px, ${position.y}px)`
  }

  return (
    <view className="container">
      <view 
        className="blueDot" 
        style={dotStyle}
        bindtouchstart={handleTouchStart}
        bindtouchmove={handleTouchMove}
        bindtouchend={handleTouchEnd}
      />
    </view>
  )
}
