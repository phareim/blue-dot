import { PerspectiveCamera, Vector3 } from 'three'
import { anyTangent, toTangent } from './geo'

const tA = new Vector3()
const tB = new Vector3()

/**
 * The surface view looks almost straight down at the comet. Its screen-up vector is carried along the
 * sphere without turning with the comet, so a direction on screen stays the same direction on the ground:
 * that is what lets the comet steer toward a finger.
 */
export class CamRig {
  readonly camera: PerspectiveCamera
  /** Screen-up on the surface (a tangent vector). */
  readonly screenUp = new Vector3(0, 0, -1)
  private pos = new Vector3(0, 40, 80)
  private look = new Vector3()
  private up = new Vector3(0, 1, 0)
  private ahead = new Vector3()
  private trauma = 0
  private fov = 55
  fovKick = 0
  /** Extra distance, for big moments. */
  pull = 0

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(55, aspect, 0.1, 4000)
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount)
  }

  /** How far above the surface to sit so the play area fits the screen. */
  surfaceDistance(radius: number): number {
    const tan = Math.tan((this.camera.fov * Math.PI) / 360)
    const a = this.camera.aspect
    const d = Math.max(7.5 / tan, 7.8 / (tan * Math.min(a, 1.25)))
    const scale = Math.sqrt(Math.min(1.1, Math.max(0.55, radius / 11)))
    return Math.min(d * scale, radius * 3.4 + 8)
  }

  surface(dt: number, p: Vector3, n: Vector3, facing: Vector3, radius: number, snap = false) {
    toTangent(this.screenUp, n)
    if (this.screenUp.lengthSq() < 0.04) anyTangent(n, this.screenUp)
    this.screenUp.normalize()
    const k = snap ? 1 : 1 - Math.exp(-dt * 6)
    this.ahead.lerp(tA.copy(facing).multiplyScalar(2.6), 1 - Math.exp(-dt * 2.5))
    toTangent(this.ahead, n)
    const D = this.surfaceDistance(radius) + this.pull
    const tilt = 0.2
    const target = tB.copy(p).add(this.ahead)
    const want = tA.copy(target).addScaledVector(n, D * Math.cos(tilt)).addScaledVector(this.screenUp, -D * Math.sin(tilt))
    this.pos.lerp(want, k)
    this.look.lerp(target, k)
    this.up.lerp(this.screenUp, k).normalize()
    this.fovTo(dt, 55)
  }

  flight(dt: number, p: Vector3, t: Vector3, upv: Vector3, k = 1 - Math.exp(-dt * 5)) {
    const want = tA.copy(p).addScaledVector(t, -9).addScaledVector(upv, 3.2)
    this.pos.lerp(want, k)
    this.look.lerp(tB.copy(p).addScaledVector(t, 16), k)
    this.up.lerp(upv, k).normalize()
    this.fovTo(dt, 74)
  }

  orbit(dt: number, center: Vector3, dist: number, time: number) {
    const a = time * 0.08
    const want = tA.set(Math.cos(a) * dist, dist * 0.35, Math.sin(a) * dist).add(center)
    const k = 1 - Math.exp(-dt * 1.5)
    this.pos.lerp(want, k)
    this.look.lerp(center, k)
    this.up.lerp(tB.set(0, 1, 0), k).normalize()
    this.fovTo(dt, 50)
  }

  /** Set the frame directly (for cuts). */
  jumpTo(pos: Vector3, look: Vector3, up: Vector3) {
    this.pos.copy(pos)
    this.look.copy(look)
    this.up.copy(up)
  }

  private fovTo(dt: number, f: number) {
    this.fov += (f + this.fovKick - this.fov) * (1 - Math.exp(-dt * 4))
  }

  apply(dt: number, time: number) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6)
    this.fovKick = Math.max(0, this.fovKick - dt * 10)
    const c = this.camera
    c.position.copy(this.pos)
    c.up.copy(this.up)
    c.lookAt(this.look)
    const s = this.trauma * this.trauma
    if (s > 0) {
      const amp = s * 1.4
      c.translateX(Math.sin(time * 61.3) * amp * 0.6 + Math.sin(time * 23.1) * amp * 0.4)
      c.translateY(Math.cos(time * 57.9) * amp * 0.6 + Math.sin(time * 31.7) * amp * 0.4)
      c.rotateZ(Math.sin(time * 41.0) * s * 0.035)
    }
    if (Math.abs(c.fov - this.fov) > 0.01) {
      c.fov = this.fov
      c.updateProjectionMatrix()
    }
  }
}
