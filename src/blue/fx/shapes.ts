import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three'
import type { EnemyKind } from '../config'
import { glowMaterial } from './materials'

type P2 = [number, number]

interface Build { pos: number[]; col: number[]; idx: number[] }

/** A closed outline of thickness `th` in the XZ plane (Y is the surface normal). */
function outline(b: Build, pts: P2[], th: number, bright: number, y = 0) {
  const n = pts.length
  const base = b.pos.length / 3
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const a = pts[(i - 1 + n) % n]
    const c = pts[(i + 1) % n]
    const e1 = [p[0] - a[0], p[1] - a[1]]
    const e2 = [c[0] - p[0], c[1] - p[1]]
    const l1 = Math.hypot(e1[0], e1[1]) || 1
    const l2 = Math.hypot(e2[0], e2[1]) || 1
    const n1 = [-e1[1] / l1, e1[0] / l1]
    const n2 = [-e2[1] / l2, e2[0] / l2]
    let mx = n1[0] + n2[0]
    let my = n1[1] + n2[1]
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const scale = Math.min(2.2, 1 / Math.max(0.3, mx * n1[0] + my * n1[1]))
    const o = (th / 2) * scale
    b.pos.push(p[0] + mx * o, y, p[1] + my * o, p[0] - mx * o, y, p[1] - my * o)
    b.col.push(bright, bright, bright, bright, bright, bright)
  }
  for (let i = 0; i < n; i++) {
    const a = base + i * 2
    const c = base + ((i + 1) % n) * 2
    b.idx.push(a, a + 1, c, a + 1, c + 1, c)
  }
}

function fill(b: Build, pts: P2[], bright: number, y = -0.01) {
  const base = b.pos.length / 3
  let cx = 0
  let cz = 0
  for (const p of pts) { cx += p[0]; cz += p[1] }
  cx /= pts.length
  cz /= pts.length
  b.pos.push(cx, y, cz)
  b.col.push(bright, bright, bright)
  for (const p of pts) {
    b.pos.push(p[0], y, p[1])
    b.col.push(bright * 0.4, bright * 0.4, bright * 0.4)
  }
  for (let i = 0; i < pts.length; i++) b.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % pts.length))
}

function finish(b: Build): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3))
  g.setAttribute('color', new BufferAttribute(new Float32Array(b.col), 3))
  g.setIndex(b.idx)
  g.computeBoundingSphere()
  return g
}

function poly(n: number, r: number, rot = 0): P2[] {
  const out: P2[] = []
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

function star(n: number, r1: number, r2: number, rot = Math.PI / 2): P2[] {
  const out: P2[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2
    const r = i % 2 === 0 ? r1 : r2
    out.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return out
}

const scaleP = (pts: P2[], s: number): P2[] => pts.map(([x, z]) => [x * s, z * s])

/** Unit-sized neon shape per enemy kind; forward is +Z. */
export function enemyGeometry(kind: EnemyKind): BufferGeometry {
  const b: Build = { pos: [], col: [], idx: [] }
  switch (kind) {
    case 'mite': {
      const d: P2[] = [[0, 1], [0.78, 0], [0, -1], [-0.78, 0]]
      outline(b, d, 0.2, 1)
      outline(b, scaleP(d, 0.42), 0.14, 0.8)
      fill(b, d, 0.22)
      break
    }
    case 'hunter': {
      const c: P2[] = [[0, 1.15], [0.9, -0.75], [0, -0.28], [-0.9, -0.75]]
      outline(b, c, 0.2, 1)
      fill(b, c, 0.25)
      break
    }
    case 'shear': {
      const s = star(4, 1.15, 0.3, 0)
      outline(b, s, 0.17, 1)
      outline(b, poly(4, 0.22, Math.PI / 4), 0.12, 1.2)
      fill(b, s, 0.2)
      break
    }
    case 'spore': {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        const blade: P2[] = [[0, 0], [1.05, 0.12], [0.3, 0.95]].map(([x, z]) => [x * ca - z * sa, x * sa + z * ca] as P2)
        outline(b, blade, 0.15, 1)
        fill(b, blade, 0.22)
      }
      break
    }
    case 'warden': {
      const h = poly(6, 1, Math.PI / 6)
      outline(b, h, 0.16, 1)
      outline(b, poly(6, 0.62, 0), 0.12, 0.85)
      outline(b, poly(3, 0.28, Math.PI / 2), 0.1, 1.2)
      fill(b, h, 0.18)
      break
    }
    case 'gem': {
      const s = star(5, 1.1, 0.48)
      outline(b, s, 0.16, 1.2)
      fill(b, s, 0.5)
      break
    }
  }
  return finish(b)
}

export function enemyMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, transparent: true, blending: AdditiveBlending, depthWrite: false })
}

