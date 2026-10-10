/**
 * The effect engine's shaders and how its materials blend: particle quads
 * (VERTEX, FRAGMENT), screen effects (distortion, radial blur), trail
 * ribbons, and the preview's bloom mix.
 */
import * as THREE from 'three'
import { FX_ALPHA_BOOST } from './constants.ts'

export const VERTEX = /* glsl */ `
  uniform float uCols;
  uniform float uRows;
  uniform float uFrames;
  uniform float uInterp;
  uniform float uOrient;
  uniform vec3 uLocalX;
  uniform vec3 uLocalY;
  uniform vec3 uLocalZ;
  attribute vec3 iPos;
  attribute vec2 iSize;
  attribute vec4 iColor;
  attribute float iFrame;
  attribute float iRot;
  attribute vec3 iDir;
  // Texture layers: UV shift (xy) and scale (zw); layer 2 is the mask.
  attribute vec4 iUv;
  attribute vec4 iUv2;
  // Per-particle alphaFadeThreshold (0-1) when it changes over the particle's life.
  attribute float iFade;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying float vFrameT;
  varying vec2 vQuadUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vFade = iFade;
    vec4 center = modelViewMatrix * vec4(iPos, 1.0);
    // Mask (layer 2) UVs are centred on the sprite: offset 0.5 means no shift.
    vQuadUv = (uv - 0.5) * iUv2.zw + iUv2.xy;
    // Sparks can be ~1 cm: never let a particle shrink below a few pixels.
    float minSize = -center.z * 0.004;
    vec2 size = max(iSize, vec2(minSize));
    // Roll, then place the quad by the FXR orientation mode.
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * size;
    int mode = int(uOrient + 0.5);
    vec4 mv;
    if (mode == 0 || mode == 2 || mode == 3 || mode == 5 || mode == 4 || mode == 7) {
      vec3 right;
      vec3 up = vec3(0.0, 1.0, 0.0);
      if (mode == 5) {
        right = vec3(0.0, 0.0, 1.0); // faces east (+X)
      } else if (mode == 4) {
        // GlobalYaw: upright (height along world Y), turned toward the camera.
        vec3 toCam = cameraPosition - iPos;
        toCam.y = 0.0;
        if (dot(toCam, toCam) < 1e-6) toCam = vec3(0.0, 0.0, 1.0);
        right = normalize(cross(up, normalize(toCam)));
      } else if (mode == 7) {
        // LocalYaw: the width lies along the particle's direction of travel
        // and the quad only rolls around it to face the camera. In the game
        // files these are long, thin streaks (468 wide vs 11 tall): blood
        // sprays, light rays, Glintstone Pebble's speed lines.
        right = dot(iDir, iDir) > 1e-8 ? normalize(iDir) : uLocalZ;
        vec3 toCam = cameraPosition - iPos;
        vec3 n = toCam - right * dot(toCam, right);
        up = dot(n, n) < 1e-8 ? uLocalY : normalize(cross(normalize(n), right));
      } else if (mode == 2) {
        right = uLocalX; // LocalSouth: faces the effect's -Z
        up = uLocalY;
      } else {
        right = vec3(1.0, 0.0, 0.0); // South: faces global -Z
      }
      mv = modelViewMatrix * vec4(iPos + right * q.x + up * q.y, 1.0);
    } else {
      mv = center; // 1, 6: face the camera
      mv.xy += q;
    }
    gl_Position = projectionMatrix * mv;
    // Flipbook: the frame index wraps; with interpolation, blend into the next frame.
    float frames = max(uFrames, 1.0);
    float frame = mod(max(iFrame, 0.0), frames);
    float f0 = floor(frame);
    float f1 = mod(f0 + 1.0, frames);
    vFrameT = uInterp > 0.5 ? frame - f0 : 0.0;
    vec2 luv = uv * iUv.zw + iUv.xy;
    vUv = vec2((luv.x + mod(f0, uCols)) / uCols, 1.0 - (floor(f0 / uCols) + 1.0 - luv.y) / uRows);
    vUv2 = vec2((luv.x + mod(f1, uCols)) / uCols, 1.0 - (floor(f1 / uCols) + 1.0 - luv.y) / uRows);
    vColor = iColor;
  }
`

