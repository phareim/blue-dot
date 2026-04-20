import { PerspectiveCamera, Vector3 } from 'three'
import { latLonToVec3, tangentFrame } from './sphere'
import { GLOBE_RADIUS } from './scene'

const CAM_DISTANCE = 1.4
const CAM_HEIGHT = 0.6
const CAM_LERP = 0.12

export const ZOOM_MIN = 0.45
export const ZOOM_MAX = 2.6
export const ZOOM_DEFAULT = 1

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_DEFAULT
  if (z < ZOOM_MIN) return ZOOM_MIN
  if (z > ZOOM_MAX) return ZOOM_MAX
  return z
}

const desiredPos = new Vector3()
const lookAt = new Vector3()

export function updateFollowCam(
  camera: PerspectiveCamera,
  lat: number,
  lon: number,
  heading: number,
  zoom: number = ZOOM_DEFAULT,
): void {
  const z = clampZoom(zoom)
  const { up, east, north } = tangentFrame(lat, lon)
  const forward = new Vector3()
    .addScaledVector(north, Math.cos(heading))
    .addScaledVector(east, Math.sin(heading))
    .normalize()
  const dotPos = latLonToVec3(lat, lon, GLOBE_RADIUS)
  desiredPos.copy(dotPos)
    .addScaledVector(up, CAM_HEIGHT * z)
    .addScaledVector(forward, -CAM_DISTANCE * z)
  camera.position.lerp(desiredPos, CAM_LERP)
  lookAt.copy(dotPos).addScaledVector(forward, 0.6)
  camera.lookAt(lookAt)
  camera.up.copy(up)
}
