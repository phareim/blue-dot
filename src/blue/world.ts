import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  ShaderMaterial,
  SphereGeometry,
  UnsignedByteType,
  Vector3,
} from 'three'
import { FIRST_SYSTEM, LATER_TYPES, PALETTE, PLANETS, type PlanetType } from './config'
import { EquirectGrid, paintCap, paintLoop, randomDir, rng, type LoopShape } from './geo'
import { RING_SLOTS, atmosphereMaterial, glowMaterial, planetMaterial, sunMaterial } from './fx/materials'

export const GRID = new EquirectGrid(512, 256)
const UP = new Vector3(0, 1, 0)

export interface Ring {
  dir: Vector3
  angle: number
  speed: number
  width: number
  color: Color
  intensity: number
  life: number
  age: number
}

export interface Vent {
  n: Vector3
  timer: number
  state: 'idle' | 'rumble' | 'erupt'
  mesh: Mesh
}

export interface Moon {
  mesh: Mesh
  axis: Vector3
  ref: Vector3
  angle: number
  speed: number
  dist: number
  radius: number
  pos: Vector3
  sub: Vector3
}

export interface Wave {
  dir: Vector3
  front: number
  id: number
  next: number
  active: boolean
}

export const WAVE = { amp: 1.15, speed: 1.05, width: 0.16, every: 5.5 }
export const VENT = { radius: 1.35, idle: [3.5, 7], rumble: 1.1, erupt: 1.3, launch: 21 }

let bodyIds = 0

export class Body {
  readonly id = bodyIds++
  readonly group = new Group()
  readonly mask = new Uint8Array(GRID.width * GRID.height)
  readonly tex: DataTexture
  readonly mat: ShaderMaterial
  readonly atmo: ShaderMaterial
  readonly mu: number
  painted = 0
  rings: Ring[] = []
  vents: Vent[] = []
  moon: Moon | null = null
  wave: Wave | null = null
  readonly sunDir = new Vector3()

  constructor(
    readonly type: PlanetType,
    readonly world: World,
    readonly center: Vector3,
    readonly radius: number,
    seed: number,
  ) {
    this.mu = type.gravity * radius * radius
    this.tex = new DataTexture(this.mask, GRID.width, GRID.height, RedFormat, UnsignedByteType)
    this.tex.wrapS = RepeatWrapping
    this.tex.wrapT = ClampToEdgeWrapping
    this.tex.magFilter = LinearFilter
    this.tex.minFilter = LinearFilter
    this.tex.generateMipmaps = false
    this.tex.needsUpdate = true
    this.mat = planetMaterial(type, this.tex, seed, new Color(PALETTE.paint))
    const segs = radius > 8 ? [112, 80] : [80, 56]
    const surface = new Mesh(new SphereGeometry(radius, segs[0], segs[1]), this.mat)
    this.group.add(surface)
    this.atmo = atmosphereMaterial(type.colors.atmo)
    const atmo = new Mesh(new SphereGeometry(radius * 1.1, 64, 40), this.atmo)
    atmo.renderOrder = 2
    this.group.add(atmo)
    this.group.position.copy(center)
    const r = rng(seed * 7 + 3)
    if (type.feature === 'geysers') this.makeVents(r)
    if (type.feature === 'tide') this.makeMoon(r)
    if (type.feature === 'waves') this.wave = { dir: new Vector3(0, 1, 0), front: -1, id: 0, next: 2.5, active: false }
  }

