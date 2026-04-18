# Blue Dot Phase 0 — Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-page DOM dot with a Three.js 3D globe scene where a player dot moves along the surface via keyboard + click-to-go, with a follow-camera — solo-playable, no backend.

**Architecture:** Keep React for HUD only. Mount a `<canvas>` inside a `Game` component and run an imperative Three.js render loop in a `useEffect`. Pure sphere math (lat/lon ↔ 3D, great-circle interpolation, tangent frame) lives in `src/game/sphere.ts` and is unit-tested with vitest. Visual modules (scene, camera, controls) are verified manually in the browser.

**Tech Stack:** TypeScript, React 18, Three.js (`three` + `@types/three`), Vite, vitest (new dev dep for pure-math tests).

---

## File Structure

**New:**
- `src/game/sphere.ts` — lat/lon ↔ 3D conversions, heading/tangent math, great-circle interpolation.
- `src/game/sphere.test.ts` — vitest unit tests for `sphere.ts`.
- `src/game/scene.ts` — Three.js scene setup (sphere mesh, lights, skybox, dot mesh).
- `src/game/camera.ts` — follow-cam update function.
- `src/game/controls.ts` — keyboard + pointer handlers that mutate player state.
- `src/game/state.ts` — shared player/game state types + mutable refs used by the loop.
- `src/Game.tsx` — React component that mounts the canvas and runs the render loop.
- `src/Game.css` — full-screen canvas + HUD-layer styling.
- `vitest.config.ts` — test runner config (jsdom-free, pure node).

**Modified:**
- `package.json` — add `three`, `@types/three`, `vitest`; add `test` + `test:run` scripts.
- `src/App.tsx` — render `<Game />` and the hint; drop DOM dot + parallax background.
- `src/App.css` — keep hint styles; drop `.dot` / `.container` grid styles.
- `index.html` — ensure body has no margin (Three.js full-screen).
- `src/index.css` — reset margin/padding, `html, body, #root { height: 100% }`.

**Retired (delete):**
- `src/ParallaxBackground.tsx`, `src/ParallaxBackground.css` — replaced by Three.js starfield skybox. (Phase 0 decision: retire rather than repurpose — the Three.js scene handles background directly.)

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add runtime + types + test runner**

Run:
```bash
cd /home/petter/github/blue-dot
pnpm add three
pnpm add -D @types/three vitest
```

- [ ] **Step 2: Verify install**

Run: `pnpm run typecheck`
Expected: passes (no new errors; three is installed but unused).

- [ ] **Step 3: Add test scripts**

Edit `package.json` `scripts` block to add:
```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add three, @types/three, vitest"
```

---

## Task 2: Sphere math utilities (TDD)

**Files:**
- Create: `src/game/sphere.ts`
- Create: `src/game/sphere.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Create vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 2: Write the failing tests**

Create `src/game/sphere.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test:run`
Expected: FAIL — module `./sphere` cannot be resolved.

- [ ] **Step 4: Write the implementation**

Create `src/game/sphere.ts`:
```ts
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
  const east = new Vector3().crossVectors(worldUp, up).normalize()
  const north = new Vector3().crossVectors(up, east).normalize()
  return { up, east, north }
}