export const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform float uAlphaFade;
  uniform vec3 uLight;
  uniform vec3 uBloom;
  uniform float uBloomPass;
  uniform float uBloomGain;
  uniform float uExposure;
  uniform float uAdditive;
  uniform float uAdditiveGain;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying float vFrameT;
  varying vec2 vQuadUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vec4 t = uHasMap > 0.5 ? mix(texture2D(uMap, vUv), texture2D(uMap, vUv2), vFrameT) : vec4(1.0);
    // Second layer shapes the first (it isn't part of the flipbook).
    if (uHasMask > 0.5) t.a *= texture2D(uMask, vQuadUv).a;
    float fade = max(uAlphaFade, vFade);
    if (fade > 0.0) t.a = clamp((t.a - fade) / (1.0 - fade), 0.0, 1.0);
    vec4 c = t * vColor;
    // HDR output in scene units: tone mapping and bloom happen afterwards.
    c.rgb *= uLight * uExposure;
    if (uBloomPass > 0.5) c.rgb += c.rgb * uBloom * uBloomGain;
    // Additive blending: alpha is an intensity, and the game lets it go past 1
    // (alphaMultiplier 3.75-5 on Bloody Rings' rings and lines). Keep that
    // brightness, up to FX_ALPHA_BOOST: lightning spears use alpha 25 on
    // colours of ~90, which would white out the whole frame.
    if (uAdditive > 0.5) c.rgb *= uAdditiveGain * (c.a > 1.0 ? min(c.a, ${FX_ALPHA_BOOST.toFixed(1)}) : 1.0);
    c.a = clamp(c.a, 0.0, 1.0);
    if (c.a < 0.003) discard;
    gl_FragColor = c;
  }
`

/**
 * Screen effects (Distortion, RadialBlur) don't draw colour: they write into
 * a screen-sized effects buffer. RG = how far to bend the background (UV),
 * BA = radial blur vector toward the sprite's centre (UV). SCREEN_FX then
 * applies the buffer to the rendered scene.
 */
export const FX_VERTEX = VERTEX.replace(
  'varying vec4 vColor;',
  'varying vec4 vColor;\n  attribute vec4 iFx;\n  varying vec4 vFx;\n  varying vec2 vCenterUv;',
).replace(
  'vColor = iColor;',
  'vColor = iColor;\n    vFx = iFx;\n    vec4 cc = projectionMatrix * center;\n    vCenterUv = cc.xy / cc.w * 0.5 + 0.5;',
)

export const FX_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform float uMode;
  uniform float uShape;
  uniform float uStir;
  uniform vec4 uNormalUv;
  uniform vec2 uResolution;
  varying vec2 vUv;
  varying vec2 vQuadUv;
  varying vec4 vColor;
  varying vec4 vFx;
  varying vec2 vCenterUv;
  void main() {
    // vFx: x = intensity (or blur radius), y = radius of the effect ellipse, z = particle age.
    vec2 p = vQuadUv * 2.0 - 1.0;
    float d = length(p);
    float edge = clamp(1.0 - d / max(vFx.y, 1e-3), 0.0, 1.0);
    // Ellipsoids bend most in the middle, like a lens; flat shapes evenly, soft at the rim.
    float fall = uShape > 0.5 ? sqrt(edge) : smoothstep(0.0, 0.15, edge);
    float a = clamp(vColor.a, 0.0, 1.0) * fall * (uHasMask > 0.5 ? texture2D(uMask, vQuadUv).a : 1.0);
    if (a < 0.001) discard;
    if (uMode < -0.5) {
      // Radial blur: smear toward the sprite's centre on screen.
      vec2 here = gl_FragCoord.xy / uResolution;
      gl_FragColor = vec4(0.0, 0.0, (vCenterUv - here) * vFx.x * a);
      return;
    }
    vec2 off;
    if (uMode > 0.5 && uMode < 1.5 || uMode > 2.5) {
      // Normal map, scrolled and scaled.
      vec2 uv = vQuadUv * uNormalUv.xy + uNormalUv.zw * vFx.z;
      off = uHasMap > 0.5 ? texture2D(uMap, uv).rg * 2.0 - 1.0 : vec2(0.0);
    } else if (uMode > 1.5) {
      // Twist: the middle turns, the rim stays put.
      float ang = 1.2 * edge;
      off = vec2(cos(ang) * p.x - sin(ang) * p.y, sin(ang) * p.x + cos(ang) * p.y) - p;
    } else {
      // Stir: an animated swirl.
      float ang = uStir * vFx.z + d * 6.2832;
      off = vec2(-p.y, p.x) * sin(ang) * 0.6;
    }
    // Game intensities: normal-map median 10 (up to 150), stir/twist 0-20.
    // ~1% of the screen at intensity 10; never more than 6%.
    float k = (uMode > 0.5 && uMode < 1.5 || uMode > 2.5) ? 0.001 : 0.004;
    gl_FragColor = vec4(clamp(off * vFx.x * a * k, vec2(-0.06), vec2(0.06)), 0.0, 0.0);
  }
`

