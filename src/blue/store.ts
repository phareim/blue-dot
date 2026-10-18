export type Screen = 'title' | 'play' | 'paused' | 'over'

export interface RunSummary {
  score: number
  best: number
  newBest: boolean
  worlds: number
  systems: number
  biggestLoop: number
  captured: number
  time: number
}

export interface HudState {
  screen: Screen
  score: number
  best: number
  hearts: number
  maxHearts: number
  chain: number
  mult: number
  flux: number
  blaze: boolean
  paint: number
  target: number
  worldName: string
  worldIndex: number
  worldCount: number
  system: number
  launchReady: boolean
  flying: boolean
  boons: { id: string; name: string; color: string; count: number }[]
  power: string | null
  muted: boolean
  summary: RunSummary | null
  touch: boolean
}

export function initialHud(best: number, muted: boolean): HudState {
  return {
    screen: 'title', score: 0, best, hearts: 3, maxHearts: 3, chain: 0, mult: 1, flux: 0, blaze: false,
    paint: 0, target: 0.3, worldName: '', worldIndex: 0, worldCount: 0, system: 1, launchReady: false,
    flying: false, boons: [], power: null, muted, summary: null, touch: false,
  }
}

export class Store {
  private listeners = new Set<() => void>()
  constructor(private state: HudState) {}

  get = (): HudState => this.state

  set(patch: Partial<HudState>) {
    let changed = false
    for (const k in patch) {
      const key = k as keyof HudState
      if (this.state[key] !== patch[key]) { changed = true; break }
    }
    if (!changed) return
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

const BEST_KEY = 'blue.best'

export function loadMuted(): boolean {
  try {
    return localStorage.getItem('blue.muted') === '1'
  } catch {
    return false
  }
}

export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0
  } catch {
    return 0
  }
}

export function saveBest(score: number) {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)))
  } catch { /* storage blocked */ }
}