// heading: radians measured clockwise from north (0 = north, PI/2 = east).
// distance: angular distance in radians on the unit sphere.
export function moveAlongHeading(
  lat: number, lon: number, heading: number, distance: number,
): LatLon {
  if (distance === 0) return { lat, lon }
  const { up, east, north } = tangentFrame(lat, lon)
  const dir = new Vector3()
    .addScaledVector(north, Math.cos(heading))
    .addScaledVector(east, Math.sin(heading))
    .normalize()
  const pos = latLonToVec3(lat, lon, 1)
  // Rodrigues-like: rotate `up` around axis (up × dir) by `distance`.
  const result = pos.clone().multiplyScalar(Math.cos(distance))
    .addScaledVector(dir, Math.sin(distance))
  return vec3ToLatLon(result)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test:run`
Expected: all tests PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add src/game/sphere.ts src/game/sphere.test.ts vitest.config.ts package.json
git commit -m "feat: sphere math utilities (lat/lon, slerp, tangent frame, heading step)"
```

---

## Task 3: Game state + types

**Files:**
- Create: `src/game/state.ts`

- [ ] **Step 1: Create state types and factory**

Create `src/game/state.ts`:
```ts
export interface PlayerState {
  lat: number
  lon: number
  heading: number // radians, 0 = north, PI/2 = east
  // When gliding toward a tapped point, these are set; otherwise null.
  glide: null | {
    fromLat: number
    fromLon: number
    toLat: number
    toLon: number
    startMs: number
    durationMs: number
  }
}

export interface Pellet {
  id: number
  lat: number
  lon: number
  kind: 'common' | 'gold'
}

export interface GameState {
  player: PlayerState
  pellets: Pellet[]
  keys: Set<string>
}

export function createGameState(): GameState {
  return {
    player: { lat: 0, lon: 0, heading: 0, glide: null },
    pellets: [],
    keys: new Set(),
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/game/state.ts
git commit -m "feat: game state types (player, pellets, input)"
```

---

## Task 4: Three.js scene setup

**Files:**
- Create: `src/game/scene.ts`

- [ ] **Step 1: Write scene module**

Create `src/game/scene.ts`:
```ts
import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  WebGLRenderer,
  Vector3,
  PointsMaterial,
  Points,
  BufferGeometry,
  BufferAttribute,
} from 'three'

export const GLOBE_RADIUS = 1
export const DOT_RADIUS = 0.035
export const PELLET_RADIUS = 0.02

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

  // Lights
  scene.add(new AmbientLight(0xffffff, 0.35))
  const sun = new DirectionalLight(0xffffff, 1.0)
  sun.position.set(3, 3, 2)
  scene.add(sun)

  // Globe
  const globe = new Mesh(
    new SphereGeometry(GLOBE_RADIUS, 64, 48),
    new MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.9, metalness: 0.0 }),
  )
  scene.add(globe)

  // Starfield skybox — procedural points on a big inverted sphere.
  scene.add(createStarfield())

  // Player dot
  const playerDot = new Mesh(
    new SphereGeometry(DOT_RADIUS, 24, 16),
    new MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.6 }),
  )
  scene.add(playerDot)

  return { renderer, scene, camera, playerDot, globe }
}

function createStarfield(): Points {
  const count = 1200
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // uniform points on a sphere of radius ~50
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

export function createPelletMesh(): Mesh {
  return new Mesh(
    new SphereGeometry(PELLET_RADIUS, 10, 8),
    new MeshBasicMaterial({ color: 0xffffff }),
  )
}

export function placeOnSphere(mesh: Mesh, pos: Vector3, lift = 0): void {
  const n = pos.clone().normalize()
  mesh.position.copy(n.multiplyScalar(GLOBE_RADIUS + lift))
}

// Silence the unused import warning; BackSide may be used for a proper skybox
// cubemap in a follow-up. Re-export so it's not a dead import.
export { BackSide }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/game/scene.ts
git commit -m "feat: three.js scene (globe, lights, starfield, player dot)"
```

---

## Task 5: Follow-camera

**Files:**
- Create: `src/game/camera.ts`

- [ ] **Step 1: Write camera update function**

Create `src/game/camera.ts`:
```ts
import { PerspectiveCamera, Vector3 } from 'three'
import { latLonToVec3, tangentFrame } from './sphere'
import { GLOBE_RADIUS } from './scene'

const CAM_DISTANCE = 1.4   // how far behind/above the dot
const CAM_HEIGHT = 0.6     // how far along `up` the camera sits
const CAM_LERP = 0.12      // 0..1 smoothing per frame

const desiredPos = new Vector3()
const lookAt = new Vector3()

export function updateFollowCam(
  camera: PerspectiveCamera,
  lat: number,
  lon: number,
  heading: number,
): void {
  const { up, east, north } = tangentFrame(lat, lon)
  // Forward direction along the surface.
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/game/camera.ts
git commit -m "feat: follow-camera that trails dot along local tangent frame"
```

---

## Task 6: Controls (keyboard + click-to-go)

**Files:**
- Create: `src/game/controls.ts`

- [ ] **Step 1: Write controls module**

Create `src/game/controls.ts`:
```ts
import { PerspectiveCamera, Raycaster, Vector2, Mesh } from 'three'
import type { GameState } from './state'
import { vec3ToLatLon, moveAlongHeading } from './sphere'

// Tune so a full hemisphere takes ~15s → PI radians / 15s = ~0.21 rad/s.
// Multiplied by Shift for big step.
const ANG_SPEED = Math.PI / 15        // rad per second forward/back
const ROT_SPEED = Math.PI / 2         // rad per second for heading rotation
const SHIFT_MULT = 2.5
const GLIDE_MS_PER_RAD = 700          // ~PI seconds for a full hemisphere

export interface ControlHandlers {
  onKeyDown: (e: KeyboardEvent) => void
  onKeyUp: (e: KeyboardEvent) => void
  onPointerDown: (e: PointerEvent) => void
}

export function createControls(
  state: GameState,
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  globe: Mesh,
  respawn: () => void,
): ControlHandlers {
  const raycaster = new Raycaster()
  const ndc = new Vector2()

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (k === 'r' || e.key === 'Home') {
      respawn()
      e.preventDefault()
      return
    }
    if (KEYS.has(k) || KEYS.has(e.key)) {
      state.keys.add(k)
      state.keys.add(e.key)
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    state.keys.delete(e.key.toLowerCase())
    state.keys.delete(e.key)
  }

  const onPointerDown = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(ndc, camera)
    const hit = raycaster.intersectObject(globe, false)[0]
    if (!hit) return
    const { lat, lon } = vec3ToLatLon(hit.point)
    const p = state.player
    const duration = GLIDE_MS_PER_RAD *
      Math.max(0.1, Math.acos(Math.max(-1, Math.min(1,
        Math.sin(p.lat) * Math.sin(lat) +
        Math.cos(p.lat) * Math.cos(lat) * Math.cos(lon - p.lon),
      ))))
    p.glide = {
      fromLat: p.lat,
      fromLon: p.lon,
      toLat: lat,
      toLon: lon,
      startMs: performance.now(),
      durationMs: duration,
    }
  }

  return { onKeyDown, onKeyUp, onPointerDown }
}

const KEYS = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'w', 'a', 's', 'd', 'W', 'A', 'S', 'D', 'Shift', 'shift',
])

export function tickKeyboard(state: GameState, dtMs: number): void {
  if (state.player.glide) return // glide overrides keyboard movement
  const dt = dtMs / 1000
  const shift = state.keys.has('Shift') || state.keys.has('shift')
  const mult = shift ? SHIFT_MULT : 1
  const forward = state.keys.has('ArrowUp') || state.keys.has('w') || state.keys.has('arrowup')
  const back = state.keys.has('ArrowDown') || state.keys.has('s') || state.keys.has('arrowdown')
  const left = state.keys.has('ArrowLeft') || state.keys.has('a') || state.keys.has('arrowleft')
  const right = state.keys.has('ArrowRight') || state.keys.has('d') || state.keys.has('arrowright')

  if (left) state.player.heading -= ROT_SPEED * dt * mult
  if (right) state.player.heading += ROT_SPEED * dt * mult

  let step = 0
  if (forward) step += ANG_SPEED * dt * mult
  if (back) step -= ANG_SPEED * dt * mult
  if (step !== 0) {
    const { lat, lon } = moveAlongHeading(
      state.player.lat, state.player.lon, state.player.heading, step,
    )
    state.player.lat = lat
    state.player.lon = lon
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/game/controls.ts
git commit -m "feat: keyboard steering + click-to-go along great-circle glide"
```

---

## Task 7: Game React component

**Files:**
- Create: `src/Game.tsx`
- Create: `src/Game.css`

- [ ] **Step 1: Write Game.css**

Create `src/Game.css`:
```css
.game-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  background: #05060a;
}
```

- [ ] **Step 2: Write Game component**

Create `src/Game.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { createScene, resizeRenderer, createPelletMesh, placeOnSphere } from './game/scene'
import { createGameState, type Pellet } from './game/state'
import { createControls, tickKeyboard } from './game/controls'
import { updateFollowCam } from './game/camera'
import { latLonToVec3, slerpLatLon } from './game/sphere'
import { Vector3, Mesh } from 'three'
import './Game.css'

const CLIENT_PELLET_TARGET = 60

function randomSpherePoint() {
  const u = Math.random() * 2 - 1
  const theta = Math.random() * Math.PI * 2
  const r = Math.sqrt(1 - u * u)
  const v = new Vector3(r * Math.cos(theta), u, r * Math.sin(theta))
  const lat = Math.asin(v.y)
  const lon = Math.atan2(v.z, v.x)
  return { lat, lon }
}

export function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const s = createScene(canvas)
    const state = createGameState()

    const respawn = () => {
      const { lat, lon } = randomSpherePoint()
      state.player.lat = lat
      state.player.lon = lon
      state.player.heading = Math.random() * Math.PI * 2
      state.player.glide = null
    }
    respawn()

    // Seed pellets.
    const pelletMeshes = new Map<number, Mesh>()
    let nextId = 1
    const spawnPellet = () => {
      const { lat, lon } = randomSpherePoint()
      const pellet: Pellet = { id: nextId++, lat, lon, kind: 'common' }
      state.pellets.push(pellet)
      const m = createPelletMesh()
      placeOnSphere(m, latLonToVec3(lat, lon, 1), 0.005)
      s.scene.add(m)
      pelletMeshes.set(pellet.id, m)
    }
    for (let i = 0; i < CLIENT_PELLET_TARGET; i++) spawnPellet()

    const { onKeyDown, onKeyUp, onPointerDown } = createControls(
      state, canvas, s.camera, s.globe, respawn,
    )
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    canvas.addEventListener('pointerdown', onPointerDown)

    const onResize = () => resizeRenderer(s.renderer, s.camera, canvas)
    window.addEventListener('resize', onResize)
    onResize()

    let prev = performance.now()
    let raf = 0
    const loop = (now: number) => {
      const dt = Math.min(50, now - prev)
      prev = now

      if (state.player.glide) {
        const g = state.player.glide
        const t = Math.min(1, (now - g.startMs) / g.durationMs)
        const { lat, lon } = slerpLatLon(g.fromLat, g.fromLon, g.toLat, g.toLon, t)
        state.player.lat = lat
        state.player.lon = lon
        if (t >= 1) state.player.glide = null
      } else {
        tickKeyboard(state, dt)
      }

      placeOnSphere(s.playerDot, latLonToVec3(state.player.lat, state.player.lon, 1), 0.01)
      updateFollowCam(s.camera, state.player.lat, state.player.lon, state.player.heading)
      s.renderer.render(s.scene, s.camera)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('resize', onResize)
      canvas.removeEventListener('pointerdown', onPointerDown)
      pelletMeshes.forEach((m) => {
        s.scene.remove(m)
        m.geometry.dispose()
      })
      s.renderer.dispose()
    }
  }, [])

  return <canvas ref={canvasRef} className="game-canvas" />
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/Game.tsx src/Game.css
git commit -m "feat: Game component (render loop, pellets, controls wiring)"
```

---

## Task 8: Wire into App.tsx, retire parallax + old dot

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Modify: `src/index.css`
- Delete: `src/ParallaxBackground.tsx`, `src/ParallaxBackground.css`

- [ ] **Step 1: Replace App.tsx**

Overwrite `src/App.tsx`:
```tsx
import { Game } from './Game'
import './App.css'

export function App() {
  return (
    <>
      <Game />
      <div className="hint" aria-hidden="true">
        <kbd>↑</kbd><kbd>↓</kbd> move
        <span className="hint__sep">·</span>
        <kbd>←</kbd><kbd>→</kbd> turn
        <span className="hint__sep">·</span>
        <kbd>Shift</kbd> fast
        <span className="hint__sep">·</span>
        <kbd>R</kbd> respawn
        <span className="hint__sep">·</span>
        click to go
      </div>
    </>
  )
}
```

- [ ] **Step 2: Simplify App.css**

Overwrite `src/App.css` keeping only the hint styles (the `.container` and `.dot*` rules are dead):
```css
.hint {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  color: #e2e8f0;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  z-index: 2;
}

.hint kbd {
  display: inline-block;
  min-width: 22px;
  padding: 3px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #f8fafc;
  font: inherit;
  font-size: 12px;
  text-align: center;
}

.hint__sep {
  opacity: 0.4;
}
```

- [ ] **Step 3: Update index.css**

Read current `src/index.css` first (may be empty or near-empty). Replace with:
```css
html, body, #root {
  height: 100%;
}
body {
  margin: 0;
  background: #05060a;
  color: #e2e8f0;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, sans-serif;
  overflow: hidden;
}
```

- [ ] **Step 4: Delete parallax files**

```bash
git rm src/ParallaxBackground.tsx src/ParallaxBackground.css
```

- [ ] **Step 5: Typecheck + build**

Run: `pnpm run build`
Expected: passes (catches the retired imports).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css src/index.css
git commit -m "feat: mount Game component; retire DOM dot + parallax"
```

---

## Task 9: Manual browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start dev server**

Run: `pnpm run dev`

- [ ] **Step 2: Open browser to the dev URL (typically http://localhost:5173)**

Verify:
- A blue globe is visible against a starfield, with lighting.
- A bright cyan dot sits on the globe surface.
- `↑` / `W` moves forward; `↓` / `S` moves backward (the globe rotates under you).
- `←` / `→` / `A` / `D` turns the heading; the camera swings with the dot.
- `Shift` + movement moves noticeably faster.
- `R` respawns the dot at a random location.
- Clicking somewhere on the globe makes the dot glide there along a great-circle arc.
- Clicking off the globe (starfield/empty space) does nothing.
- White pellets are scattered across the sphere.
- Camera follows the dot smoothly, horizon curves, pellets pop over it.

- [ ] **Step 3: Run typecheck and tests one more time**

Run: `pnpm run typecheck && pnpm test:run`
Expected: both pass.

- [ ] **Step 4: Final commit if any polish tweaks were needed**

(Skip if nothing changed.)

---

## Verification (end-to-end)

- `pnpm test:run` — all sphere math tests green.
- `pnpm run typecheck` — clean.
- `pnpm run build` — clean.
- `pnpm run dev` — interactive verification per Task 9.
- Existing Cloudflare Pages deploy (`pnpm run deploy`) still builds and ships the SPA; no backend work yet.
