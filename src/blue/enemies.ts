import { Color, Group, InstancedMesh, Matrix4, Vector3 } from 'three'
import { ENEMIES, PLAYER, type EnemyDef, type EnemyKind } from './config'
import { anyTangent, toTangent, walk } from './geo'
import { enemyGeometry, enemyMaterial } from './fx/shapes'
import { VENT, WAVE, type Body } from './world'
import type { Trail } from './trail'

export type EnemyState = 'spawn' | 'live' | 'caught' | 'dead'

export interface Enemy {
  id: number
  kind: EnemyKind
  def: EnemyDef
  body: Body
  n: Vector3
  h: Vector3
  v: Vector3
  alt: number
  vAlt: number
  state: EnemyState
  t: number
  age: number
  spin: number
  spinRate: number
  from: Vector3
  pull: Vector3
  wave: number
  flash: number
  burn: number
  phase: number
  pulse: number
}

export interface SwarmContext {
  body: Body | null
  playerN: Vector3
  playerAir: boolean
  trail: Trail
  /** 1 normally; lower under Chrono. */
  timeScale: number
  /** Grows with time spent on a world. */
  heat: number
  singularity: { body: Body; n: Vector3; strength: number } | null
  onCut: (segment: number, e: Enemy) => void
  onPulse: (e: Enemy) => void
  onPop: (e: Enemy) => void
}

const KINDS: EnemyKind[] = ['mite', 'hunter', 'shear', 'spore', 'warden', 'gem']
const CAP = 96
const CAUGHT_TIME = 0.32
const SPAWN_TIME = 0.9

const tD = new Vector3()
const tX = new Vector3()
const tZ = new Vector3()
const tP = new Vector3()
const tF = new Vector3()
const mat = new Matrix4()
const col = new Color()
let ids = 1

/** Rotate `h` about `n` toward tangent direction `d` by at most `max` radians. */
function turnToward(n: Vector3, h: Vector3, d: Vector3, max: number) {
  const cross = tX.crossVectors(h, d).dot(n)
  const dot = h.dot(d)
  const ang = Math.atan2(cross, dot)
  const step = Math.max(-max, Math.min(max, ang))
  h.applyAxisAngle(n, step)
  toTangent(h, n).normalize()
}

/** Tangent direction at `n` toward `m`, written to `out`. False when `m` is (nearly) `n` or its antipode. */
export function dirTo(n: Vector3, m: Vector3, out: Vector3): boolean {
  out.copy(m).addScaledVector(n, -n.dot(m))
  const l = out.length()
  if (l < 1e-6) return false
  out.divideScalar(l)
  return true
}

export class Swarm {
  readonly group = new Group()
  readonly list: Enemy[] = []
  private meshes = new Map<EnemyKind, InstancedMesh>()

  constructor() {
    for (const k of KINDS) {
      const m = new InstancedMesh(enemyGeometry(k), enemyMaterial(), CAP)
      m.count = 0
      m.frustumCulled = false
      m.renderOrder = 4
      m.setColorAt(0, new Color(1, 1, 1))
      this.meshes.set(k, m)
      this.group.add(m)
    }
  }

  get live(): number {
    let c = 0
    for (const e of this.list) if (e.state === 'live' || e.state === 'spawn') c++
    return c
  }

  countOn(body: Body, kind?: EnemyKind): number {
    let c = 0
    for (const e of this.list) if (e.body === body && e.state !== 'dead' && (!kind || e.kind === kind)) c++
    return c
  }

  spawn(kind: EnemyKind, body: Body, n: Vector3, delay = SPAWN_TIME): Enemy | null {
    if (this.list.length >= CAP * 2) return null
    let same = 0
    for (const e of this.list) if (e.kind === kind) same++
    if (same >= CAP) return null
    const h = anyTangent(n, new Vector3()).applyAxisAngle(n, Math.random() * Math.PI * 2)
    const e: Enemy = {
      id: ids++, kind, def: ENEMIES[kind], body,
      n: n.clone().normalize(), h, v: new Vector3(),
      alt: 0, vAlt: 0, state: 'spawn', t: delay, age: 0,
      spin: Math.random() * 6, spinRate: kind === 'hunter' ? 0 : (Math.random() < 0.5 ? -1 : 1) * (1.5 + Math.random() * 2),
      from: new Vector3(), pull: new Vector3(), wave: -1, flash: 0, burn: 0, phase: Math.random() * 100, pulse: 2 + Math.random() * 3,
    }
    this.list.push(e)
    return e
  }

  capture(e: Enemy, center: Vector3) {
    if (e.state === 'caught' || e.state === 'dead') return
    e.state = 'caught'
    e.t = 0
    e.from.copy(e.n)
    e.pull.copy(center)
  }

