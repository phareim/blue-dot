import { Color, HalfFloatType, PerspectiveCamera, Scene, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const SHOCKS = 4

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uCA: { value: 0 },
    uFlash: { value: 0 },
    uFlashCol: { value: new Color(1, 1, 1) },
    uVig: { value: 0.55 },
    uGrain: { value: 0.018 },
    uSat: { value: 1.08 },
    uTint: { value: new Color(1, 1, 1) },
    uLens: { value: new Vector3(0.5, 0.5, 0) },
    uShock: { value: Array.from({ length: SHOCKS }, () => new Vector4(0, 0, 0, 0)) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uCA, uFlash, uVig, uGrain, uSat;
    uniform vec3 uFlashCol, uTint, uLens;
    uniform vec4 uShock[${SHOCKS}];
    varying vec2 vUv;
    void main() {
      vec2 asp = vec2(uRes.x / uRes.y, 1.0);
      vec2 uv = vUv;
      for (int i = 0; i < ${SHOCKS}; i++) {
        vec4 s = uShock[i];
        if (s.w <= 0.0) continue;
        vec2 d = (uv - s.xy) * asp;
        float r = length(d) + 1e-5;
        float k = s.w * exp(-pow((r - s.z) * 14.0, 2.0));
        uv -= (d / r) / asp * k * 0.035;
      }
      // Gravitational lens: deflection falls off as 1/r; inside the Einstein radius the far side shows through.
      float shadow = 1.0;
      if (uLens.z > 0.0) {
        float rs = uLens.z;
        vec2 d = (uv - uLens.xy) * asp;
        float r = max(length(d), 1e-4);
        float defl = rs * rs * 3.0 / r;
        uv -= (d / r) / asp * defl;
        shadow = smoothstep(rs * 0.85, rs * 1.15, r);
      }
      vec2 dir = uv - 0.5;
      float ca = uCA * (0.0015 + dot(dir, dir) * 0.03);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;
      col *= shadow;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat) * uTint;
      col += uFlashCol * uFlash;
      float v = smoothstep(1.3, 0.3, length((vUv - 0.5) * asp));
      col *= mix(1.0, v, uVig);
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

interface Shock { x: number; y: number; r: number; speed: number; strength: number; life: number; age: number }

export class Post {
  readonly composer: EffectComposer
  readonly bloom: UnrealBloomPass
  readonly final: ShaderPass
  private shocks: Shock[] = []
  ca = 0
  flash = 0
  readonly flashCol = new Color(1, 1, 1)
  readonly tint = new Color(1, 1, 1)
  sat = 1.08
  lens = new Vector3(0.5, 0.5, 0)
  bloomBoost = 0

  constructor(private renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType })
    this.composer = new EffectComposer(renderer, target)
    this.composer.addPass(new RenderPass(scene, camera))
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.8, 0.38, 0.9)
    this.composer.addPass(this.bloom)
    this.final = new ShaderPass(FinalShader)
    this.composer.addPass(this.final)
    this.composer.addPass(new OutputPass())
  }

  setSize(w: number, h: number, dpr: number) {
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(dpr)
    this.composer.setSize(w, h)
    // Bloom at reduced resolution is most of the saving on a phone.
    this.bloom.resolution.set(Math.round((w * dpr) / 2), Math.round((h * dpr) / 2))
    ;(this.final.uniforms.uRes.value as Vector2).set(w * dpr, h * dpr)
  }

  /** A ripple across the screen from (x, y) in 0..1 UV. */
  shock(x: number, y: number, strength = 1, speed = 1.4, life = 0.7) {
    if (this.shocks.length >= SHOCKS) this.shocks.shift()
    this.shocks.push({ x, y, r: 0, speed, strength, life, age: 0 })
  }

  update(dt: number, time: number) {
    const u = this.final.uniforms
    u.uTime.value = time
    const arr = u.uShock.value as Vector4[]
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i]
      s.age += dt
      s.r += s.speed * dt
      if (s.age >= s.life) this.shocks.splice(i, 1)
    }
    for (let i = 0; i < SHOCKS; i++) {
      const s = this.shocks[i]
      if (!s) { arr[i].set(0, 0, 0, 0); continue }
      arr[i].set(s.x, s.y, s.r, s.strength * (1 - s.age / s.life))
    }
    this.ca = Math.max(0, this.ca - dt * 2.2)
    this.flash = Math.max(0, this.flash - dt * 3.2)
    this.bloomBoost = Math.max(0, this.bloomBoost - dt * 1.5)
    u.uCA.value = 0.35 + this.ca * 6
    u.uFlash.value = this.flash
    ;(u.uFlashCol.value as Color).copy(this.flashCol)
    ;(u.uTint.value as Color).copy(this.tint)
    u.uSat.value = this.sat
    ;(u.uLens.value as Vector3).copy(this.lens)
    this.bloom.strength = 0.8 + this.bloomBoost
  }

  render() {
    this.composer.render()
  }
}