  private makeVents(r: () => number) {
    const geo = new CircleGeometry(1, 28)
    for (let i = 0; i < 8; i++) {
      const n = randomDir(r, new Vector3())
      const mesh = new Mesh(geo, new MeshBasicMaterial({ color: new Color(1, 0.35, 0.05), transparent: true, blending: AdditiveBlending, depthWrite: false }))
      mesh.position.copy(n).multiplyScalar(this.radius + 0.04)
      mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n)
      mesh.scale.setScalar(VENT.radius)
      this.group.add(mesh)
      this.vents.push({ n, timer: VENT.idle[0] + r() * (VENT.idle[1] - VENT.idle[0]), state: 'idle', mesh })
    }
  }

  private makeMoon(r: () => number) {
    const radius = 2.3
    const mat = new ShaderMaterial({
      uniforms: { uSun: { value: this.sunDir } },
      vertexShader: `varying vec3 vN; void main(){ vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uSun; varying vec3 vN; void main(){ float d = max(dot(normalize(vN), normalize(uSun)), 0.0); gl_FragColor = vec4(vec3(0.75,0.95,0.9)*(0.08 + d*1.1), 1.0); }`,
    })
    const mesh = new Mesh(new SphereGeometry(radius, 40, 28), mat)
    this.group.add(mesh)
    const axis = randomDir(r, new Vector3())
    axis.lerp(UP, 0.6).normalize()
    const ref = new Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize()
    this.moon = { mesh, axis, ref, angle: r() * 6.28, speed: 0.55, dist: this.radius + 8.5, radius, pos: new Vector3(), sub: new Vector3() }
  }

  coverage(): number {
    return this.painted / GRID.totalWeight
  }

  paintShape(shape: LoopShape): number {
    const gained = paintLoop(GRID, this.mask, shape)
    if (gained > 0) this.tex.needsUpdate = true
    this.painted += gained
    return gained / GRID.totalWeight
  }

  paintSplat(dir: Vector3, angle: number): number {
    const gained = paintCap(GRID, this.mask, dir, angle)
    if (gained > 0) this.tex.needsUpdate = true
    this.painted += gained
    return gained / GRID.totalWeight
  }

  addRing(dir: Vector3, opts: Partial<Omit<Ring, 'dir' | 'age'>> & { color: Color }): Ring {
    if (this.rings.length >= RING_SLOTS) {
      // Replace the oldest finite ring.
      let oldest = -1
      for (let i = 0; i < this.rings.length; i++) if (this.rings[i].life !== Infinity && (oldest < 0 || this.rings[i].age > this.rings[oldest].age)) oldest = i
      if (oldest < 0) return this.rings[0]
      this.rings.splice(oldest, 1)
    }
    const ring: Ring = {
      dir: dir.clone().normalize(),
      angle: opts.angle ?? 0,
      speed: opts.speed ?? 1.2,
      width: opts.width ?? 0.05,
      color: opts.color,
      intensity: opts.intensity ?? 2,
      life: opts.life ?? 0.8,
      age: 0,
    }
    this.rings.push(ring)
    return ring
  }

  removeRing(ring: Ring) {
    const i = this.rings.indexOf(ring)
    if (i >= 0) this.rings.splice(i, 1)
  }

  /** Height of the ground above the sphere at direction `n` (jelly waves). */
  groundHeight(n: Vector3): number {
    const w = this.wave
    if (!w || !w.active) return 0
    const a = Math.acos(Math.max(-1, Math.min(1, n.dot(w.dir))))
    const d = (a - w.front) / WAVE.width
    return WAVE.amp * Math.exp(-d * d)
  }

  update(dt: number, time: number, beat: number, sunPos: Vector3, camQuat: Quaternion) {
    this.sunDir.copy(sunPos).sub(this.center).normalize()
    const u = this.mat.uniforms
    u.uTime.value = time
    u.uBeat.value = beat
    ;(u.uSunDir.value as Vector3).copy(this.sunDir)
    this.atmo.uniforms.uBeat.value = beat
    this.atmo.uniforms.uLit.value = u.uLit.value
    // Rings → uniforms
    const rs = u.uRings.value as { set: (x: number, y: number, z: number, w: number) => void }[]
    const rc = u.uRingCol.value as { set: (x: number, y: number, z: number, w: number) => void }[]
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]
      r.age += dt
      r.angle += r.speed * dt
      if (r.age >= r.life || r.angle > Math.PI) this.rings.splice(i, 1)
    }
    for (let i = 0; i < RING_SLOTS; i++) {
      const r = this.rings[i]
      if (!r) { rc[i].set(0, 0, 0, 0); continue }
      const fade = r.life === Infinity ? 1 : Math.pow(1 - r.age / r.life, 1.5)
      const k = r.intensity * fade
      rs[i].set(r.dir.x, r.dir.y, r.dir.z, r.angle)
      rc[i].set(r.color.r * k, r.color.g * k, r.color.b * k, r.width)
    }
    for (const v of this.vents) {
      v.timer -= dt
      if (v.timer <= 0) {
        if (v.state === 'idle') { v.state = 'rumble'; v.timer = VENT.rumble }
        else if (v.state === 'rumble') { v.state = 'erupt'; v.timer = VENT.erupt }
        else { v.state = 'idle'; v.timer = VENT.idle[0] + Math.random() * (VENT.idle[1] - VENT.idle[0]) }
      }
      const m = v.mesh.material as MeshBasicMaterial
      const pulse = v.state === 'rumble' ? 0.6 + 0.4 * Math.sin(time * 40) : v.state === 'erupt' ? 1 : 0.18 + beat * 0.1
      m.color.setRGB(1.6 * pulse + 0.15, 0.5 * pulse + 0.05, 0.08 * pulse)
    }
    if (this.moon) {
      const m = this.moon
      m.angle += m.speed * dt
      const b = new Vector3().crossVectors(m.axis, m.ref)
      m.sub.copy(m.ref).multiplyScalar(Math.cos(m.angle)).addScaledVector(b, Math.sin(m.angle)).normalize()
      m.mesh.position.copy(m.sub).multiplyScalar(m.dist)
      m.pos.copy(m.mesh.position).add(this.center)
    }
    const w = this.wave
    if (w) {
      w.next -= dt
      if (w.active) {
        w.front += WAVE.speed * dt
        if (w.front > Math.PI + 0.3) w.active = false
      } else if (w.next <= 0) {
        w.active = true
        w.front = -0.2
        w.id++
        w.next = WAVE.every
        randomDir(Math.random, w.dir)
      }
      u.uWaveAmp.value = w.active ? WAVE.amp : 0
      u.uWaveFront.value = w.front
      ;(u.uWaveDir.value as Vector3).copy(w.dir)
    }
    void camQuat
  }
}

