/**
 * Reading Havok animations (hkaSplineCompressedAnimation) to sample them at
 * any time. The animation is cut into blocks of `maxFramesPerBlock` frames
 * (sharing their edge frame); in each, every bone track's position, rotation
 * and scale is a fixed value or a B-spline over the block's frames (layout:
 * splineBlock.ts; number formats: quantization.ts). Root motion comes from
 * the file's reference frame samples.
 *
 * Credit: the format is documented by the Havok Format Library (Lukas Cone)
 * and SoulsAssetPipeline (Meowmaritus and Katalash), read as documentation
 * only (both are GPL-3.0); DS Anim Studio (Meowmaritus, MIT) plays the same
 * files.
 */
import { type Tagfile } from './tagfile.ts'
import { evaluate, type BSpline } from './bspline.ts'
import { decodeRotation, dequantize } from './quantization.ts'
import { readBlock, type StoredRot, type StoredVec3 } from './splineBlock.ts'
import { itemsOfType } from './objects.ts'

/* -------------------------------- animation -------------------------------- */
export interface AnimationClip {
  duration: number
  frameDuration: number
  numFrames: number
  /** Bone index for each track. */
  trackToBone: number[]
  /** Samples a track set at `time` (seconds), into flat arrays of t (3), r (4), s (3) per track. */
  sample(time: number, t: Float32Array, r: Float32Array, s: Float32Array): void
  /** Root motion at `time`: translation and yaw (radians), if the animation has it. */
  rootMotion?: (time: number) => [number, number, number, number]
  trackCount: number
}

/** A track's position, rotation or scale over one block: a fixed value, or a B-spline over the block's frames. */
type Component = { kind: 'static'; value: Float32Array } | { kind: 'spline'; spline: BSpline }

interface TrackComponents {
  pos: Component
  rot: Component
  scale: Component
}

/** A stored position or scale: its spline axes dequantized into control points, the rest fixed (`fallback` when not stored). */
function vectorComponent(stored: StoredVec3, quantization: number, fallback: number): Component {
  const fixed = [0, 1, 2].map((a) => stored.statics[a] ?? fallback)
  const spline = stored.spline
  if (!spline) return { kind: 'static', value: Float32Array.from(fixed) }
  const splineAxes = [0, 1, 2].filter((a) => stored.flags & (0x10 << a))
  const stored3 = spline.points as number[][]
  const points = new Float32Array(stored3.length * 3)
  stored3.forEach((point, i) => {
    for (let a = 0; a < 3; a++) points[i * 3 + a] = fixed[a]
    splineAxes.forEach((a, k) => {
      points[i * 3 + a] = dequantize(point[k], quantization, spline.min![k], spline.max![k])
    })
  })
  return { kind: 'spline', spline: { degree: spline.degree, knots: spline.knots, points, dims: 3 } }
}

/** A stored rotation, decoded; no rotation when the track stores none. */
function rotationComponent(stored: StoredRot, format: number): Component {
  const spline = stored.spline
  if (!spline)
    return {
      kind: 'static',
      value: Float32Array.from(stored.value ? decodeRotation(format, stored.value) : [0, 0, 0, 1]),
    }
  const raw = spline.points as Uint8Array[]
  const points = new Float32Array(raw.length * 4)
  raw.forEach((bytes, i) => points.set(decodeRotation(format, bytes), i * 4))
  // Each control point on the same hemisphere as the one before it, so blending between them doesn't turn the long way.
  for (let i = 4; i < points.length; i += 4) {
    let dot = 0
    for (let k = 0; k < 4; k++) dot += points[i + k] * points[i - 4 + k]
    if (dot < 0) for (let k = 0; k < 4; k++) points[i + k] = -points[i + k]
  }
  return { kind: 'spline', spline: { degree: spline.degree, knots: spline.knots, points, dims: 4 } }
}

