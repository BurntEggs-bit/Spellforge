/**
 * Writing Havok animations (hkaSplineCompressedAnimation), the way Elden
 * Ring's own files store them, and the tagfile plumbing to put one into a
 * copy of an existing animation file.
 *
 * Retail player animations all use 16-bit positions and scales and
 * THREECOMP40 rotations (5 bytes), at most 256 frames per block (blocks
 * share their edge frame). Many retail tracks are degree-1 splines; new
 * animations are written that way, one control point per frame.
 */
import { allMembers, sizeOf, type Tagfile, type TagType } from './tagfile.ts'
import { itemsOfType } from './objects.ts'
import { encodeThreeComp40 } from './quantization.ts'
import { type StoredVec3, type StoredRot, type StoredTrack, writeBlock } from './splineBlock.ts'

const MAX_FRAMES_PER_BLOCK = 256
/** Quantization byte for 16-bit positions and scales and THREECOMP40 rotations (0x45, as retail files). */
const RETAIL_QUANTIZATION = 0x45

/* ------------------------------- encoding ------------------------------ */

/** Frames of a transform animation: [frame][track][tx ty tz rx ry rz rw sx sy sz]. */
export interface MotionFrames {
  frames: number
  frameDuration: number
  /** Skeleton bone of each track. */
  tracks: number[]
  data: Float32Array
  /** [frame][x y z yaw] root motion, or null. */
  root: Float32Array | null
}

const POS_EPS = 1e-5
const ROT_EPS = 2e-5

/** A position or scale component of one track over one block: static, or a degree-1 spline through every frame. */
function encodeVec3(values: Float32Array[], def: number): StoredVec3 {
  const n = values.length
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const v of values)
    for (let a = 0; a < 3; a++) {
      if (v[a] < min[a]) min[a] = v[a]
      if (v[a] > max[a]) max[a] = v[a]
    }
  let flags = 0
  const statics: (number | null)[] = [null, null, null]
  for (let a = 0; a < 3; a++) {
    if (max[a] - min[a] > POS_EPS) flags |= 0x10 << a
    else if (Math.abs(values[0][a] - def) > POS_EPS) {
      flags |= 1 << a
      statics[a] = values[0][a]
    }
  }
  if (!(flags & 0x70) || n < 2) {
    // Static: no spline (a single frame always is).
    flags &= 0x07
    for (let a = 0; a < 3; a++)
      if (max[a] - min[a] > POS_EPS || Math.abs(values[0][a] - def) > POS_EPS) {
        flags |= 1 << a
        statics[a] = values[0][a]
      }
    return { flags, statics, spline: null }
  }
  const axes = [0, 1, 2].filter((a) => flags & (0x10 << a))
  const points = values.map((v) =>
    axes.map((a) => {
      const range = max[a] - min[a]
      return Math.max(0, Math.min(65535, Math.round(((v[a] - min[a]) / range) * 65535)))
    }),
  )
  return {
    flags,
    statics,
    spline: { degree: 1, knots: linearKnots(n), min: axes.map((a) => min[a]), max: axes.map((a) => max[a]), points },
  }
}

/** Knots of a degree-1 spline with a control point on every one of n frames. */
function linearKnots(n: number): number[] {
  const k = [0]
  for (let i = 0; i < n; i++) k.push(i)
  k.push(n - 1)
  return k
}

function encodeRot(values: Float32Array[]): StoredRot {
  const n = values.length
  let varies = false
  for (const v of values) for (let c = 0; c < 4; c++) if (Math.abs(v[c] - values[0][c]) > ROT_EPS) varies = true
  if (!varies || n < 2) {
    const v = values[0]
    const identity = Math.abs(v[0]) < ROT_EPS && Math.abs(v[1]) < ROT_EPS && Math.abs(v[2]) < ROT_EPS
    if (identity) return { flags: 0, value: null, spline: null }
    return { flags: 0x0f, value: encodeThreeComp40(v[0], v[1], v[2], v[3]), spline: null }
  }
  return {
    flags: 0xf0,
    value: null,
    spline: { degree: 1, knots: linearKnots(n), points: values.map((v) => encodeThreeComp40(v[0], v[1], v[2], v[3])) },
  }
}

