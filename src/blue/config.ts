// Tuning and content. Distances are world units, angles radians, times seconds.

export const PLAYER = {
  speed: 9.5,
  turn: 3.9,
  radius: 0.45,
  jump: 9.5,
  hearts: 3,
  maxHearts: 5,
  invulnerable: 1.6,
  blazeSpeed: 1.45,
  blazeTime: 6,
}

export const TRAIL = {
  spacing: 0.26,
  length: 38,
  /** The head closes a loop when it comes this close to an old trail point. */
  snap: 0.8,
  width: 0.36,
}

export const SCORE = {
  perEnemy: 10,
  gem: 250,
  /** Captures closer together than this keep the chain alive. */
  chainWindow: 3.2,
  worldLit: 1500,
  supernova: 8000,
  paintPerPercent: 20,
}

export type EnemyKind = 'mite' | 'hunter' | 'shear' | 'spore' | 'warden' | 'gem'

export interface EnemyDef {
  color: [number, number, number]
  radius: number
  /** Fraction of the player's base speed. */
  speed: number
  turn: number
  flux: number
  /** Touching the comet costs a heart. */
  harmful: boolean
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  // Mites only bump the comet away (see Game.bump); the warm-coloured kinds cost a heart.
  mite: { color: [1.0, 0.18, 0.72], radius: 0.42, speed: 0.34, turn: 1.6, flux: 0.025, harmful: false },
  hunter: { color: [1.0, 0.42, 0.06], radius: 0.48, speed: 0.6, turn: 2.3, flux: 0.04, harmful: true },
  shear: { color: [1.0, 0.08, 0.16], radius: 0.46, speed: 0.5, turn: 2.6, flux: 0.05, harmful: true },
  spore: { color: [0.5, 1.0, 0.12], radius: 0.55, speed: 0.3, turn: 1.0, flux: 0.06, harmful: true },
  warden: { color: [0.62, 0.3, 1.0], radius: 0.85, speed: 0.18, turn: 0.8, flux: 0.12, harmful: true },
  gem: { color: [1.0, 0.82, 0.25], radius: 0.4, speed: 0.55, turn: 3.0, flux: 0.15, harmful: false },
}

export type Feature = 'none' | 'geysers' | 'ice' | 'waves' | 'twin' | 'tiny' | 'tide'

export interface PlanetType {
  id: string
  name: string
  /** One line for the world card. */
  blurb: string
  radius: number
  gravity: number
  /** How fast the comet's velocity catches up with where it points. Low is slippery. */
  grip: number
  style: number
  feature: Feature
  colors: { deep: string; mid: string; high: string; glow: string; atmo: string }
  noise: number
  paintTarget: number
}

export const PLANETS: Record<string, PlanetType> = {
  azure: {
    id: 'azure', name: 'Azure', blurb: 'Close a loop around them.',
    radius: 11, gravity: 26, grip: 14, style: 0, feature: 'none',
    colors: { deep: '#06163a', mid: '#0f4a78', high: '#3ab0c4', glow: '#8ff4ff', atmo: '#3f9dff' },
    noise: 2.2, paintTarget: 0.2,
  },
  ember: {
    id: 'ember', name: 'Ember', blurb: 'The vents throw everything skyward.',
    radius: 10, gravity: 24, grip: 12, style: 1, feature: 'geysers',
    colors: { deep: '#0d0404', mid: '#341007', high: '#5e2410', glow: '#ff6418', atmo: '#ff4d24' },
    noise: 2.8, paintTarget: 0.22,
  },
  rime: {
    id: 'rime', name: 'Rime', blurb: 'No grip. Lean into the drift.',
    radius: 12, gravity: 26, grip: 1.6, style: 2, feature: 'ice',
    colors: { deep: '#1d4563', mid: '#86c3dc', high: '#eef9ff', glow: '#c4f6ff', atmo: '#9fe6ff' },
    noise: 3.2, paintTarget: 0.2,
  },
  bloom: {
    id: 'bloom', name: 'Bloom', blurb: 'The ground breathes in waves.',
    radius: 10, gravity: 22, grip: 11, style: 3, feature: 'waves',
    colors: { deep: '#33083a', mid: '#982b76', high: '#ff8cc6', glow: '#ffd2f2', atmo: '#ff63d2' },
    noise: 2.0, paintTarget: 0.22,
  },
  gemini: {
    id: 'gemini', name: 'Gemini', blurb: 'Two worlds. Jump the gap.',
    radius: 6.5, gravity: 17, grip: 13, style: 4, feature: 'twin',
    colors: { deep: '#332308', mid: '#a06c24', high: '#f0cf74', glow: '#ffe8a0', atmo: '#ffc062' },
    noise: 3.0, paintTarget: 0.2,
  },
  mote: {
    id: 'mote', name: 'Mote', blurb: 'Tiny, and barely any gravity.',
    radius: 5.5, gravity: 7, grip: 12, style: 5, feature: 'tiny',
    colors: { deep: '#1a0938', mid: '#552ca2', high: '#b08aff', glow: '#e8dcff', atmo: '#9c78ff' },
    noise: 2.4, paintTarget: 0.32,
  },
  tide: {
    id: 'tide', name: 'Tide', blurb: 'A moon drags the swarm in its wake.',
    radius: 12, gravity: 25, grip: 13, style: 6, feature: 'tide',
    colors: { deep: '#022019', mid: '#0a6555', high: '#4fdcae', glow: '#b6ffe2', atmo: '#38ffbe' },
    noise: 2.6, paintTarget: 0.22,
  },
}

