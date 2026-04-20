import { PerspectiveCamera, Raycaster, Vector2, Mesh } from 'three'
import type { GameState } from './state'
import { vec3ToLatLon, moveAlongHeading, greatCircleDistance } from './sphere'
import { clampZoom, ZOOM_DEFAULT } from './camera'

const ANG_SPEED = Math.PI / 15
const ROT_SPEED = Math.PI / 2
const SHIFT_MULT = 2.5
const GLIDE_MS_PER_RAD = 700
const ZOOM_KEY_STEP = 0.18
const ZOOM_WHEEL_STEP = 0.0015

export interface ControlHandlers {
  onKeyDown: (e: KeyboardEvent) => void
  onKeyUp: (e: KeyboardEvent) => void
  onPointerDown: (e: PointerEvent) => void
  onWheel: (e: WheelEvent) => void
}

const MOVEMENT_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'w', 'a', 's', 'd', 'Shift',
])

export function createControls(
  state: GameState,
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  globe: Mesh,
  respawn: () => void,
): ControlHandlers {
  const raycaster = new Raycaster()
  const ndc = new Vector2()

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'r' || e.key === 'R' || e.key === 'Home') {
      respawn()
      e.preventDefault()
      return
    }
    if (e.key === '=' || e.key === '+') {
      state.zoom = clampZoom(state.zoom - ZOOM_KEY_STEP)
      e.preventDefault()
      return
    }
    if (e.key === '-' || e.key === '_') {
      state.zoom = clampZoom(state.zoom + ZOOM_KEY_STEP)
      e.preventDefault()
      return
    }
    if (e.key === '0') {
      state.zoom = ZOOM_DEFAULT
      e.preventDefault()
      return
    }
    const k = normalizeKey(e.key)
    if (MOVEMENT_KEYS.has(k)) {
      state.keys.add(k)
      e.preventDefault()
    }
  }

  const onKeyUp = (e: KeyboardEvent) => {
    state.keys.delete(normalizeKey(e.key))
  }

  const onPointerDown = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(globe, false)[0]
    if (!hit) return
    const { lat, lon } = vec3ToLatLon(hit.point)
    const p = state.player
    const dist = greatCircleDistance(p.lat, p.lon, lat, lon)
    const duration = Math.max(120, GLIDE_MS_PER_RAD * dist)
    p.glide = {
      fromLat: p.lat,
      fromLon: p.lon,
      toLat: lat,
      toLon: lon,
      startMs: performance.now(),
      durationMs: duration,
    }
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    state.zoom = clampZoom(state.zoom + e.deltaY * ZOOM_WHEEL_STEP)
  }

  return { onKeyDown, onKeyUp, onPointerDown, onWheel }
}

function normalizeKey(key: string): string {
  if (key.length === 1) return key.toLowerCase()
  return key
}

export function tickKeyboard(state: GameState, dtMs: number): void {
  if (state.player.glide) return
  const dt = dtMs / 1000
  const mult = state.keys.has('Shift') ? SHIFT_MULT : 1
  const forward = state.keys.has('ArrowUp') || state.keys.has('w')
  const back = state.keys.has('ArrowDown') || state.keys.has('s')
  const left = state.keys.has('ArrowLeft') || state.keys.has('a')
  const right = state.keys.has('ArrowRight') || state.keys.has('d')

  if (left) state.player.heading -= ROT_SPEED * dt * mult
  if (right) state.player.heading += ROT_SPEED * dt * mult

  let step = 0
  if (forward) step += ANG_SPEED * dt * mult
  if (back) step -= ANG_SPEED * dt * mult
  if (step !== 0) {
    const { lat, lon } = moveAlongHeading(
      state.player.lat, state.player.lon, state.player.heading, step,
    )
    state.player.lat = lat
    state.player.lon = lon
  }
}
