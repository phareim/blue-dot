// Spherical geometry for loops drawn on a planet's surface.
// Every direction here is a unit vector from the planet's centre.
import { Vector3 } from 'three'

/** Great-circle arcs ab and cd (each well under 90°) cross. Writes the crossing to `out`. */
export function arcsCross(a: Vector3, b: Vector3, c: Vector3, d: Vector3, out?: Vector3): boolean {
  const n1x = a.y * b.z - a.z * b.y
  const n1y = a.z * b.x - a.x * b.z
  const n1z = a.x * b.y - a.y * b.x
  const sc = n1x * c.x + n1y * c.y + n1z * c.z
  const sd = n1x * d.x + n1y * d.y + n1z * d.z
  if (sc * sd >= 0) return false
  const n2x = c.y * d.z - c.z * d.y
  const n2y = c.z * d.x - c.x * d.z
  const n2z = c.x * d.y - c.y * d.x
  const sa = n2x * a.x + n2y * a.y + n2z * a.z
  const sb = n2x * b.x + n2y * b.y + n2z * b.z
  if (sa * sb >= 0) return false
  // Both pairs straddle: the arcs meet at ±(n1×n2). Short arcs on opposite sides of the sphere also pass the sign tests.
  if (a.x * c.x + a.y * c.y + a.z * c.z <= 0) return false
  if (out) {
    out.set(n1y * n2z - n1z * n2y, n1z * n2x - n1x * n2z, n1x * n2y - n1y * n2x).normalize()
    if (out.dot(a) < 0) out.negate()
  }
  return true
}

/**
 * A closed loop flattened by gnomonic projection onto the tangent plane at its centre.
 * Gnomonic projection maps great circles to straight lines, so the 2D polygon test is exact
 * for every point in the loop's hemisphere. The smaller of the loop's two regions is "inside".
 */
export interface LoopShape {
  ok: boolean
  center: Vector3
  u: Vector3
  w: Vector3
  xs: Float64Array
  ys: Float64Array
  count: number
  /** Cosine of the largest angle from the centre to a vertex: points with dot(center) below it are outside. */
  cosReach: number
  /** Area in steradians. */
  area: number
}

const MIN_DOT = 0.12 // a vertex closer than ~83° to the rim of the hemisphere makes the projection unreliable

export function makeLoopShape(points: readonly Vector3[], count = points.length): LoopShape {
  const center = new Vector3()
  for (let i = 0; i < count; i++) center.add(points[i])
  const shape: LoopShape = {
    ok: false, center, u: new Vector3(), w: new Vector3(),
    xs: new Float64Array(count), ys: new Float64Array(count), count, cosReach: 1, area: 0,
  }
  if (count < 3 || center.lengthSq() < 1e-12) return shape
  center.normalize()
  const u = shape.u
  if (Math.abs(center.x) < 0.9) u.set(1, 0, 0)
  else u.set(0, 1, 0)
  u.addScaledVector(center, -u.dot(center)).normalize()
  shape.w.crossVectors(center, u)
  let cosReach = 1
  for (let i = 0; i < count; i++) {
    const p = points[i]
    const d = p.dot(center)
    if (d < MIN_DOT) return shape
    if (d < cosReach) cosReach = d
    shape.xs[i] = p.dot(u) / d
    shape.ys[i] = p.dot(shape.w) / d
  }
  shape.cosReach = cosReach
  shape.area = Math.abs(sphericalArea(points, count, center))
  shape.ok = true
  return shape
}

/** Signed area (steradians) of a closed spherical polygon, summed as triangles fanned from `apex`. */
export function sphericalArea(points: readonly Vector3[], count: number, apex: Vector3): number {
  let sum = 0
  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % count]
    const triple = apex.x * (a.y * b.z - a.z * b.y) + apex.y * (a.z * b.x - a.x * b.z) + apex.z * (a.x * b.y - a.y * b.x)
    const denom = 1 + apex.dot(a) + a.dot(b) + b.dot(apex)
    sum += 2 * Math.atan2(triple, denom)
  }
  return sum
}

