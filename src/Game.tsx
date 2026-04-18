import { useEffect, useRef } from 'react'
import { Mesh, Vector3 } from 'three'
import {
  createPelletMesh,
  createScene,
  placeOnSphere,
  resizeRenderer,
} from './game/scene'
import { createControls, tickKeyboard } from './game/controls'
import { updateFollowCam } from './game/camera'
import { latLonToVec3, slerpLatLon } from './game/sphere'
import { createGameState, type Pellet } from './game/state'
import './Game.css'

const CLIENT_PELLET_TARGET = 60

function randomSpherePoint() {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  const v = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta))
  const lat = Math.asin(v.y)
  const lon = Math.atan2(v.z, v.x)
  return { lat, lon }
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const s = createScene(canvas)
    const state = createGameState()

    const respawn = () => {
      const { lat, lon } = randomSpherePoint()
      state.player.lat = lat
      state.player.lon = lon
      state.player.heading = Math.random() * Math.PI * 2
      state.player.glide = null
    }
    respawn()

    const pelletMeshes = new Map<number, Mesh>()
    let nextId = 1
    const spawnPellet = () => {
      const { lat, lon } = randomSpherePoint()
      const pellet: Pellet = { id: nextId++, lat, lon, kind: 'common' }
      state.pellets.push(pellet)
      const m = createPelletMesh()
      placeOnSphere(m, latLonToVec3(lat, lon, 1), 0.005)
      s.scene.add(m)
      pelletMeshes.set(pellet.id, m)
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
      pelletMeshes.forEach((m) => {
        s.scene.remove(m)
        m.geometry.dispose()
      })
      s.renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" />
}
