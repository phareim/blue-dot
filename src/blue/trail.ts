import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three'
import { detectLoop, loopVertices, type LoopHit } from './geo'
import { trailMaterial } from './fx/materials'
import { TRAIL } from './config'
import type { Body } from './world'

const MAX = 720
const LIFT = 0.07

function ribbonGeometry(max: number, closed: boolean): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(max * 2 * 3), 3))
  g.setAttribute('aT', new BufferAttribute(new Float32Array(max * 2), 1))
  g.setAttribute('aSide', new BufferAttribute(new Float32Array(max * 2), 1))
  g.setAttribute('aDist', new BufferAttribute(new Float32Array(max * 2), 1))
  const side = g.getAttribute('aSide') as BufferAttribute
  for (let i = 0; i < max; i++) {
    side.setX(i * 2, -1)
    side.setX(i * 2 + 1, 1)
  }
  const segs = closed ? max : max - 1
  const idx = new Uint32Array(segs * 6)
  for (let i = 0; i < segs; i++) {
    const a = i * 2
    const b = ((i + 1) % max) * 2
    idx.set([a, a + 1, b, a + 1, b + 1, b], i * 6)
  }
  g.setIndex(new BufferAttribute(idx, 1))
  g.setDrawRange(0, 0)
  return g
}

const tA = new Vector3()
const tB = new Vector3()
const tT = new Vector3()
const tS = new Vector3()
const tP = new Vector3()

/** Write a ribbon through unit directions `pts` on `body` into `g`. */
function writeRibbon(g: BufferGeometry, body: Body, pts: readonly Vector3[], count: number, width: (t: number) => number, closed: boolean) {
  const pos = g.getAttribute('position') as BufferAttribute
  const at = g.getAttribute('aT') as BufferAttribute
  const ad = g.getAttribute('aDist') as BufferAttribute
  const arr = pos.array as Float32Array
  const R = body.radius
  let dist = 0
  for (let i = 0; i < count; i++) {
    const n = pts[i]
    const prev = pts[i > 0 ? i - 1 : closed ? count - 1 : 0]
    const next = pts[i < count - 1 ? i + 1 : closed ? 0 : count - 1]
    tT.subVectors(next, prev)
    if (tT.lengthSq() < 1e-12) tT.set(1, 0, 0)
    tS.crossVectors(n, tT).normalize()
    if (i > 0) dist += pts[i - 1].distanceTo(n) * R
    const t = count > 1 ? i / (count - 1) : 1
    const w = width(t) * 0.5
    const h = R + LIFT + body.groundHeight(n)
    tP.copy(n).multiplyScalar(h).add(body.center)
    const o = i * 6
    arr[o] = tP.x - tS.x * w
    arr[o + 1] = tP.y - tS.y * w
    arr[o + 2] = tP.z - tS.z * w
    arr[o + 3] = tP.x + tS.x * w
    arr[o + 4] = tP.y + tS.y * w
    arr[o + 5] = tP.z + tS.z * w
    at.setX(i * 2, t)
    at.setX(i * 2 + 1, t)
    ad.setX(i * 2, dist)
    ad.setX(i * 2 + 1, dist)
  }
  pos.needsUpdate = true
  at.needsUpdate = true
  ad.needsUpdate = true
  pos.clearUpdateRanges()
  pos.addUpdateRange(0, count * 6)
  g.setDrawRange(0, Math.max(0, (closed ? count : count - 1) * 6))
  g.computeBoundingSphere()
}

export class Trail {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial
  body: Body | null = null
  count = 0
  length = 0
  maxLength = TRAIL.length
  snap = TRAIL.snap
  width = TRAIL.width
  private pts: Vector3[] = []
  private segs: number[] = []
  private view: Vector3[] = []
  private loopOut = new Vector3()

