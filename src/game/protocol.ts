// Wire protocol shared with worker/world.ts.
// Keep these types in sync on both sides — there is no code-sharing build step.

export type PelletKind = 0 | 1 // 0 = common, 1 = gold

export interface HelloMsg {
  t: 'hello'
  nickname: string
  color: string
}

export interface MoveMsg {
  t: 'move'
  lat: number
  lon: number
  h: number
}

export interface EatMsg {
  t: 'eat'
  id: number
}

export type ClientMsg = HelloMsg | MoveMsg | EatMsg

export interface WelcomeMsg {
  t: 'welcome'
  you: { id: number }
  dots: Array<{
    id: number
    nickname: string
    color: string
    lat: number
    lon: number
    h: number
    score: number
  }>
  pellets: Array<{ id: number; lat: number; lon: number; k: PelletKind }>
}

export type TickDot = [id: number, lat: number, lon: number, h: number, score: number]
export type TickSpawn = [id: number, lat: number, lon: number, kind: PelletKind]
export type TickEvent = { t: 'bump'; a: number; b: number }

export interface TickMsg {
  t: 'tick'
  dots: TickDot[]
  spawned: TickSpawn[]
  removed: number[]
  events: TickEvent[]
}

export interface JoinMsg {
  t: 'join'
  id: number
  nickname: string
  color: string
}

export interface LeftMsg {
  t: 'left'
  id: number
}

export type ServerMsg = WelcomeMsg | TickMsg | JoinMsg | LeftMsg
