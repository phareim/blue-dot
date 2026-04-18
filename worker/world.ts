/// <reference types="@cloudflare/workers-types" />

import { randomSpherePoint } from './math'

const PELLET_TARGET_MIN = 60
const PELLET_DENSITY_COEF = 30
const GOLD_PROBABILITY = 0.1
const SANITY_NICK_MAX = 24

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

export class World implements DurableObject {
  private state: DurableObjectState
  private sessions = new Map<number, Session>()
  private pellets = new Map<number, Pellet>()
  private nextSessionId = 1
  private nextPelletId = 1

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
  }

  private spawnPellet(): Pellet {
    const { lat, lon } = randomSpherePoint()
    const kind: PelletKind = Math.random() < GOLD_PROBABILITY ? 1 : 0
    const pellet: Pellet = { id: this.nextPelletId++, lat, lon, kind }
    this.pellets.set(pellet.id, pellet)
    return pellet
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
  }

  private dropSession(session: Session): void {
    if (!this.sessions.delete(session.id)) return
    this.broadcast({ t: 'left', id: session.id })
    // Don't aggressively respawn pellets on leave; density will drop naturally
    // until the next tick's spawn loop (added in a later task). For now pellet
    // count follows current target only on spawn-after-eat.
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
      session.nickname = sanitizeNick((msg as Record<string, unknown>).nickname)
      session.color = sanitizeColor((msg as Record<string, unknown>).color)
      session.helloed = true
      this.sendWelcome(session)
      this.broadcast({
        t: 'join',
        id: session.id,
        nickname: session.nickname,
        color: session.color,
      }, session.id)
    }
    // Additional messages handled in later tasks (move/eat).
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

  private broadcast(msg: object, exceptId?: number): void {
    const data = JSON.stringify(msg)
    for (const s of this.sessions.values()) {
      if (exceptId !== undefined && s.id === exceptId) continue
      try { s.ws.send(data) } catch { /* ignored; close handler cleans up */ }
    }
  }

  private send(ws: WebSocket, msg: object): void {
    try { ws.send(JSON.stringify(msg)) } catch { /* ignored */ }
  }

}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
