/**
 * BC6H (HDR) block decoding, for Elden Ring's light-probe cubemaps.
 *
 * It follows the Direct3D 11 BC6H specification. The per-mode endpoint bit
 * layouts are expressed as data: each step reads `n` bits (optionally
 * bit-reversed) into channel `ch` of endpoint `ep`, shifted left by `shift`.
 * Partitions are BC7's first 32 two-subset shapes.
 *
 * Credit: bcdec (Sergii "iOrange" Kudlai; MIT, notice in
 * THIRD_PARTY_NOTICES.txt): this decoder is a port of its BC6H decoder.
 */
import { ANCHOR2, P2 } from './bc7Tables.ts'

/** IEEE half -> float. */
export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * Math.pow(2, e - 15) * (1 + f / 1024)
}

type Step = [ch: number, ep: number, n: number, shift: number, reversed?: 1]

/** Endpoint bits for each of the 14 modes, in bitstream order (bcdec). */
const MODE_STEPS: Step[][] = [
  // 0: 10.555 x3
  [
    [1, 2, 1, 4],
    [2, 2, 1, 4],
    [2, 3, 1, 4],
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 5, 0],
    [1, 3, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 5, 0],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 5, 0],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 5, 0],
    [2, 3, 1, 2],
    [0, 3, 5, 0],
    [2, 3, 1, 3],
  ],
  // 1: 7666 x3
  [
    [1, 2, 1, 5],
    [1, 3, 1, 4],
    [1, 3, 1, 5],
    [0, 0, 7, 0],
    [2, 3, 1, 0],
    [2, 3, 1, 1],
    [2, 2, 1, 4],
    [1, 0, 7, 0],
    [2, 2, 1, 5],
    [2, 3, 1, 2],
    [1, 2, 1, 4],
    [2, 0, 7, 0],
    [2, 3, 1, 3],
    [2, 3, 1, 5],
    [2, 3, 1, 4],
    [0, 1, 6, 0],
    [1, 2, 4, 0],
    [1, 1, 6, 0],
    [1, 3, 4, 0],
    [2, 1, 6, 0],
    [2, 2, 4, 0],
    [0, 2, 6, 0],
    [0, 3, 6, 0],
  ],
  // 2: 11.555, 11.444, 11.444
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 5, 0],
    [0, 0, 1, 10],
    [1, 2, 4, 0],
    [1, 1, 4, 0],
    [1, 0, 1, 10],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 4, 0],
    [2, 0, 1, 10],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 5, 0],
    [2, 3, 1, 2],
    [0, 3, 5, 0],
    [2, 3, 1, 3],
  ],
  // 3: 11.444, 11.555, 11.444
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 4, 0],
    [0, 0, 1, 10],
    [1, 3, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 5, 0],
    [1, 0, 1, 10],
    [1, 3, 4, 0],
    [2, 1, 4, 0],
    [2, 0, 1, 10],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 4, 0],
    [2, 3, 1, 0],
    [2, 3, 1, 2],
    [0, 3, 4, 0],
    [1, 2, 1, 4],
    [2, 3, 1, 3],
  ],
  // 4: 11.444, 11.444, 11.555
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 4, 0],
    [0, 0, 1, 10],
    [2, 2, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 4, 0],
    [1, 0, 1, 10],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 5, 0],
    [2, 0, 1, 10],
    [2, 2, 4, 0],
    [0, 2, 4, 0],
    [2, 3, 1, 1],
    [2, 3, 1, 2],
    [0, 3, 4, 0],
    [2, 3, 1, 4],
    [2, 3, 1, 3],
  ],
  // 5: 9555 x3
  [
    [0, 0, 9, 0],
    [2, 2, 1, 4],
    [1, 0, 9, 0],
    [1, 2, 1, 4],
    [2, 0, 9, 0],
    [2, 3, 1, 4],
    [0, 1, 5, 0],
    [1, 3, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 5, 0],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 5, 0],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 5, 0],
    [2, 3, 1, 2],
    [0, 3, 5, 0],
    [2, 3, 1, 3],
  ],
  // 6: 8666, 8555, 8555
  [
    [0, 0, 8, 0],
    [1, 3, 1, 4],
    [2, 2, 1, 4],
    [1, 0, 8, 0],
    [2, 3, 1, 2],
    [1, 2, 1, 4],
    [2, 0, 8, 0],
    [2, 3, 1, 3],
    [2, 3, 1, 4],
    [0, 1, 6, 0],
    [1, 2, 4, 0],
    [1, 1, 5, 0],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 5, 0],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 6, 0],
    [0, 3, 6, 0],
  ],
  // 7: 8555, 8666, 8555
  [
    [0, 0, 8, 0],
    [2, 3, 1, 0],
    [2, 2, 1, 4],
    [1, 0, 8, 0],
    [1, 2, 1, 5],
    [1, 2, 1, 4],
    [2, 0, 8, 0],
    [1, 3, 1, 5],
    [2, 3, 1, 4],
    [0, 1, 5, 0],
    [1, 3, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 6, 0],
    [1, 3, 4, 0],
    [2, 1, 5, 0],
    [2, 3, 1, 1],
    [2, 2, 4, 0],
    [0, 2, 5, 0],
    [2, 3, 1, 2],
    [0, 3, 5, 0],
    [2, 3, 1, 3],
  ],
  // 8: 8555, 8555, 8666
  [
    [0, 0, 8, 0],
    [2, 3, 1, 1],
    [2, 2, 1, 4],
    [1, 0, 8, 0],
    [2, 2, 1, 5],
    [1, 2, 1, 4],
    [2, 0, 8, 0],
    [2, 3, 1, 5],
    [2, 3, 1, 4],
    [0, 1, 5, 0],
    [1, 3, 1, 4],
    [1, 2, 4, 0],
    [1, 1, 5, 0],
    [2, 3, 1, 0],
    [1, 3, 4, 0],
    [2, 1, 6, 0],
    [2, 2, 4, 0],
    [0, 2, 5, 0],
    [2, 3, 1, 2],
    [0, 3, 5, 0],
    [2, 3, 1, 3],
  ],
  // 9: 6666 x3 (no transform)
  [
    [0, 0, 6, 0],
    [1, 3, 1, 4],
    [2, 3, 1, 0],
    [2, 3, 1, 1],
    [2, 2, 1, 4],
    [1, 0, 6, 0],
    [1, 2, 1, 5],
    [2, 2, 1, 5],
    [2, 3, 1, 2],
    [1, 2, 1, 4],
    [2, 0, 6, 0],
    [1, 3, 1, 5],
    [2, 3, 1, 3],
    [2, 3, 1, 5],
    [2, 3, 1, 4],
    [0, 1, 6, 0],
    [1, 2, 4, 0],
    [1, 1, 6, 0],
    [1, 3, 4, 0],
    [2, 1, 6, 0],
    [2, 2, 4, 0],
    [0, 2, 6, 0],
    [0, 3, 6, 0],
  ],
  // 10: 10.10 (one region, no transform)
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 10, 0],
    [1, 1, 10, 0],
    [2, 1, 10, 0],
  ],
  // 11: 11.9
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 9, 0],
    [0, 0, 1, 10],
    [1, 1, 9, 0],
    [1, 0, 1, 10],
    [2, 1, 9, 0],
    [2, 0, 1, 10],
  ],
  // 12: 12.8
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 8, 0],
    [0, 0, 2, 10, 1],
    [1, 1, 8, 0],
    [1, 0, 2, 10, 1],
    [2, 1, 8, 0],
    [2, 0, 2, 10, 1],
  ],
  // 13: 16.4
  [
    [0, 0, 10, 0],
    [1, 0, 10, 0],
    [2, 0, 10, 0],
    [0, 1, 4, 0],
    [0, 0, 6, 10, 1],
    [1, 1, 4, 0],
    [1, 0, 6, 10, 1],
    [2, 1, 4, 0],
    [2, 0, 6, 10, 1],
  ],
]