export const SCREEN_FX = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tFx;
  varying vec2 vUv;
  void main() {
    vec4 fx = texture2D(tFx, vUv);
    vec2 uv = vUv + fx.rg;
    if (dot(fx.ba, fx.ba) < 1e-9) {
      gl_FragColor = texture2D(tDiffuse, uv);
      return;
    }
    vec4 c = vec4(0.0);
    for (int i = 0; i < 12; i++) c += texture2D(tDiffuse, uv + fx.ba * (float(i) / 11.0));
    gl_FragColor = c / 12.0;
  }
`

/** Trail ribbons: vertices are already in world space, built on the CPU each frame. */
export const RIBBON_VERTEX = /* glsl */ `
  attribute vec4 color;
  varying vec2 vUv;
  varying vec2 vUv2;
  varying float vFrameT;
  varying vec2 vQuadUv;
  varying vec4 vColor;
  varying float vFade;
  void main() {
    vFade = 0.0;
    vUv = uv;
    vUv2 = uv;
    vFrameT = 0.0;
    vQuadUv = vec2(fract(uv.x), uv.y);
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Adds the bloom (computed from the bloom render) onto the scene. */
export const MIX_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const MIX_FRAGMENT = /* glsl */ `
  uniform sampler2D baseTexture;
  uniform sampler2D bloomTexture;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(baseTexture, vUv) + uStrength * texture2D(bloomTexture, vUv);
  }
`

export const isAdditive = (mode: number) => mode === 0 || mode === 4 || mode === 7

/** Draw order between parts: normal-blend layers first, glow (additive) on top. */
export const drawLayer = (mode: number) => (isAdditive(mode) ? 2 : 1)

export function applyBlend(m: THREE.ShaderMaterial, mode: number): void {
  m.transparent = true
  m.depthWrite = false
  switch (mode) {
    case 0:
    case 4:
    case 7:
      m.blending = THREE.AdditiveBlending
      break
    case 3:
      m.blending = THREE.MultiplyBlending
      m.premultipliedAlpha = true
      break
    case 5:
      m.blending = THREE.CustomBlending
      m.blendEquation = THREE.ReverseSubtractEquation
      m.blendSrc = THREE.SrcAlphaFactor
      m.blendDst = THREE.OneFactor
      break
    default:
      m.blending = THREE.NormalBlending
  }
}

/** UV layer attributes with no shift and unit scale (`centre` 0.5 for the centred mask layer). */
export function identityUv(count: number, centre = 0): Float32Array {
  const a = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    a[i * 4] = centre
    a[i * 4 + 1] = centre
    a[i * 4 + 2] = 1
    a[i * 4 + 3] = 1
  }
  return a
}
