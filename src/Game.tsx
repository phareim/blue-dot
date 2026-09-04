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
import { greatCircleDistance, latLonToVec3, slerpLatLon, wrapAngle } from './game/sphere'
import { createGameState } from './game/state'
import type { Identity } from './game/identity'
import { createNet, type Net } from './game/net'
import type {
  JoinMsg,
  LeftMsg,
  PelletKind as WirePelletKind,
  TickMsg,
  UpdateMsg,
  WelcomeMsg,
} from './game/protocol'
import './Game.css'

const EAT_RADIUS = 0.045 // angular radians — must be <= server EAT_RADIUS (0.05)
const EAT_POP_MS = 180
const EAT_RETRY_MS = 600 // re-send eat if the server hasn't confirmed by now (see tryEatNearby)
const REMOTE_DOT_RADIUS = DOT_RADIUS * 0.9 // slightly smaller so they don't fully overlap
const GHOST_TICKS = 150 // drop remotes unseen for ~10s (missed `left` messages)
const FALLBACK_COLOR = '#38bdf8' // must match worker DEFAULT_COLOR

type KindLabel = 'common' | 'gold'
function kindLabel(k: WirePelletKind): KindLabel { return k === 1 ? 'gold' : 'common' }

interface PelletVis {
  mesh: Mesh
  kind: KindLabel
  lat: number
  lon: number
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
  missedTicks: number
}

function disposeMesh(mesh: Mesh): void {
  mesh.geometry.dispose()
  const mat = mesh.material as { dispose?: () => void } | { dispose?: () => void }[]
  if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
  else mat.dispose?.()
}

export interface LeaderboardEntry {
  id: number
  nickname: string
  color: string
  score: number
  isSelf: boolean
}

interface Props {
  identity: Identity
  onScoreChange: (score: number) => void
  onLeaderboard: (entries: LeaderboardEntry[]) => void
  onConnectionChange?: (connected: boolean) => void
}