/** A component's value `u` frames into its block, into `out` from `at` (rotations normalized). */
function sampleComponent(c: Component, u: number, out: Float32Array, at: number, dims: number): void {
  if (c.kind === 'static') out.set(c.value, at)
  else evaluate(c.spline, u, out, at)
  if (dims === 4) {
    const length = Math.hypot(out[at], out[at + 1], out[at + 2], out[at + 3]) || 1
    for (let d = 0; d < 4; d++) out[at + d] /= length
  }
}

export function readAnimation(tf: Tagfile): AnimationClip {
  const spline = itemsOfType(tf, 'hkaSplineCompressedAnimation')[0]?.value
  const binding = itemsOfType(tf, 'hkaAnimationBinding')[0]?.value
  if (!spline) {
    const other = tf.items
      .map((it) => tf.types[it.type]?.name)
      .find((n) => n?.startsWith('hka') && n.endsWith('Animation'))
    throw new Error(`Unsupported animation type ${other ?? '(none)'}`)
  }
  const tracks = spline.numberOfTransformTracks as number
  const floats = spline.numberOfFloatTracks as number
  const numBlocks = spline.numBlocks as number
  const perBlock = spline.maxFramesPerBlock as number
  const frameDuration = spline.frameDuration as number
  const numFrames = spline.numFrames as number
  const data = spline.data as Uint8Array
  const blockOffsets = spline.blockOffsets as Uint32Array
  const blocks: TrackComponents[][] = Array.from({ length: numBlocks }, (_, b) =>
    readBlock(data, blockOffsets[b], tracks, floats).tracks.map((t) => ({
      pos: vectorComponent(t.pos, t.quantization & 3, 0),
      rot: rotationComponent(t.rot, (t.quantization >> 2) & 0xf),
      scale: vectorComponent(t.scale, (t.quantization >> 6) & 3, 1),
    })),
  )

  const trackToBone = binding
    ? Array.from(binding.transformTrackToBoneIndices as Int16Array)
    : Array.from({ length: tracks }, (_, i) => i)
  const duration = (spline.duration as number) || (numFrames - 1) * frameDuration

  const clip: AnimationClip = {
    duration,
    frameDuration,
    numFrames,
    trackToBone,
    trackCount: tracks,
    sample(time, t, rr, s) {
      const frame = Math.max(0, Math.min(numFrames - 1, time / frameDuration))
      const span = Math.max(1, perBlock - 1)
      const b = Math.min(numBlocks - 1, Math.floor(frame / span))
      const u = frame - b * span
      const list = blocks[b]
      for (let i = 0; i < tracks; i++) {
        sampleComponent(list[i].pos, u, t, i * 3, 3)
        sampleComponent(list[i].rot, u, rr, i * 4, 4)
        sampleComponent(list[i].scale, u, s, i * 3, 3)
      }
    },
  }

  // Root motion: samples of (x, y, z, yaw) spread evenly over the duration.
  const motion = itemsOfType(tf, 'hkaDefaultAnimatedReferenceFrame')[0]?.value
  const samples = motion?.referenceFrameSamples as Float32Array | (Float32Array | number[])[] | undefined
  if (samples) {
    const flat =
      samples instanceof Float32Array
        ? samples
        : Float32Array.from((samples as Float32Array[]).flatMap((x) => Array.from(x)))
    const n = flat.length / 4
    const dur = (motion!.duration as number) || duration
    if (n > 0)
      clip.rootMotion = (time) => {
        if (n === 1) return [flat[0], flat[1], flat[2], flat[3]]
        const f = Math.max(0, Math.min(n - 1, (time / dur) * (n - 1)))
        const i = Math.min(n - 2, Math.floor(f))
        const k = f - i
        const lerp = (c: number) => flat[i * 4 + c] * (1 - k) + flat[i * 4 + 4 + c] * k
        return [lerp(0), lerp(1), lerp(2), lerp(3)]
      }
  }
  return clip
}
