/// <reference types="@cloudflare/workers-types" />

export class World implements DurableObject {
  private state: DurableObjectState
  private sockets = new Set<WebSocket>()
  private nextId = 1

  constructor(state: DurableObjectState) {
    this.state = state
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

  private accept(ws: WebSocket): void {
    ws.accept()
    const id = this.nextId++
    this.sockets.add(ws)
    ws.addEventListener('close', () => {
      this.sockets.delete(ws)
    })
    ws.addEventListener('error', () => {
      this.sockets.delete(ws)
    })
    ws.send(JSON.stringify({ t: 'welcome', you: { id } }))
  }
}