export function insideLoop(shape: LoopShape, qx: number, qy: number, qz: number): boolean {
  if (!shape.ok) return false
  const c = shape.center
  const d = qx * c.x + qy * c.y + qz * c.z
  if (d < shape.cosReach - 1e-9) return false
  const u = shape.u
  const w = shape.w
  const x = (qx * u.x + qy * u.y + qz * u.z) / d
  const y = (qx * w.x + qy * w.y + qz * w.z) / d
  const xs = shape.xs
  const ys = shape.ys
  let inside = false
  for (let i = 0, j = shape.count - 1; i < shape.count; j = i++) {
    const yi = ys[i]
    const yj = ys[j]
    if (yi > y !== yj > y && x < ((xs[j] - xs[i]) * (y - yi)) / (yj - yi) + xs[i]) inside = !inside
  }
  return inside
}

export function insideLoopV(shape: LoopShape, q: Vector3): boolean {
  return insideLoop(shape, q.x, q.y, q.z)
}

export interface LoopHit {
  /** First trail index that belongs to the loop. */
  from: number
  /** Last trail index that belongs to the loop. */
  to: number
  /** Where the trail crossed itself, or null when the head snapped onto an old point. */
  cross: Vector3 | null
}

/**
 * Has the newest trail segment closed a loop? Checks a crossing with any older segment, then whether
 * the head came within `snap` radians of an old point (a forgiving close). `gap` recent points are
 * skipped by the snap test so the head never snaps onto its own neck.
 */
export function detectLoop(pts: readonly Vector3[], count: number, snap: number, gap: number, out: Vector3): LoopHit | null {
  if (count < 6) return null
  const a = pts[count - 2]
  const b = pts[count - 1]
  for (let i = count - 4; i >= 0; i--) {
    if (arcsCross(pts[i], pts[i + 1], a, b, out)) return { from: i + 1, to: count - 2, cross: out }
  }
  if (snap > 0) {
    const cosSnap = Math.cos(snap)
    const last = count - 1 - gap
    for (let i = 0; i <= last; i++) {
      if (pts[i].dot(b) > cosSnap) return { from: i, to: count - 1, cross: null }
    }
  }
  return null
}

/** Copy the loop's vertices (crossing point first, if any) into `dst`. Returns the vertex count. */
export function loopVertices(pts: readonly Vector3[], hit: LoopHit, dst: Vector3[]): number {
  let n = 0
  if (hit.cross) dst[n++].copy(hit.cross)
  for (let i = hit.from; i <= hit.to; i++) dst[n++].copy(pts[i])
  return n
}

// ---- Equirectangular paint masks ---------------------------------------------------------
// Pixel (i, j) is direction (-cos φ sin θ, cos θ, sin φ sin θ) with φ = (i+.5)/W·2π, θ = (j+.5)/H·π.
// The planet shader reads the mask with u = atan(z, -x)/2π, v = acos(y)/π, so both agree.

export class EquirectGrid {
  readonly cosPhi: Float64Array
  readonly sinPhi: Float64Array
  readonly cosTheta: Float64Array
  readonly sinTheta: Float64Array
  readonly totalWeight: number

  constructor(readonly width: number, readonly height: number) {
    this.cosPhi = new Float64Array(width)
    this.sinPhi = new Float64Array(width)
    for (let i = 0; i < width; i++) {
      const phi = ((i + 0.5) / width) * Math.PI * 2
      this.cosPhi[i] = Math.cos(phi)
      this.sinPhi[i] = Math.sin(phi)
    }
    this.cosTheta = new Float64Array(height)
    this.sinTheta = new Float64Array(height)
    let total = 0
    for (let j = 0; j < height; j++) {
      const theta = ((j + 0.5) / height) * Math.PI
      this.cosTheta[j] = Math.cos(theta)
      this.sinTheta[j] = Math.sin(theta)
      total += this.sinTheta[j] * width
    }
    this.totalWeight = total
  }

