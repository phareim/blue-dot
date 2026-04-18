import { useEffect, useRef } from 'react'
import { Mesh, Vector3 } from 'three'
import {
  createPelletMesh,
  createScene,
  placeOnSphere,
  pulseGoldPellet,
  resizeRenderer,
  setPlayerColor,
  PELLET_VALUE,
  type PelletKind,
} from './game/scene'
import { createControls, tickKeyboard } from './game/controls'
import { updateFollowCam } from './game/camera'
import { greatCircleDistance, latLonToVec3, slerpLatLon } from './game/sphere'
import { createGameState, type Pellet } from './game/state'
import type { Identity } from './game/identity'
import './Game.css'

const CLIENT_PELLET_TARGET = 60
const GOLD_PROBABILITY = 0.1
const EAT_RADIUS = 0.045 // angular radians; tuned to feel immediate at close range
const EAT_POP_MS = 180

interface Props {
  identity: Identity
  onScoreChange: (score: number) => void
}

function randomSpherePoint() {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  const v = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta))
  const lat = Math.asin(v.y)
  const lon = Math.atan2(v.z, v.x)
  return { lat, lon }
}

export function Game({ identity, onScoreChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const s = createScene(canvas)
    setPlayerColor(s.playerDot, identity.color)

    const state = createGameState()

    const respawn = () => {
      const { lat, lon } = randomSpherePoint()
      state.player.lat = lat
      state.player.lon = lon
      state.player.heading = Math.random() * Math.PI * 2
      state.player.glide = null
    }
    respawn()

    interface PelletMesh { mesh: Mesh; kind: PelletKind; bornMs: number; dying: null | { startMs: number } }
    const pelletMeshes = new Map<number, PelletMesh>()
    let nextId = 1
    const spawnPellet = () => {
      const kind: PelletKind = Math.random() < GOLD_PROBABILITY ? 'gold' : 'common'
      const { lat, lon } = randomSpherePoint()
      const pellet: Pellet = { id: nextId++, lat, lon, kind }
      state.pellets.push(pellet)
      const mesh = createPelletMesh(kind)
      placeOnSphere(mesh, latLonToVec3(lat, lon, 1), kind === 'gold' ? 0.012 : 0.005)
      s.scene.add(mesh)
      pelletMeshes.set(pellet.id, { mesh, kind, bornMs: performance.now(), dying: null })
    }
    for (let i = 0; i < CLIENT_PELLET_TARGET; i++) spawnPellet()

    const { onKeyDown, onKeyUp, onPointerDown } = createControls(
      state, canvas, s.camera, s.globe, respawn,
    )
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown)

    const onResize = () => resizeRenderer(s.renderer, s.camera, canvas)
    window.addEventListener('resize', onResize)
    onResize()

    let prev = performance.now()
    let raf = 0

    const eatNearby = (now: number) => {
      const p = state.player
      // iterate a copy — we mutate state.pellets during loop
      for (let i = state.pellets.length - 1; i >= 0; i--) {
        const pellet = state.pellets[i]
        const pm = pelletMeshes.get(pellet.id)
        if (!pm || pm.dying) continue
        const d = greatCircleDistance(p.lat, p.lon, pellet.lat, pellet.lon)
        if (d < EAT_RADIUS) {
          state.score += PELLET_VALUE[pellet.kind]
          onScoreChange(state.score)
          pm.dying = { startMs: now }
          state.pellets.splice(i, 1)
        }
      }
    }

    const loop = (now: number) => {
      const dt = Math.min(50, now - prev)
      prev = now

      if (state.player.glide) {
        const g = state.player.glide
        const t = Math.min(1, (now - g.startMs) / g.durationMs)
        const { lat, lon } = slerpLatLon(g.fromLat, g.fromLon, g.toLat, g.toLon, t)
        state.player.lat = lat
        state.player.lon = lon
        if (t >= 1) state.player.glide = null
      } else {
        tickKeyboard(state, dt)
      }

      eatNearby(now)

      // Pellet visual updates (pulse + death animation).
      for (const [id, pm] of pelletMeshes) {
        if (pm.dying) {
          const t = Math.min(1, (now - pm.dying.startMs) / EAT_POP_MS)
          pm.mesh.scale.setScalar(1 + t * 1.8)
          const mat = pm.mesh.material as { opacity?: number; transparent?: boolean }
          mat.transparent = true
          mat.opacity = 1 - t
          if (t >= 1) {
            s.scene.remove(pm.mesh)
            pm.mesh.geometry.dispose()
            pelletMeshes.delete(id)
            spawnPellet()
          }
        } else if (pm.kind === 'gold') {
          pulseGoldPellet(pm.mesh, now)
        }
      }

      placeOnSphere(s.playerDot, latLonToVec3(state.player.lat, state.player.lon, 1), 0.01)
      updateFollowCam(s.camera, state.player.lat, state.player.lon, state.player.heading)
      s.renderer.render(s.scene, s.camera)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      pelletMeshes.forEach((pm) => {
        s.scene.remove(pm.mesh)
        pm.mesh.geometry.dispose()
      })
      s.renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" />
}
