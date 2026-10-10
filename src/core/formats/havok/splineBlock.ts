/**
 * One block of an hkaSplineCompressedAnimation as stored, without dequantizing:
 * read for decoding and to write blocks back byte for byte.
 *
 * Layout: a 4-byte mask per transform track (quantization byte, then
 * position / rotation / scale flags), one byte per float track, align 4;
 * then per track its position, rotation and scale, each followed by align 4.
 * A component is either static (a float per axis, or one quantized
 * quaternion) or a B-spline: u16 control point count - 1, u8 degree, u8
 * knots (in frames), then for positions align 4, a min and max float per
 * spline axis, and the quantized control points interleaved by point. Float
 * track data starts at the block's floatBlockOffset; blocks are padded to
 * 16 bytes.
 */
import { ROTATION_ALIGN as ROT_ALIGN, ROTATION_BYTES as ROT_SIZE } from './quantization.ts'

/** One spline as stored: degree, knots and quantized control points. */
export interface StoredSpline {
  degree: number
  knots: number[]
  /** Position/scale: per spline axis, its range. */
  min?: number[]
  max?: number[]
  /**
   * Control points as stored: for positions/scales, per point the u8/u16 of
   * each spline axis in order; for rotations, per point the raw quaternion
   * bytes.
   */
  points: number[][] | Uint8Array[]
}

export interface StoredVec3 {
  flags: number
  /** Static axis values, by axis (only for axes with their static flag). */
  statics: (number | null)[]
  spline: StoredSpline | null
}

export interface StoredRot {
  flags: number
  /** A static quaternion's raw bytes. */
  value: Uint8Array | null
  spline: StoredSpline | null
}

export interface StoredTrack {
  quantization: number
  pos: StoredVec3
  rot: StoredRot
  scale: StoredVec3
}
class Writer {
  bytes: number[] = []
  get pos() {
    return this.bytes.length
  }
  u8(v: number) {
    this.bytes.push(v & 0xff)
  }
  u16(v: number) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff)
  }
  f32(v: number) {
    const b = Buffer.alloc(4)
    b.writeFloatLE(v, 0)
    this.bytes.push(...b)
  }
  raw(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.bytes.push(b[i])
  }
  align(n: number, base: number) {
    while ((this.pos - base) % n) this.bytes.push(0)
  }
}
function writeVec3(w: Writer, base: number, c: StoredVec3, quant: number): void {
  if (!c.spline) {
    for (let a = 0; a < 3; a++) if (c.flags & (1 << a)) w.f32(c.statics[a] ?? 0)
    return
  }
  const s = c.spline
  const n = s.points.length - 1
  w.u16(n)
  w.u8(s.degree)
  for (const k of s.knots) w.u8(k)
  w.align(4, base)
  let k = 0
  for (let a = 0; a < 3; a++) {
    if (c.flags & (0x10 << a)) {
      w.f32(s.min![k])
      w.f32(s.max![k])
      k++
    } else if (c.flags & (1 << a)) w.f32(c.statics[a] ?? 0)
  }
  const put = quant === 0 ? (q: number) => w.u8(q) : (q: number) => w.u16(q)
  for (const p of s.points as number[][]) for (const q of p) put(q)
}
function writeRot(w: Writer, base: number, c: StoredRot, quant: number): void {
  if (!c.spline) {
    if (c.value) {
      w.align(ROT_ALIGN[quant], base)
      w.raw(c.value)
    }
    return
  }
  const s = c.spline
  w.u16(s.points.length - 1)
  w.u8(s.degree)
  for (const k of s.knots) w.u8(k)
  w.align(ROT_ALIGN[quant], base)
  for (const p of s.points as Uint8Array[]) w.raw(p)
}
/**
 * One block's bytes from stored tracks, and where its float data starts
 * (relative to the block). `floatTracks` is the number of float tracks
 * (their masks are written as 0; Elden Ring player animations have none).
 */