  /** Throw an enemy off the ground. */
  fling(e: Enemy, up: number, kick?: Vector3) {
    e.vAlt = Math.max(e.vAlt, up)
    if (kick) e.v.add(kick)
    e.spinRate *= 2.5
  }

  clearBody(body: Body | null) {
    for (const e of this.list) if (!body || e.body === body) e.state = 'dead'
    this.sweep()
  }

  private sweep() {
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].state === 'dead') this.list.splice(i, 1)
  }

  update(dt: number, ctx: SwarmContext) {
    const base = PLAYER.speed
    for (const e of this.list) {
      e.age += dt
      e.flash = Math.max(0, e.flash - dt * 4)
      e.spin += e.spinRate * dt * ctx.timeScale
      if (e.state === 'spawn') {
        e.t -= dt
        if (e.t <= 0) e.state = 'live'
        continue
      }
      if (e.state === 'caught') {
        e.t += dt
        const k = Math.max(0, Math.min(1, e.t / CAUGHT_TIME))
        const ease = k * k * (3 - 2 * k)
        e.n.copy(e.from).lerp(e.pull, ease * 0.9).normalize()
        e.spinRate += dt * 60
        if (k >= 1) {
          e.state = 'dead'
          ctx.onPop(e)
        }
        continue
      }
      if (e.state !== 'live') continue
      this.think(e, dt, ctx)
      this.move(e, dt, ctx, base)
    }
    this.separate(dt)
    this.sweep()
  }

  private think(e: Enemy, dt: number, ctx: SwarmContext) {
    const sameBody = ctx.body === e.body
    const ts = ctx.timeScale
    const turn = e.def.turn * dt * ts
    switch (e.kind) {
      case 'mite': {
        e.h.applyAxisAngle(e.n, Math.sin(e.age * 1.3 + e.phase) * 1.1 * dt * ts)
        // Mites drift toward the comet only when it is close: a swarm, not a pack.
        if (sameBody && e.n.angleTo(ctx.playerN) * e.body.radius < 7 && dirTo(e.n, ctx.playerN, tD)) turnToward(e.n, e.h, tD, turn * 0.3)
        break
      }
      case 'hunter': {
        if (sameBody && dirTo(e.n, ctx.playerN, tD)) turnToward(e.n, e.h, tD, turn)
        break
      }
      case 'shear': {
        const tr = ctx.trail
        const target = sameBody && tr.body === e.body && tr.count > 8 ? tr.point(Math.floor(tr.count * 0.55)) : sameBody ? ctx.playerN : null
        if (target && dirTo(e.n, target, tD)) turnToward(e.n, e.h, tD, turn)
        if (sameBody && tr.body === e.body && tr.count > 3 && e.alt < 0.4) {
          const seg = tr.nearestSegment(e.n, (e.def.radius * 0.9) / e.body.radius, 2)
          if (seg >= 0) ctx.onCut(seg, e)
        }
        break
      }
      case 'spore': {
        e.h.applyAxisAngle(e.n, (e.phase > 50 ? 1 : -1) * 1.0 * dt * ts)
        if (sameBody && dirTo(e.n, ctx.playerN, tD)) turnToward(e.n, e.h, tD, turn * 0.25)
        break
      }
      case 'warden': {
        if (sameBody && dirTo(e.n, ctx.playerN, tD)) turnToward(e.n, e.h, tD, turn)
        e.pulse -= dt * ts
        if (e.pulse <= 0) {
          e.pulse = 4.2
          e.flash = 1
          ctx.onPulse(e)
        }
        break
      }
      case 'gem': {
        if (sameBody && dirTo(e.n, ctx.playerN, tD)) {
          tD.negate()
          turnToward(e.n, e.h, tD, turn)
        }
        e.h.applyAxisAngle(e.n, Math.sin(e.age * 2.1 + e.phase) * 1.4 * dt)
        if (e.age > 15) {
          e.state = 'dead'
          ctx.onPop(e)
        }
        break
      }
    }
  }

  private move(e: Enemy, dt: number, ctx: SwarmContext, base: number) {
    const body = e.body
    const R = body.radius
    const ts = ctx.timeScale
    const speed = e.def.speed * base * (1 + Math.min(0.6, ctx.heat * 0.012)) * ts
    const grip = body.type.grip
    const k = 1 - Math.exp(-grip * dt)
    e.v.lerp(tF.copy(e.h).multiplyScalar(speed), e.alt > 0 ? k * 0.1 : k)

    // World features push the swarm around.
    if (body.moon && e.alt < 0.3) {
      const a = Math.acos(Math.max(-1, Math.min(1, e.n.dot(body.moon.sub))))
      if (a < 1.4 && dirTo(e.n, body.moon.sub, tD)) e.v.addScaledVector(tD, 11 * (1 - a / 1.4) * dt)
    }
    for (const vent of body.vents) {
      if (vent.state !== 'erupt' || e.alt > 0.5) continue
      if (e.n.angleTo(vent.n) * R < VENT.radius) {
        this.fling(e, VENT.launch * (0.75 + Math.random() * 0.4))
        if (dirTo(vent.n, e.n, tD)) e.v.addScaledVector(tD, 4)
      }
    }
    const w = body.wave
    if (w && w.active && e.wave !== w.id && e.alt < 0.2) {
      const a = Math.acos(Math.max(-1, Math.min(1, e.n.dot(w.dir))))
      if (Math.abs(a - w.front) < WAVE.width * 0.5) {
        e.wave = w.id
        this.fling(e, 9 + Math.random() * 3)
      }
    }
    const s = ctx.singularity
    if (s && s.body === body) {
      const a = e.n.angleTo(s.n)
      if (dirTo(e.n, s.n, tD)) {
        const pull = s.strength * 26 / Math.max(0.35, a * R * 0.4)
        e.v.addScaledVector(tD, pull * dt)
        // Swirl
        tX.crossVectors(e.n, tD)
        e.v.addScaledVector(tX, pull * 0.45 * dt)
      }
    }

    if (e.alt > 0 || e.vAlt > 0) {
      e.vAlt -= body.type.gravity * 0.8 * dt
      e.alt += e.vAlt * dt
      if (e.alt <= 0) {
        e.alt = 0
        e.vAlt = e.vAlt < -6 ? -e.vAlt * 0.3 : 0
        e.spinRate = Math.sign(e.spinRate || 1) * Math.min(Math.abs(e.spinRate), 4)
      }
    }
    const sp = e.v.length()
    if (sp > 1e-5) {
      tF.copy(e.v).divideScalar(sp)
      walk(e.n, tF, (sp * dt) / (R + e.alt), [e.h, e.v])
      toTangent(e.h, e.n).normalize()
      toTangent(e.v, e.n)
    }
  }

  private separate(dt: number) {
    const L = this.list
    for (let i = 0; i < L.length; i++) {
      const a = L[i]
      if (a.state !== 'live') continue
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j]
        if (b.state !== 'live' || b.body !== a.body) continue
        const min = (a.def.radius + b.def.radius) / a.body.radius
        const d = a.n.angleTo(b.n)
        if (d >= min || d < 1e-6) continue
        const push = (min - d) * 0.5 * Math.min(1, dt * 12)
        tD.subVectors(a.n, b.n)
        a.n.addScaledVector(tD, push / d).normalize()
        b.n.addScaledVector(tD, -push / d).normalize()
      }
    }
  }

  render(time: number) {
    const counts = new Map<EnemyKind, number>()
    for (const k of KINDS) counts.set(k, 0)
    for (const e of this.list) {
      if (e.state === 'dead') continue
      const mesh = this.meshes.get(e.kind)!
      const i = counts.get(e.kind)!
      if (i >= CAP) continue
      counts.set(e.kind, i + 1)
      const body = e.body
      let scale = e.def.radius * 1.3
      let bright = 2.4
      if (e.state === 'spawn') {
        const k = 1 - e.t / SPAWN_TIME
        scale *= 0.2 + 0.8 * k
        bright = 0.6 + Math.abs(Math.sin(time * 30)) * 1.2 * k
      } else if (e.state === 'caught') {
        const k = Math.max(0, Math.min(1, e.t / CAUGHT_TIME))
        scale *= 1 + k * 0.5
        bright = 3 + k * 6
      }
      if (e.kind === 'gem') scale *= 1 + 0.15 * Math.sin(time * 8 + e.phase)
      const lift = 0.14 + e.alt + body.groundHeight(e.n)
      tP.copy(e.n).multiplyScalar(body.radius + lift).add(body.center)
      tZ.copy(e.h)
      if (e.spinRate !== 0) tZ.applyAxisAngle(e.n, e.spin)
      tX.crossVectors(e.n, tZ)
      mat.makeBasis(tX, e.n, tZ)
      mat.scale(tD.set(scale, scale, scale))
      mat.setPosition(tP)
      mesh.setMatrixAt(i, mat)
      const [r, g, b] = e.def.color
      const f = Math.min(1, e.flash + (e.state === 'caught' ? Math.max(0, Math.min(1, e.t / CAUGHT_TIME)) : 0))
      col.setRGB(r + (1 - r) * f, g + (1 - g) * f, b + (1 - b) * f).multiplyScalar(bright)
      mesh.setColorAt(i, col)
    }
    for (const [k, mesh] of this.meshes) {
      mesh.count = counts.get(k)!
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }
}
