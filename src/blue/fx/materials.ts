import {
  AdditiveBlending,
  BackSide,
  Color,
  DataTexture,
  DoubleSide,
  FrontSide,
  ShaderMaterial,
  Vector3,
  Vector4,
} from 'three'
import { NOISE } from './glsl'
import type { PlanetType } from '../config'

export const RING_SLOTS = 10

export interface PlanetUniforms {
  [k: string]: { value: unknown }
  uTime: { value: number }
  uBeat: { value: number }
  uLit: { value: number }
  uFlash: { value: number }
  uSunDir: { value: Vector3 }
  uPaint: { value: DataTexture }
  uRings: { value: Vector4[] }
  uRingCol: { value: Vector4[] }
  uWaveDir: { value: Vector3 }
  uWaveFront: { value: number }
  uWaveAmp: { value: number }
}

/** One shader for every planet; `style` picks the surface. Paint, rings and waves are drawn on the curved surface itself. */
export function planetMaterial(type: PlanetType, paint: DataTexture, seed: number, paintColor: Color): ShaderMaterial {
  const rings: Vector4[] = []
  const ringCol: Vector4[] = []
  for (let i = 0; i < RING_SLOTS; i++) {
    rings.push(new Vector4(0, 1, 0, 0))
    ringCol.push(new Vector4(0, 0, 0, 0))
  }
  const c = type.colors
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uLit: { value: 0 },
      uFlash: { value: 0 },
      uStyle: { value: type.style },
      uNoise: { value: type.noise },
      uSeed: { value: new Vector3((seed % 97) * 1.37, (seed % 89) * 0.71, (seed % 83) * 2.13) },
      uDeep: { value: new Color(c.deep) },
      uMid: { value: new Color(c.mid) },
      uHigh: { value: new Color(c.high) },
      uGlow: { value: new Color(c.glow) },
      uAtmo: { value: new Color(c.atmo) },
      uPaintCol: { value: paintColor },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uPaint: { value: paint },
      uRings: { value: rings },
      uRingCol: { value: ringCol },
      uWaveDir: { value: new Vector3(0, 1, 0) },
      uWaveFront: { value: -1 },
      uWaveAmp: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec3 uWaveDir;
      uniform float uWaveFront;
      uniform float uWaveAmp;
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vWave;
      void main() {
        vN = normalize(position);
        vec3 pos = position;
        float wave = 0.0;
        if (uWaveAmp > 0.0) {
          float a = acos(clamp(dot(vN, uWaveDir), -1.0, 1.0));
          float d = (a - uWaveFront) / 0.12;
          wave = exp(-d * d);
          pos += vN * uWaveAmp * wave;
        }
        vWave = wave;
        vec4 wp = modelMatrix * vec4(pos, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBeat, uLit, uFlash, uStyle, uNoise;
      uniform vec3 uSeed, uDeep, uMid, uHigh, uGlow, uAtmo, uPaintCol, uSunDir;
      uniform sampler2D uPaint;
      uniform vec4 uRings[${RING_SLOTS}];
      uniform vec4 uRingCol[${RING_SLOTS}];
      varying vec3 vN;
      varying vec3 vWorld;
      varying float vWave;
      ${NOISE}
      void main() {
        vec3 n = normalize(vN);
        vec3 p = n * uNoise + uSeed;
        float h = fbm(p);
        vec3 col;
        vec3 emis = vec3(0.0);
        float spec = 0.0;
        if (uStyle < 0.5) {
          // Azure: sea and islands, glowing coasts
          float land = smoothstep(0.06, 0.12, h);
          vec3 sea = mix(uDeep, uMid, smoothstep(-0.6, 0.06, h));
          vec3 ground = mix(uMid * 1.3, uHigh, smoothstep(0.12, 0.5, h));
          col = mix(sea, ground, land);
          spec = (1.0 - land) * 0.8;
          emis += uGlow * 0.14 * (1.0 - smoothstep(0.0, 0.03, abs(h - 0.08)));
          float sh = sin(dot(n, vec3(41.0, 23.0, 31.0)) * 1.0 + uTime * 1.3 + h * 18.0);
          emis += uGlow * 0.05 * (1.0 - land) * smoothstep(0.9, 1.0, sh);
        } else if (uStyle < 1.5) {
          // Ember: cooling crust over lava
          float r = 1.0 - abs(snoise(p * 1.7));
          float crack = smoothstep(0.88, 0.985, r);
          col = mix(uDeep, uMid, smoothstep(-0.5, 0.5, h));
          col = mix(col, uHigh, smoothstep(0.35, 0.8, h) * 0.7);
          float pulse = 0.6 + 0.4 * sin(uTime * 2.2 + h * 7.0);
          emis += uGlow * crack * 2.2 * pulse;
          emis += uGlow * 0.45 * smoothstep(-0.25, -0.65, h) * pulse;
        } else if (uStyle < 2.5) {
          // Rime: ice plates with bright seams and glints
          float plates = abs(snoise(p * 1.3));
          col = mix(uDeep, uMid, smoothstep(-0.4, 0.3, h));
          col = mix(col, uHigh, smoothstep(0.15, 0.6, h + plates * 0.3));
          emis += uGlow * 0.5 * (1.0 - smoothstep(0.0, 0.035, plates));
          float glint = snoise(n * 70.0 + uTime * 0.2);
          emis += vec3(1.0) * smoothstep(0.82, 0.95, glint) * 0.9;
          spec = 0.9;
        } else if (uStyle < 3.5) {
          // Bloom: soft jelly stripes
          float s = sin(h * 9.0 + dot(n, vec3(0.0, 6.0, 0.0)) + uTime * 0.6);
          col = mix(uDeep, uMid, 0.5 + 0.5 * s);
          col = mix(col, uHigh, smoothstep(0.25, 0.7, h));
          emis += uGlow * 0.18 * smoothstep(0.85, 1.0, s);
          spec = 0.5;
        } else if (uStyle < 4.5) {
          // Gemini: dunes and teal oases
          float dune = sin(dot(n, vec3(9.0, 4.0, 7.0)) * 3.0 + h * 8.0);
          col = mix(uDeep, uMid, smoothstep(-0.5, 0.4, h));
          col = mix(col, uHigh, smoothstep(0.6, 1.0, dune) * 0.6 + smoothstep(0.3, 0.7, h) * 0.4);
          float oasis = smoothstep(-0.35, -0.5, h);
          col = mix(col, vec3(0.03, 0.35, 0.38), oasis);
          emis += vec3(0.2, 1.0, 0.9) * 0.25 * (1.0 - smoothstep(0.0, 0.03, abs(h + 0.42)));
        } else if (uStyle < 5.5) {
          // Mote: swirling violet gas bands
          float band = sin(n.y * 9.0 + fbm3(p * 0.8 + vec3(uTime * 0.05)) * 4.0);
          col = mix(uDeep, uMid, 0.5 + 0.5 * band);
          col = mix(col, uHigh, smoothstep(0.3, 0.8, h) * 0.6);
          emis += uGlow * 0.12 * smoothstep(0.9, 1.0, band);
        } else {
          // Tide: deep water with current lines
          float cur = sin(h * 14.0 - uTime * 1.6 + n.y * 4.0);
          col = mix(uDeep, uMid, smoothstep(-0.5, 0.4, h));
          col = mix(col, uHigh, smoothstep(0.35, 0.75, h) * 0.5);
          emis += uGlow * 0.12 * smoothstep(0.92, 1.0, cur);
          spec = 0.7;
        }

        vec3 L = normalize(uSunDir);
        float ndl = dot(n, L);
        float diff = smoothstep(-0.35, 1.0, ndl) * 0.95 + 0.14;
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 H = normalize(V + L);
        float sp = pow(max(dot(n, H), 0.0), 70.0) * spec * step(0.0, ndl);
        vec3 lit = col * diff * 0.85 + sp * vec3(1.0, 0.94, 0.82) + uAtmo * fres * 0.3;

        // Territory painted by closed loops
        float u = fract(atan(n.z, -n.x) / 6.2831853);
        float v = acos(clamp(n.y, -1.0, 1.0)) / 3.14159265;
        float m = texture2D(uPaint, vec2(u, v)).r;
        float pm = smoothstep(0.35, 0.65, m);
        float edge = smoothstep(0.06, 0.45, m) * (1.0 - smoothstep(0.55, 0.94, m));
        // A glowing lattice: three sets of stripes in 3D, so there is no seam or pole pinch.
        vec3 q = n * 30.0;
        float lat = max(abs(sin(q.x + q.y * 0.5)), max(abs(sin(q.y - q.z * 0.5)), abs(sin(q.z + q.x * 0.5))));
        float cell = smoothstep(0.965, 1.0, lat);
        float scan = 0.5 + 0.5 * sin(dot(n, normalize(vec3(1.0, 0.6, 0.3))) * 22.0 - uTime * 3.0);
        lit = mix(lit, lit * 0.22, pm);
        emis += pm * (uPaintCol * (0.22 + 0.16 * scan + 0.3 * uBeat) + (uPaintCol * 0.8 + vec3(0.04, 0.12, 0.2)) * cell);
        emis += (uPaintCol * 2.0 + vec3(0.4, 0.7, 1.0)) * edge * (1.0 + 0.6 * uBeat);

        // A lit world glows all over
        if (uLit > 0.0) {
          float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + v * 24.0);
          lit = mix(lit, lit * 0.35 + uPaintCol * (0.7 + 0.6 * pulse), uLit * 0.75);
          emis += uPaintCol * uLit * 0.5 * pulse;
        }

        for (int i = 0; i < ${RING_SLOTS}; i++) {
          vec4 rc = uRingCol[i];
          if (rc.w <= 0.0) continue;
          vec4 r = uRings[i];
          float ang = acos(clamp(dot(n, r.xyz), -1.0, 1.0));
          float k = 1.0 - smoothstep(0.0, rc.w, abs(ang - r.w));
          emis += rc.rgb * k * k;
        }

        emis += uGlow * vWave * 0.35;
        gl_FragColor = vec4(lit + emis + vec3(uFlash), 1.0);
      }
    `,
    side: FrontSide,
  })
}

export function atmosphereMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uBeat: { value: 0 }, uLit: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBeat, uLit;
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vec3 V = normalize(cameraPosition - vWorld);
        float rim = 1.0 - abs(dot(normalize(vN), V));
        float k = pow(rim, 3.0) * smoothstep(1.0, 0.75, rim);
        gl_FragColor = vec4(uColor * k * (0.75 + 0.3 * uBeat + uLit * 1.4), 1.0);
      }
    `,
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
}

export function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uA: { value: new Color('#1a0b3a') },
      uB: { value: new Color('#06264a') },
      uC: { value: new Color('#3a0a2a') },
      uWarp: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWarp;
      uniform vec3 uA, uB, uC;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float n1 = fbm3(d * 2.2 + vec3(0.0, uTime * 0.01, 0.0));
        float n2 = fbm3(d * 4.5 + vec3(7.0, 2.0, uTime * 0.015));
        float band = exp(-pow(d.y * 2.4 + n1 * 0.9, 2.0));
        vec3 col = vec3(0.004, 0.006, 0.016);
        col += uA * smoothstep(-0.1, 0.8, n1) * 0.55 * (0.4 + band);
        col += uB * smoothstep(0.0, 0.9, n2) * 0.5 * band;
        col += uC * smoothstep(0.3, 0.9, n1 * n2 * 2.0) * 0.6;
        col *= 1.0 + uWarp * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  })
}

