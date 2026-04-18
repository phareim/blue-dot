/// <reference types="@cloudflare/workers-types" />

import { greatCircleDistance, randomSpherePoint } from './math'

const PELLET_TARGET_MIN = 60
const PELLET_DENSITY_COEF = 30
const GOLD_PROBABILITY = 0.1
const SANITY_NICK_MAX = 24
const TICK_MS = 66
const EAT_RADIUS = 0.05 // angular radians on unit sphere
const MIN_MOVE_INTERVAL_MS = 25 // drop update bursts over ~40 Hz

type PelletKind = 0 | 1 // 0 = common, 1 = gold

interface Session {
  id: number
  nickname: string
  color: string
  lat: number
  lon: number
  h: number
  score: number
  lastBumpMs: number
  lastMoveMs: number
  lastInboundMs: number
  ws: WebSocket
  helloed: boolean
}

interface Pellet {
  id: number
  lat: number
  lon: number
  kind: PelletKind
}

type TickEvent = { t: 'bump'; a: number; b: number }

const DEFAULT_COLOR = '#38bdf8'

function sanitizeNick(input: unknown): string {
  if (typeof input !== 'string') return 'dot'
  const trimmed = input.trim().slice(0, SANITY_NICK_MAX)
  return trimmed || 'dot'
}

function sanitizeColor(input: unknown): string {
  if (typeof input === 'string' && /^#[0-9a-fA-F]{6}$/.test(input)) return input
  return DEFAULT_COLOR
}

function clampFinite(n: unknown, min: number, max: number): number | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  if (n < min) return min
  if (n > max) return max
  return n
}

export class World implements DurableObject {
  private state: DurableObjectState
  private sessions = new Map<number, Session>()
  private pellets = new Map<number, Pellet>()
  private nextSessionId = 1
  private nextPelletId = 1

  // Per-tick buffers (cleared after broadcast).
  private spawnedThisTick: Pellet[] = []
  private removedThisTick: number[] = []
  private eventsThisTick: TickEvent[] = []

  private tickTimer: ReturnType<typeof setTimeout> | null = null