/** The spline-compressed data of an animation (all blocks), as retail files lay it out. */
function encodeSplineData(m: MotionFrames): {
  data: Buffer
  blockOffsets: number[]
  floatBlockOffsets: number[]
  numBlocks: number
  maskAndQuantizationSize: number
} {
  const T = m.tracks.length
  const span = MAX_FRAMES_PER_BLOCK - 1
  const numBlocks = Math.max(1, Math.ceil((m.frames - 1) / span))
  const parts: Buffer[] = []
  const blockOffsets: number[] = []
  const floatBlockOffsets: number[] = []
  let at = 0
  // Quaternions on one hemisphere frame to frame, so blending never takes the long way.
  const data = Float32Array.from(m.data)
  for (let t = 0; t < T; t++)
    for (let f = 1; f < m.frames; f++) {
      const o = (f * T + t) * 10 + 3
      const p = ((f - 1) * T + t) * 10 + 3
      if (data[o] * data[p] + data[o + 1] * data[p + 1] + data[o + 2] * data[p + 2] + data[o + 3] * data[p + 3] < 0)
        for (let c = 0; c < 4; c++) data[o + c] = -data[o + c]
    }
  for (let b = 0; b < numBlocks; b++) {
    const f0 = b * span
    const f1 = Math.min(m.frames - 1, f0 + span)
    const tracks: StoredTrack[] = []
    for (let t = 0; t < T; t++) {
      const pos: Float32Array[] = []
      const rot: Float32Array[] = []
      const scl: Float32Array[] = []
      for (let f = f0; f <= f1; f++) {
        const o = (f * T + t) * 10
        pos.push(data.subarray(o, o + 3))
        rot.push(data.subarray(o + 3, o + 7))
        scl.push(data.subarray(o + 7, o + 10))
      }
      tracks.push({
        quantization: RETAIL_QUANTIZATION,
        pos: encodeVec3(pos, 0),
        rot: encodeRot(rot),
        scale: encodeVec3(scl, 1),
      })
    }
    const block = writeBlock(tracks)
    blockOffsets.push(at)
    // Retail floatBlockOffsets count from the start of their block.
    floatBlockOffsets.push(block.floatOffset)
    parts.push(block.bytes)
    at += block.bytes.length
  }
  return { data: Buffer.concat(parts), blockOffsets, floatBlockOffsets, numBlocks, maskAndQuantizationSize: T * 4 }
}

/* ------------------------------- tagfiles ------------------------------ */
function alignOf(tf: Tagfile, typeIndex: number): number {
  for (let t: TagType | undefined = tf.types[typeIndex]; t; t = tf.types[t.parent]) {
    if (t.align) return t.align
    if (!t.parent) break
  }
  return 1
}

/** The byte size of an item in DATA. */
function itemSize(tf: Tagfile, index: number): number {
  const it = tf.items[index]
  return it.count * sizeOf(tf, it.type)
}

/**
 * Where items start in DATA, as Havok lays them out: in their original
 * order, arrays at 16 bytes except text, objects at their type's alignment.
 */
function itemAlign(tf: Tagfile, index: number): number {
  const it = tf.items[index]
  const t = tf.types[it.type]
  if (it.flags & 0x20) return t?.name === 'char' ? 1 : 16
  return alignOf(tf, it.type)
}

/**
 * Rebuilds DATA with some items' bytes replaced (and resized), moving every
 * later item and the reference offsets (patches) inside them. With no
 * replacements the result is the original file.
 */
export function relayout(tf: Tagfile, replace: Map<number, { bytes: Buffer; count: number }>): Tagfile {
  const order = tf.items.map((_, i) => i).filter((i) => i > 0)
  order.sort((a, b) => tf.items[a].offset - tf.items[b].offset)
  const starts = order.map((i) => tf.items[i].offset)
  const moved = new Map<number, number>()
  const chunks: Buffer[] = []
  let cursor = 0
  const items = tf.items.map((it) => ({ ...it }))
  for (const i of order) {
    const it = tf.items[i]
    const a = itemAlign(tf, i)
    const start = Math.ceil(cursor / a) * a
    if (start > cursor) chunks.push(Buffer.alloc(start - cursor))
    const r = replace.get(i)
    const bytes = r ? r.bytes : tf.data.subarray(it.offset, it.offset + itemSize(tf, i))
    chunks.push(Buffer.from(bytes))
    moved.set(i, start)
    items[i].offset = start
    if (r) items[i].count = r.count
    cursor = start + bytes.length
  }
  // DATA ends on a 16-byte boundary.
  if (cursor % 16) chunks.push(Buffer.alloc(16 - (cursor % 16)))
  // The item an old DATA offset belongs to.
  const owner = (off: number): number => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= off) lo = mid
      else hi = mid - 1
    }
    return order[lo]
  }
  const patches = tf.patches.map((p) => ({
    type: p.type,
    offsets: p.offsets.map((o) => {
      const i = owner(o)
      return o - tf.items[i].offset + moved.get(i)!
    }),
  }))
  return { ...tf, data: Buffer.concat(chunks), items, patches }
}

