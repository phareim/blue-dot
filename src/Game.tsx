import { useEffect, useRef } from 'react'
import { Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three'
import {
  createPelletMesh,
  createScene,
  placeOnSphere,
  pulseGoldPellet,
  resizeRenderer,
  setPlayerColor,
  DOT_RADIUS,
} from './game/scene'
import { createControls, tickKeyboard } from './game/controls'
import { updateFollowCam } from './game/camera'
import { greatCircleDistance, latLonToVec3, slerpLatLon } from './game/sphere'
import { createGameState } from './game/state'
import type { Identity } from './game/identity'
import { createNet } from './game/net'
import type {
  JoinMsg,
  LeftMsg,
  PelletKind as WirePelletKind,
  TickMsg,
  WelcomeMsg,
} from './game/protocol'
import './Game.css'

const EAT_RADIUS = 0.045 // angular radians — must be <= server EAT_RADIUS (0.05)
const EAT_POP_MS = 180
const REMOTE_DOT_RADIUS = DOT_RADIUS * 0.9 // slightly smaller so they don't fully overlap

type KindLabel = 'common' | 'gold'
function kindLabel(k: WirePelletKind): KindLabel { return k === 1 ? 'gold' : 'common' }

interface PelletVis {
  mesh: Mesh
  kind: KindLabel
  dying: null | { startMs: number }
}

interface RemoteDot {
  mesh: Mesh
  color: string
  nickname: string
  score: number
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  startMs: number
  durationMs: number
}

interface Props {
  identity: Identity
  onScoreChange: (score: number) => void
}

export function Game({ identity, onScoreChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const s = createScene(canvas)
    setPlayerColor(s.playerDot, identity.color)

    const state = createGameState()
    state.player.heading = Math.random() * Math.PI * 2

    const pellets = new Map<number, PelletVis>()
    const remotes = new Map<number, RemoteDot>()
    let selfId: number | null = null
    let lastScore = 0
    const eatSent = new Set<number>() // dedupe: one eat per pellet until confirmed

    const addPellet = (id: number, lat: number, lon: number, kind: WirePelletKind) => {
      if (pellets.has(id)) return
      const label = kindLabel(kind)
      const mesh = createPelletMesh(label)
      placeOnSphere(mesh, latLonToVec3(lat, lon, 1), label === 'gold' ? 0.012 : 0.005)
      s.scene.add(mesh)
      pellets.set(id, { mesh, kind: label, dying: null })
    }

    const removePellet = (id: number, now: number) => {
      const pv = pellets.get(id)
      if (!pv) return
      if (pv.dying) return
      pv.dying = { startMs: now }
    }

    const makeRemoteMesh = (color: string): Mesh => {
      return new Mesh(
        new SphereGeometry(REMOTE_DOT_RADIUS, 20, 14),
        new MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
        }),
      )
    }

    const addRemote = (
      id: number, nickname: string, color: string, lat: number, lon: number, score: number,
    ) => {
      if (remotes.has(id)) return
      const mesh = makeRemoteMesh(color)
      placeOnSphere(mesh, latLonToVec3(lat, lon, 1), 0.008)
      s.scene.add(mesh)
      remotes.set(id, {
        mesh, color, nickname, score,
        fromLat: lat, fromLon: lon, toLat: lat, toLon: lon,
        startMs: performance.now(), durationMs: 1,
      })
    }

    const removeRemote = (id: number) => {
      const r = remotes.get(id)
      if (!r) return
      s.scene.remove(r.mesh)
      r.mesh.geometry.dispose()
      remotes.delete(id)
    }

    const onWelcome = (msg: WelcomeMsg) => {
      selfId = msg.you.id
      // Seed other dots.
      for (const d of msg.dots) {
        if (d.id === selfId) continue
        addRemote(d.id, d.nickname, d.color, d.lat, d.lon, d.score)
      }
      // Seed pellets.
      for (const p of msg.pellets) addPellet(p.id, p.lat, p.lon, p.k)
    }

    const onTick = (msg: TickMsg) => {
      const now = performance.now()
      // Spawned pellets.
      for (const [id, lat, lon, kind] of msg.spawned) addPellet(id, lat, lon, kind)
      // Removed pellets (server confirmed eat).
      for (const id of msg.removed) {
        removePellet(id, now)
        eatSent.delete(id)
      }
      // Dot updates.
      for (const [id, lat, lon, , score] of msg.dots) {
        if (id === selfId) {
          if (score !== lastScore) {
            lastScore = score
            onScoreChange(score)
          }
          continue
        }
        const r = remotes.get(id)
        if (!r) continue
        // Use this remote's current interpolated pose as the new "from" so there's no snap.
        const t = r.durationMs > 0 ? Math.min(1, (now - r.startMs) / r.durationMs) : 1
        const cur = slerpLatLon(r.fromLat, r.fromLon, r.toLat, r.toLon, t)
        r.fromLat = cur.lat
        r.fromLon = cur.lon
        r.toLat = lat
        r.toLon = lon
        r.startMs = now
        r.durationMs = 80 // one tick period (66) + small slack
        r.score = score
      }
    }

    const onJoin = (msg: JoinMsg) => {
      addRemote(msg.id, msg.nickname, msg.color, 0, 0, 0)
    }

    const onLeft = (msg: LeftMsg) => {
      removeRemote(msg.id)
    }

    const net = createNet(identity, {
      onWelcome, onTick, onJoin, onLeft,
      onConnectionChange: () => { /* future: show banner */ },
    })

    // Respawn (local): just randomize our pose. The server will pick up via next move.
    const respawn = () => {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const v = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta))
      state.player.lat = Math.asin(v.y)
      state.player.lon = Math.atan2(v.z, v.x)
      state.player.heading = Math.random() * Math.PI * 2
      state.player.glide = null
    }
    respawn()

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

    const tryEatNearby = () => {
      const p = state.player
      for (const [id, pv] of pellets) {
        if (pv.dying) continue
        if (eatSent.has(id)) continue
        // Read position back from mesh (already placed on sphere)
        // Avoid storing lat/lon again: reverse from mesh.position.
        const pos = pv.mesh.position
        // Convert xyz back to lat/lon — cheap.
        const n = pos.clone().normalize()
        const lat = Math.asin(n.y)
        const lon = Math.atan2(n.z, n.x)
        const d = greatCircleDistance(p.lat, p.lon, lat, lon)
        if (d < EAT_RADIUS) {
          eatSent.add(id)
          net.sendEat(id)
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

      tryEatNearby()
      net.sendMove(state.player.lat, state.player.lon, state.player.heading)

      // Pellet visuals.
      for (const [id, pv] of pellets) {
        if (pv.dying) {
          const t = Math.min(1, (now - pv.dying.startMs) / EAT_POP_MS)
          pv.mesh.scale.setScalar(1 + t * 1.8)
          const mat = pv.mesh.material as { opacity?: number; transparent?: boolean }
          mat.transparent = true
          mat.opacity = 1 - t
          if (t >= 1) {
            s.scene.remove(pv.mesh)
            pv.mesh.geometry.dispose()
            pellets.delete(id)
          }
        } else if (pv.kind === 'gold') {
          pulseGoldPellet(pv.mesh, now)
        }
      }

      // Remote dot interpolation.
      for (const r of remotes.values()) {
        const t = r.durationMs > 0 ? Math.min(1, (now - r.startMs) / r.durationMs) : 1
        const { lat, lon } = slerpLatLon(r.fromLat, r.fromLon, r.toLat, r.toLon, t)
        placeOnSphere(r.mesh, latLonToVec3(lat, lon, 1), 0.008)
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
      net.close()
      pellets.forEach((pv) => {
        s.scene.remove(pv.mesh)
        pv.mesh.geometry.dispose()
      })
      pellets.clear()
      remotes.forEach((r) => {
        s.scene.remove(r.mesh)
        r.mesh.geometry.dispose()
      })
      remotes.clear()
      s.renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" />
}