/** Mode code (2 or 5 bits) -> mode index; anything else is reserved. */
const MODE_BY_CODE: Record<number, number> = {
  0b00: 0,
  0b01: 1,
  0b00010: 2,
  0b00110: 3,
  0b01010: 4,
  0b01110: 5,
  0b10010: 6,
  0b10110: 7,
  0b11010: 8,
  0b11110: 9,
  0b00011: 10,
  0b00111: 11,
  0b01011: 12,
  0b01111: 13,
}

/** [endpoint bits, delta bits R, G, B] per mode. */
const BITS: number[][] = [
  [10, 5, 5, 5],
  [7, 6, 6, 6],
  [11, 5, 4, 4],
  [11, 4, 5, 4],
  [11, 4, 4, 5],
  [9, 5, 5, 5],
  [8, 6, 5, 5],
  [8, 5, 6, 5],
  [8, 5, 5, 6],
  [6, 6, 6, 6],
  [10, 10, 10, 10],
  [11, 9, 9, 9],
  [12, 8, 8, 8],
  [16, 4, 4, 4],
]

const W3 = [0, 9, 18, 27, 37, 46, 55, 64]
const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]

const extendSign = (v: number, bits: number) => (v << (32 - bits)) >> (32 - bits)

function transformInverse(v: number, a0: number, bits: number, signed: boolean): number {
  v = (v + a0) & ((1 << bits) - 1)
  return signed ? extendSign(v, bits) : v
}

