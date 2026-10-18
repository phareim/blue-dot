import { Vector3 } from 'three'
import type { Body, StarSystem } from './world'

export interface FlightTarget {
  center: Vector3
  radius: number
  body: Body | null
}

const STEP = 1 / 60
const tA = new Vector3()
const tB = new Vector3()
const tC = new Vector3()

/**
 * A slingshot between worlds. The path is simulated through the system's real gravity, with a homing
 * pull that grows over time so it always arrives; the comet rides it and can drift sideways.
 */
export class Flight {
  readonly path: Vector3[] = []
  readonly tangents: Vector3[] = []
  readonly ups: Vector3[] = []
  readonly speeds: number[] = []
  time = 0
  readonly offset = { x: 0, y: 0 }
  /** Path index where the boon orbs sit, or -1. */
  orbIndex = -1

  constructor(readonly target: FlightTarget) {}

  get duration(): number {
    return (this.path.length - 1) * STEP
  }

  get done(): boolean {
    return this.time >= this.duration
  }

  /** Fraction of the flight flown. */
  get progress(): number {
    return Math.min(1, this.time / Math.max(STEP, this.duration))
  }

  build(system: StarSystem, from: Vector3, launch: Vector3, screenUp: Vector3, cruise = 34) {
    const p = from.clone()
    const v = launch.clone()
    const target = this.target
    const avoid: { c: Vector3; r: number }[] = system.bodies
      .filter((b) => !target.body || b.world !== target.body.world)
      .map((b) => ({ c: b.center, r: b.radius }))
    if (target.body) avoid.push({ c: system.sunPos, r: system.sunRadius })
    this.path.push(p.clone())
    let t = 0
    for (let i = 0; i < 60 * 12; i++) {
      t += STEP
      system.gravityAt(p, tA)
      tA.multiplyScalar(0.35)
      tB.subVectors(target.center, p)
      const dist = tB.length()
      tB.divideScalar(dist).multiplyScalar(cruise + Math.min(30, dist * 0.06))
      const homing = Math.min(1, t / 2.4) ** 2 * 4.5
      tA.addScaledVector(tC.subVectors(tB, v), homing)
      for (const b of avoid) {
        tC.subVectors(p, b.c)
        const d = tC.length()
        const margin = b.r + 7
        if (d < margin) tA.addScaledVector(tC.divideScalar(d), 140 * (1 - (d - b.r) / 7))
      }
      v.addScaledVector(tA, STEP)
      p.addScaledVector(v, STEP)
      if (p.distanceTo(target.center) < target.radius + 0.4) {
        p.sub(target.center).setLength(target.radius).add(target.center)
        this.path.push(p.clone())
        break
      }
      this.path.push(p.clone())
    }
    const last = this.path[this.path.length - 1]
    if (last.distanceTo(target.center) > target.radius + 1) {
      // Never arrived: bend the tail of the path onto the target.
      const n = this.path.length
      const end = tA.subVectors(last, target.center).setLength(target.radius).add(target.center)
      for (let i = Math.floor(n * 0.6); i < n; i++) {
        const k = (i - n * 0.6) / (n * 0.4)
        this.path[i].lerp(end, k * k)
      }
    }
    // Tangents, a parallel-transported up, and speeds.
    let up = screenUp.clone()
    for (let i = 0; i < this.path.length; i++) {
      const a = this.path[Math.max(0, i - 1)]
      const b = this.path[Math.min(this.path.length - 1, i + 1)]
      const tan = new Vector3().subVectors(b, a)
      const len = tan.length()
      this.speeds.push(len / (2 * STEP))
      tan.divideScalar(len || 1)
      up = up.clone().addScaledVector(tan, -up.dot(tan))
      if (up.lengthSq() < 1e-4) up.set(0, 1, 0).addScaledVector(tan, -tan.y)
      up.normalize()
      this.tangents.push(tan)
      this.ups.push(up)
    }
    this.orbIndex = this.path.length > 150 ? Math.floor(this.path.length * 0.55) : -1
  }

  /** Where the comet is at the current time, with its sideways offset. */
  sample(outPos: Vector3, outT: Vector3, outUp: Vector3, time = this.time) {
    const f = Math.min(this.path.length - 1.001, Math.max(0, time / STEP))
    const i = Math.floor(f)
    const k = f - i
    outPos.lerpVectors(this.path[i], this.path[i + 1], k)
    outT.lerpVectors(this.tangents[i], this.tangents[i + 1], k).normalize()
    outUp.lerpVectors(this.ups[i], this.ups[i + 1], k).normalize()
    // Offsets fade out near both ends so take-off and landing stay on the path.
    const p = this.progress
    const fade = Math.min(1, p / 0.2, (1 - p) / 0.15)
    const side = tA.crossVectors(outT, outUp)
    outPos.addScaledVector(side, this.offset.x * fade).addScaledVector(outUp, this.offset.y * fade)
  }

  /** The point on the path itself at index `i`, with a sideways offset `x` (for orbs and dust). */
  pointAt(i: number, x: number, y: number, out: Vector3): Vector3 {
    const j = Math.max(0, Math.min(this.path.length - 1, i))
    const side = tA.crossVectors(this.tangents[j], this.ups[j])
    return out.copy(this.path[j]).addScaledVector(side, x).addScaledVector(this.ups[j], y)
  }

  speedNow(): number {
    const i = Math.min(this.speeds.length - 1, Math.floor(this.time / STEP))
    return this.speeds[Math.max(0, i)] ?? 30
  }
}

export const FLIGHT_STEP = STEP
