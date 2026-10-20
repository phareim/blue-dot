import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three'
import { toTangent, walk } from './geo'
import { makeComet } from './fx/shapes'
import { dirTo } from './enemies'
import type { Body } from './world'

const tA = new Vector3()
const tB = new Vector3()
const basis = new Matrix4()

/** Rotate `v` about `n` toward tangent direction `d` by at most `max` radians. */
function turnToward(n: Vector3, v: Vector3, d: Vector3, max: number) {
  const ang = Math.atan2(tA.crossVectors(v, d).dot(n), v.dot(d))
  v.applyAxisAngle(n, Math.max(-max, Math.min(max, ang)))
}

export class Comet {
  readonly pos = new Vector3()
  readonly vel = new Vector3()
  /** Local up: the surface normal of the body below. */
  readonly n = new Vector3(0, 1, 0)
  readonly facing = new Vector3(0, 0, 1)
  /** Velocity along the ground while grounded. */
  readonly vt = new Vector3()
  body: Body | null = null
  grounded = true
  air = 0
  airJumps = 0
  readonly group: Group
  readonly halo: Mesh
  readonly chevron: Mesh
  private coreMat: MeshBasicMaterial
  private chevMat: MeshBasicMaterial
  private baseColor: Color

  constructor(color: Color) {
    const c = makeComet(color)
    this.group = c.group
    this.halo = c.halo
    this.chevron = c.chevron
    this.coreMat = c.coreMat
    this.chevMat = c.chevMat
    this.baseColor = color.clone()
  }

  place(body: Body, n: Vector3, facing: Vector3) {
    this.body = body
    this.n.copy(n).normalize()
    this.facing.copy(facing)
    toTangent(this.facing, this.n).normalize()
    this.vt.set(0, 0, 0)
    this.vel.set(0, 0, 0)
    this.grounded = true
    this.air = 0
    this.pos.copy(this.n).multiplyScalar(body.radius).add(body.center)
  }

  /** Point toward a tangent direction (pointer) or turn by `turn` (keyboard: −1 left … 1 right). */
  steer(dt: number, dir: Vector3 | null, turn: number, rate: number) {
    const max = rate * dt * (this.grounded ? 1 : 0.6)
    if (dir) turnToward(this.n, this.facing, dir, max)
    else if (turn !== 0) this.facing.applyAxisAngle(this.n, -turn * max)
    toTangent(this.facing, this.n).normalize()
    if (!this.grounded) {
      // Air control: swing the horizontal part of the velocity with the facing.
      const vn = this.vel.dot(this.n)
      tB.copy(this.vel).addScaledVector(this.n, -vn)
      const sp = tB.length()
      if (sp > 0.5) {
        tB.divideScalar(sp)
        turnToward(this.n, tB, this.facing, max * 0.8)
        this.vel.copy(tB).multiplyScalar(sp).addScaledVector(this.n, vn)
      }
    }
  }

  groundStep(dt: number, speed: number, grip: number) {
    if (!this.body) return
    const k = 1 - Math.exp(-grip * dt)
    this.vt.lerp(tA.copy(this.facing).multiplyScalar(speed), k)
    this.glide(dt)
  }

  /** Move over the ground with the velocity as it is. */
  glide(dt: number) {
    const body = this.body
    if (!body) return
    const sp = this.vt.length()
    if (sp > 1e-6) {
      tA.copy(this.vt).divideScalar(sp)
      walk(this.n, tA, (sp * dt) / body.radius, [this.facing, this.vt])
      toTangent(this.facing, this.n).normalize()
      toTangent(this.vt, this.n)
    }
    this.pos.copy(this.n).multiplyScalar(body.radius + body.groundHeight(this.n)).add(body.center)
  }

  /** Leave the ground (or jump again in the air). */
  jump(up: number) {
    if (this.grounded) {
      this.vel.copy(this.vt).addScaledVector(this.n, up)
      this.grounded = false
      this.air = 0
      return
    }
    const vn = this.vel.dot(this.n)
    this.vel.addScaledVector(this.n, Math.max(0, up - vn))
  }

  /** Ballistic flight among `bodies`. Returns the body landed on, if any, and how hard. */
  airStep(dt: number, bodies: readonly Body[], gravity: (p: Vector3, out: Vector3) => Vector3): { body: Body; impact: number } | null {
    this.air += dt
    gravity(this.pos, tA)
    this.vel.addScaledVector(tA, dt)
    this.pos.addScaledVector(this.vel, dt)
    let nearest: Body | null = null
    let best = Infinity
    for (const b of bodies) {
      const d = this.pos.distanceTo(b.center) - b.radius
      if (d < best) { best = d; nearest = b }
    }
    if (!nearest) return null
    this.n.copy(this.pos).sub(nearest.center).normalize()
    toTangent(this.facing, this.n)
    if (this.facing.lengthSq() < 1e-6) dirTo(this.n, tB.copy(this.vel).add(this.n), this.facing)
    this.facing.normalize()
    if (best <= nearest.groundHeight(this.n) && this.vel.dot(this.n) <= 0) {
      const impact = -this.vel.dot(this.n)
      this.body = nearest
      this.grounded = true
      this.vt.copy(this.vel).addScaledVector(this.n, -this.vel.dot(this.n))
      if (this.vt.length() > 1) this.facing.copy(this.vt).normalize()
      this.pos.copy(this.n).multiplyScalar(nearest.radius + nearest.groundHeight(this.n)).add(nearest.center)
      return { body: nearest, impact }
    }
    return null
  }

  /** Height above the ground right now. */
  get height(): number {
    if (!this.body) return 0
    return this.pos.distanceTo(this.body.center) - this.body.radius
  }

  render(camQuat: { x: number; y: number; z: number; w: number }, time: number, blaze: number, invulnerable: boolean, prism: boolean) {
    this.group.position.copy(this.pos).addScaledVector(this.n, 0.36)
    this.halo.position.copy(this.group.position)
    this.halo.quaternion.set(camQuat.x, camQuat.y, camQuat.z, camQuat.w)
    const blink = invulnerable ? (Math.sin(time * 40) > 0 ? 1 : 0.25) : 1
    const c = tA.set(this.baseColor.r, this.baseColor.g, this.baseColor.b)
    if (blaze > 0) c.lerp(tB.set(1, 0.55, 0.15), Math.min(1, blaze * 2))
    if (prism) c.lerp(tB.set(0.4, 1, 0.95), 0.4)
    this.coreMat.color.setRGB(c.x * 4 * blink + 1, c.y * 4 * blink + 1, c.z * 4 * blink + 1)
    const hu = (this.halo.material as unknown as { uniforms: { uColor: { value: Color }; uI: { value: number } } }).uniforms
    hu.uColor.value.setRGB(c.x, c.y, c.z)
    hu.uI.value = (1.3 + blaze * 2) * blink
    this.halo.scale.setScalar(2.3 + blaze * 2.4 + Math.sin(time * 9) * 0.12)
    // Chevron just ahead, flat on the ground.
    const body = this.body
    if (body && this.grounded) {
      this.chevron.visible = true
      this.chevron.position.copy(this.pos).addScaledVector(this.facing, 1.05).addScaledVector(this.n, 0.12)
      tB.crossVectors(this.n, this.facing)
      basis.makeBasis(tB, this.n, this.facing)
      this.chevron.quaternion.setFromRotationMatrix(basis)
      this.chevMat.color.setRGB(c.x * 1.6, c.y * 1.6, c.z * 1.6)
    } else {
      this.chevron.visible = false
    }
  }
}
