/**
 * Area lighting from the game's light probes, shared by the effect preview
 * and the character viewport: the probe as an HDR environment, its average
 * colour (ambient) and its brightest direction (a stand-in for the sun).
 */
import * as THREE from 'three'
import type { EnvironmentAreaView, EnvironmentView } from '../../shared/api.ts'
import { call } from './ipc.ts'

/** Mean luminance of daylight probes, before exposure. */
const DAY_LUMINANCE = 0.05
/** What a daylight scene's mean brightness is scaled to. */
export const DAY_TARGET = 0.18

/**
 * Partial eye adaptation: the game brightens dark places, but not all the
 * way, so caves and nights still read darker than daylight.
 */
function adaptedScale(luminance: number): number {
  const lum = Math.max(1e-5, luminance)
  const target = DAY_TARGET * Math.min(1.5, Math.max(0.15, Math.pow(lum / DAY_LUMINANCE, 0.4)))
  return target / lum
}

function decodeFloats(base64: string): Float32Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Float32Array(bytes.buffer)
}

export interface ProbeLighting {
  /** Equirectangular half-float environment (for PMREM). */
  texture: THREE.DataTexture
  /** Solid-angle weighted mean colour. */
  ambient: THREE.Vector3
  /** Direction toward the brightest part of the probe, and its colour/strength. */
  sunDirection: THREE.Vector3
  sunColor: THREE.Color
  /** How much brighter the brightest region is than the mean (1 = flat, overcast). */
  sunContrast: number
  /** Eye adaptation relative to daylight (1 by day, ~7 at night, at most 10): effects are exposed by it. */
  adaptation: number
}

/** Builds the environment texture and light estimates from a probe. */
export function probeLighting(view: EnvironmentView): ProbeLighting {
  const rgb = decodeFloats(view.rgb)
  const { width: w, height: h } = view
  const scale = adaptedScale(view.luminance)
  const half = new Uint16Array(w * h * 4)
  const sum = [0, 0, 0]
  let weight = 0
  // Brightest direction: luminance-weighted mean of the top 2% of texels.
  const lum = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    // Rows arrive top-first; textures are bottom-first.
    const dst = (h - 1 - y) * w
    const wy = Math.sin(((y + 0.5) / h) * Math.PI)
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3
      const d = (dst + x) * 4
      for (let c = 0; c < 3; c++) {
        const v = rgb[s + c] * scale
        half[d + c] = THREE.DataUtils.toHalfFloat(Math.min(65000, v))
        sum[c] += v * wy
      }
      half[d + 3] = THREE.DataUtils.toHalfFloat(1)
      weight += wy
      lum[y * w + x] = (0.2126 * rgb[s] + 0.7152 * rgb[s + 1] + 0.0722 * rgb[s + 2]) * scale
    }
  }
  const ambient = new THREE.Vector3(sum[0] / weight, sum[1] / weight, sum[2] / weight)
  const sorted = Float32Array.from(lum).sort()
  const cut = sorted[Math.floor(sorted.length * 0.98)]
  const dir = new THREE.Vector3()
  const col = [0, 0, 0]
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = lum[y * w + x]
      if (l < cut) continue
      // three's equirect mapping: u = atan2(z, x) / 2π + 0.5, v = asin(y) / π + 0.5 (v up).
      const u = (x + 0.5) / w
      const v = 1 - (y + 0.5) / h
      const lon = (u - 0.5) * Math.PI * 2
      const lat = (v - 0.5) * Math.PI
      const k = l * Math.sin(((y + 0.5) / h) * Math.PI)
      dir.x += Math.cos(lat) * Math.cos(lon) * k
      dir.y += Math.sin(lat) * k
      dir.z += Math.cos(lat) * Math.sin(lon) * k
      const s = (y * w + x) * 3
      for (let c = 0; c < 3; c++) col[c] += rgb[s + c] * scale * k
      total += k
    }
  }
  if (dir.lengthSq() < 1e-8) dir.set(0.4, 1, 0.3)
  dir.normalize()
  // Keep the sun above the horizon so it lights the character from above.
  if (dir.y < 0.25) {
    dir.y = 0.25
    dir.normalize()
  }
  const peak = Math.max(1e-6, total ? Math.max(col[0], col[1], col[2]) / total : 0)
  const meanLum = 0.2126 * ambient.x + 0.7152 * ambient.y + 0.0722 * ambient.z
  const sunColor = total
    ? new THREE.Color(col[0] / total / peak, col[1] / total / peak, col[2] / total / peak)
    : new THREE.Color(1, 1, 1)
  const texture = new THREE.DataTexture(half, w, h, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.mapping = THREE.EquirectangularReflectionMapping
  texture.colorSpace = THREE.LinearSRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return {
    texture,
    ambient,
    sunDirection: dir,
    sunColor,
    sunContrast: peak / Math.max(1e-6, meanLum),
    // Effects get the game's full adaptation (capped for pitch-black caves),
    // not the scene's partial one: a deep red Bloody Rings at Stormveil by
    // night glows in game, yet fire by day must not blow out.
    adaptation: Math.min(10, DAY_LUMINANCE / Math.max(1e-5, view.luminance)),
  }
}

let areasPromise: Promise<EnvironmentAreaView[]> | null = null
/** The lighting presets this game folder has (cached). */
export function loadAreas(): Promise<EnvironmentAreaView[]> {
  areasPromise ??= call('env:list', undefined).catch((e) => {
    areasPromise = null
    throw e
  })
  return areasPromise
}
