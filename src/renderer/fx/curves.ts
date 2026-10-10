/**
 * Sampling the curves of a PreviewSpec: the main process samples each FXR
 * property curve evenly over its range, and the engine interpolates them.
 */
import * as THREE from 'three'

/** Seconds between NodeTranslation samples (matches core/effects/preview.ts). */
const TRANSLATION_STEP = 0.25

/** A curve at f (0..1 over its range), linearly interpolated between its samples and held at the ends. */
export function sample(curve: { samples: number[][] }, f: number): number[] {
  const s = curve.samples
  if (s.length === 1) return s[0]
  const x = Math.max(0, Math.min(1, f)) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.floor(x))
  const t = x - i
  return s[i].map((v, k) => v + (s[i + 1][k] - v) * t)
}

/** Samples a curve at x (0..1 over its range), continuing past the end along the last segment. */
export function sampleExtended(curve: { samples: number[][] }, x: number): number[] {
  const s = curve.samples
  if (x <= 1 || s.length < 2) return sample(curve, Math.min(1, x))
  const last = s[s.length - 1]
  const prev = s[s.length - 2]
  const steps = (x - 1) * (s.length - 1)
  return last.map((v, k) => v + (v - prev[k]) * steps)
}

/** An active-time curve at time t: sampled over its span, then held at its end (or repeated when it loops). */
export function activeAt(curve: { samples: number[][]; span: number; loop: boolean }, t: number): number[] {
  const span = Math.max(1e-3, curve.span)
  return sample(curve, curve.loop ? (t % span) / span : t / span)
}

/** NodeTranslation at node time t (samples every TRANSLATION_STEP seconds, held after the last). */
export function translationAt(samples: number[][], t: number): THREE.Vector3 {
  const x = Math.min(samples.length - 1, t / TRANSLATION_STEP)
  const i = Math.max(0, Math.min(samples.length - 2, Math.floor(x)))
  const a = samples[i]
  const b = samples[i + 1] ?? a
  const k = Math.max(0, Math.min(1, x - i))
  return new THREE.Vector3(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k)
}
