import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three'

export const GLOBE_RADIUS = 1
export const DOT_RADIUS = 0.035
export const PELLET_RADIUS = 0.02
export const GOLD_PELLET_RADIUS = 0.032

export const PELLET_VALUE = { common: 1, gold: 3 } as const
export type PelletKind = keyof typeof PELLET_VALUE

export interface SceneObjects {
  renderer: WebGLRenderer
  scene: Scene
  camera: PerspectiveCamera
  playerDot: Mesh
  globe: Mesh
}

export function createScene(canvas: HTMLCanvasElement): SceneObjects {
  const renderer = new WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)

  const scene = new Scene()
  scene.background = new Color(0x05060a)

  const camera = new PerspectiveCamera(55, 1, 0.01, 100)
  camera.position.set(0, 0.8, 2.2)
  camera.lookAt(0, 0, 0)

  scene.add(new AmbientLight(0xffffff, 0.35))
  const sun = new DirectionalLight(0xffffff, 1.0)
  sun.position.set(3, 3, 2)
  scene.add(sun)

  const globe = new Mesh(
    new SphereGeometry(GLOBE_RADIUS, 64, 48),
    new MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.9, metalness: 0.0 }),
  )
  scene.add(globe)

  scene.add(createStarfield())

  const playerDot = new Mesh(
    new SphereGeometry(DOT_RADIUS, 24, 16),
    new MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.6,
    }),
  )
  scene.add(playerDot)

  return { renderer, scene, camera, playerDot, globe }
}

export function setPlayerColor(playerDot: Mesh, hex: string): void {
  const mat = playerDot.material as MeshStandardMaterial
  mat.color.set(hex)
  mat.emissive.set(hex)
  mat.emissiveIntensity = 0.55
}

function createStarfield(): Points {
  const count = 1200
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1
    const theta = Math.random() * Math.PI * 2
    const r = Math.sqrt(1 - u * u)
    const R = 50
    positions[i * 3] = R * r * Math.cos(theta)
    positions[i * 3 + 1] = R * u
    positions[i * 3 + 2] = R * r * Math.sin(theta)
  }
  const geom = new BufferGeometry()
  geom.setAttribute('position', new BufferAttribute(positions, 3))
  const mat = new PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true })
  return new Points(geom, mat)
}

export function resizeRenderer(
  renderer: WebGLRenderer,
  camera: PerspectiveCamera,
  canvas: HTMLCanvasElement,
): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(1, h)
  camera.updateProjectionMatrix()
}

export function createPelletMesh(kind: PelletKind = 'common'): Mesh {
  if (kind === 'gold') {
    return new Mesh(
      new SphereGeometry(GOLD_PELLET_RADIUS, 14, 10),
      new MeshStandardMaterial({
        color: 0xfde047,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.8,
        roughness: 0.3,
        metalness: 0.5,
      }),
    )
  }
  return new Mesh(
    new SphereGeometry(PELLET_RADIUS, 10, 8),
    new MeshBasicMaterial({ color: 0xffffff }),
  )
}

export function pulseGoldPellet(mesh: Mesh, timeMs: number): void {
  const t = Math.sin(timeMs * 0.005) * 0.5 + 0.5 // 0..1
  const scale = 1 + 0.18 * t
  mesh.scale.setScalar(scale)
  const mat = mesh.material as MeshStandardMaterial
  mat.emissiveIntensity = 0.5 + 0.6 * t
}

export function placeOnSphere(mesh: Mesh, pos: Vector3, lift = 0): void {
  const n = pos.clone().normalize()
  mesh.position.copy(n.multiplyScalar(GLOBE_RADIUS + lift))
}
