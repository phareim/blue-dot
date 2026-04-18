export interface PlayerState {
  lat: number
  lon: number
  heading: number // radians, 0 = north, PI/2 = east
  glide: null | {
    fromLat: number
    fromLon: number
    toLat: number
    toLon: number
    startMs: number
    durationMs: number
  }
}

export interface Pellet {
  id: number
  lat: number
  lon: number
  kind: 'common' | 'gold'
}

export interface GameState {
  player: PlayerState
  pellets: Pellet[]
  keys: Set<string>
}

export function createGameState(): GameState {
  return {
    player: { lat: 0, lon: 0, heading: 0, glide: null },
    pellets: [],
    keys: new Set(),
  }
}