export function Game({ identity, onScoreChange, onLeaderboard, onConnectionChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const netRef = useRef<Net | null>(null)
  const playerDotRef = useRef<Mesh | null>(null)
  // Live identity for the socket (hello on reconnect, leaderboard self-row).
  const identityRef = useRef(identity)
  identityRef.current = identity

  // Push renames/recolors to the server without dropping the session.
  useEffect(() => {
    netRef.current?.sendProfile(identity)
    if (playerDotRef.current) setPlayerColor(playerDotRef.current, identity.color)
  }, [identity])

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
    let lastLeaderKey = ''
    // pellet id -> ms timestamp of the last eat sent. Entries are retried after
    // EAT_RETRY_MS (a rejected eat must not block the pellet forever) and
    // cleared when the server confirms the removal.
    const eatSent = new Map<number, number>()

    const publishLeaderboard = () => {
      const id = identityRef.current
      const all: LeaderboardEntry[] = []
      if (selfId !== null) {
        all.push({
          id: selfId,
          nickname: id.nickname,
          color: id.color,
          score: lastScore,
          isSelf: true,
        })
      }
      for (const [id, r] of remotes) {
        all.push({ id, nickname: r.nickname, color: r.color, score: r.score, isSelf: false })
      }
      all.sort((a, b) => b.score - a.score || a.id - b.id)
      const top = all.slice(0, 5)
      const key = top.map((e) => `${e.id}:${e.score}:${e.nickname}:${e.color}`).join('|')
      if (key === lastLeaderKey) return
      lastLeaderKey = key
      onLeaderboard(top)
    }

    const addPellet = (id: number, lat: number, lon: number, kind: WirePelletKind) => {
      if (pellets.has(id)) return
      const label = kindLabel(kind)
      const mesh = createPelletMesh(label)
      placeOnSphere(mesh, latLonToVec3(lat, lon, 1), label === 'gold' ? 0.012 : 0.005)
      s.scene.add(mesh)
      pellets.set(id, { mesh, kind: label, lat, lon, dying: null })
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
      const existing = remotes.get(id)
      if (existing) {
        // A join arriving after a tick-placeholder (or a re-join) corrects it.
        existing.nickname = nickname
        existing.score = score
        if (existing.color !== color) {
          existing.color = color
          const mat = existing.mesh.material as MeshStandardMaterial
          mat.color.set(color)
          mat.emissive.set(color)
        }
        existing.missedTicks = 0
        return
      }
      const mesh = makeRemoteMesh(color)
      placeOnSphere(mesh, latLonToVec3(lat, lon, 1), 0.008)
      s.scene.add(mesh)
      remotes.set(id, {
        mesh, color, nickname, score,
        fromLat: lat, fromLon: lon, toLat: lat, toLon: lon,
        startMs: performance.now(), durationMs: 1, missedTicks: 0,
      })
    }

    const removeRemote = (id: number) => {
      const r = remotes.get(id)
      if (!r) return
      s.scene.remove(r.mesh)
      disposeMesh(r.mesh)
      remotes.delete(id)
    }

    const applyProfile = (id: number, nickname: string, color: string) => {
      const r = remotes.get(id)
      if (!r) return
      r.nickname = nickname
      if (r.color !== color) {
        r.color = color
        const mat = r.mesh.material as MeshStandardMaterial
        mat.color.set(color)
        mat.emissive.set(color)
      }
      publishLeaderboard()
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
      publishLeaderboard()
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
      const seen = new Set<number>()
      for (const [id, lat, lon, , score] of msg.dots) {
        if (id === selfId) {
          if (score !== lastScore) {
            lastScore = score
            onScoreChange(score)
          }
          continue
        }
        seen.add(id)
        let r = remotes.get(id)
        if (!r) {
          // Join missed (reconnect race): placeholder until join/update corrects it.
          addRemote(id, `dot-${id}`, FALLBACK_COLOR, lat, lon, score)
          r = remotes.get(id)
          if (!r) continue
          publishLeaderboard()
        } else {
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
        r.missedTicks = 0
      }
      // Ghost sweep: remotes absent from ticks for a while (missed `left`).
      for (const [id, r] of remotes) {
        if (seen.has(id)) continue
        r.missedTicks += 1
        if (r.missedTicks > GHOST_TICKS) removeRemote(id)
      }
      publishLeaderboard()
    }

    const onJoin = (msg: JoinMsg) => {
      addRemote(msg.id, msg.nickname, msg.color, msg.lat, msg.lon, msg.score)
      publishLeaderboard()
    }

    const onUpdate = (msg: UpdateMsg) => {
      applyProfile(msg.id, msg.nickname, msg.color)
    }

    const onLeft = (msg: LeftMsg) => {
      removeRemote(msg.id)
      publishLeaderboard()
    }

    const net = createNet(
      {
        getIdentity: () => identityRef.current,
        getPos: () => ({ lat: state.player.lat, lon: state.player.lon, h: state.player.heading }),
      },
      {
        onWelcome, onTick, onJoin, onUpdate, onLeft,
        onConnectionChange: (connected) => { onConnectionChange?.(connected) },
      },
    )
    netRef.current = net
    playerDotRef.current = s.playerDot

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

    const { onKeyDown, onKeyUp, onPointerDown, onWheel } = createControls(
      state, canvas, s.camera, s.globe, respawn,
    )
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('wheel', onWheel, { passive: false })

    const onResize = () => resizeRenderer(s.renderer, s.camera, canvas)
    window.addEventListener('resize', onResize)
    onResize()

    let prev = performance.now()
    let raf = 0

    const tryEatNearby = (now: number) => {
      const p = state.player
      for (const [id, pv] of pellets) {
        if (pv.dying) continue
        const sentAt = eatSent.get(id)
        if (sentAt !== undefined) {
          // Still awaiting confirmation — but a rejection (stale position at the
          // server) must not block the pellet forever, so retry after a delay.
          if (now - sentAt < EAT_RETRY_MS) continue
          eatSent.delete(id)
        }
        const d = greatCircleDistance(p.lat, p.lon, pv.lat, pv.lon)
        if (d < EAT_RADIUS) {
          eatSent.set(id, now)
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

      tryEatNearby(now)
      state.player.heading = wrapAngle(state.player.heading)
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
            disposeMesh(pv.mesh)
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
      updateFollowCam(s.camera, state.player.lat, state.player.lon, state.player.heading, state.zoom)
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
      canvas.removeEventListener('wheel', onWheel)
      net.close()
      netRef.current = null
      playerDotRef.current = null
      pellets.forEach((pv) => {
        s.scene.remove(pv.mesh)
        disposeMesh(pv.mesh)
      })
      pellets.clear()
      remotes.forEach((r) => {
        s.scene.remove(r.mesh)
        disposeMesh(r.mesh)
      })
      remotes.clear()
      s.renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" />
}
