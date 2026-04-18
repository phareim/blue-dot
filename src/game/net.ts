import type { Identity } from './identity'
import type {
  ClientMsg,
  JoinMsg,
  LeftMsg,
  ServerMsg,
  TickMsg,
  WelcomeMsg,
} from './protocol'

export interface NetHandlers {
  onWelcome(msg: WelcomeMsg): void
  onTick(msg: TickMsg): void
  onJoin(msg: JoinMsg): void
  onLeft(msg: LeftMsg): void
  onConnectionChange(connected: boolean): void
}

export interface Net {
  sendMove(lat: number, lon: number, h: number): void
  sendEat(pelletId: number): void
  close(): void
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

export function createNet(identity: Identity, handlers: NetHandlers): Net {
  const url = resolveUrl()
  let ws: WebSocket | null = null
  let closed = false
  let backoffMs = RECONNECT_MIN_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let lastMoveSentMs = 0
  let pendingMove: { lat: number; lon: number; h: number } | null = null
  let pendingMoveTimer: ReturnType<typeof setTimeout> | null = null

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
    send({ t: 'move', lat, lon, h })
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS)
      connect()
    }, backoffMs)
  }

  function connect(): void {
    if (closed) return
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      backoffMs = RECONNECT_MIN_MS
      send({ t: 'hello', nickname: identity.nickname, color: identity.color })
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
        case 'left': handlers.onLeft(msg); break
      }
    })
    ws.addEventListener('close', () => {
      handlers.onConnectionChange(false)
      if (closed) return
      scheduleReconnect()
    })
    ws.addEventListener('error', () => { /* close will follow */ })
  }

  connect()

  return {
    sendMove(lat, lon, h) {
      const now = Date.now()
      const wait = lastMoveSentMs + CLIENT_MIN_MOVE_INTERVAL_MS - now
      if (wait <= 0) {
        lastMoveSentMs = now
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
    close() {
      closed = true
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
