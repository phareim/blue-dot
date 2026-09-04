import type { Identity } from './identity'
import type {
  ClientMsg,
  JoinMsg,
  LeftMsg,
  ServerMsg,
  TickMsg,
  UpdateMsg,
  WelcomeMsg,
} from './protocol'

export interface NetHandlers {
  onWelcome(msg: WelcomeMsg): void
  onTick(msg: TickMsg): void
  onJoin(msg: JoinMsg): void
  onUpdate(msg: UpdateMsg): void
  onLeft(msg: LeftMsg): void
  onConnectionChange(connected: boolean): void
}

export interface Net {
  sendMove(lat: number, lon: number, h: number): void
  sendEat(pelletId: number): void
  sendProfile(identity: Identity): void
  close(): void
}

/** Live accessors so reconnects re-announce the current identity/position. */
export interface NetLive {
  getIdentity(): Identity
  getPos(): { lat: number; lon: number; h: number }
}

function resolveUrl(): string {
  const fromEnv = import.meta.env.VITE_WORKER_URL as string | undefined
  if (fromEnv) return fromEnv
  if (typeof window === 'undefined') return 'ws://localhost:8787/ws'
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 8000
const CLIENT_MIN_MOVE_INTERVAL_MS = 33 // ~30 Hz
const HEARTBEAT_MS = 5000 // keep the session alive when the tab is idle/backgrounded

export function createNet(live: NetLive, handlers: NetHandlers): Net {
  const url = resolveUrl()
  let ws: WebSocket | null = null
  let closed = false
  let backoffMs = RECONNECT_MIN_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let lastMoveSentMs = 0
  let lastMove: { lat: number; lon: number; h: number } | null = null
  let pendingMove: { lat: number; lon: number; h: number } | null = null
  let pendingMoveTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

  function send(msg: ClientMsg): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try { ws.send(JSON.stringify(msg)) } catch { /* closed mid-send */ }
  }

  function flushPendingMove(): void {
    pendingMoveTimer = null
    if (!pendingMove) return
    const { lat, lon, h } = pendingMove
    pendingMove = null
    lastMoveSentMs = Date.now()
    lastMove = { lat, lon, h }
    send({ t: 'move', lat, lon, h })
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null) return
    // Jitter the backoff so clients don't reconnect in lockstep after an outage.
    const delay = backoffMs * (0.5 + Math.random() * 0.5)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      connect()
    }, delay)
  }

  function connect(): void {
    if (closed) return
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      backoffMs = RECONNECT_MIN_MS
      const id = live.getIdentity()
      const pos = live.getPos()
      send({ t: 'hello', nickname: id.nickname, color: id.color, lat: pos.lat, lon: pos.lon, h: pos.h })
      lastMoveSentMs = Date.now()
      lastMove = { ...pos }
      startHeartbeat()
      handlers.onConnectionChange(true)
    })
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return
      let msg: ServerMsg
      try { msg = JSON.parse(e.data) as ServerMsg } catch { return }
      switch (msg.t) {
        case 'welcome': handlers.onWelcome(msg); break
        case 'tick': handlers.onTick(msg); break
        case 'join': handlers.onJoin(msg); break
        case 'update': handlers.onUpdate(msg); break
        case 'left': handlers.onLeft(msg); break
      }
    })
    ws.addEventListener('close', () => {
      stopHeartbeat()
      handlers.onConnectionChange(false)
      if (closed) return
      scheduleReconnect()
    })
    ws.addEventListener('error', () => { /* close will follow */ })
  }

  function startHeartbeat(): void {
    if (heartbeatTimer !== null) return
    heartbeatTimer = setInterval(() => {
      // Re-send the last known pose so the server's idle sweep doesn't drop
      // backgrounded tabs (rAF stops, so sendMove isn't called from the loop).
      const pos = lastMove ?? live.getPos()
      lastMoveSentMs = Date.now()
      lastMove = { ...pos }
      send({ t: 'move', ...pos })
    }, HEARTBEAT_MS)
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  connect()

  return {
    sendMove(lat, lon, h) {
      const now = Date.now()
      const wait = lastMoveSentMs + CLIENT_MIN_MOVE_INTERVAL_MS - now
      if (wait <= 0) {
        lastMoveSentMs = now
        lastMove = { lat, lon, h }
        send({ t: 'move', lat, lon, h })
        return
      }
      pendingMove = { lat, lon, h }
      if (pendingMoveTimer === null) {
        pendingMoveTimer = setTimeout(flushPendingMove, wait)
      }
    },
    sendEat(pelletId) {
      send({ t: 'eat', id: pelletId })
    },
    sendProfile(identity) {
      send({ t: 'profile', nickname: identity.nickname, color: identity.color })
    },
    close() {
      closed = true
      stopHeartbeat()
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (pendingMoveTimer !== null) {
        clearTimeout(pendingMoveTimer)
        pendingMoveTimer = null
      }
      if (ws) {
        try { ws.close() } catch { /* noop */ }
        ws = null
      }
    },
  }
}
