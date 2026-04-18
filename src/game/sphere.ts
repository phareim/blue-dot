import { Vector3 } from 'three'

export interface LatLon {
  lat: number
  lon: number
}

export function latLonToVec3(lat: number, lon: number, radius: number): Vector3 {
  const cosLat = Math.cos(lat)
  return new Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  )
}

export function vec3ToLatLon(v: Vector3): LatLon {
  const r = v.length()
  if (r === 0) return { lat: 0, lon: 0 }
  const lat = Math.asin(v.y / r)
  const lon = Math.atan2(v.z, v.x)
  return { lat, lon }
}

export function greatCircleDistance(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0
  const a = latLonToVec3(lat1, lon1, 1)
  const b = latLonToVec3(lat2, lon2, 1)
  const dot = Math.max(-1, Math.min(1, a.dot(b)))
  return Math.acos(dot)
}

export function slerpLatLon(
  lat1: number, lon1: number, lat2: number, lon2: number, t: number,
): LatLon {
  const a = latLonToVec3(lat1, lon1, 1)
  const b = latLonToVec3(lat2, lon2, 1)
  const omega = Math.acos(Math.max(-1, Math.min(1, a.dot(b))))
  if (omega < 1e-8) return { lat: lat1, lon: lon1 }
  const sinOmega = Math.sin(omega)
  const k1 = Math.sin((1 - t) * omega) / sinOmega
  const k2 = Math.sin(t * omega) / sinOmega
  const v = new Vector3(
    a.x * k1 + b.x * k2,
    a.y * k1 + b.y * k2,
    a.z * k1 + b.z * k2,
  )
  return vec3ToLatLon(v)
}

export interface TangentFrame {
  up: Vector3
  east: Vector3
  north: Vector3
}

export function tangentFrame(lat: number, lon: number): TangentFrame {
  const up = latLonToVec3(lat, lon, 1).normalize()
  const worldUp = new Vector3(0, 1, 0)
  const east = new Vector3().crossVectors(up, worldUp).normalize()
  const north = new Vector3().crossVectors(east, up).normalize()
  return { up, east, north }
}

export function moveAlongHeading(
  lat: number, lon: number, heading: number, distance: number,
): LatLon {
  if (distance === 0) return { lat, lon }
  const { east, north } = tangentFrame(lat, lon)
  const dir = new Vector3()
    .addScaledVector(north, Math.cos(heading))
    .addScaledVector(east, Math.sin(heading))
    .normalize()
  const pos = latLonToVec3(lat, lon, 1)
  const result = pos.clone().multiplyScalar(Math.cos(distance))
    .addScaledVector(dir, Math.sin(distance))
  return vec3ToLatLon(result)
}