/** The comet: a white-hot core, a halo that faces the camera, and a chevron showing where it points. */
export function makeComet(color: Color) {
  const group = new Group()
  const coreMat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(4) })
  const core = new Mesh(new IcosahedronGeometry(0.36, 2), coreMat)
  group.add(core)
  const halo = new Mesh(new PlaneGeometry(1, 1), glowMaterial(color, 2.2))
  halo.scale.setScalar(3.2)
  halo.renderOrder = 6
  const chevMat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
  const chevron = new Mesh(enemyGeometryChevron(), chevMat)
  return { group, core, coreMat, halo, chevron, chevMat }
}

function enemyGeometryChevron(): BufferGeometry {
  const b: Build = { pos: [], col: [], idx: [] }
  const c: P2[] = [[0, 0.5], [0.45, -0.3], [0, -0.08], [-0.45, -0.3]]
  outline(b, c, 0.1, 1)
  const g = finish(b)
  g.deleteAttribute('color')
  return g
}

/** A power-up: glowing core in a spinning ring. */
export function makeOrb(color: Color) {
  const group = new Group()
  const core = new Mesh(new SphereGeometry(0.42, 20, 14), new MeshBasicMaterial({ color: color.clone().multiplyScalar(3) }))
  group.add(core)
  const ringMat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(2.2), side: DoubleSide })
  const ring = new Mesh(new TorusGeometry(0.85, 0.06, 8, 40), ringMat)
  group.add(ring)
  const ring2 = new Mesh(new TorusGeometry(0.65, 0.04, 8, 32), ringMat)
  ring2.rotation.x = Math.PI / 2
  group.add(ring2)
  const halo = new Mesh(new PlaneGeometry(1, 1), glowMaterial(color, 1.6))
  halo.scale.setScalar(3.4)
  return { group, ring, ring2, halo }
}

/** The launch star that throws the comet to the next world. */
export function makeLaunchStar() {
  const group = new Group()
  const shape = new Shape()
  const s = star(5, 1.5, 0.68)
  shape.moveTo(s[0][0], s[0][1])
  for (let i = 1; i < s.length; i++) shape.lineTo(s[i][0], s[i][1])
  shape.closePath()
  const geo = new ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 })
  geo.center()
  const mat = new MeshBasicMaterial({ color: new Color(1, 0.8, 0.25).multiplyScalar(3.2) })
  const starMesh = new Mesh(geo, mat)
  group.add(starMesh)
  const beamMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new Color(1, 0.8, 0.35) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uColor; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 1.6) * (0.6 + 0.4*sin(vUv.y*30.0 - uTime*8.0)); float edge = pow(1.0 - abs(fract(vUv.x*2.0)*2.0-1.0), 2.0); gl_FragColor = vec4(uColor * a * edge * 0.7, 1.0); }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  const beam = new Mesh(new CylinderGeometry(0.5, 0.9, 18, 24, 1, true), beamMat)
  beam.position.y = 9
  const halo = new Mesh(new PlaneGeometry(1, 1), glowMaterial(new Color(1, 0.75, 0.3), 2))
  halo.scale.setScalar(6)
  return { group, starMesh, beam, beamMat, halo }
}

/** A camera-facing shock ring for the supernova. Set `uA` for its brightness. */
export function makeShockRing(): Mesh {
  const mat = new ShaderMaterial({
    uniforms: { uA: { value: 0 }, uColor: { value: new Color(2.4, 1.7, 1.1) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uA; uniform vec3 uColor; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float k = smoothstep(0.78, 0.96, d) * (1.0 - smoothstep(0.96, 1.0, d)); float inner = smoothstep(0.2, 0.95, d) * (1.0 - step(1.0, d)) * 0.12; gl_FragColor = vec4(uColor * (k + inner) * uA, 1.0); }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  const m = new Mesh(new PlaneGeometry(1, 1), mat)
  m.frustumCulled = false
  m.renderOrder = 7
  return m
}

/** A singularity: a black core inside a hot accretion disc. */
export function makeSingularity() {
  const group = new Group()
  const core = new Mesh(new SphereGeometry(1, 28, 20), new MeshBasicMaterial({ color: 0x000000 }))
  group.add(core)
  const discMat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec3 vP; void main(){ float r = length(vP.xy); float a = atan(vP.y, vP.x); float k = smoothstep(1.0, 1.25, r) * (1.0 - smoothstep(1.6, 3.2, r)); float sw = 0.6 + 0.4*sin(a*5.0 + r*6.0 - uTime*9.0); vec3 c = mix(vec3(2.6,1.2,0.4), vec3(1.2,0.5,3.0), smoothstep(1.2, 2.8, r)); gl_FragColor = vec4(c*k*sw*1.8, 1.0); }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
  const disc = new Mesh(new RingGeometry(0.9, 3.4, 64, 1), discMat)
  disc.rotation.x = -Math.PI / 2
  group.add(disc)
  return { group, discMat, disc }
}