export class World {
  bodies: Body[] = []
  lit = false
  litT = 0
  constructor(readonly index: number, readonly type: PlanetType, readonly paintTarget: number) {}

  get name() { return this.type.name }

  coverage(): number {
    let sum = 0
    let total = 0
    for (const b of this.bodies) {
      const w = b.radius * b.radius
      sum += b.coverage() * w
      total += w
    }
    return total > 0 ? sum / total : 0
  }

  /** A point a little outside the world, used as a flight target. */
  get center(): Vector3 {
    if (this.bodies.length === 1) return this.bodies[0].center
    return this.bodies[0].center.clone().add(this.bodies[1].center).multiplyScalar(0.5)
  }
}

export class StarSystem {
  readonly group = new Group()
  readonly worlds: World[] = []
  readonly bodies: Body[] = []
  readonly sunPos = new Vector3(0, 0, 0)
  readonly sunRadius = 34
  readonly sunMat = sunMaterial()
  readonly sunGlow: Mesh
  readonly sun: Mesh

  constructor(readonly index: number, readonly seed: number) {
    const r = rng(seed)
    this.sun = new Mesh(new SphereGeometry(this.sunRadius, 64, 48), this.sunMat)
    this.group.add(this.sun)
    const hue = [new Color('#ffb347'), new Color('#ff6a3d'), new Color('#9fd4ff'), new Color('#ff7ad9')][index % 4]
    this.sunMat.uniforms.uColor.value = hue
    this.sunGlow = new Mesh(new PlaneGeometry(1, 1), glowMaterial(hue.clone().multiplyScalar(2.2), 1))
    this.sunGlow.scale.setScalar(this.sunRadius * 7)
    this.group.add(this.sunGlow)

    const types = this.pickTypes(r)
    let angle = r() * Math.PI * 2
    for (let i = 0; i < types.length; i++) {
      const type = PLANETS[types[i]]
      const target = Math.min(0.5, type.paintTarget + index * 0.03)
      const world = new World(i, type, target)
      const dist = 150 + i * 46 + r() * 12
      angle += 0.95 + r() * 0.35
      const c = new Vector3(Math.cos(angle) * dist, (r() - 0.5) * 60, Math.sin(angle) * dist)
      if (type.feature === 'twin') {
        const axis = new Vector3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize()
        const off = type.radius + 1.9
        world.bodies.push(new Body(type, world, c.clone().addScaledVector(axis, off), type.radius, seed + i * 31))
        world.bodies.push(new Body(type, world, c.clone().addScaledVector(axis, -off), type.radius, seed + i * 31 + 17))
      } else {
        world.bodies.push(new Body(type, world, c, type.radius, seed + i * 31))
      }
      for (const b of world.bodies) {
        this.bodies.push(b)
        this.group.add(b.group)
      }
      this.worlds.push(world)
    }
  }

  private pickTypes(r: () => number): string[] {
    if (this.index === 0) return FIRST_SYSTEM.slice()
    const count = Math.min(6, 4 + this.index)
    const pool = LATER_TYPES.slice()
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    if (this.index === 1) {
      // The second system introduces what the first one did not have.
      const fresh = ['bloom', 'gemini', 'tide']
      return fresh.concat(pool.filter((t) => !fresh.includes(t))).slice(0, count)
    }
    return pool.slice(0, count)
  }

  update(dt: number, time: number, beat: number, camQuat: Quaternion) {
    this.sunMat.uniforms.uTime.value = time
    this.sunGlow.quaternion.copy(camQuat)
    for (const b of this.bodies) b.update(dt, time, beat, this.sunPos, camQuat)
  }

  /** Sum of every body's gravity at `p`, written to `out`. */
  gravityAt(p: Vector3, out: Vector3, bodies: readonly Body[] = this.bodies): Vector3 {
    out.set(0, 0, 0)
    for (const b of bodies) {
      const dx = b.center.x - p.x
      const dy = b.center.y - p.y
      const dz = b.center.z - p.z
      const d2 = dx * dx + dy * dy + dz * dz
      const d = Math.sqrt(d2)
      const a = b.mu / Math.max(d2, b.radius * b.radius)
      out.x += (dx / d) * a
      out.y += (dy / d) * a
      out.z += (dz / d) * a
    }
    return out
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as Mesh
      if (m.geometry) m.geometry.dispose()
      const mat = m.material as { dispose?: () => void } | undefined
      if (mat && mat.dispose) mat.dispose()
    })
    for (const b of this.bodies) b.tex.dispose()
  }
}
