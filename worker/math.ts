// Minimal spherical math used server-side. No three dependency.

export function randomSpherePoint(): { lat: number; lon: number } {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  const x = r * Math.cos(theta)
  const y = u
  const z = r * Math.sin(theta)
  return { lat: Math.asin(y), lon: Math.atan2(z, x) }
}

export function greatCircleDistance(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const sinLat = Math.sin(lat1) * Math.sin(lat2)
  const cosLat = Math.cos(lat1) * Math.cos(lat2)
  const dot = Math.max(-1, Math.min(1, sinLat + cosLat * Math.cos(lon1 - lon2)))
  return Math.acos(dot)
}