export function sunMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uColor: { value: new Color('#ffb347') } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vWorld;
      void main() {
        vN = normalize(position);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHeat;
      uniform vec3 uColor;
      varying vec3 vN;
      varying vec3 vWorld;
      ${NOISE}
      void main() {
        vec3 n = normalize(vN);
        float g = fbm3(n * 5.0 + vec3(uTime * 0.08));
        vec3 V = normalize(cameraPosition - vWorld);
        float limb = pow(max(dot(n, V), 0.0), 0.5);
        vec3 col = mix(uColor * 2.0, vec3(4.0, 3.4, 2.6), smoothstep(-0.2, 0.6, g)) * (0.6 + 0.6 * limb);
        col = mix(col, vec3(2.6, 2.5, 2.7), uHeat * 0.8);
        gl_FragColor = vec4(col * (1.0 + uHeat * 0.6), 1.0);
      }
    `,
  })
}

/** Soft additive billboard, used for glows and halos. */
export function glowMaterial(color: Color, intensity = 1): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uI: { value: intensity } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uI;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float k = exp(-d * d * 4.0) * (1.0 - smoothstep(0.85, 1.0, d));
        gl_FragColor = vec4(uColor * k * uI, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
}

/** Ribbon trail: additive, bright core, energy flowing toward the head. */
export function trailMaterial(color: Color, head: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uHead: { value: head.clone() },
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uAlpha: { value: 1 },
      uHot: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aT;
      attribute float aSide;
      attribute float aDist;
      varying float vT;
      varying float vSide;
      varying float vDist;
      void main() {
        vT = aT;
        vSide = aSide;
        vDist = aDist;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uHead;
      uniform float uTime, uBeat, uAlpha, uHot;
      varying float vT;
      varying float vSide;
      varying float vDist;
      void main() {
        float across = 1.0 - abs(vSide);
        float core = smoothstep(0.6, 1.0, across);
        float soft = across * across;
        float flow = 0.5 + 0.5 * sin(vDist * 2.2 - uTime * 12.0);
        vec3 base = mix(uColor, vec3(1.0, 0.45, 0.1) * 2.0, uHot);
        vec3 c = base * (soft * 0.6 + core * 1.2) * (0.3 + 0.7 * vT) * (0.8 + 0.35 * flow + 0.4 * uBeat);
        c += uHead * core * smoothstep(0.85, 1.0, vT) * 0.6;
        float a = soft * smoothstep(0.0, 0.2, vT) * uAlpha;
        gl_FragColor = vec4(c * a, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  })
}

export function particleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      attribute float aAlpha;
      uniform float uScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 96.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q) * 4.0;
        float k = exp(-d * 3.5) * (1.0 - step(1.0, d));
        gl_FragColor = vec4(vColor * k * vAlpha, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
}

export function starMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime, uScale;
      varying float vTw;
      void main() {
        vTw = 0.65 + 0.35 * sin(uTime * (1.0 + aPhase * 3.0) + aPhase * 40.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale;
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.9999;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTw;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float d = dot(q, q) * 4.0;
        float k = exp(-d * 5.0) * (1.0 - step(1.0, d));
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * k * vTw * 1.4, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
}