/** Worlds of the first system, in order. Later systems draw from every type. */
export const FIRST_SYSTEM = ['azure', 'ember', 'rime', 'mote']
export const LATER_TYPES = ['azure', 'ember', 'rime', 'bloom', 'gemini', 'mote', 'tide']

/** Which enemy kinds a world in system `s`, at world index `w`, may spawn, with weights. */
export function enemyMix(s: number, w: number): [EnemyKind, number][] {
  const step = s * 4 + w
  const mix: [EnemyKind, number][] = [['mite', 10]]
  if (step >= 1) mix.push(['hunter', 2 + Math.min(4, step * 0.5)])
  if (step >= 2) mix.push(['shear', 1 + Math.min(3, step * 0.3)])
  if (step >= 3) mix.push(['spore', 1.5])
  if (step >= 5) mix.push(['warden', 0.6 + Math.min(1.2, step * 0.08)])
  return mix
}

export interface RunStats {
  speed: number
  turn: number
  trail: number
  snap: number
  magnet: number
  blazeTime: number
  jump: number
  doubleJump: boolean
  mult: number
  chainBolts: number
  emberTail: boolean
  echo: boolean
  fluxStart: number
  maxHearts: number
}

export function baseStats(): RunStats {
  return {
    speed: 1, turn: 1, trail: 1, snap: 1, magnet: 1, blazeTime: PLAYER.blazeTime, jump: 1,
    doubleJump: false, mult: 1, chainBolts: 0, emberTail: false, echo: false, fluxStart: 0,
    maxHearts: PLAYER.hearts,
  }
}

export interface Boon {
  id: string
  name: string
  text: string
  color: string
  /** May be taken more than once. */
  stacks: boolean
  apply: (s: RunStats) => void
}

export const BOONS: Boon[] = [
  { id: 'tail', name: 'Long Tail', text: 'Trail +35%', color: '#5fb8ff', stacks: true, apply: (s) => { s.trail *= 1.35 } },
  { id: 'snap', name: 'Lasso', text: 'Loops close from further away', color: '#7fe3ff', stacks: true, apply: (s) => { s.snap *= 1.6 } },
  { id: 'bolts', name: 'Arc Lightning', text: 'Every capture zaps 2 more', color: '#c9a6ff', stacks: true, apply: (s) => { s.chainBolts += 2 } },
  { id: 'burn', name: 'Afterburn', text: 'Blaze lasts 3 s longer', color: '#ff9a3c', stacks: true, apply: (s) => { s.blazeTime += 3 } },
  { id: 'magnet', name: 'Gravity Well', text: 'Stardust flies to you from twice as far', color: '#9cf2c0', stacks: true, apply: (s) => { s.magnet *= 2 } },
  { id: 'spring', name: 'Spring', text: 'Jump higher, and once more in the air', color: '#ffe36b', stacks: false, apply: (s) => { s.jump *= 1.35; s.doubleJump = true } },
  { id: 'heart', name: 'Second Wind', text: '+1 heart, and one back now', color: '#ff6b8a', stacks: true, apply: (s) => { s.maxHearts = Math.min(6, s.maxHearts + 1) } },
  { id: 'mult', name: 'Resonance', text: 'Score multiplier +1', color: '#ffffff', stacks: true, apply: (s) => { s.mult += 1 } },
  { id: 'ember', name: 'Ember Tail', text: 'Your trail burns what touches it', color: '#ff5a1f', stacks: false, apply: (s) => { s.emberTail = true } },
  { id: 'echo', name: 'Echo', text: 'Each loop strikes twice', color: '#6ef0ff', stacks: false, apply: (s) => { s.echo = true } },
  { id: 'fast', name: 'Overclock', text: 'Faster, and turns tighter', color: '#5af0a8', stacks: true, apply: (s) => { s.speed *= 1.1; s.turn *= 1.14 } },
  { id: 'charge', name: 'Supercharge', text: 'Land on each world half charged', color: '#ffd04a', stacks: false, apply: (s) => { s.fluxStart = 0.5 } },
]

export type PowerKind = 'nova' | 'singularity' | 'prism' | 'chrono' | 'heart' | 'blaze'

export const POWERS: Record<PowerKind, { name: string; color: [number, number, number]; weight: number }> = {
  nova: { name: 'NOVA', color: [1, 0.95, 0.6], weight: 3 },
  singularity: { name: 'SINGULARITY', color: [0.65, 0.35, 1], weight: 3 },
  prism: { name: 'PRISM', color: [0.4, 1, 0.95], weight: 3 },
  chrono: { name: 'CHRONO', color: [0.55, 0.75, 1], weight: 2 },
  heart: { name: '+1 HEART', color: [1, 0.3, 0.45], weight: 1.4 },
  blaze: { name: 'BLAZE', color: [1, 0.55, 0.15], weight: 2 },
}

export const PALETTE = {
  comet: [0.55, 0.82, 1.0] as [number, number, number],
  trail: [0.18, 0.5, 1.0] as [number, number, number],
  paint: '#2a74ff',
  blaze: [1.0, 0.55, 0.15] as [number, number, number],
}
