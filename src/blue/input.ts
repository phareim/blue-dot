// Keyboard, mouse and touch. The comet heads toward the mouse cursor, or A/D or the arrows turn it.
// On a touch screen the finger spins the planet: the game reads the finger's movement, not its spot.
// A quick tap, a second finger, Space or a right click jumps.

const TAP_MS = 220
const TAP_PX = 14

export class Input {
  readonly keys = new Set<string>()
  /** Screen position of the mouse or the steering finger, or null. */
  pointer: { x: number; y: number } | null = null
  pointerKind: 'mouse' | 'touch' | null = null
  /** How far the steering finger has swiped since the last `consumeDrag`, in CSS pixels. */
  readonly drag = { x: 0, y: 0 }
  private steerId: number | null = null
  private lastX = 0
  private lastY = 0
  private dragX = 0
  private dragY = 0
  private downAt = 0
  private downX = 0
  private downY = 0
  private moved = false
  private jumpQueued = false
  private pressQueued = false
  private extra = new Set<number>()
  /** Called on every user gesture (for audio unlock on iOS). */
  onGesture: () => void = () => {}
  onKey: (code: string) => void = () => {}

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down, { passive: false })
    el.addEventListener('pointermove', this.move, { passive: false })
    el.addEventListener('pointerup', this.up, { passive: false })
    el.addEventListener('pointercancel', this.up, { passive: false })
    el.addEventListener('pointerleave', this.leave)
    el.addEventListener('contextmenu', this.context)
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    window.addEventListener('blur', this.blur)
  }

  dispose() {
    const el = this.el
    el.removeEventListener('pointerdown', this.down)
    el.removeEventListener('pointermove', this.move)
    el.removeEventListener('pointerup', this.up)
    el.removeEventListener('pointercancel', this.up)
    el.removeEventListener('pointerleave', this.leave)
    el.removeEventListener('contextmenu', this.context)
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
    window.removeEventListener('blur', this.blur)
  }

  /** −1 (left) … 1 (right) from the keyboard. */
  get turn(): number {
    let t = 0
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) t -= 1
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) t += 1
    return t
  }

  /** −1 (down) … 1 (up) from the keyboard, used in flight. */
  get lift(): number {
    let t = 0
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) t += 1
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) t -= 1
    return t
  }

  /** The steering finger is down and can no longer be a tap: it has swiped, or rested past TAP_MS. */
  get held(): boolean {
    return this.steerId !== null && (this.moved || performance.now() - this.downAt >= TAP_MS)
  }

  consumeJump(): boolean {
    const j = this.jumpQueued
    this.jumpQueued = false
    return j
  }

  /** Any press at all (to start, continue, or pick). */
  consumePress(): boolean {
    const p = this.pressQueued
    this.pressQueued = false
    return p
  }

  /** Take the finger's movement since the last call; `drag` holds it until the next. */
  consumeDrag(): { x: number; y: number } {
    this.drag.x = this.dragX
    this.drag.y = this.dragY
    this.dragX = 0
    this.dragY = 0
    return this.drag
  }

  clearQueued() {
    this.jumpQueued = false
    this.pressQueued = false
    this.dragX = 0
    this.dragY = 0
  }

  private down = (e: PointerEvent) => {
    e.preventDefault()
    this.onGesture()
    this.pressQueued = true
    if (e.pointerType === 'mouse') {
      // The mouse steers by hovering, so any click jumps.
      this.jumpQueued = true
      this.pointer = { x: e.clientX, y: e.clientY }
      this.pointerKind = 'mouse'
      return
    }
    try { this.el.setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    if (this.steerId === null) {
      this.steerId = e.pointerId
      this.pointer = { x: e.clientX, y: e.clientY }
      this.pointerKind = 'touch'
      this.downAt = performance.now()
      this.downX = e.clientX
      this.downY = e.clientY
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.dragX = 0
      this.dragY = 0
      this.moved = false
    } else {
      this.extra.add(e.pointerId)
      this.jumpQueued = true
    }
  }

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      this.pointer = { x: e.clientX, y: e.clientY }
      this.pointerKind = 'mouse'
      return
    }
    if (e.pointerId !== this.steerId) return
    e.preventDefault()
    this.pointer = { x: e.clientX, y: e.clientY }
    // A touch is a tap (a jump) until it travels past TAP_PX; from then on it is a swipe, counted from where it landed.
    const wasMoved = this.moved
    if (!wasMoved && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > TAP_PX) this.moved = true
    if (this.moved) {
      this.dragX += e.clientX - (wasMoved ? this.lastX : this.downX)
      this.dragY += e.clientY - (wasMoved ? this.lastY : this.downY)
    }
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    if (this.extra.delete(e.pointerId)) return
    if (e.pointerId !== this.steerId) return
    this.steerId = null
    if (!this.moved && performance.now() - this.downAt < TAP_MS) this.jumpQueued = true
    this.pointer = null
    this.pointerKind = null
  }

  private leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      this.pointer = null
      this.pointerKind = null
    }
  }

  private context = (e: Event) => e.preventDefault()

  private keydown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    this.onGesture()
    if (!e.repeat) {
      if (e.code === 'Space') this.jumpQueued = true
      if (e.code === 'Space' || e.code === 'Enter') this.pressQueued = true
      this.onKey(e.code)
    }
    if (['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'].includes(e.code) && this.pointerKind === 'mouse') {
      // The keyboard takes over until the mouse moves again.
      this.pointer = null
      this.pointerKind = null
    }
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
    this.keys.add(e.code)
  }

  private keyup = (e: KeyboardEvent) => {
    this.keys.delete(e.code)
  }

  private blur = () => {
    this.keys.clear()
    this.steerId = null
    this.extra.clear()
    this.pointer = null
    this.dragX = 0
    this.dragY = 0
  }
}