function unquantize(v: number, bits: number, signed: boolean): number {
  if (!signed) {
    if (bits >= 15) return v
    if (!v) return 0
    if (v === (1 << bits) - 1) return 0xffff
    return ((v << 16) + 0x8000) >> bits
  }
  if (bits >= 16) return v
  let s = false
  if (v < 0) {
    s = true
    v = -v
  }
  let u: number
  if (v === 0) u = 0
  else if (v >= (1 << (bits - 1)) - 1) u = 0x7fff
  else u = ((v << 15) + 0x4000) >> (bits - 1)
  return s ? -u : u
}

function finishUnquantize(v: number, signed: boolean): number {
  if (!signed) return (v * 31) >> 6
  v = v < 0 ? -((-v * 31) >> 5) : (v * 31) >> 5
  return v < 0 ? 0x8000 | -v : v
}

/** LSB-first reader over one 16-byte block. */
class BitReader {
  private pos = 0
  private buf: Buffer
  private base: number
  constructor(buf: Buffer, base: number) {
    this.buf = buf
    this.base = base
  }
  read(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) {
      const p = this.pos + i
      v |= ((this.buf[this.base + (p >> 3)] >> (p & 7)) & 1) << i
    }
    this.pos += n
    return v
  }
  readReversed(n: number): number {
    let bits = this.read(n)
    let r = 0
    for (let i = 0; i < n; i++) {
      r = (r << 1) | (bits & 1)
      bits >>= 1
    }
    return r
  }
}

/** Decodes one block into 16 RGB floats (48 values, row-major). */
export function decodeBc6hBlock(buf: Buffer, offset: number, signed: boolean, out: Float32Array): void {
  const bits = new BitReader(buf, offset)
  let code = bits.read(2)
  if (code > 1) code |= bits.read(3) << 2
  const mode = MODE_BY_CODE[code]
  if (mode === undefined) {
    out.fill(0) // reserved mode: black, per spec
    return
  }

  const e = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ] // e[channel][endpoint]
  for (const [ch, ep, n, shift, rev] of MODE_STEPS[mode]) {
    e[ch][ep] |= (rev ? bits.readReversed(n) : bits.read(n)) << shift
  }
  const twoRegions = mode < 10
  const partition = twoRegions ? bits.read(5) : 0
  const endpoints = twoRegions ? 4 : 2
  const [epBits, ...deltaBits] = BITS[mode]

  for (let c = 0; c < 3; c++) {
    if (signed) e[c][0] = extendSign(e[c][0], epBits)
    if ((mode !== 9 && mode !== 10) || signed) {
      for (let i = 1; i < endpoints; i++) e[c][i] = extendSign(e[c][i], deltaBits[c])
    }
    if (mode !== 9 && mode !== 10) {
      for (let i = 1; i < endpoints; i++) e[c][i] = transformInverse(e[c][i], e[c][0], epBits, signed)
    }
    for (let i = 0; i < endpoints; i++) e[c][i] = unquantize(e[c][i], epBits, signed)
  }

  const weights = twoRegions ? W3 : W4
  for (let p = 0; p < 16; p++) {
    const subset = twoRegions ? P2[partition][p] : 0
    const anchor = p === 0 || (twoRegions && p === ANCHOR2[partition])
    const index = bits.read((twoRegions ? 3 : 4) - (anchor ? 1 : 0))
    const w = weights[index]
    for (let c = 0; c < 3; c++) {
      const a = e[c][subset * 2]
      const b = e[c][subset * 2 + 1]
      const v = (a * (64 - w) + b * w + 32) >> 6
      out[p * 3 + c] = halfToFloat(finishUnquantize(v, signed))
    }
  }
}
