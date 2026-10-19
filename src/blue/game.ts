import {
  ACESFilmicToneMapping,
  Color,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three'
import {
  BOONS,
  ENEMIES,
  PALETTE,
  PLAYER,
  POWERS,
  SCORE,
  TOUCH,
  TRAIL,
  baseStats,
  enemyMix,
  type Boon,
  type EnemyKind,
  type PowerKind,
  type RunStats,
} from './config'
import { anyTangent, insideLoopV, makeLoopShape, randomDir, sampleMask, toTangent, type LoopHit, type LoopShape } from './geo'
import { CamRig } from './camera'
import { Comet } from './player'
import { Swarm, dirTo, type Enemy, type SwarmContext } from './enemies'
import { LoopFlash, Trail } from './trail'
import { Flight, FLIGHT_STEP, type FlightTarget } from './flight'
import { GRID, StarSystem, VENT, WAVE, type Body, type World } from './world'
import { Particles, Mode } from './fx/particles'
import { Post } from './fx/post'
import { Sky } from './fx/sky'
import { makeLaunchStar, makeOrb, makeShockRing, makeSingularity } from './fx/shapes'
import { Sound } from './audio'
import { Input } from './input'
import { Overlay } from './overlay'
import { Store, loadBest, saveBest, type HudState } from './store'

type Mode_ = 'title' | 'intro' | 'play' | 'launch' | 'flight' | 'nova' | 'dying' | 'over'

interface PowerOrb {
  kind: PowerKind
  body: Body
  n: Vector3
  age: number
  view: ReturnType<typeof makeOrb>
}

interface FlightOrb {
  boon: Boon
  pos: Vector3
  view: ReturnType<typeof makeOrb>
  x: number
}

interface Echo {
  at: number
  body: Body
  shape: LoopShape
}

const tA = new Vector3()
const tB = new Vector3()
const tC = new Vector3()
const tQ = new Quaternion()
const right = new Vector3()
const camUp = new Vector3()
const camFwd = new Vector3()
const loopVerts: Vector3[] = Array.from({ length: 800 }, () => new Vector3())
/** How far the comet can drift sideways off its flight path; a pointer at the screen's edge is the full reach. */
const FLIGHT_REACH = 8
/** No damage for this long after landing on a world. */
const LANDING_GRACE = 2

export class Game {
  readonly renderer: WebGLRenderer
  readonly scene = new Scene()
  readonly rig: CamRig
  readonly post: Post
  readonly sky = new Sky()
  readonly sound = new Sound()
  readonly input: Input
  readonly overlay: Overlay
  readonly store: Store
  system: StarSystem
  readonly comet: Comet
  readonly clones: Comet[]
  readonly trails: Trail[]
  readonly flashes: LoopFlash[]
  readonly swarm = new Swarm()
  readonly particles = new Particles(6000)
  private star = makeLaunchStar()
  private singularityView = makeSingularity()
  private novaRing = makeShockRing()
  private readonly novaCam = new Vector3()

  private mode: Mode_ = 'title'
  private paused = false
  private resizeObserver: ResizeObserver
  private raf = 0
  private last = 0
  private time = 0
  private dpr = 1
  private maxDpr = 2
  private frameTimes: number[] = []
  private qualityCooldown = 0
  private hudTimer = 0

  // Run state
  private stats: RunStats = baseStats()
  private score = 0
  private shownScore = 0
  private hearts = PLAYER.hearts
  private chain = 0
  private chainTimer = 0
  private flux = 0
  private blaze = 0
  private invulnerable = 0
  private worldIdx = 0
  private heat = 0
  private spawnTimer = 0
  private swarmTimer = 0
  private gemTimer = 0
  private powerTimer = 0
  private orbs: PowerOrb[] = []
  private launchOn = false
  private readonly launchN = new Vector3()
  private launchBody: Body | null = null
  private launchT = 0
  private flight: Flight | null = null
  private flightOrbs: FlightOrb[] = []
  private orbsResolved = false
  private boonCounts = new Map<string, number>()
  private singularity: { body: Body; n: Vector3; life: number; strength: number } | null = null
  private prism = 0
  private readonly prismAxis = new Vector3()
  private chrono = 0
  private echoes: Echo[] = []
  private hitStop = 0
  private slow = 1
  private slowTimer = 0
  private stateTimer = 0
  private waveSeen = -1
  private summaryStats = { captured: 0, biggestLoop: 0, worlds: 0, started: 0 }
  /** The finger's spin: the heading on screen (x right, y down), whether it is set, and movement not yet past the dead zone. */
  private spin = { x: 0, y: 0, on: false, ax: 0, ay: 0 }

  constructor(private canvas: HTMLCanvasElement, overlayRoot: HTMLElement, store: Store) {
    this.store = store
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    this.rig = new CamRig(w / Math.max(1, h))
    this.post = new Post(this.renderer, this.scene, this.rig.camera)
    const touch = window.matchMedia('(pointer: coarse)').matches
    this.maxDpr = Math.min(window.devicePixelRatio || 1, touch ? 1.6 : 1.75)
    this.dpr = this.maxDpr
    this.store.set({ touch })

    this.scene.add(this.sky.group)
    this.scene.add(this.sky.streaks)
    this.system = new StarSystem(0, 1337)
    this.scene.add(this.system.group)

    this.comet = new Comet(new Color(...PALETTE.comet))
    this.scene.add(this.comet.group, this.comet.halo, this.comet.chevron)
    this.clones = [0, 1].map(() => {
      const c = new Comet(new Color(0.4, 1, 0.95))
      c.group.visible = false
      c.halo.visible = false
      c.chevron.visible = false
      this.scene.add(c.group, c.halo, c.chevron)
      return c
    })
    const trailColor = new Color(...PALETTE.trail).multiplyScalar(1.6)
    const head = new Color(0.6, 1.0, 2.0)
    this.trails = [
      new Trail(trailColor, head),
      new Trail(new Color(0.3, 1.6, 1.4), head),
      new Trail(new Color(0.3, 1.6, 1.4), head),
    ]
    for (const t of this.trails) this.scene.add(t.mesh)
    this.flashes = Array.from({ length: 4 }, () => new LoopFlash(new Color(1.5, 2.2, 3.5)))
    for (const f of this.flashes) this.scene.add(f.mesh)
    this.scene.add(this.swarm.group)
    this.scene.add(this.particles.points)
    this.star.group.visible = false
    this.star.halo.visible = false
    this.scene.add(this.star.group, this.star.halo)
    this.star.group.add(this.star.beam)
    this.singularityView.group.visible = false
    this.scene.add(this.singularityView.group)
    this.novaRing.visible = false
    this.scene.add(this.novaRing)

    this.overlay = new Overlay(overlayRoot)
    this.input = new Input(canvas)
    this.input.onGesture = () => this.sound.unlock()
    this.input.onKey = (code) => this.onKey(code)
    window.addEventListener('resize', this.resize)
    document.addEventListener('visibilitychange', this.visibility)
    // Safari can run this before the stylesheet applies (the canvas is still 300×150), and its toolbars
    // change the height without a window resize: follow the canvas's own box.
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.resize()
    this.titleScene()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.visibility)
    this.input.dispose()
    this.overlay.dispose()
    this.sound.dispose()
    this.system.dispose()
    this.renderer.dispose()
  }

  // ---- public controls (HUD buttons) -------------------------------------------------------

  start() {
    this.sound.unlock()
    this.startRun()
  }

  togglePause(force?: boolean) {
    if (this.mode === 'title' || this.mode === 'over') return
    this.paused = force ?? !this.paused
    this.sound.setPlaying(!this.paused)
    this.store.set({ screen: this.paused ? 'paused' : 'play' })
    this.input.clearQueued()
  }

  setMuted(m: boolean) {
    this.sound.unlock()
    this.sound.setMuted(m)
    this.store.set({ muted: m })
  }

  toTitle() {
    this.paused = false
    this.titleScene()
  }

  private onKey(code: string) {
    if (code === 'KeyM') this.setMuted(!this.sound.muted)
    if (code === 'Escape' || code === 'KeyP') this.togglePause()
    if ((code === 'Enter' || code === 'Space') && (this.mode === 'title' || this.mode === 'over') && this.stateTimer > 0.6) this.start()
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.rig.camera.aspect = w / Math.max(1, h)
    this.rig.camera.updateProjectionMatrix()
    this.post.setSize(w, h, this.dpr)
    this.particles.mat.uniforms.uScale.value = h * this.dpr * 0.6
    this.sky.stars.uniforms.uScale.value = this.dpr
  }

  private visibility = () => {
    if (document.hidden && (this.mode === 'play' || this.mode === 'flight')) this.togglePause(true)
  }

  // ---- scenes ------------------------------------------------------------------------------

  private titleScene() {
    this.mode = 'title'
    this.stateTimer = 0
    this.resetSystem(0)
    this.swarm.clearBody(null)
    this.particles.clear()
    for (const t of this.trails) t.reset(null)
    this.comet.group.visible = false
    this.comet.halo.visible = false
    this.comet.chevron.visible = false
    this.overlay.clear()
    this.sound.setPlaying(false)
    const b = this.system.worlds[0].bodies[0]
    for (let i = 0; i < 26; i++) this.swarm.spawn(i % 5 === 0 ? 'hunter' : 'mite', b, randomDir(Math.random, new Vector3()), 0.1)
    this.store.set({ screen: 'title', summary: null })
  }

  private resetSystem(index: number) {
    this.scene.remove(this.system.group)
    this.system.dispose()
    this.system = new StarSystem(index, 1337 + index * 7919)
    this.scene.add(this.system.group)
    const pal = [
      ['#1a0b3a', '#06264a', '#3a0a2a'],
      ['#2a0830', '#0a1e40', '#401a08'],
      ['#06283a', '#1a0a40', '#082a1a'],
      ['#300a18', '#120a40', '#0a2a3a'],
    ][index % 4]
    const u = this.sky.nebula.uniforms
    ;(u.uA.value as Color).set(pal[0])
    ;(u.uB.value as Color).set(pal[1])
    ;(u.uC.value as Color).set(pal[2])
  }

  private startRun() {
    this.resetSystem(0)
    this.swarm.clearBody(null)
    this.particles.clear()
    this.clearPowers()
    this.stats = baseStats()
    this.boonCounts.clear()
    this.score = 0
    this.shownScore = 0
    this.hearts = PLAYER.hearts
    this.chain = 0
    this.chainTimer = 0
    this.flux = 0
    this.blaze = 0
    this.invulnerable = 0
    this.worldIdx = 0
    this.paused = false
    this.slow = 1
    this.hitStop = 0
    this.summaryStats = { captured: 0, biggestLoop: 0, worlds: 0, started: this.time }
    this.comet.group.visible = true
    this.comet.halo.visible = true
    this.overlay.clear()
    this.sound.setPlaying(true)
    this.sound.intensity = 1
    this.store.set({ screen: 'play', summary: null })
    // Arrive from deep space.
    const world = this.system.worlds[0]
    const body = world.bodies[0]
    const from = tA.copy(body.center).add(tB.set(0.4, 0.5, 1).normalize().multiplyScalar(90))
    this.beginFlight(from, tB.copy(body.center).sub(from).normalize().multiplyScalar(20), { center: body.center, radius: body.radius, body }, false)
    this.mode = 'intro'
  }

  private get world(): World {
    return this.system.worlds[this.worldIdx]
  }

  // ---- main loop ---------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const raw = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.trackQuality(raw)
    if (this.paused) {
      this.render(0)
      return
    }
    this.time += raw
    this.stateTimer += raw
    let dt = raw
    if (this.hitStop > 0) {
      this.hitStop -= raw
      dt = 0
    } else {
      if (this.slowTimer > 0) this.slowTimer -= raw
      else this.slow += (1 - this.slow) * (1 - Math.exp(-raw * 5))
      dt *= this.slow
    }
    switch (this.mode) {
      case 'title': this.updateTitle(dt); break
      case 'intro':
      case 'flight': this.updateFlight(dt); break
      case 'play': this.updatePlay(dt); break
      case 'launch': this.updateLaunch(dt); break
      case 'nova': this.updateNova(dt); break
      case 'dying': this.updateDying(dt); break
      case 'over': this.updateTitle(dt); break
    }
    this.render(dt)
    this.syncHud(raw)
  }

  private render(dt: number) {
    const beat = this.sound.beat()
    const cam = this.rig.camera
    this.rig.apply(dt, this.time)
    cam.updateMatrixWorld()
    const e = cam.matrixWorld.elements
    right.set(e[0], e[1], e[2])
    camUp.set(e[4], e[5], e[6])
    camFwd.set(-e[8], -e[9], -e[10])
    this.system.update(dt, this.time, beat, cam.quaternion)
    const lit = this.system.worlds
    for (const w of lit) {
      if (w.lit) w.litT = Math.min(1, w.litT + dt * 0.8)
      for (const b of w.bodies) b.mat.uniforms.uLit.value = w.litT
    }
    const hot = this.blaze > 0 ? 1 : 0
    for (let i = 0; i < this.trails.length; i++) {
      const head = i === 0 ? (this.comet.grounded && this.mode === 'play' ? this.comet.n : null) : this.prism > 0 && this.clones[i - 1].grounded ? this.clones[i - 1].n : null
      this.trails[i].update(head, this.time, beat, hot)
    }
    for (const f of this.flashes) f.update(dt, this.time)
    this.swarm.render(this.time)
    if (this.comet.group.visible) this.comet.render(cam.quaternion, this.time, this.blaze > 0 ? 1 : 0, this.invulnerable > 0, this.prism > 0)
    for (const c of this.clones) {
      const on = this.prism > 0 && this.mode === 'play'
      c.group.visible = on
      c.halo.visible = on
      if (on) c.render(cam.quaternion, this.time, 0, false, true)
      else c.chevron.visible = false
    }
    this.renderPowers(beat)
    const speed = this.flight ? this.flight.speedNow() : 0
    this.sky.warp += ((this.mode === 'flight' || this.mode === 'intro' ? 1 : 0) - this.sky.warp) * (1 - Math.exp(-dt * 3))
    this.sky.update(dt, this.time, cam.position, camFwd, camUp, right, speed)
    // Singularity lensing
    if (this.singularity) {
      const s = this.singularity
      const at = this.surfacePoint(s.body, s.n, 1.2, tA)
      // The shadow's radius on screen, as a fraction of the screen height.
      const dist = at.distanceTo(cam.position)
      const rs = (1.1 * Math.min(1, s.life, (6.5 - s.life) * 3)) / (dist * Math.tan((cam.fov * Math.PI) / 360)) * 0.5
      at.project(cam)
      this.post.lens.set(at.x * 0.5 + 0.5, at.y * 0.5 + 0.5, at.z < 1 ? Math.max(0, rs) : 0)
    } else this.post.lens.z = 0
    const chronoK = Math.min(1, this.chrono)
    const blazeK = this.blaze > 0 ? Math.min(1, this.blaze) : 0
    this.post.sat = 1.1 - chronoK * 0.6 + blazeK * 0.15
    this.post.tint.setRGB(1 + blazeK * 0.12 - chronoK * 0.1, 1 - chronoK * 0.02, 1 - blazeK * 0.12 + chronoK * 0.15)
    this.post.update(dt, this.time)
    this.post.render()
  }

  private trackQuality(raw: number) {
    if (raw <= 0) return
    this.frameTimes.push(raw)
    if (this.frameTimes.length < 90) return
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
    this.frameTimes.length = 0
    this.qualityCooldown -= 1
    if (this.qualityCooldown > 0) return
    if (avg > 0.024 && this.dpr > 0.75) {
      this.dpr = Math.max(0.75, this.dpr - 0.25)
      this.qualityCooldown = 2
      this.resize()
    } else if (avg < 0.0135 && this.dpr < this.maxDpr) {
      this.dpr = Math.min(this.maxDpr, this.dpr + 0.25)
      this.qualityCooldown = 4
      this.resize()
    }
  }

  private syncHud(raw: number) {
    this.shownScore += (this.score - this.shownScore) * (1 - Math.exp(-raw * 9))
    if (Math.abs(this.score - this.shownScore) < 1) this.shownScore = this.score
    this.hudTimer -= raw
    if (this.hudTimer > 0) return
    this.hudTimer = 1 / 15
    if (this.mode === 'title' || this.mode === 'over') return
    const w = this.world
    const patch: Partial<HudState> = {
      score: Math.round(this.shownScore),
      hearts: this.hearts,
      maxHearts: this.stats.maxHearts,
      chain: this.chainTimer > 0 ? this.chain : 0,
      mult: this.stats.mult,
      flux: this.blaze > 0 ? this.blaze / this.stats.blazeTime : this.flux,
      blaze: this.blaze > 0,
      paint: w ? w.coverage() : 0,
      target: w ? w.paintTarget : 0,
      worldName: w ? w.name : '',
      worldIndex: this.worldIdx,
      worldCount: this.system.worlds.length,
      system: this.system.index + 1,
      launchReady: this.launchOn,
      flying: this.mode === 'flight' || this.mode === 'intro',
    }
    this.store.set(patch)
  }

  // ---- title -------------------------------------------------------------------------------

  private updateTitle(dt: number) {
    const b = this.system.worlds[0].bodies[0]
    this.rig.orbit(dt, b.center, b.radius * 3.4, this.time)
    this.swarm.update(dt, this.swarmCtx(null))
    this.particles.update(dt, null, 0, () => {})
    if (this.input.consumePress() && this.stateTimer > 0.6 && this.mode === 'over') this.start()
    this.input.clearQueued()
  }

  // ---- surface play ------------------------------------------------------------------------

  private swarmCtx(body: Body | null): SwarmContext {
    return {
      body,
      playerN: this.comet.n,
      playerAir: !this.comet.grounded,
      trail: this.trails[0],
      timeScale: this.chrono > 0 ? 0.3 : 1,
      heat: this.heat,
      singularity: this.singularity,
      onCut: (seg, e) => this.cutTrail(this.trails[0], seg, e.n),
      onPulse: (e) => this.wardenPulse(e),
      onPop: (e) => this.popEnemy(e),
    }
  }

  private updatePlay(dt: number) {
    const c = this.comet
    const body = c.body!
    const world = this.world
    const stats = this.stats
    this.heat += dt
    this.timers(dt)

    // Steering: toward the mouse, by spinning the planet with a finger, or the keyboard.
    let dir: Vector3 | null = null
    const p = this.input.pointer
    const drag = this.input.consumeDrag()
    const s = this.spin
    if (p && this.input.pointerKind === 'touch') {
      // The ground follows the finger, so the comet heads against the finger's movement. The heading is kept
      // on screen, not on the sphere, so it stays put while the finger rests however far the comet travels.
      const leak = Math.exp(-dt / TOUCH.leak)
      s.ax = s.ax * leak + drag.x
      s.ay = s.ay * leak + drag.y
      const l = Math.hypot(s.ax, s.ay)
      if (l > TOUCH.deadPx) {
        const k = s.on ? 1 - Math.exp(-dt / TOUCH.smooth) : 1
        const x = s.x + (-s.ax / l - s.x) * k
        const y = s.y + (-s.ay / l - s.y) * k
        const m = Math.hypot(x, y)
        if (m > 1e-3) {
          s.x = x / m
          s.y = y / m
          s.on = true
        }
        s.ax = 0
        s.ay = 0
      }
      if (s.on) {
        dir = tB.copy(right).multiplyScalar(s.x).addScaledVector(camUp, -s.y)
        toTangent(dir, c.n)
        if (dir.lengthSq() > 1e-8) dir.normalize()
        else dir = null
      }
    } else {
      s.on = false
      s.ax = 0
      s.ay = 0
    }
    if (p && this.input.pointerKind === 'mouse') {
      tA.copy(c.pos).project(this.rig.camera)
      const sx = (tA.x * 0.5 + 0.5) * window.innerWidth
      const sy = (-tA.y * 0.5 + 0.5) * window.innerHeight
      const dx = p.x - sx
      const dy = p.y - sy
      if (dx * dx + dy * dy > 18 * 18) {
        dir = tB.copy(right).multiplyScalar(dx).addScaledVector(camUp, -dy)
        toTangent(dir, c.n)
        if (dir.lengthSq() > 1e-8) dir.normalize()
        else dir = null
      }
    }
    const turnRate = PLAYER.turn * stats.turn * (this.blaze > 0 ? 1.15 : 1) * (s.on ? TOUCH.turn : 1)
    c.steer(dt, dir, this.input.turn, turnRate)

    if (this.input.consumeJump()) {
      if (c.grounded) {
        c.jump(PLAYER.jump * stats.jump)
        c.airJumps = stats.doubleJump ? 1 : 0
        this.sound.jump()
        this.particles.burst(c.pos, 14, 0.5, 0.8, 2, 5, 0.4, 0.35, body, Mode.Fall)
      } else if (c.airJumps > 0) {
        c.airJumps--
        c.jump(PLAYER.jump * stats.jump * 0.9)
        this.sound.jump()
        this.particles.burst(c.pos, 20, 0.6, 1, 2.2, 7, 0.4, 0.4)
      }
    }

    const speed = PLAYER.speed * stats.speed * (this.blaze > 0 ? PLAYER.blazeSpeed : 1)
    if (c.grounded) {
      this.surfaceForces(dt, c, body)
      if (c.grounded) c.groundStep(dt, speed, body.type.grip)
    }
    if (!c.grounded) {
      const res = c.airStep(dt, world.bodies, (pp, out) => this.system.gravityAt(pp, out, world.bodies))
      if (res) this.onLand(res.body, res.impact)
      else if (c.air > 7 || c.pos.distanceTo(world.center) > 120) this.rescue()
    }

    // Trails and loops
    const trail = this.trails[0]
    trail.maxLength = TRAIL.length * stats.trail
    trail.snap = TRAIL.snap * stats.snap
    if (c.grounded) {
      if (trail.body !== c.body) trail.reset(c.body)
      const hit = trail.push(c.n)
      if (hit) this.closeLoop(trail, hit)
    }
    this.updateClones(dt)

    this.swarm.update(dt, this.swarmCtx(body))
    this.contacts(dt)
    this.spawnDirector(dt)
    this.updatePowers(dt)
    this.updateEchoes()
    this.exhaust(dt)
    this.particles.update(dt, c.pos, 4.5 * stats.magnet, (v) => this.gainFlux(v))

    // Ignition: enough of the world is painted.
    if (!this.launchOn && !world.lit && world.coverage() >= world.paintTarget) this.armLaunch()
    if (this.launchOn && this.launchBody === c.body && c.grounded && c.n.angleTo(this.launchN) * body.radius < 1.7) this.beginLaunch()

    this.ventFx(dt)
    this.rig.surface(dt, c.pos, c.n, c.facing, c.body!.radius)
    this.pointToStar()
  }

  /** Smoke from rumbling vents, fire from erupting ones. */
  private ventFx(dt: number) {
    const body = this.comet.body
    if (!body) return
    for (const v of body.vents) {
      if (v.state === 'idle') continue
      const p = this.surfacePoint(body, v.n, 0.2, tC)
      if (v.state === 'rumble') {
        if (Math.random() < dt * 30) this.particles.fountain(p, v.n, 1, 1.2, 0.4, 0.1, 4, 0.5, 0.6, 0.35, body)
      } else {
        this.particles.fountain(p, v.n, Math.ceil(dt * 110), 1.8, 0.45 + Math.random() * 0.45, 0.08, 19, 0.42, 1.2, 0.32, body)
      }
    }
  }

  private timers(dt: number) {
    if (this.chainTimer > 0) {
      this.chainTimer -= dt
      if (this.chainTimer <= 0) this.chain = 0
    }
    if (this.invulnerable > 0) this.invulnerable -= dt
    if (this.blaze > 0) {
      this.blaze -= dt
      if (this.blaze <= 0) {
        this.blaze = 0
        this.sound.intensity = 1
      }
    }
    if (this.chrono > 0) this.chrono -= dt
    if (this.prism > 0) {
      this.prism -= dt
      if (this.prism <= 0) {
        this.trails[1].reset(null)
        this.trails[2].reset(null)
      }
    }
    if (this.blaze <= 0) this.sound.intensity = this.chain >= 3 || this.swarm.live > 30 ? 2 : 1
  }

  /** Vents, waves, the tide moon and a singularity act on the comet while it is on the ground. */
  private surfaceForces(dt: number, c: Comet, body: Body) {
    for (const v of body.vents) {
      if (v.state === 'erupt' && c.n.angleTo(v.n) * body.radius < VENT.radius) {
        c.jump(VENT.launch)
        c.airJumps = this.stats.doubleJump ? 1 : 0
        this.rig.shake(0.35)
        this.sound.jump()
        this.callout('WHOOSH', c.pos, '#ffb070', 20)
        return
      }
    }
    const w = body.wave
    if (w && w.active && this.waveSeen !== w.id) {
      const a = Math.acos(Math.max(-1, Math.min(1, c.n.dot(w.dir))))
      if (Math.abs(a - w.front) < WAVE.width * 0.5) {
        this.waveSeen = w.id
        c.jump(11)
        c.airJumps = this.stats.doubleJump ? 1 : 0
        this.rig.shake(0.2)
        return
      }
    }
    if (body.moon) {
      const a = c.n.angleTo(body.moon.sub)
      if (a < 1.4 && dirTo(c.n, body.moon.sub, tA)) c.vt.addScaledVector(tA, 5 * (1 - a / 1.4) * dt)
    }
    const s = this.singularity
    if (s && s.body === body && dirTo(c.n, s.n, tA)) {
      const d = Math.max(0.6, c.n.angleTo(s.n) * body.radius)
      c.vt.addScaledVector(tA, (14 * s.strength * dt) / d)
    }
  }

  private onLand(body: Body, impact: number) {
    const c = this.comet
    if (body !== this.trails[0].body) this.trails[0].reset(body)
    else if (this.trails[0].count > 0 && this.trails[0].point(this.trails[0].count - 1).angleTo(c.n) * body.radius > 3) this.trails[0].reset(body)
    if (impact > 6) {
      this.sound.land(Math.min(1.5, impact / 14))
      this.rig.shake(Math.min(0.4, impact / 60))
      this.particles.fountain(c.pos, c.n, Math.min(40, Math.floor(impact * 2)), 0.6, 0.9, 2.2, impact * 0.35, 0.8, 0.7, 0.35, body)
      body.addRing(c.n, { color: new Color(0.6, 0.9, 2), speed: 0.9, width: 0.03, life: 0.5, intensity: Math.min(3, impact / 6) })
    }
  }

  private rescue() {
    const c = this.comet
    const body = this.world.bodies[0]
    const n = tA.copy(c.pos).sub(body.center).normalize()
    c.place(body, n, anyTangent(n, tB))
    this.trails[0].reset(body)
    this.rig.shake(0.3)
  }

  private updateClones(dt: number) {
    if (this.prism <= 0 || !this.comet.body) return
    const c = this.comet
    for (let i = 0; i < 2; i++) {
      const k = this.clones[i]
      tQ.setFromAxisAngle(this.prismAxis, ((i === 0 ? 1 : -1) * 5.5) / c.body!.radius)
      k.body = c.body
      k.n.copy(c.n).applyQuaternion(tQ)
      k.facing.copy(c.facing).applyQuaternion(tQ)
      k.grounded = c.grounded
      k.pos.copy(k.n).multiplyScalar(c.body!.radius + c.height).add(c.body!.center)
      const tr = this.trails[i + 1]
      tr.maxLength = TRAIL.length * this.stats.trail
      tr.snap = TRAIL.snap * this.stats.snap
      if (!k.grounded) continue
      if (tr.body !== k.body) tr.reset(k.body)
      const hit = tr.push(k.n)
      if (hit) this.closeLoop(tr, hit)
    }
    void dt
  }

  // ---- loops -------------------------------------------------------------------------------

  private closeLoop(trail: Trail, hit: LoopHit) {
    const body = trail.body!
    const count = trail.takeLoop(hit, loopVerts)
    const shape = makeLoopShape(loopVerts, count)
    if (!shape.ok || shape.area * body.radius * body.radius < 1.2) {
      this.particles.burst(tA.copy(this.comet.pos), 10, 0.5, 0.7, 1.6, 4, 0.3, 0.25)
      return
    }
    const flash = this.flashes.find((f) => !f.active) ?? this.flashes[0]
    flash.start(body, loopVerts, count, shape.center, 0.42)
    body.addRing(shape.center, { color: new Color(0.5, 0.9, 2.4), speed: 1.4, width: 0.045, life: 0.75, intensity: 3 })
    const gained = body.paintShape(shape)
    const caught = this.strike(body, shape, true)
    this.summaryStats.biggestLoop = Math.max(this.summaryStats.biggestLoop, caught)
    if (this.stats.echo) this.echoes.push({ at: this.time + 0.55, body, shape })
    // Paint points even when nothing was caught.
    const paintPts = Math.round(gained * 100 * SCORE.paintPerPercent * this.stats.mult)
    if (paintPts > 0) this.score += paintPts
    if (caught === 0 && paintPts > 0) this.callout(`+${paintPts}`, this.surfacePoint(body, shape.center, 0.5), '#7fb6ff', 18, `${(gained * 100).toFixed(1)}% painted`)
  }

  /** Catch everything inside `shape` on `body`. Returns how many enemies were caught. */
  private strike(body: Body, shape: LoopShape, primary: boolean): number {
    const caught: Enemy[] = []
    for (const e of this.swarm.list) {
      if (e.body !== body || (e.state !== 'live' && e.state !== 'spawn')) continue
      if (insideLoopV(shape, e.n)) caught.push(e)
    }
    for (const o of this.orbs.slice()) if (o.body === body && insideLoopV(shape, o.n)) this.takePower(o)
    // Arc lightning reaches out from the loop to the nearest enemies outside it.
    if (caught.length > 0 && this.stats.chainBolts > 0) {
      const extra = this.swarm.list
        .filter((e) => e.body === body && e.state === 'live' && !caught.includes(e))
        .sort((a, b) => a.n.angleTo(shape.center) - b.n.angleTo(shape.center))
        .slice(0, this.stats.chainBolts)
      for (const e of extra) {
        this.bolt(body, shape.center, e.n)
        caught.push(e)
      }
    }
    const n = caught.filter((e) => e.kind !== 'gem').length
    const gems = caught.length - n
    if (caught.length === 0) return 0
    if (primary) {
      this.chain = this.chainTimer > 0 ? this.chain + 1 : 1
      this.chainTimer = SCORE.chainWindow
    }
    const chain = Math.max(1, this.chain)
    const pts = Math.round((SCORE.perEnemy * n * n + SCORE.gem * gems) * chain * this.stats.mult)
    this.score += pts
    this.summaryStats.captured += n
    for (const e of caught) {
      this.swarm.capture(e, shape.center)
      if (e.kind === 'gem') this.gainFlux(ENEMIES.gem.flux)
    }
    this.celebrate(body, shape.center, n + gems * 3, pts, chain)
    return n
  }

  private celebrate(body: Body, center: Vector3, n: number, pts: number, chain: number) {
    const p = this.surfacePoint(body, center, 0.6)
    const label = n >= 15 ? 'GALAXY BRAIN' : n >= 10 ? 'SUPERMASSIVE' : n >= 7 ? 'MEGA LOOP' : n >= 4 ? 'SWARM' : n >= 2 ? 'DOUBLE' : ''
    const sub = [label ? `${label} ×${n}` : '', chain > 1 ? `CHAIN ${chain}` : ''].filter(Boolean).join(' · ')
    this.callout(`+${pts.toLocaleString('en-US')}`, p, n >= 7 ? '#ffffff' : '#9fdcff', Math.min(56, 22 + n * 3), sub)
    this.sound.capture(n, chain)
    this.rig.shake(Math.min(0.7, 0.12 + n * 0.05))
    this.post.ca = Math.min(1.2, 0.2 + n * 0.08)
    this.post.bloomBoost = Math.min(1.6, 0.2 + n * 0.12)
    tA.copy(p).project(this.rig.camera)
    if (tA.z < 1) this.post.shock(tA.x * 0.5 + 0.5, tA.y * 0.5 + 0.5, Math.min(1.6, 0.4 + n * 0.12))
    if (n >= 3) this.hitStop = Math.min(0.14, 0.04 + n * 0.012)
    if (n >= 7) {
      this.slow = 0.3
      this.slowTimer = 0.5
      this.post.flash = 0.35
      this.post.flashCol.setRGB(0.6, 0.8, 1)
      this.overlay.showCard(label, `${n} caught in one loop`, '#bfe6ff', 1400)
    }
  }

  private bolt(body: Body, from: Vector3, to: Vector3) {
    for (let i = 0; i <= 14; i++) {
      const k = i / 14
      tA.copy(from).lerp(to, k).normalize()
      const p = tB.copy(tA).multiplyScalar(body.radius + 0.4 + Math.sin(k * Math.PI) * 1.2).add(body.center)
      p.x += (Math.random() - 0.5) * 0.5
      p.y += (Math.random() - 0.5) * 0.5
      p.z += (Math.random() - 0.5) * 0.5
      this.particles.emit(p, tC.set(0, 0, 0), 1.6, 1.0, 3.2, 0.35, 0.5, 3)
    }
    body.addRing(to, { color: new Color(1.2, 0.8, 2.6), speed: 0.8, width: 0.03, life: 0.4, intensity: 2.5 })
  }

  private updateEchoes() {
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i]
      if (this.time < e.at) continue
      this.echoes.splice(i, 1)
      if (e.body !== this.comet.body) continue
      e.body.addRing(e.shape.center, { color: new Color(0.4, 2.2, 2.4), speed: 1.2, width: 0.05, life: 0.6, intensity: 3 })
      this.strike(e.body, e.shape, false)
    }
  }

  private cutTrail(trail: Trail, seg: number, at: Vector3) {
    if (!trail.body) return
    const p = this.surfacePoint(trail.body, at, 0.2)
    trail.cutAt(seg)
    this.particles.burst(p, 26, 2.4, 0.4, 0.5, 7, 0.45, 0.35, trail.body, Mode.Fall)
    this.sound.cut()
    this.callout('CUT', p, '#ff5a6a', 18)
  }

  private wardenPulse(e: Enemy) {
    const body = e.body
    body.addRing(e.n, { color: new Color(1.2, 0.5, 2.6), speed: 0.55, width: 0.05, life: 0.6, intensity: 2.6 })
    if (body !== this.comet.body) return
    const trail = this.trails[0]
    let cut = -1
    for (let i = 0; i < trail.count; i++) if (trail.point(i).angleTo(e.n) * body.radius < 3.6) cut = i
    if (cut >= 0) this.cutTrail(trail, Math.min(cut, trail.count - 2), e.n)
  }

  private popEnemy(e: Enemy) {
    const body = e.body
    const p = this.surfacePoint(body, e.n, 0.3 + e.alt)
    const [r, g, b] = e.def.color
    this.particles.burst(p, 26, r * 3, g * 3, b * 3, 9, 0.55, 0.4)
    this.particles.fountain(p, e.n, 10, r * 2, g * 2, b * 2, 6, 0.7, 1.1, 0.25, body)
    const dust = Math.max(2, Math.round(e.def.flux * 40))
    for (let i = 0; i < dust; i++) {
      tA.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5).addScaledVector(e.n, 6)
      this.particles.emit(p, tA, 0.6, 1.2, 2.6, 6, 0.32, 1.2, Mode.Dust, body, e.def.flux / dust)
    }
    this.sound.pop()
    if (e.kind === 'spore') {
      // Spores burst into a gem.
      this.swarm.spawn('gem', body, e.n, 0.3)
    }
  }

  // ---- contact -----------------------------------------------------------------------------

  private contacts(dt: number) {
    const c = this.comet
    const body = c.body
    if (!body) return
    const air = c.height
    const burnTrail = this.stats.emberTail || this.blaze > 0
    const trail = this.trails[0]
    for (const e of this.swarm.list) {
      if (e.body !== body || e.state !== 'live') continue
      if (burnTrail && trail.count > 3 && e.alt < 0.5) {
        const seg = trail.nearestSegment(e.n, (e.def.radius + TRAIL.width) / body.radius, 3)
        if (seg >= 0) {
          e.burn += dt
          e.flash = 1
          if (e.burn > (this.blaze > 0 ? 0.05 : 0.3)) this.kill(e, 'BURN')
          continue
        }
      }
      if (Math.abs(air - e.alt) > 1.1) continue
      const d = c.n.angleTo(e.n) * body.radius
      if (d > PLAYER.radius + e.def.radius * 0.75) continue
      if (e.kind === 'gem') {
        this.swarm.capture(e, c.n)
        this.score += SCORE.gem * this.stats.mult
        this.gainFlux(ENEMIES.gem.flux)
        this.callout(`+${SCORE.gem * this.stats.mult}`, c.pos, '#ffd34a', 22, 'GEM')
        this.sound.pickup()
        continue
      }
      if (this.blaze > 0) {
        this.kill(e, 'SMASH')
        continue
      }
      if (!e.def.harmful) {
        this.bump(e)
        continue
      }
      if (this.invulnerable > 0) continue
      this.damage(e)
      break
    }
  }

  /** Mites are bumpers: the comet glances off and the mite goes flying. Costs the chain, not a heart. */
  private bump(e: Enemy) {
    const c = this.comet
    const body = c.body!
    if (!dirTo(c.n, e.n, tA)) return
    this.swarm.fling(e, 8, tB.copy(tA).multiplyScalar(11))
    e.flash = 1
    const into = c.vt.dot(tA)
    if (into > 0) c.vt.addScaledVector(tA, -1.8 * into)
    if (this.chain > 1) this.callout('CHAIN LOST', c.pos, '#ff8fc8', 16)
    this.chain = 0
    this.chainTimer = 0
    this.rig.shake(0.18)
    this.sound.land(0.7)
    this.sound.pop()
    this.particles.burst(this.surfacePoint(body, e.n, 0.3), 14, 2.4, 0.5, 1.8, 6, 0.35, 0.3)
  }

  private kill(e: Enemy, why: string) {
    const chain = Math.max(1, this.chain)
    const pts = SCORE.perEnemy * 3 * chain * this.stats.mult
    this.score += pts
    this.summaryStats.captured++
    this.swarm.capture(e, e.n)
    this.rig.shake(0.06)
    if (Math.random() < 0.35) this.callout(`+${pts}`, this.surfacePoint(e.body, e.n, 0.5), '#ffb070', 16, why)
  }

  private damage(e: Enemy) {
    const c = this.comet
    const body = c.body!
    this.hearts -= 1
    this.invulnerable = PLAYER.invulnerable
    this.chain = 0
    this.chainTimer = 0
    this.trails[0].reset(body)
    this.rig.shake(0.8)
    this.post.flash = 0.55
    this.post.flashCol.setRGB(1, 0.15, 0.2)
    this.post.ca = 1.4
    this.hitStop = 0.12
    this.sound.hit()
    this.particles.burst(c.pos, 60, 3, 0.4, 0.5, 12, 0.7, 0.45)
    body.addRing(c.n, { color: new Color(2.6, 0.4, 0.5), speed: 1.8, width: 0.05, life: 0.6, intensity: 3 })
    // Knock the swarm back.
    for (const o of this.swarm.list) {
      if (o.body !== body || o.state !== 'live') continue
      const a = o.n.angleTo(c.n) * body.radius
      if (a < 6 && dirTo(c.n, o.n, tA)) {
        this.swarm.fling(o, 8 * (1 - a / 6) + 2, tA.multiplyScalar(10 * (1 - a / 6)))
      }
    }
    void e
    if (this.hearts <= 0) this.die()
    else this.callout(this.hearts === 1 ? 'LAST HEART' : 'OUCH', c.pos, '#ff5a6a', 26)
  }

  private die() {
    if (this.mode !== 'play') return
    this.mode = 'dying'
    this.stateTimer = 0
    this.slow = 0.25
    this.slowTimer = 1.2
    const c = this.comet
    this.particles.burst(c.pos, 300, 1.5, 2.2, 4, 18, 1.4, 0.6)
    this.particles.burst(c.pos, 120, 3, 1.4, 0.6, 10, 1.2, 0.5)
    this.post.flash = 0.9
    this.post.flashCol.setRGB(1, 1, 1)
    this.rig.shake(1)
    this.sound.nova(false)
    this.comet.group.visible = false
    this.comet.halo.visible = false
    this.comet.chevron.visible = false
    this.trails[0].reset(null)
    this.sound.setPlaying(false)
  }

  private updateDying(dt: number) {
    this.swarm.update(dt, this.swarmCtx(this.comet.body))
    this.particles.update(dt, null, 0, () => {})
    if (this.comet.body) this.rig.surface(dt, this.comet.pos, this.comet.n, this.comet.facing, this.comet.body.radius)
    if (this.stateTimer > 2.2) this.gameOver()
  }

  private gameOver() {
    this.mode = 'over'
    this.stateTimer = 0
    const best = Math.max(loadBest(), 0)
    const newBest = this.score > best
    if (newBest) saveBest(this.score)
    this.sound.over()
    this.overlay.clear()
    this.store.set({
      screen: 'over',
      best: Math.max(best, this.score),
      score: this.score,
      summary: {
        score: this.score,
        best: Math.max(best, this.score),
        newBest,
        worlds: this.summaryStats.worlds,
        systems: this.system.index,
        biggestLoop: this.summaryStats.biggestLoop,
        captured: this.summaryStats.captured,
        time: this.time - this.summaryStats.started,
      },
    })
  }

  // ---- flux and blaze ----------------------------------------------------------------------

  private gainFlux(v: number) {
    this.sound.dust()
    if (this.blaze > 0) {
      this.score += 2 * this.stats.mult
      return
    }
    this.flux = Math.min(1, this.flux + v)
    if (this.flux >= 1 && this.mode === 'play') this.startBlaze()
  }

  private startBlaze() {
    this.flux = 0
    this.blaze = this.stats.blazeTime
    this.sound.intensity = 3
    this.sound.blaze()
    this.rig.fovKick = 10
    this.rig.shake(0.4)
    this.post.flash = 0.4
    this.post.flashCol.setRGB(1, 0.6, 0.2)
    this.post.ca = 1
    this.callout('BLAZE', this.comet.pos, '#ffb04a', 44, 'smash them · your trail burns')
    if (this.comet.body) this.comet.body.addRing(this.comet.n, { color: new Color(2.8, 1.2, 0.3), speed: 2.2, width: 0.06, life: 1, intensity: 3 })
  }

  private exhaust(dt: number) {
    const c = this.comet
    const rate = this.blaze > 0 ? 90 : 30
    const n = Math.floor(rate * dt + Math.random())
    const [r, g, b] = this.blaze > 0 ? [2.4, 1.0, 0.25] : [0.5, 0.9, 2.2]
    for (let i = 0; i < n; i++) {
      tA.copy(c.facing).multiplyScalar(-2 - Math.random() * 2).addScaledVector(c.n, 1 + Math.random() * 1.5)
      tA.x += (Math.random() - 0.5) * 1.5
      tA.y += (Math.random() - 0.5) * 1.5
      tA.z += (Math.random() - 0.5) * 1.5
      tB.copy(c.pos).addScaledVector(c.n, 0.35)
      this.particles.emit(tB, tA, r, g, b, 0.45 + Math.random() * 0.3, this.blaze > 0 ? 0.55 : 0.3, 2.5)
    }
  }

  // ---- spawning ----------------------------------------------------------------------------

  private spawnDirector(dt: number) {
    const body = this.comet.body!
    const world = this.world
    const sys = this.system.index
    const cap = Math.min(80, 20 + Math.floor(this.heat * 0.45) + sys * 8 + this.worldIdx * 2)
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(0.22, 1.15 - this.heat * 0.012 - sys * 0.1 - this.worldIdx * 0.04)
      if (this.swarm.live < cap) {
        const b = world.bodies[Math.floor(Math.random() * world.bodies.length)]
        const kind = this.pickKind()
        if (kind !== 'warden' || this.swarm.countOn(b, 'warden') < 2 + sys) this.spawnAt(kind, b)
      }
    }
    this.swarmTimer -= dt
    if (this.swarmTimer <= 0) {
      this.swarmTimer = Math.max(6, 11 - this.heat * 0.05)
      this.spawnFlock(body, 8 + Math.min(16, Math.floor(this.heat / 6) + sys * 3))
    }
    this.gemTimer -= dt
    if (this.gemTimer <= 0) {
      this.gemTimer = 16
      this.spawnAt('gem', body)
    }
    this.powerTimer -= dt
    if (this.powerTimer <= 0) {
      this.powerTimer = 12
      if (this.orbs.filter((o) => o.body === body).length < 2) this.spawnPower(body)
    }
  }

  private pickKind(): EnemyKind {
    const mix = enemyMix(this.system.index, this.worldIdx)
    // The first world is only mites, until you linger.
    if (mix.length === 1 && this.heat > 20 && Math.random() < 0.2) return 'hunter'
    let total = 0
    for (const [, w] of mix) total += w
    let r = Math.random() * total
    for (const [k, w] of mix) {
      r -= w
      if (r <= 0) return k
    }
    return 'mite'
  }

  /** A random spot away from the comet, off painted ground when possible. */
  private spot(body: Body, minDist = 4.5, out = new Vector3()): Vector3 {
    for (let i = 0; i < 8; i++) {
      randomDir(Math.random, out)
      if (body === this.comet.body && out.angleTo(this.comet.n) * body.radius < minDist) continue
      if (i < 6 && sampleMask(GRID, body.mask, out) > 128) continue
      return out
    }
    return out
  }

  private spawnAt(kind: EnemyKind, body: Body) {
    const n = this.spot(body)
    if (this.swarm.spawn(kind, body, n)) body.addRing(n, { color: new Color(...ENEMIES[kind].color).multiplyScalar(1.5), angle: 0.12, speed: -0.12, width: 0.02, life: 0.9, intensity: 1.6 })
  }

  /** A tight flock of mites: the easiest big loop on the world. */
  private spawnFlock(body: Body, count: number) {
    const c = this.comet
    const center = new Vector3()
    if (body === c.body && dirTo(c.n, randomDir(Math.random, tC), tA)) {
      const ang = (6 + Math.random() * 4) / body.radius
      center.copy(c.n).multiplyScalar(Math.cos(ang)).addScaledVector(tA, Math.sin(ang)).normalize()
    } else this.spot(body, 6, center)
    const t = anyTangent(center, new Vector3())
    const b = new Vector3().crossVectors(center, t)
    const R = 2.2 / body.radius
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      const rr = R * (0.4 + Math.random() * 0.6)
      const n = center.clone().multiplyScalar(Math.cos(rr)).addScaledVector(t, Math.sin(rr) * Math.cos(a)).addScaledVector(b, Math.sin(rr) * Math.sin(a)).normalize()
      this.swarm.spawn(i % 7 === 6 && this.system.index + this.worldIdx > 0 ? 'hunter' : 'mite', body, n, 0.6 + i * 0.03)
    }
    body.addRing(center, { color: new Color(2.4, 0.5, 1.8), angle: 0.4, speed: -0.3, width: 0.03, life: 1.1, intensity: 2 })
  }

  // ---- power-ups ---------------------------------------------------------------------------

  private spawnPower(body: Body) {
    const kinds = Object.entries(POWERS) as [PowerKind, (typeof POWERS)[PowerKind]][]
    let total = 0
    for (const [, d] of kinds) total += d.weight
    let r = Math.random() * total
    let kind: PowerKind = 'nova'
    for (const [k, d] of kinds) {
      r -= d.weight
      if (r <= 0) { kind = k; break }
    }
    if (kind === 'heart' && this.hearts >= this.stats.maxHearts) kind = 'nova'
    const n = this.spot(body, 5).clone()
    const view = makeOrb(new Color(...POWERS[kind].color))
    this.scene.add(view.group, view.halo)
    this.orbs.push({ kind, body, n, age: 0, view })
    body.addRing(n, { color: new Color(...POWERS[kind].color).multiplyScalar(2), angle: 0.25, speed: -0.25, width: 0.02, life: 1, intensity: 2 })
  }

  private takePower(o: PowerOrb) {
    this.removeOrb(o)
    const c = this.comet
    const name = POWERS[o.kind].name
    const col = POWERS[o.kind].color
    this.sound.pickup()
    this.particles.burst(this.surfacePoint(o.body, o.n, 0.8), 50, col[0] * 3, col[1] * 3, col[2] * 3, 9, 0.6, 0.45)
    this.callout(name, c.pos, `rgb(${col.map((v) => Math.round(v * 255)).join(',')})`, 30)
    switch (o.kind) {
      case 'nova': this.nova(o.body, c.grounded ? c.n : o.n); break
      case 'singularity': {
        this.singularity = { body: o.body, n: o.n.clone(), life: 6.5, strength: 1 }
        o.body.addRing(o.n, { color: new Color(1.4, 0.6, 3), angle: 4 / o.body.radius, speed: 0, width: 0.04, life: 6.5, intensity: 2 })
        this.sound.nova(false)
        this.rig.shake(0.4)
        break
      }
      case 'prism': {
        // Two copies of the comet, one either side, turned rigidly about the planet's centre.
        this.prism = 12
        this.prismAxis.copy(c.facing)
        this.trails[1].reset(c.body)
        this.trails[2].reset(c.body)
        break
      }
      case 'chrono': this.chrono = 7; break
      case 'heart': this.hearts = Math.min(this.stats.maxHearts, this.hearts + 1); break
      case 'blaze': this.startBlaze(); break
    }
  }

  /** A blast across a third of the world: catches and paints everything near. */
  private nova(body: Body, at: Vector3) {
    const reach = Math.min(1.1, 13 / body.radius)
    const ring: Vector3[] = []
    const t = anyTangent(at, new Vector3())
    const b = new Vector3().crossVectors(at, t)
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2
      ring.push(at.clone().multiplyScalar(Math.cos(reach)).addScaledVector(t, Math.sin(reach) * Math.cos(a)).addScaledVector(b, Math.sin(reach) * Math.sin(a)).normalize())
    }
    const shape = makeLoopShape(ring)
    body.paintShape(shape)
    body.addRing(at, { color: new Color(3, 2.6, 1.4), speed: 2.4, width: 0.08, life: 0.9, intensity: 4 })
    body.addRing(at, { color: new Color(1.5, 2, 3), speed: 1.6, width: 0.05, life: 0.9, intensity: 3 })
    this.post.flash = 0.7
    this.post.flashCol.setRGB(1, 0.95, 0.8)
    this.rig.shake(0.9)
    this.sound.nova(true)
    this.strike(body, shape, true)
  }

  private updatePowers(dt: number) {
    const c = this.comet
    for (const o of this.orbs.slice()) {
      o.age += dt
      if (o.age > 22) { this.removeOrb(o); continue }
      if (o.body === c.body && c.n.angleTo(o.n) * o.body.radius < 1.5 && c.height < 2.5) this.takePower(o)
    }
    const s = this.singularity
    if (s) {
      s.life -= dt
      // Whatever falls into the centre is crushed.
      for (const e of this.swarm.list) {
        if (e.body !== s.body || e.state !== 'live') continue
        if (e.n.angleTo(s.n) * s.body.radius < 0.7) {
          this.swarm.capture(e, s.n)
          const pts = SCORE.perEnemy * 2 * Math.max(1, this.chain) * this.stats.mult
          this.score += pts
          this.summaryStats.captured++
        }
      }
      if (s.life <= 0) {
        this.singularity = null
        s.body.addRing(s.n, { color: new Color(1.6, 0.8, 3), speed: 2, width: 0.06, life: 0.7, intensity: 3 })
        this.rig.shake(0.3)
      }
    }
  }

  private removeOrb(o: PowerOrb) {
    const i = this.orbs.indexOf(o)
    if (i >= 0) this.orbs.splice(i, 1)
    this.scene.remove(o.view.group, o.view.halo)
  }

  private clearPowers() {
    for (const o of this.orbs.slice()) this.removeOrb(o)
    this.singularity = null
    this.prism = 0
    this.chrono = 0
    this.echoes.length = 0
    this.launchOn = false
    this.star.group.visible = false
    this.star.halo.visible = false
    for (const f of this.flightOrbs) this.scene.remove(f.view.group, f.view.halo)
    this.flightOrbs = []
  }

  private renderPowers(beat: number) {
    const q = this.rig.camera.quaternion
    for (const o of this.orbs) {
      const p = this.surfacePoint(o.body, o.n, 1 + Math.sin(this.time * 3 + o.age) * 0.25)
      o.view.group.position.copy(p)
      o.view.halo.position.copy(p)
      o.view.halo.quaternion.copy(q)
      o.view.ring.rotation.x = this.time * 2
      o.view.ring.rotation.y = this.time * 1.3
      o.view.ring2.rotation.z = this.time * 2.6
      const s = o.age < 0.4 ? o.age / 0.4 : o.age > 19 ? (Math.sin(this.time * 20) > 0 ? 1 : 0.4) : 1
      o.view.group.scale.setScalar(s * (1 + beat * 0.12))
    }
    for (const f of this.flightOrbs) {
      f.view.group.position.copy(f.pos)
      f.view.halo.position.copy(f.pos)
      f.view.halo.quaternion.copy(q)
      f.view.ring.rotation.x = this.time * 2
      f.view.ring.rotation.y = this.time * 1.4
      f.view.group.scale.setScalar(2.2 * (1 + beat * 0.1))
      f.view.halo.scale.setScalar(7)
    }
    if (this.launchOn && this.launchBody) {
      const p = this.surfacePoint(this.launchBody, this.launchN, 1.4 + Math.sin(this.time * 2.5) * 0.25)
      this.star.group.position.copy(p)
      this.star.halo.position.copy(p)
      this.star.halo.quaternion.copy(q)
      tA.copy(this.launchN)
      this.star.group.quaternion.setFromUnitVectors(tB.set(0, 1, 0), tA)
      this.star.starMesh.rotation.y = this.time * 2.2
      this.star.starMesh.rotation.x = Math.PI / 2
      this.star.beamMat.uniforms.uTime.value = this.time
    }
    const s = this.singularity
    const sv = this.singularityView
    sv.group.visible = !!s
    if (s) {
      const k = Math.min(1, s.life, (6.5 - s.life) * 3)
      sv.group.position.copy(this.surfacePoint(s.body, s.n, 1.2))
      sv.group.quaternion.setFromUnitVectors(tB.set(0, 1, 0), s.n)
      sv.group.scale.setScalar(Math.max(0.01, k) * (1.3 + Math.sin(this.time * 7) * 0.06))
      sv.disc.rotation.z = this.time * 3
      sv.discMat.uniforms.uTime.value = this.time
    }
  }

  // ---- launch and flight -------------------------------------------------------------------

  private armLaunch() {
    const c = this.comet
    const body = c.body!
    this.launchOn = true
    this.launchBody = body
    // Somewhere ahead, a fair way off.
    const ang = 7 / body.radius
    this.launchN.copy(c.n).multiplyScalar(Math.cos(ang)).addScaledVector(c.facing, Math.sin(ang)).normalize()
    this.star.group.visible = true
    this.star.halo.visible = true
    body.addRing(this.launchN, { color: new Color(3, 2.4, 0.8), speed: 0, angle: 0.08, width: 0.03, life: Infinity, intensity: 2.5 })
    this.overlay.showCard('IGNITION', 'Reach the star to launch', '#ffd34a', 2200)
    this.sound.lit()
    this.rig.shake(0.3)
  }

  private beginLaunch() {
    const c = this.comet
    const world = this.world
    this.mode = 'launch'
    this.launchT = 0
    this.launchOn = false
    this.star.group.visible = false
    this.star.halo.visible = false
    this.overlay.pointArrow(false)
    world.lit = true
    this.summaryStats.worlds++
    const cov = world.coverage()
    const bonus = Math.round(SCORE.worldLit * (1 + cov * 2) * (this.system.index + 1))
    this.score += bonus
    this.callout(`+${bonus.toLocaleString('en-US')}`, c.pos, '#ffd34a', 40, `${world.name.toUpperCase()} LIT · ${Math.round(cov * 100)}%`)
    for (const b of world.bodies) b.rings = b.rings.filter((r) => r.life !== Infinity)
    this.sound.launch()
    this.post.flash = 0.6
    this.post.flashCol.setRGB(1, 0.85, 0.5)
    this.rig.shake(0.6)
    // Every enemy on the world goes up in a cascade.
    let k = 0
    for (const e of this.swarm.list) {
      if (e.body.world !== world || e.state === 'dead') continue
      e.state = 'caught'
      e.t = -k * 0.025
      e.from.copy(e.n)
      e.pull.copy(e.n)
      k++
      this.score += SCORE.perEnemy * this.stats.mult
    }
    this.trails[0].reset(null)
    this.trails[1].reset(null)
    this.trails[2].reset(null)
  }

  private updateLaunch(dt: number) {
    const c = this.comet
    const body = c.body!
    this.launchT += dt
    this.swarm.update(dt, this.swarmCtx(body))
    this.particles.update(dt, c.pos, 30, (v) => this.gainFlux(v))
    // Spin up inside the star.
    const k = Math.min(1, this.launchT / 0.5)
    c.n.lerp(this.launchN, k * 0.3).normalize()
    c.pos.copy(c.n).multiplyScalar(body.radius + k * 1.4).add(body.center)
    this.particles.burst(c.pos, 6, 2.6, 2, 0.6, 6, 0.4, 0.35)
    this.rig.pull = k * 6
    this.rig.surface(dt, c.pos, c.n, c.facing, body.radius)
    if (this.launchT >= 0.7) {
      this.rig.pull = 0
      const next = this.worldIdx + 1
      const launch = tA.copy(c.n).multiplyScalar(30).addScaledVector(c.facing, 6)
      if (next < this.system.worlds.length) {
        const nb = this.system.worlds[next].bodies[0]
        this.beginFlight(c.pos, launch, { center: nb.center, radius: nb.radius, body: nb }, true)
      } else {
        this.beginFlight(c.pos, launch, { center: this.system.sunPos, radius: this.system.sunRadius * 0.9, body: null }, true)
        this.overlay.showCard('INTO THE SUN', 'Every world is lit', '#ffb04a', 2400)
      }
    }
  }

  private beginFlight(from: Vector3, launch: Vector3, target: FlightTarget, withBoons: boolean) {
    const f = new Flight(target)
    f.build(this.system, from, launch, this.rig.screenUp)
    this.flight = f
    this.mode = 'flight'
    this.orbsResolved = !withBoons
    for (const o of this.flightOrbs) this.scene.remove(o.view.group, o.view.halo)
    this.flightOrbs = []
    if (withBoons && f.orbIndex >= 0) {
      const picks = this.drawBoons(3)
      const xs = [-5.5, 0, 5.5]
      picks.forEach((boon, i) => {
        const view = makeOrb(new Color(boon.color))
        this.scene.add(view.group, view.halo)
        this.flightOrbs.push({ boon, view, x: xs[i], pos: f.pointAt(f.orbIndex, xs[i], 0, new Vector3()) })
      })
    }
    // Stardust along the way.
    for (let i = 0; i < 46; i++) {
      const idx = Math.floor(f.path.length * (0.18 + Math.random() * 0.7))
      const p = f.pointAt(idx, (Math.random() - 0.5) * 11, (Math.random() - 0.5) * 6, new Vector3())
      this.particles.emit(p, tB.set(0, 0, 0), 1.1, 0.9, 0.35, 12, 0.3, 0, Mode.Dust, null, 0.02)
    }
    this.comet.grounded = false
    this.comet.body = null
  }

  private drawBoons(n: number): Boon[] {
    const pool = BOONS.filter((b) => b.stacks || !this.boonCounts.has(b.id))
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, n)
  }

  private updateFlight(dt: number) {
    const f = this.flight
    if (!f) return
    const c = this.comet
    f.time += dt
    // Steering: keyboard nudges, a pointer places the comet across the screen.
    const p = this.input.pointer
    let tx: number
    let ty: number
    if (p) {
      tx = (p.x / window.innerWidth - 0.5) * 2 * FLIGHT_REACH
      ty = -(p.y / window.innerHeight - 0.5) * 2 * 4
    } else {
      tx = f.offset.x + this.input.turn * 14 * dt
      ty = f.offset.y + this.input.lift * 10 * dt
    }
    // Flight reads where the finger is; its movement only steers on the ground.
    this.input.consumeDrag()
    tx = Math.max(-FLIGHT_REACH, Math.min(FLIGHT_REACH, tx))
    ty = Math.max(-4, Math.min(4, ty))
    const k = 1 - Math.exp(-dt * 6)
    f.offset.x += (tx - f.offset.x) * k
    f.offset.y += (ty - f.offset.y) * k
    this.input.consumeJump()
    f.sample(c.pos, tA, tB)
    c.facing.copy(tA)
    c.n.copy(tB)
    this.rig.flight(dt, c.pos, tA, tB, f.time < 0.4 ? 1 - Math.exp(-dt * 2.5) : 1 - Math.exp(-dt * 6))
    this.particles.update(dt, c.pos, 4 * this.stats.magnet, (v) => {
      this.gainFlux(v)
      this.score += 5 * this.stats.mult
    })
    // Exhaust: moving almost as fast as the comet, so it streaks behind it instead of flying into the lens.
    const sp = f.speedNow()
    for (let i = 0; i < 3; i++) {
      tC.copy(tA).multiplyScalar(sp * (0.75 + Math.random() * 0.1))
      tC.x += (Math.random() - 0.5) * 2
      tC.y += (Math.random() - 0.5) * 2
      tC.z += (Math.random() - 0.5) * 2
      this.particles.emit(c.pos, tC, 0.5, 0.9, 2.4, 0.35, 0.22, 0.5)
    }
    // Boon orbs: take the one you fly through.
    if (!this.orbsResolved && f.orbIndex >= 0) {
      const at = f.orbIndex * FLIGHT_STEP
      this.flightOrbs.forEach((o, i) => {
        const near = Math.abs(o.x - f.offset.x) < 2.75
        this.overlay.label(i, f.time < at, 0.5 + o.x / (2 * FLIGHT_REACH), o.boon.name, o.boon.text, o.boon.color, near)
      })
      if (f.time >= at) {
        this.orbsResolved = true
        let best: FlightOrb | null = null
        let bestD = 3.2
        for (const o of this.flightOrbs) {
          const d = Math.abs(o.x - f.offset.x)
          if (d < bestD) { bestD = d; best = o }
        }
        for (let i = 0; i < 3; i++) this.overlay.label(i, false)
        for (const o of this.flightOrbs) {
          const col = new Color(o.boon.color)
          this.particles.burst(o.pos, o === best ? 120 : 30, col.r * 3, col.g * 3, col.b * 3, o === best ? 16 : 6, 0.8, 0.6)
          this.scene.remove(o.view.group, o.view.halo)
        }
        this.flightOrbs = []
        if (best) this.takeBoon(best.boon)
        else this.callout('MISSED', c.pos, '#8899aa', 22)
      }
    }
    if (f.done) this.arrive(f)
  }

  private takeBoon(b: Boon) {
    b.apply(this.stats)
    this.boonCounts.set(b.id, (this.boonCounts.get(b.id) ?? 0) + 1)
    if (b.id === 'heart') this.hearts = Math.min(this.stats.maxHearts, this.hearts + 1)
    this.sound.boon()
    this.post.flash = 0.3
    this.post.flashCol.set(b.color)
    this.overlay.showCard(b.name.toUpperCase(), b.text, b.color, 1600)
    this.store.set({
      boons: BOONS.filter((x) => this.boonCounts.has(x.id)).map((x) => ({ id: x.id, name: x.name, color: x.color, count: this.boonCounts.get(x.id)! })),
    })
  }

  private arrive(f: Flight) {
    const c = this.comet
    const target = f.target
    this.flight = null
    if (!target.body) {
      this.supernova()
      return
    }
    const body = target.body
    const world = body.world
    this.worldIdx = world.index
    const n = tA.copy(c.pos).sub(body.center).normalize()
    const facing = tB.copy(f.tangents[f.tangents.length - 1])
    toTangent(facing, n)
    if (facing.lengthSq() < 1e-4) anyTangent(n, facing)
    c.place(body, n, facing.normalize())
    c.vt.copy(c.facing).multiplyScalar(PLAYER.speed)
    this.spin.on = false
    this.spin.ax = 0
    this.spin.ay = 0
    for (const t of this.trails) t.reset(body)
    this.heat = 0
    this.spawnTimer = 1.2
    this.swarmTimer = 2.5
    this.gemTimer = 9
    this.powerTimer = 5
    this.flux = Math.max(this.flux, this.stats.fluxStart)
    this.invulnerable = Math.max(this.invulnerable, LANDING_GRACE)
    this.mode = 'play'
    this.stateTimer = 0
    // Impact
    body.paintSplat(n, 0.13)
    body.addRing(n, { color: new Color(0.6, 1.2, 3), speed: 1.6, width: 0.07, life: 1, intensity: 4 })
    body.addRing(n, { color: new Color(2, 2, 2), speed: 0.8, width: 0.04, life: 0.8, intensity: 2 })
    this.particles.fountain(c.pos, n, 120, 0.8, 1.2, 3, 14, 0.9, 1.4, 0.45, body)
    this.rig.shake(0.7)
    this.post.flash = 0.45
    this.post.flashCol.setRGB(0.7, 0.85, 1)
    tC.copy(c.pos).project(this.rig.camera)
    this.post.shock(tC.x * 0.5 + 0.5, tC.y * 0.5 + 0.5, 1.5, 1.2, 0.9)
    this.sound.land(2)
    this.sound.nova(false)
    // Knock nothing loose yet: the swarm arrives just after you do.
    this.spawnFlock(body, 10 + this.system.index * 3)
    for (let i = 0; i < 4 + this.worldIdx; i++) this.spawnAt(this.pickKind(), world.bodies[i % world.bodies.length])
    const sysLabel = this.system.index > 0 ? `SYSTEM ${this.system.index + 1} · ` : ''
    this.overlay.showCard(world.name.toUpperCase(), `${sysLabel}${world.type.blurb}`, world.type.colors.glow, 2600)
  }

  private supernova() {
    this.mode = 'nova'
    this.stateTimer = 0
    const sys = this.system
    sys.sunMat.uniforms.uHeat.value = 0
    const bonus = SCORE.supernova * (sys.index + 1)
    this.score += bonus
    // Pull back to watch the sun go.
    const out = tA.copy(this.comet.pos).sub(sys.sunPos).normalize()
    this.novaCam.copy(sys.sunPos).addScaledVector(out, sys.sunRadius * 11).add(tB.set(0, sys.sunRadius * 2.5, 0))
    this.rig.jumpTo(this.novaCam, sys.sunPos, tB.set(0, 1, 0))
    this.comet.group.visible = false
    this.comet.halo.visible = false
    this.novaRing.visible = true
    this.novaRing.position.copy(sys.sunPos)
    const hue = sys.sunMat.uniforms.uColor.value as Color
    for (let i = 0; i < 3; i++) {
      this.particles.burst(sys.sunPos, 160, hue.r * 2, hue.g * 2, hue.b * 2, 140 + i * 70, 2.4, 2.4 + i)
    }
    this.particles.burst(sys.sunPos, 140, 1.6, 1.8, 2.4, 300, 1.6, 2)
    this.post.flash = 0.35
    this.post.flashCol.setRGB(1, 0.95, 0.85)
    this.post.ca = 1.5
    this.post.bloomBoost = 0.6
    this.rig.shake(1)
    this.sound.nova(true)
    this.overlay.showCard('SUPERNOVA', `+${bonus.toLocaleString('en-US')}`, '#ffffff', 2400)
  }

  private updateNova(dt: number) {
    const sys = this.system
    const k = this.stateTimer
    sys.sunMat.uniforms.uHeat.value = Math.min(1, k * 1.2)
    sys.sun.scale.setScalar(1 + (1 - Math.exp(-k * 2.5)) * 1.7)
    const ring = this.novaRing
    ring.scale.setScalar(sys.sunRadius * 2 + k * 520)
    ring.quaternion.copy(this.rig.camera.quaternion)
    const ringU = (ring.material as ShaderMaterial).uniforms
    ringU.uA.value = Math.max(0, 1 - k / 1.9) * 1.3
    ;(ringU.uColor.value as Color).copy(sys.sunMat.uniforms.uColor.value as Color).multiplyScalar(2.2)
    this.rig.jumpTo(this.novaCam, sys.sunPos, tB.set(0, 1, 0))
    this.rig.shake(dt * 0.8)
    this.particles.update(dt, null, 0, () => {})
    if (k > 1.25) {
      this.post.flash = Math.max(this.post.flash, ((k - 1.25) / 0.55) * 1.5)
      this.post.flashCol.setRGB(1, 0.97, 0.92)
    }
    if (k > 1.8) {
      // The next system, harder.
      ring.visible = false
      this.resetSystem(sys.index + 1)
      this.swarm.clearBody(null)
      this.particles.clear()
      this.clearPowers()
      this.worldIdx = 0
      this.comet.group.visible = true
      this.comet.halo.visible = true
      const body = this.system.worlds[0].bodies[0]
      const from = tA.copy(this.system.sunPos).add(tB.copy(body.center).sub(this.system.sunPos).normalize().multiplyScalar(this.system.sunRadius + 30))
      this.beginFlight(from, tB.copy(body.center).sub(from).normalize().multiplyScalar(26), { center: body.center, radius: body.radius, body }, true)
      this.rig.jumpTo(tC.copy(from).addScaledVector(tB.normalize(), -12), body.center, this.flight!.ups[0])
      this.post.flash = 1.4
    }
  }

  // ---- helpers -----------------------------------------------------------------------------

  private surfacePoint(body: Body, n: Vector3, lift: number, out = new Vector3()): Vector3 {
    return out.copy(n).multiplyScalar(body.radius + lift + body.groundHeight(n)).add(body.center)
  }

  private callout(text: string, at: Vector3, color: string, size: number, sub?: string) {
    tC.copy(at).project(this.rig.camera)
    if (tC.z > 1) return
    const x = (tC.x * 0.5 + 0.5) * window.innerWidth
    const y = (-tC.y * 0.5 + 0.5) * window.innerHeight
    const m = 60
    this.overlay.callout({ text, sub, x: Math.max(m, Math.min(window.innerWidth - m, x)), y: Math.max(m + 40, Math.min(window.innerHeight - m, y)), color, size })
  }

  /** Point an arrow at the launch star when it's off screen or behind the world. */
  private pointToStar() {
    if (!this.launchOn || !this.launchBody) {
      this.overlay.pointArrow(false)
      return
    }
    const cam = this.rig.camera
    const p = this.surfacePoint(this.launchBody, this.launchN, 1.4, tC)
    const facingCam = tA.copy(cam.position).sub(p).dot(this.launchN) > 0
    tB.copy(p).project(cam)
    const onScreen = facingCam && tB.z < 1 && Math.abs(tB.x) < 0.92 && Math.abs(tB.y) < 0.92
    if (onScreen) {
      this.overlay.pointArrow(false)
      return
    }
    const c = this.comet
    if (!dirTo(c.n, this.launchN, tA)) return
    const sx = tA.dot(right)
    const sy = tA.dot(camUp)
    const ang = Math.atan2(-sy, sx)
    tB.copy(c.pos).project(cam)
    const cx = (tB.x * 0.5 + 0.5) * window.innerWidth
    const cy = (-tB.y * 0.5 + 0.5) * window.innerHeight
    const r = Math.min(window.innerWidth, window.innerHeight) * 0.34
    this.overlay.pointArrow(true, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, ang)
  }
}
