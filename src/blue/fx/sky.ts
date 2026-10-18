import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Points,
  SphereGeometry,
  Vector3,
} from 'three'
import { skyMaterial, starMaterial } from './materials'

const STREAKS = 260

/** Nebula, stars, and the warp streaks shown in flight. All of it follows the camera. */
export class Sky {
  readonly group = new Group()
  readonly nebula = skyMaterial()
  readonly stars = starMaterial()
  private streakGeo: BufferGeometry
  private streakMat: LineBasicMaterial
  private streakSeeds: Float32Array
  readonly streaks: LineSegments
  warp = 0

  constructor() {
    const dome = new Mesh(new SphereGeometry(1500, 32, 24), this.nebula)
    dome.renderOrder = -10
    dome.frustumCulled = false
    this.group.add(dome)

    const N = 3200
    const pos = new Float32Array(N * 3)
    const size = new Float32Array(N)
    const phase = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2
      // Denser along a galactic band.
      const band = Math.random() < 0.45 ? (Math.random() - 0.5) * 0.35 : Math.random() * 2 - 1
      const r = Math.sqrt(1 - band * band)
      const R = 1400
      pos[i * 3] = R * r * Math.cos(a)
      pos[i * 3 + 1] = R * band
      pos[i * 3 + 2] = R * r * Math.sin(a)
      size[i] = Math.random() < 0.04 ? 4 + Math.random() * 3 : 1.2 + Math.random() * 1.8
      phase[i] = Math.random()
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(pos, 3))
    g.setAttribute('aSize', new BufferAttribute(size, 1))
    g.setAttribute('aPhase', new BufferAttribute(phase, 1))
    const pts = new Points(g, this.stars)
    pts.frustumCulled = false
    pts.renderOrder = -9
    this.group.add(pts)

    this.streakGeo = new BufferGeometry()
    this.streakGeo.setAttribute('position', new BufferAttribute(new Float32Array(STREAKS * 6), 3))
    this.streakSeeds = new Float32Array(STREAKS * 3)
    for (let i = 0; i < STREAKS; i++) this.seedStreak(i, true)
    this.streakMat = new LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false })
    this.streaks = new LineSegments(this.streakGeo, this.streakMat)
    this.streaks.frustumCulled = false
  }

  private seedStreak(i: number, anywhere: boolean) {
    const a = Math.random() * Math.PI * 2
    const r = 3 + Math.random() * 22
    this.streakSeeds[i * 3] = Math.cos(a) * r
    this.streakSeeds[i * 3 + 1] = Math.sin(a) * r
    this.streakSeeds[i * 3 + 2] = anywhere ? -Math.random() * 160 : -160
  }

  /** `fwd`, `up` and `right` are the camera's axes; streaks rush past along `fwd`. */
  update(dt: number, time: number, camPos: Vector3, fwd: Vector3, up: Vector3, right: Vector3, speed: number) {
    this.group.position.copy(camPos)
    this.nebula.uniforms.uTime.value = time
    this.nebula.uniforms.uWarp.value = this.warp
    this.stars.uniforms.uTime.value = time
    this.streakMat.opacity = Math.min(1, this.warp) * 0.9
    this.streaks.visible = this.warp > 0.01
    if (!this.streaks.visible) return
    const arr = (this.streakGeo.getAttribute('position') as BufferAttribute).array as Float32Array
    const len = 2 + speed * 0.12 * this.warp
    for (let i = 0; i < STREAKS; i++) {
      this.streakSeeds[i * 3 + 2] += speed * dt * 1.6
      if (this.streakSeeds[i * 3 + 2] > 6) this.seedStreak(i, false)
      const x = this.streakSeeds[i * 3]
      const y = this.streakSeeds[i * 3 + 1]
      const z = -this.streakSeeds[i * 3 + 2]
      for (let k = 0; k < 2; k++) {
        const zz = z + (k === 0 ? 0 : len)
        const o = i * 6 + k * 3
        arr[o] = camPos.x + right.x * x + up.x * y + fwd.x * zz
        arr[o + 1] = camPos.y + right.y * x + up.y * y + fwd.y * zz
        arr[o + 2] = camPos.z + right.z * x + up.z * y + fwd.z * zz
      }
    }
    ;(this.streakGeo.getAttribute('position') as BufferAttribute).needsUpdate = true
  }
}