  /**
   * Visit every pixel within `angle` of `center`. The callback gets the pixel index and its direction,
   * and returns true when it painted the pixel; the sum of painted pixels' area weights is returned.
   */
  forCap(center: Vector3, angle: number, fn: (idx: number, x: number, y: number, z: number) => boolean): number {
    const W = this.width
    const H = this.height
    const thetaC = Math.acos(Math.max(-1, Math.min(1, center.y)))
    const lo = Math.max(0, Math.floor(((thetaC - angle) / Math.PI) * H) - 1)
    const hi = Math.min(H - 1, Math.ceil(((thetaC + angle) / Math.PI) * H) + 1)
    const cosA = Math.cos(angle)
    let gained = 0
    for (let j = lo; j <= hi; j++) {
      const st = this.sinTheta[j]
      const y = this.cosTheta[j]
      const row = j * W
      for (let i = 0; i < W; i++) {
        const x = -this.cosPhi[i] * st
        const z = this.sinPhi[i] * st
        if (x * center.x + y * center.y + z * center.z < cosA) continue
        if (fn(row + i, x, y, z)) gained += st
      }
    }
    return gained
  }
}

/** Paint the inside of a loop into `mask`. Returns the newly painted area weight. */
export function paintLoop(grid: EquirectGrid, mask: Uint8Array, shape: LoopShape): number {
  if (!shape.ok) return 0
  const angle = Math.acos(Math.max(-1, Math.min(1, shape.cosReach))) + 0.01
  return grid.forCap(shape.center, angle, (idx, x, y, z) => {
    if (mask[idx] === 255) return false
    if (!insideLoop(shape, x, y, z)) return false
    mask[idx] = 255
    return true
  })
}

/** Paint a round splat of `angle` radians. Returns the newly painted area weight. */
export function paintCap(grid: EquirectGrid, mask: Uint8Array, center: Vector3, angle: number): number {
  return grid.forCap(center, angle, (idx) => {
    if (mask[idx] === 255) return false
    mask[idx] = 255
    return true
  })
}

/** Mask value at a direction (nearest pixel). */
export function sampleMask(grid: EquirectGrid, mask: Uint8Array, d: Vector3): number {
  let phi = Math.atan2(d.z, -d.x)
  if (phi < 0) phi += Math.PI * 2
  const theta = Math.acos(Math.max(-1, Math.min(1, d.y)))
  const i = Math.min(grid.width - 1, Math.floor((phi / (Math.PI * 2)) * grid.width))
  const j = Math.min(grid.height - 1, Math.floor((theta / Math.PI) * grid.height))
  return mask[j * grid.width + i]
}

// ---- Moving on a sphere ------------------------------------------------------------------

const tmpAxis = new Vector3()

/**
 * Advance a surface walker: `n` (unit normal) moves `angle` radians along tangent `t`.
 * Every vector in `carry` is rotated with it, which parallel-transports headings and velocities.
 */
export function walk(n: Vector3, t: Vector3, angle: number, carry: Vector3[]): void {
  if (angle === 0) return
  tmpAxis.crossVectors(n, t)
  const len = tmpAxis.length()
  if (len < 1e-9) return
  tmpAxis.divideScalar(len)
  n.applyAxisAngle(tmpAxis, angle).normalize()
  for (const v of carry) v.applyAxisAngle(tmpAxis, angle)
}

/** Remove the normal component of `v` (in place). */
export function toTangent(v: Vector3, n: Vector3): Vector3 {
  return v.addScaledVector(n, -v.dot(n))
}

/** Any unit tangent at `n`, written to `out`. */
export function anyTangent(n: Vector3, out: Vector3): Vector3 {
  if (Math.abs(n.y) < 0.9) out.set(0, 1, 0)
  else out.set(1, 0, 0)
  return toTangent(out, n).normalize()
}

/** Seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform random direction. */
export function randomDir(r: () => number, out: Vector3): Vector3 {
  const u = r() * 2 - 1
  const a = r() * Math.PI * 2
  const s = Math.sqrt(1 - u * u)
  return out.set(s * Math.cos(a), u, s * Math.sin(a))
}
