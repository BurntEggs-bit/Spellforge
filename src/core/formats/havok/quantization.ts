/**
 * How hkaSplineCompressedAnimation stores its numbers small: a rotation in one
 * of six formats (bits 2-5 of a track's quantisation byte), positions and
 * scales as 8- or 16-bit fractions of a range (bits 0-1 and 6-7).
 *
 * Credit: these formats are documented by the Havok Format Library (Lukas
 * Cone) and SoulsAssetPipeline (Meowmaritus and Katalash), both GPL-3.0 and
 * read as documentation only; this code is written from the format
 * definitions given here.
 */

/** Rotation formats, by their number in the quantisation byte. */
export const ROTATION = {
  polar32: 0,
  threeComp40: 1,
  threeComp48: 2,
  threeComp24: 3,
  straight16: 4,
  uncompressed: 5,
} as const

/** Bytes one stored rotation takes, by format. */
export const ROTATION_BYTES = [4, 5, 6, 3, 2, 16]
/** The alignment (from the block's start) a stored rotation begins at, by format. */
export const ROTATION_ALIGN = [4, 1, 2, 1, 2, 4]

/** A quaternion, [x, y, z, w]. */
export type Quat = [number, number, number, number]

/*
 * The "three component" formats keep a unit quaternion's three smallest
 * components and drop the largest, which is rebuilt as √(1 − a² − b² − c²)
 * with a stored sign. The largest has magnitude at least ½, so each kept one
 * is within ±1/√2; a format spreads that range over its bits, centred on the
 * middle value.
 */
const THREE_COMP_40 = { bits: 12, centre: 2047, step: Math.SQRT1_2 / 2047 }
const THREE_COMP_48 = { bits: 15, centre: 16383, step: Math.SQRT1_2 / 16383 }
const THREE_COMP_24 = { bits: 7, centre: 63, step: Math.SQRT1_2 / 63.5 }

function fromSmallestThree(kept: number[], dropped: number, negative: boolean): Quat {
  const q: Quat = [0, 0, 0, 0]
  const rest = 1 - kept[0] * kept[0] - kept[1] * kept[1] - kept[2] * kept[2]
  const largest = rest > 0 ? Math.sqrt(rest) : 0
  for (let i = 0, k = 0; i < 4; i++) q[i] = i === dropped ? (negative ? -largest : largest) : kept[k++]
  return q
}

/** An unsigned field of `bits` bits starting at bit `shift` of a value up to 53 bits wide. */
function field(value: number, shift: number, bits: number): number {
  return Math.floor(value / 2 ** shift) % 2 ** bits
}

/** Little-endian unsigned integer of `count` bytes. */
function readUint(bytes: ArrayLike<number>, at: number, count: number): number {
  let v = 0
  for (let i = count - 1; i >= 0; i--) v = v * 256 + bytes[at + i]
  return v
}

/**
 * POLAR32: bits 28-31 the signs of x, y, z and w; bits 18-27 the real part,
 * stored as √(1 − w); bits 0-17 the axis direction as a point on one octant
 * of the sphere, numbered row by row from the pole: row r (0-511, its polar
 * angle r·(π/2)/511) holds 2r + 1 points across the octant's quarter turn.
 */
function polar32(bits: number): Quat {
  const packed = bits % 2 ** 18
  const row = Math.floor(Math.sqrt(packed))
  const polar = (row * (Math.PI / 2)) / 511
  const azimuth = row > 0 ? ((packed - row * row) * (Math.PI / 2)) / (2 * row) : 0
  const root = field(bits, 18, 10) / 1023
  const w = 1 - root * root
  const axisLength = Math.sqrt(Math.max(0, 1 - w * w))
  const q: Quat = [
    Math.sin(polar) * Math.cos(azimuth) * axisLength,
    Math.sin(polar) * Math.sin(azimuth) * axisLength,
    Math.cos(polar) * axisLength,
    w,
  ]
  for (let k = 0; k < 4; k++) if (field(bits, 28 + k, 1)) q[k] = -q[k]
  return q
}

/**
 * Reads one stored rotation in a format, at `at` in `bytes`. STRAIGHT16
 * (no Elden Ring file uses it) reads as no rotation.
 */
export function decodeRotation(format: number, bytes: ArrayLike<number>, at = 0): Quat {
  switch (format) {
    case ROTATION.polar32:
      return polar32(readUint(bytes, at, 4))
    case ROTATION.threeComp40: {
      // Three 12-bit components, then the dropped component's index (2 bits) and its sign.
      const v = readUint(bytes, at, 5)
      const { bits, centre, step } = THREE_COMP_40
      const kept = [0, 1, 2].map((k) => (field(v, k * bits, bits) - centre) * step)
      return fromSmallestThree(kept, field(v, 36, 2), field(v, 38, 1) === 1)
    }
    case ROTATION.threeComp48: {
      // Three 16-bit words: 15 bits of component each; the top bits of the first two give the
      // dropped component's index (first word low), the third's its sign.
      const words = [0, 1, 2].map((k) => readUint(bytes, at + 2 * k, 2))
      const { centre, step } = THREE_COMP_48
      const kept = words.map((w) => ((w & 0x7fff) - centre) * step)
      const dropped = (words[0] >> 15) | ((words[1] >> 15) << 1)
      return fromSmallestThree(kept, dropped, words[2] >> 15 === 1)
    }
    case ROTATION.threeComp24: {
      // Three 7-bit components, the dropped index (2 bits) and its sign.
      const v = readUint(bytes, at, 3)
      const { bits, centre, step } = THREE_COMP_24
      const kept = [0, 1, 2].map((k) => (field(v, k * bits, bits) - centre) * step)
      return fromSmallestThree(kept, field(v, 21, 2), field(v, 23, 1) === 1)
    }
    case ROTATION.uncompressed: {
      const view = new DataView(Uint8Array.from({ length: 16 }, (_, i) => bytes[at + i]).buffer)
      return [view.getFloat32(0, true), view.getFloat32(4, true), view.getFloat32(8, true), view.getFloat32(12, true)]
    }
    default:
      return [0, 0, 0, 1]
  }
}

/** A unit quaternion as THREECOMP40, the format Elden Ring's animations use (the inverse of decodeRotation). */
export function encodeThreeComp40(x: number, y: number, z: number, w: number): Uint8Array {
  const length = Math.hypot(x, y, z, w) || 1
  const q = [x / length, y / length, z / length, w / length]
  let dropped = 0
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[dropped])) dropped = i
  const { bits, centre, step } = THREE_COMP_40
  const top = 2 ** bits - 1
  const kept = q.filter((_, i) => i !== dropped).map((v) => Math.max(0, Math.min(top, Math.round(v / step) + centre)))
  let value = kept[0] + kept[1] * 2 ** 12 + kept[2] * 2 ** 24 + dropped * 2 ** 36 + (q[dropped] < 0 ? 2 ** 38 : 0)
  const out = new Uint8Array(5)
  for (let i = 0; i < 5; i++) {
    out[i] = value % 256
    value = Math.floor(value / 256)
  }
  return out
}

/** A position or scale axis stored as a fraction of [min, max] in 8 bits (quantisation 0) or 16 (otherwise). */
export function dequantize(stored: number, quantization: number, min: number, max: number): number {
  const top = quantization === 0 ? 0xff : 0xffff
  return min + ((max - min) * stored) / top
}