  constructor(state: DurableObjectState) {
    this.state = state
    this.seedPellets()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname !== '/ws') return new Response('not found', { status: 404 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.accept(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private targetPelletCount(): number {
    const n = this.sessions.size
    return Math.max(PELLET_TARGET_MIN, Math.round(PELLET_DENSITY_COEF * Math.sqrt(n)))
  }

  private seedPellets(): void {
    const target = this.targetPelletCount()
    while (this.pellets.size < target) this.spawnPellet()
    // Initial seed goes out in welcome snapshots, not as per-tick deltas.
    this.spawnedThisTick.length = 0
  }

  private spawnPellet(): Pellet {
    const { lat, lon } = randomSpherePoint()
    const kind: PelletKind = Math.random() < GOLD_PROBABILITY ? 1 : 0
    const pellet: Pellet = { id: this.nextPelletId++, lat, lon, kind }
    this.pellets.set(pellet.id, pellet)
    this.spawnedThisTick.push(pellet)
    return pellet
  }

  private removePellet(id: number): void {
    if (this.pellets.delete(id)) this.removedThisTick.push(id)
  }

  private topUpPellets(): void {
    const target = this.targetPelletCount()
    while (this.pellets.size < target) this.spawnPellet()
  }

  private accept(ws: WebSocket): void {
    ws.accept()
    const id = this.nextSessionId++
    const session: Session = {
      id,
      nickname: `dot-${id}`,
      color: DEFAULT_COLOR,
      lat: 0, lon: 0, h: 0,
      score: 0,
      lastBumpMs: 0,
      lastMoveMs: 0,
      lastInboundMs: Date.now(),
      ws,
      helloed: false,
    }
    this.sessions.set(id, session)

    ws.addEventListener('message', (event) => this.onMessage(session, event))
    ws.addEventListener('close', () => this.dropSession(session))
    ws.addEventListener('error', () => this.dropSession(session))

    this.ensureTicker()
  }

  private dropSession(session: Session): void {
    if (!this.sessions.delete(session.id)) return
    this.broadcast({ t: 'left', id: session.id })
    if (this.sessions.size === 0) this.stopTicker()
  }

  private onMessage(session: Session, event: MessageEvent): void {
    session.lastInboundMs = Date.now()
    let msg: unknown
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : '')
    } catch {
      return
    }
    if (!isObj(msg) || typeof msg.t !== 'string') return

    if (msg.t === 'hello' && !session.helloed) {
      session.nickname = sanitizeNick(msg.nickname)
      session.color = sanitizeColor(msg.color)
      session.helloed = true
      this.sendWelcome(session)
      this.broadcast({
        t: 'join',
        id: session.id,
        nickname: session.nickname,
        color: session.color,
      }, session.id)
      return
    }

    if (!session.helloed) return

    if (msg.t === 'move') {
      const now = Date.now()
      if (now - session.lastMoveMs < MIN_MOVE_INTERVAL_MS) return
      const lat = clampFinite(msg.lat, -Math.PI / 2, Math.PI / 2)
      const lon = clampFinite(msg.lon, -Math.PI, Math.PI)
      const h = clampFinite(msg.h, -Math.PI * 4, Math.PI * 4)
      if (lat === null || lon === null || h === null) return
      session.lat = lat
      session.lon = lon
      session.h = h
      session.lastMoveMs = now
      return
    }

    if (msg.t === 'eat') {
      const pid = typeof msg.id === 'number' ? msg.id : null
      if (pid === null) return
      const pellet = this.pellets.get(pid)
      if (!pellet) return
      const d = greatCircleDistance(session.lat, session.lon, pellet.lat, pellet.lon)
      if (d > EAT_RADIUS) return
      session.score += pellet.kind === 1 ? 3 : 1
      this.removePellet(pid)
      this.topUpPellets()
      return
    }
  }

  private sendWelcome(session: Session): void {
    const dots = [...this.sessions.values()].map((s) => ({
      id: s.id,
      nickname: s.nickname,
      color: s.color,
      lat: s.lat, lon: s.lon, h: s.h,
      score: s.score,
    }))
    const pellets = [...this.pellets.values()].map((p) => ({
      id: p.id, lat: p.lat, lon: p.lon, k: p.kind,
    }))
    this.send(session.ws, {
      t: 'welcome',
      you: { id: session.id },
      dots,
      pellets,
    })
  }

  private ensureTicker(): void {
    if (this.tickTimer !== null) return
    const run = () => {
      this.tickTimer = null
      if (this.sessions.size === 0) return
      this.broadcastTick()
      this.tickTimer = setTimeout(run, TICK_MS)
    }
    this.tickTimer = setTimeout(run, TICK_MS)
  }

  private stopTicker(): void {
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer)
      this.tickTimer = null
    }
    this.spawnedThisTick.length = 0
    this.removedThisTick.length = 0
    this.eventsThisTick.length = 0
  }

  private broadcastTick(): void {
    const dots: Array<[number, number, number, number, number]> =
      [...this.sessions.values()].map((s) => [s.id, s.lat, s.lon, s.h, s.score])
    const spawned = this.spawnedThisTick.map((p) => [p.id, p.lat, p.lon, p.kind])
    const removed = [...this.removedThisTick]
    const events = [...this.eventsThisTick]
    this.spawnedThisTick.length = 0
    this.removedThisTick.length = 0
    this.eventsThisTick.length = 0
    this.broadcast({ t: 'tick', dots, spawned, removed, events })
  }

  private broadcast(msg: object, exceptId?: number): void {
    const data = JSON.stringify(msg)
    for (const s of this.sessions.values()) {
      if (exceptId !== undefined && s.id === exceptId) continue
      try { s.ws.send(data) } catch { /* close handler cleans up */ }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    try { ws.send(JSON.stringify(msg)) } catch { /* ignored */ }
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
