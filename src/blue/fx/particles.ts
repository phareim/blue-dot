import { BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector3 } from 'three'
import { particleMaterial } from './materials'
import type { Body } from '../world'

/** 0: free flight with drag. 1: stardust that homes onto the comet. 2: falls onto a body and bounces. */
export const enum Mode { Free = 0, Dust = 1, Fall = 2 }

const tmp = new Vector3()

export class Particles {
  readonly points: Points
  readonly mat: ShaderMaterial
  alive = 0
  private pos: Float32Array
  private col: Float32Array
  private size: Float32Array
  private alpha: Float32Array
  private vel: Float32Array
  private baseCol: Float32Array
  private life: Float32Array
  private max: Float32Array
  private drag: Float32Array
  private baseSize: Float32Array
  private value: Float32Array
  private mode: Uint8Array
  private bodyOf: (Body | null)[]
  private geo: BufferGeometry

  constructor(readonly capacity = 6000) {
    const N = capacity
    this.pos = new Float32Array(N * 3)
    this.col = new Float32Array(N * 3)
    this.size = new Float32Array(N)
    this.alpha = new Float32Array(N)
    this.vel = new Float32Array(N * 3)
    this.baseCol = new Float32Array(N * 3)
    this.life = new Float32Array(N)
    this.max = new Float32Array(N)
    this.drag = new Float32Array(N)
    this.baseSize = new Float32Array(N)
    this.value = new Float32Array(N)
    this.mode = new Uint8Array(N)
    this.bodyOf = new Array(N).fill(null)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(this.pos, 3))
    g.setAttribute('aColor', new BufferAttribute(this.col, 3))
    g.setAttribute('aSize', new BufferAttribute(this.size, 1))
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1))
    g.setDrawRange(0, 0)
    this.geo = g
    this.mat = particleMaterial()
    this.points = new Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 5
  }

  emit(
    p: Vector3, v: Vector3, r: number, g: number, b: number,
    life: number, size: number, drag = 1.5, mode: Mode = Mode.Free, body: Body | null = null, value = 0,
  ): void {
    if (this.alive >= this.capacity) return
    const i = this.alive++
    const i3 = i * 3
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z
    this.baseCol[i3] = r; this.baseCol[i3 + 1] = g; this.baseCol[i3 + 2] = b
    this.life[i] = life
    this.max[i] = life
    this.drag[i] = drag
    this.baseSize[i] = size
    this.mode[i] = mode
    this.bodyOf[i] = body
    this.value[i] = value
  }

  /** A sphere of sparks. */
  burst(p: Vector3, count: number, r: number, g: number, b: number, speed: number, life: number, size: number, body: Body | null = null, mode: Mode = Mode.Free) {
    for (let k = 0; k < count; k++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
      if (tmp.lengthSq() > 1) { k--; continue }
      tmp.normalize().multiplyScalar(speed * (0.3 + Math.random() * 0.9))
      const j = 0.75 + Math.random() * 0.5
      this.emit(p, tmp, r * j, g * j, b * j, life * (0.5 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8), 1.8, mode, body)
    }
  }

  /** Sparks thrown up and out across a surface, so they rain back down. */
  fountain(p: Vector3, up: Vector3, count: number, r: number, g: number, b: number, speed: number, spread: number, life: number, size: number, body: Body | null) {
    for (let k = 0; k < count; k++) {
      tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).multiplyScalar(spread)
      tmp.addScaledVector(up, 1).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8))
      this.emit(p, tmp, r, g, b, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.7), 0.4, Mode.Fall, body)
    }
  }

  /**
   * Step every particle. Stardust within `magnet` of `target` flies to it; `collect` gets its value on arrival.
   */
  update(dt: number, target: Vector3 | null, magnet: number, collect: (value: number) => void) {
    const pos = this.pos
    const vel = this.vel
    let i = 0
    while (i < this.alive) {
      this.life[i] -= dt
      if (this.life[i] <= 0) { this.kill(i); continue }
      const i3 = i * 3
      const mode = this.mode[i]
      const d = Math.exp(-this.drag[i] * dt)
      if (mode === Mode.Dust && target) {
        const dx = target.x - pos[i3], dy = target.y - pos[i3 + 1], dz = target.z - pos[i3 + 2]
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < 0.7) {
          collect(this.value[i])
          this.kill(i)
          continue
        }
        if (dist < magnet) {
          const pull = 90 / Math.max(0.6, dist)
          vel[i3] += (dx / dist) * pull * dt
          vel[i3 + 1] += (dy / dist) * pull * dt
          vel[i3 + 2] += (dz / dist) * pull * dt
          vel[i3] *= 0.9; vel[i3 + 1] *= 0.9; vel[i3 + 2] *= 0.9
          this.life[i] = Math.max(this.life[i], 0.5)
        } else {
          vel[i3] *= d; vel[i3 + 1] *= d; vel[i3 + 2] *= d
        }
      } else {
        vel[i3] *= d; vel[i3 + 1] *= d; vel[i3 + 2] *= d
      }
      const body = this.bodyOf[i]
      if ((mode === Mode.Fall || mode === Mode.Dust) && body) {
        const cx = pos[i3] - body.center.x, cy = pos[i3 + 1] - body.center.y, cz = pos[i3 + 2] - body.center.z
        const r = Math.sqrt(cx * cx + cy * cy + cz * cz)
        const g = body.type.gravity * 0.7
        vel[i3] -= (cx / r) * g * dt
        vel[i3 + 1] -= (cy / r) * g * dt
        vel[i3 + 2] -= (cz / r) * g * dt
        const floor = body.radius + 0.12
        if (r < floor) {
          const nx = cx / r, ny = cy / r, nz = cz / r
          const vn = vel[i3] * nx + vel[i3 + 1] * ny + vel[i3 + 2] * nz
          if (vn < 0) {
            vel[i3] -= 1.5 * vn * nx; vel[i3 + 1] -= 1.5 * vn * ny; vel[i3 + 2] -= 1.5 * vn * nz
            vel[i3] *= 0.8; vel[i3 + 1] *= 0.8; vel[i3 + 2] *= 0.8
          }
          pos[i3] = body.center.x + nx * floor
          pos[i3 + 1] = body.center.y + ny * floor
          pos[i3 + 2] = body.center.z + nz * floor
        }
      }
      pos[i3] += vel[i3] * dt
      pos[i3 + 1] += vel[i3 + 1] * dt
      pos[i3 + 2] += vel[i3 + 2] * dt
      const k = this.life[i] / this.max[i]
      const fade = mode === Mode.Dust ? 0.6 + 0.4 * Math.min(1, k * 4) : Math.min(1, k * 1.6)
      this.alpha[i] = fade
      this.size[i] = this.baseSize[i] * (mode === Mode.Free ? 0.4 + 0.6 * k : 1)
      this.col[i3] = this.baseCol[i3]
      this.col[i3 + 1] = this.baseCol[i3 + 1]
      this.col[i3 + 2] = this.baseCol[i3 + 2]
      i++
    }
    const g = this.geo
    g.setDrawRange(0, this.alive)
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      const a = g.getAttribute(name) as BufferAttribute
      a.needsUpdate = true
      a.clearUpdateRanges()
      a.addUpdateRange(0, this.alive * a.itemSize)
    }
  }

  private kill(i: number) {
    const last = --this.alive
    if (i === last) return
    const i3 = i * 3
    const l3 = last * 3
    for (let k = 0; k < 3; k++) {
      this.pos[i3 + k] = this.pos[l3 + k]
      this.vel[i3 + k] = this.vel[l3 + k]
      this.baseCol[i3 + k] = this.baseCol[l3 + k]
    }
    this.life[i] = this.life[last]
    this.max[i] = this.max[last]
    this.drag[i] = this.drag[last]
    this.baseSize[i] = this.baseSize[last]
    this.mode[i] = this.mode[last]
    this.bodyOf[i] = this.bodyOf[last]
    this.value[i] = this.value[last]
  }

  clear() {
    this.alive = 0
    this.geo.setDrawRange(0, 0)
  }
}
