import { describe, it, expect } from 'vitest'
import { clampZoom, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from './camera'

describe('clampZoom', () => {
  it('passes through values inside the range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(ZOOM_MIN + 0.01)).toBeCloseTo(ZOOM_MIN + 0.01, 10)
    expect(clampZoom(ZOOM_MAX - 0.01)).toBeCloseTo(ZOOM_MAX - 0.01, 10)
  })

  it('clamps values below the minimum', () => {
    expect(clampZoom(ZOOM_MIN - 1)).toBe(ZOOM_MIN)
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(clampZoom(-5)).toBe(ZOOM_MIN)
  })

  it('clamps values above the maximum', () => {
    expect(clampZoom(ZOOM_MAX + 1)).toBe(ZOOM_MAX)
    expect(clampZoom(100)).toBe(ZOOM_MAX)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampZoom(Number.NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Number.NEGATIVE_INFINITY)).toBe(ZOOM_DEFAULT)
  })

  it('exposes a sensible default inside the range', () => {
    expect(ZOOM_DEFAULT).toBeGreaterThanOrEqual(ZOOM_MIN)
    expect(ZOOM_DEFAULT).toBeLessThanOrEqual(ZOOM_MAX)
  })
})
