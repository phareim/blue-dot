import { describe, it, expect } from 'vitest'
import {
  latLonToVec3,
  vec3ToLatLon,
  greatCircleDistance,
  slerpLatLon,
  tangentFrame,
  moveAlongHeading,
} from './sphere'

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('latLonToVec3 / vec3ToLatLon', () => {
  it('round-trips (0, 0) to +X axis', () => {
    const v = latLonToVec3(0, 0, 1)
    expect(close(v.x, 1)).toBe(true)
    expect(close(v.y, 0)).toBe(true)
    expect(close(v.z, 0)).toBe(true)
  })

  it('north pole is +Y', () => {
    const v = latLonToVec3(Math.PI / 2, 0, 1)
    expect(close(v.y, 1)).toBe(true)
  })

  it('round-trips latitude and longitude', () => {
    const lat = 0.6
    const lon = -1.2
    const v = latLonToVec3(lat, lon, 1)
    const { lat: lat2, lon: lon2 } = vec3ToLatLon(v)
    expect(close(lat, lat2)).toBe(true)
    expect(close(lon, lon2)).toBe(true)
  })
})

describe('greatCircleDistance', () => {
  it('is zero for identical points', () => {
    expect(greatCircleDistance(0.1, 0.2, 0.1, 0.2)).toBeCloseTo(0, 10)
  })

  it('is PI for antipodal points on unit sphere', () => {
    expect(greatCircleDistance(0, 0, 0, Math.PI)).toBeCloseTo(Math.PI, 6)
  })

  it('is PI/2 for equator to north pole', () => {
    expect(greatCircleDistance(0, 0, Math.PI / 2, 0)).toBeCloseTo(Math.PI / 2, 6)
  })
})

describe('slerpLatLon', () => {
  it('t=0 returns start', () => {
    const r = slerpLatLon(0.1, 0.2, 0.5, 0.8, 0)
    expect(r.lat).toBeCloseTo(0.1, 10)
    expect(r.lon).toBeCloseTo(0.2, 10)
  })

  it('t=1 returns end', () => {
    const r = slerpLatLon(0.1, 0.2, 0.5, 0.8, 1)
    expect(r.lat).toBeCloseTo(0.5, 6)
    expect(r.lon).toBeCloseTo(0.8, 6)
  })

  it('midpoint stays on unit sphere', () => {
    const r = slerpLatLon(0, 0, Math.PI / 2, 0, 0.5)
    const v = latLonToVec3(r.lat, r.lon, 1)
    expect(close(v.length(), 1, 1e-6)).toBe(true)
  })
})

describe('tangentFrame', () => {
  it('produces orthonormal basis at (0,0)', () => {
    const { up, east, north } = tangentFrame(0, 0)
    expect(close(up.length(), 1)).toBe(true)
    expect(close(east.length(), 1)).toBe(true)
    expect(close(north.length(), 1)).toBe(true)
    expect(close(up.dot(east), 0)).toBe(true)
    expect(close(up.dot(north), 0)).toBe(true)
    expect(close(east.dot(north), 0)).toBe(true)
  })

  it('up points outward from origin', () => {
    const { up } = tangentFrame(0.3, -0.4)
    const radial = latLonToVec3(0.3, -0.4, 1).normalize()
    expect(close(up.dot(radial), 1, 1e-6)).toBe(true)
  })
})

describe('moveAlongHeading', () => {
  it('zero distance returns the same point', () => {
    const r = moveAlongHeading(0.1, 0.2, 0, 0)
    expect(r.lat).toBeCloseTo(0.1, 10)
    expect(r.lon).toBeCloseTo(0.2, 10)
  })

  it('moving north from equator increases latitude', () => {
    const r = moveAlongHeading(0, 0, 0, 0.1)
    expect(r.lat).toBeGreaterThan(0)
    expect(Math.abs(r.lon)).toBeLessThan(1e-6)
  })

  it('moving east from equator increases longitude', () => {
    const r = moveAlongHeading(0, 0, Math.PI / 2, 0.1)
    expect(r.lon).toBeGreaterThan(0)
    expect(Math.abs(r.lat)).toBeLessThan(1e-6)
  })

  it('result stays on unit sphere', () => {
    const r = moveAlongHeading(0.3, 0.4, 1.1, 0.5)
    const v = latLonToVec3(r.lat, r.lon, 1)
    expect(v.length()).toBeCloseTo(1, 6)
  })
})