  constructor(color: Color, head: Color) {
    for (let i = 0; i < MAX + 1; i++) {
      this.pts.push(new Vector3())
      this.view.push(new Vector3())
    }
    this.mat = trailMaterial(color, head)
    this.mesh = new Mesh(ribbonGeometry(MAX + 1, false), this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
  }

  reset(body: Body | null) {
    this.body = body
    this.count = 0
    this.length = 0
    this.segs.length = 0
    this.mesh.geometry.setDrawRange(0, 0)
  }

  point(i: number): Vector3 {
    return this.pts[i]
  }

  private dropOldest(k: number) {
    if (k <= 0) return
    k = Math.min(k, this.count)
    for (let i = 0; i < k; i++) this.length -= this.segs[i] ?? 0
    const removed = this.pts.splice(0, k)
    this.pts.push(...removed)
    this.segs.splice(0, k)
    this.count -= k
    if (this.count <= 1) {
      this.length = 0
      this.segs.length = 0
    }
  }

  /** Add the head position. Returns a loop when the trail just closed one. */
  push(n: Vector3): LoopHit | null {
    const body = this.body
    if (!body) return null
    if (this.count === 0) {
      this.pts[0].copy(n)
      this.count = 1
      return null
    }
    const last = this.pts[this.count - 1]
    const d = last.angleTo(n) * body.radius
    if (d < TRAIL.spacing) return null
    if (this.count >= MAX) this.dropOldest(1)
    this.pts[this.count].copy(n)
    this.segs[this.count - 1] = d
    this.length += d
    this.count++
    // On a small world a loop longer than this would wrap past a hemisphere.
    const cap = Math.min(this.maxLength, Math.PI * body.radius * 1.2)
    let drop = 0
    let len = this.length
    while (len > cap && this.count - drop > 2) len -= this.segs[drop++]
    this.dropOldest(drop)
    const snapAngle = this.snap / body.radius
    const gap = Math.ceil((this.snap * 2.4) / TRAIL.spacing) + 4
    return detectLoop(this.pts, this.count, snapAngle, gap, this.loopOut)
  }

  /** Copy a loop's vertices out, then clear the trail down to its head. */
  takeLoop(hit: LoopHit, dst: Vector3[]): number {
    const n = loopVertices(this.pts, hit, dst)
    this.dropOldest(this.count - 1)
    return n
  }

  /** Remove every point up to and including segment `i`. */
  cutAt(i: number) {
    this.dropOldest(i + 1)
  }

  /** Index of the segment within `maxAngle` of direction `q`, or -1. Skips the newest `skip` segments. */
  nearestSegment(q: Vector3, maxAngle: number, skip = 0): number {
    const cosMax = Math.cos(maxAngle)
    const last = this.count - 1 - skip
    for (let i = 0; i < last; i++) {
      const a = this.pts[i]
      const b = this.pts[i + 1]
      // Closest point on the chord, renormalised. Segments are tiny, so this is the arc distance.
      tA.subVectors(b, a)
      const l2 = tA.lengthSq()
      let t = l2 > 0 ? tB.subVectors(q, a).dot(tA) / l2 : 0
      t = Math.max(0, Math.min(1, t))
      tB.copy(a).addScaledVector(tA, t).normalize()
      if (tB.dot(q) > cosMax) return i
    }
    return -1
  }

  /** Rebuild the ribbon, with its end drawn to the head's current spot. */
  update(head: Vector3 | null, time: number, beat: number, hot: number) {
    this.mat.uniforms.uTime.value = time
    this.mat.uniforms.uBeat.value = beat
    this.mat.uniforms.uHot.value = hot
    const body = this.body
    if (!body || this.count === 0) {
      this.mesh.geometry.setDrawRange(0, 0)
      return
    }
    let n = this.count
    for (let i = 0; i < n; i++) this.view[i].copy(this.pts[i])
    if (head) this.view[n++].copy(head)
    if (n < 2) {
      this.mesh.geometry.setDrawRange(0, 0)
      return
    }
    const w = this.width
    writeRibbon(this.mesh.geometry, body, this.view, n, (t) => w * (0.25 + 0.75 * Math.min(1, t * 3)) * (t > 0.97 ? 1.15 : 1), false)
  }
}

/** A closed loop that flares and tightens around what it caught, then fades. */
export class LoopFlash {
  readonly mesh: Mesh
  readonly mat: ShaderMaterial
  active = false
  private t = 0
  private body: Body | null = null
  private count = 0
  private src: Vector3[] = []
  private view: Vector3[] = []
  private center = new Vector3()
  private dur = 0.5

  constructor(color: Color) {
    for (let i = 0; i < MAX + 1; i++) {
      this.src.push(new Vector3())
      this.view.push(new Vector3())
    }
    this.mat = trailMaterial(color, new Color(3, 3, 3))
    this.mesh = new Mesh(ribbonGeometry(MAX + 1, true), this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
    this.mesh.visible = false
  }

  start(body: Body, pts: readonly Vector3[], count: number, center: Vector3, dur = 0.5) {
    this.body = body
    this.count = Math.min(count, MAX)
    for (let i = 0; i < this.count; i++) this.src[i].copy(pts[i])
    this.center.copy(center)
    this.t = 0
    this.dur = dur
    this.active = true
    this.mesh.visible = true
  }

  update(dt: number, time: number) {
    if (!this.active || !this.body) return
    this.t += dt
    const k = this.t / this.dur
    if (k >= 1) {
      this.active = false
      this.mesh.visible = false
      return
    }
    const squeeze = 0.92 * (1 - Math.pow(1 - k, 3))
    for (let i = 0; i < this.count; i++) this.view[i].copy(this.src[i]).lerp(this.center, squeeze).normalize()
    this.mat.uniforms.uTime.value = time
    this.mat.uniforms.uAlpha.value = (1 - k) * 2.2
    writeRibbon(this.mesh.geometry, this.body, this.view, this.count, () => 0.55 + (1 - k) * 0.5, true)
    // Every point sits at the head end of the gradient so the whole ring is bright.
    const at = this.mesh.geometry.getAttribute('aT') as BufferAttribute
    for (let i = 0; i < this.count * 2; i++) at.setX(i, 1)
    at.needsUpdate = true
  }
}
