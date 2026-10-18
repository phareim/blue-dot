import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  EquirectGrid,
  anyTangent,
  arcsCross,
  detectLoop,
  insideLoopV,
  loopVertices,
  makeLoopShape,
  paintCap,
  paintLoop,
  sampleMask,
  walk,
} from './geo'

const v = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize()

/** A ring of `n` points at angular radius `r` around `c`. */
function ring(c: Vector3, r: number, n: number): Vector3[] {
  const t = anyTangent(c, new Vector3())
  const b = new Vector3().crossVectors(c, t)
  const out: Vector3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const dir = t.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a))
    out.push(c.clone().multiplyScalar(Math.cos(r)).addScaledVector(dir, Math.sin(r)).normalize())
  }
  return out
}

describe('arcsCross', () => {
  it('finds a plain crossing and its point', () => {
    const out = new Vector3()
    expect(arcsCross(v(1, 0, -0.1), v(1, 0, 0.1), v(1, -0.1, 0), v(1, 0.1, 0), out)).toBe(true)
    expect(out.distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-9)
  })
  it('rejects parallel and disjoint arcs', () => {
    expect(arcsCross(v(1, 0, -0.1), v(1, 0, 0.1), v(1, 0.05, -0.1), v(1, 0.05, 0.1))).toBe(false)
    expect(arcsCross(v(1, 0, -0.1), v(1, 0, 0.1), v(1, 0.2, 0.05), v(1, 0.3, 0.05))).toBe(false)
  })
  it('rejects arcs on opposite sides of the sphere', () => {
    expect(arcsCross(v(1, 0, 0.1), v(1, 0, -0.1), v(-1, 0.1, 0), v(-1, -0.1, 0))).toBe(false)
  })
})

describe('loop shape', () => {
  it('knows inside from outside, and the antipode is outside', () => {
    const c = v(0.3, 0.8, -0.5)
    const shape = makeLoopShape(ring(c, 0.4, 48))
    expect(shape.ok).toBe(true)
    expect(insideLoopV(shape, c)).toBe(true)
    const t = anyTangent(c, new Vector3())
    const near = c.clone().multiplyScalar(Math.cos(0.3)).addScaledVector(t, Math.sin(0.3))
    const far = c.clone().multiplyScalar(Math.cos(0.5)).addScaledVector(t, Math.sin(0.5))
    expect(insideLoopV(shape, near)).toBe(true)
    expect(insideLoopV(shape, far)).toBe(false)
    expect(insideLoopV(shape, c.clone().negate())).toBe(false)
  })
  it('measures area like a spherical cap', () => {
    const r = 0.5
    const shape = makeLoopShape(ring(v(0, 1, 0), r, 256))
    expect(shape.area).toBeCloseTo(2 * Math.PI * (1 - Math.cos(r)), 2)
  })
  it('handles a concave (C-shaped) loop', () => {
    // A crescent: outer ring, then back along a smaller ring offset into it.
    const c = v(0, 0, 1)
    const outer = ring(c, 0.4, 64)
    const shape = makeLoopShape(outer.slice(0, 48).concat(ring(c, 0.2, 64).slice(0, 48).reverse()))
    expect(shape.ok).toBe(true)
    expect(insideLoopV(shape, c)).toBe(false) // the bite of the C
  })
  it('refuses loops that reach past a hemisphere', () => {
    expect(makeLoopShape(ring(v(1, 0, 0), 1.5, 32)).ok).toBe(false)
  })
})

describe('detectLoop', () => {
  /** Walk a path on the unit sphere, turning `turn(i)` radians per step, and return its points. */
  function path(steps: number, step: number, turn: (i: number) => number): Vector3[] {
    const n = v(0, 0, 1)
    const h = new Vector3(1, 0, 0)
    const pts = [n.clone()]
    for (let i = 0; i < steps; i++) {
      h.applyAxisAngle(n, turn(i))
      walk(n, h, step, [h])
      pts.push(n.clone())
    }
    return pts
  }

  it('closes when the path crosses itself', () => {
    // Straight, then a tight circle that crosses the straight part.
    const pts = path(120, 0.01, (i) => (i < 20 ? 0 : 0.1))
    const out = new Vector3()
    let hit = null
    let at = -1
    for (let k = 6; k <= pts.length && !hit; k++) {
      hit = detectLoop(pts, k, 0, 8, out)
      at = k
    }
    expect(hit).not.toBeNull()
    expect(hit!.cross).not.toBeNull()
    expect(at).toBeGreaterThan(60)
    expect(at).toBeLessThan(100)
    const verts = pts.map(() => new Vector3())
    const count = loopVertices(pts, hit!, verts)
    const shape = makeLoopShape(verts, count)
    expect(shape.ok).toBe(true)
    // Circle of radius step/turn = 0.1 rad: area ≈ π r².
    expect(shape.area).toBeGreaterThan(0.02)
    expect(shape.area).toBeLessThan(0.045)
  })

  it('never closes on a straight or gently curving path', () => {
    const pts = path(200, 0.01, () => 0.004)
    const out = new Vector3()
    for (let k = 6; k <= pts.length; k++) expect(detectLoop(pts, k, 0.02, 12, out)).toBeNull()
  })

  it('snaps closed when the head comes back near an old point', () => {
    // A circle that ends just short of where it began, offset sideways so it never crosses.
    const pts = path(60, 0.01, () => (Math.PI * 2) / 63)
    const out = new Vector3()
    expect(detectLoop(pts, pts.length, 0, 8, out)).toBeNull()
    const hit = detectLoop(pts, pts.length, 0.04, 8, out)
    expect(hit).not.toBeNull()
    expect(hit!.cross).toBeNull()
    expect(hit!.from).toBe(0)
  })
})

describe('paint mask', () => {
  const grid = new EquirectGrid(512, 256)
  const capFraction = (r: number) => (1 - Math.cos(r)) / 2

  for (const [name, c] of [
    ['equator', v(1, 0, 0.2)],
    ['pole', v(0, 1, 0)],
    ['seam', v(-1, 0.1, 0)], // φ = 0 lies on −x
  ] as const) {
    it(`paints a loop's area at the ${name}`, () => {
      const mask = new Uint8Array(512 * 256)
      const r = 0.45
      const gained = paintLoop(grid, mask, makeLoopShape(ring(c, r, 96)))
      expect(gained / grid.totalWeight).toBeCloseTo(capFraction(r), 2)
      expect(sampleMask(grid, mask, c)).toBe(255)
      expect(sampleMask(grid, mask, c.clone().negate())).toBe(0)
    })
  }

  it('does not count paint twice', () => {
    const mask = new Uint8Array(512 * 256)
    const c = v(0.2, 0.4, 0.9)
    const first = paintCap(grid, mask, c, 0.3)
    expect(first / grid.totalWeight).toBeCloseTo(capFraction(0.3), 2)
    expect(paintCap(grid, mask, c, 0.3)).toBe(0)
  })
})