export function writeBlock(tracks: StoredTrack[], floatTracks = 0): { bytes: Buffer; floatOffset: number } {
  const w = new Writer()
  for (const t of tracks) {
    w.u8(t.quantization)
    w.u8(t.pos.flags)
    w.u8(t.rot.flags)
    w.u8(t.scale.flags)
  }
  for (let i = 0; i < floatTracks; i++) w.u8(0)
  w.align(4, 0)
  for (const t of tracks) {
    const q = t.quantization
    writeVec3(w, 0, t.pos, q & 3)
    w.align(4, 0)
    writeRot(w, 0, t.rot, (q >> 2) & 0xf)
    w.align(4, 0)
    writeVec3(w, 0, t.scale, (q >> 6) & 3)
    w.align(4, 0)
  }
  const floatOffset = w.pos
  w.align(16, 0)
  return { bytes: Buffer.from(w.bytes), floatOffset }
}
/** Reads one block's tracks as stored (no dequantizing): the inverse of writeBlock. */
export function readBlock(
  data: Uint8Array,
  base: number,
  trackCount: number,
  floatTracks: number,
): { tracks: StoredTrack[]; end: number } {
  let p = base
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const align = (n: number) => {
    p = base + Math.ceil((p - base) / n) * n
  }
  const masks: number[][] = []
  for (let i = 0; i < trackCount; i++) masks.push([data[p++], data[p++], data[p++], data[p++]])
  p += floatTracks
  align(4)
  const u16 = () => {
    const v = view.getUint16(p, true)
    p += 2
    return v
  }
  const f32 = () => {
    const v = view.getFloat32(p, true)
    p += 4
    return v
  }
  const vec = (flags: number, quant: number): StoredVec3 => {
    const statics: (number | null)[] = [null, null, null]
    if ((flags & 0x70) === 0) {
      for (let a = 0; a < 3; a++) if (flags & (1 << a)) statics[a] = f32()
      return { flags, statics, spline: null }
    }
    const n = u16()
    const degree = data[p++]
    const knots = Array.from(data.subarray(p, p + n + degree + 2))
    p += n + degree + 2
    align(4)
    const min: number[] = []
    const max: number[] = []
    for (let a = 0; a < 3; a++) {
      if (flags & (0x10 << a)) {
        min.push(f32())
        max.push(f32())
      } else if (flags & (1 << a)) statics[a] = f32()
    }
    const points: number[][] = []
    for (let i = 0; i <= n; i++) {
      const pt: number[] = []
      for (let a = 0; a < 3; a++) if (flags & (0x10 << a)) pt.push(quant === 0 ? data[p++] : u16())
      points.push(pt)
    }
    return { flags, statics, spline: { degree, knots, min, max, points } }
  }
  const rot = (flags: number, quant: number): StoredRot => {
    if ((flags & 0xf0) === 0) {
      if (flags & 0x0f) {
        align(ROT_ALIGN[quant])
        const value = data.slice(p, p + ROT_SIZE[quant])
        p += ROT_SIZE[quant]
        return { flags, value, spline: null }
      }
      return { flags, value: null, spline: null }
    }
    const n = u16()
    const degree = data[p++]
    const knots = Array.from(data.subarray(p, p + n + degree + 2))
    p += n + degree + 2
    align(ROT_ALIGN[quant])
    const points: Uint8Array[] = []
    for (let i = 0; i <= n; i++) {
      points.push(data.slice(p, p + ROT_SIZE[quant]))
      p += ROT_SIZE[quant]
    }
    return { flags, value: null, spline: { degree, knots, points } }
  }
  const tracks: StoredTrack[] = []
  for (let i = 0; i < trackCount; i++) {
    const [q, pf, rf, sf] = masks[i]
    const pos = vec(pf, q & 3)
    align(4)
    const r = rot(rf, (q >> 2) & 0xf)
    align(4)
    const scale = vec(sf, (q >> 6) & 3)
    align(4)
    tracks.push({ quantization: q, pos, rot: r, scale })
  }
  return { tracks, end: p }
}