/** Writes a number into an object's member (by name, through its type's members). */
function setMember(tf: Tagfile, data: Buffer, item: number, name: string, value: number, kind: 'i32' | 'f32'): void {
  const it = tf.items[item]
  const m = allMembers(tf, it.type).find((x) => x.name === name)
  if (!m) throw new Error(`${tf.types[it.type]?.name} has no ${name}`)
  if (kind === 'i32') data.writeInt32LE(value, it.offset + m.offset)
  else data.writeFloatLE(value, it.offset + m.offset)
}

/** The item an object's array member refers to. */
function arrayItem(tf: Tagfile, item: number, name: string): number {
  const it = tf.items[item]
  const m = allMembers(tf, it.type).find((x) => x.name === name)
  if (!m) throw new Error(`${tf.types[it.type]?.name} has no ${name}`)
  return tf.data.readUInt32LE(it.offset + m.offset)
}

/**
 * A new animation file: a copy of `template` (an animation file of the same
 * binder, so it shares its type compendium) with its animation, binding
 * and root motion replaced by `m`.
 */
export function writeAnimationFile(template: Tagfile, m: MotionFrames): Tagfile {
  const anim = itemsOfType(template, 'hkaSplineCompressedAnimation')[0]
  const binding = itemsOfType(template, 'hkaAnimationBinding')[0]
  const frame = itemsOfType(template, 'hkaDefaultAnimatedReferenceFrame')[0]
  if (!anim || !binding) throw new Error('The template has no spline-compressed animation')
  const enc = encodeSplineData(m)
  const duration = (m.frames - 1) * m.frameDuration
  const data = Buffer.from(template.data)
  const tf: Tagfile = { ...template, data }
  setMember(tf, data, anim.index, 'duration', duration, 'f32')
  setMember(tf, data, anim.index, 'numberOfTransformTracks', m.tracks.length, 'i32')
  setMember(tf, data, anim.index, 'numberOfFloatTracks', 0, 'i32')
  setMember(tf, data, anim.index, 'numFrames', m.frames, 'i32')
  setMember(tf, data, anim.index, 'numBlocks', enc.numBlocks, 'i32')
  setMember(tf, data, anim.index, 'maxFramesPerBlock', MAX_FRAMES_PER_BLOCK, 'i32')
  setMember(tf, data, anim.index, 'maskAndQuantizationSize', enc.maskAndQuantizationSize, 'i32')
  const blockDuration = (MAX_FRAMES_PER_BLOCK - 1) * m.frameDuration
  setMember(tf, data, anim.index, 'blockDuration', blockDuration, 'f32')
  setMember(tf, data, anim.index, 'blockInverseDuration', 1 / blockDuration, 'f32')
  setMember(tf, data, anim.index, 'frameDuration', m.frameDuration, 'f32')

  const u32 = (v: number[]) => {
    const b = Buffer.alloc(v.length * 4)
    v.forEach((x, i) => b.writeUInt32LE(x, i * 4))
    return b
  }
  const replace = new Map<number, { bytes: Buffer; count: number }>()
  const put = (owner: number, member: string, bytes: Buffer, count: number) => {
    const i = arrayItem(tf, owner, member)
    if (!i) throw new Error(`The template's ${member} is empty; pick a template that has one`)
    replace.set(i, { bytes, count })
  }
  put(anim.index, 'blockOffsets', u32(enc.blockOffsets), enc.blockOffsets.length)
  put(anim.index, 'floatBlockOffsets', u32(enc.floatBlockOffsets), enc.floatBlockOffsets.length)
  put(anim.index, 'data', enc.data, enc.data.length)
  const bones = Buffer.alloc(m.tracks.length * 2)
  m.tracks.forEach((b, i) => bones.writeInt16LE(b, i * 2))
  put(binding.index, 'transformTrackToBoneIndices', bones, m.tracks.length)
  if (frame) {
    setMember(tf, data, frame.index, 'duration', duration, 'f32')
    const samples = Buffer.alloc(m.frames * 16)
    for (let f = 0; f < m.frames; f++)
      for (let c = 0; c < 4; c++) samples.writeFloatLE(m.root ? m.root[f * 4 + c] : 0, f * 16 + c * 4)
    put(frame.index, 'referenceFrameSamples', samples, m.frames)
  } else if (m.root) throw new Error('The template has no root motion to replace')
  return relayout(tf, replace)
}
