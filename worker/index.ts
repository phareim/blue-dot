/// <reference types="@cloudflare/workers-types" />
export { World } from './world'

interface Env {
  WORLD: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected WebSocket upgrade', { status: 426 })
      }
      const id = env.WORLD.idFromName('world')
      const stub = env.WORLD.get(id)
      return stub.fetch(request)
    }
    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 })
    }
    return new Response('blue-dot world', { status: 200 })
  },
}
