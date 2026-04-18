import { PerspectiveCamera, Vector3 } from 'three'
import { latLonToVec3, tangentFrame } from './sphere'
import { GLOBE_RADIUS } from './scene'

const CAM_DISTANCE = 1.4
const CAM_HEIGHT = 0.6
const CAM_LERP = 0.12

const desiredPos = new Vector3()
const lookAt = new Vector3()

export function updateFollowCam(
  camera: PerspectiveCamera,
  lat: number,
  lon: number,
  heading: number,
): void {
  const { up, east, north } = tangentFrame(lat, lon)
  const forward = new Vector3()
    .addScaledVector(north, Math.cos(heading))
    .addScaledVector(east, Math.sin(heading))
    .normalize()
  const dotPos = latLonToVec3(lat, lon, GLOBE_RADIUS)
  desiredPos.copy(dotPos)
    .addScaledVector(up, CAM_HEIGHT)
    .addScaledVector(forward, -CAM_DISTANCE)
  camera.position.lerp(desiredPos, CAM_LERP)
  lookAt.copy(dotPos).addScaledVector(forward, 0.6)
  camera.lookAt(lookAt)
  camera.up.copy(up)
}
