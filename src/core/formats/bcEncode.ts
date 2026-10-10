/**
 * Images packed as the block-compressed DDS textures Elden Ring's effects
 * use: BC7 for colour with alpha (mode 6: one pair of RGBA endpoints per 4×4
 * block, 16 shades between them) and BC4 for greyscale masks (8 shades of
 * one channel), each with a full chain of smaller mip levels, as the game's
 * own textures have.
 *
 * BC7 textures are marked linear (DXGI 98), as the game's effect sprites are,
 * or sRGB (99), as its models' colour maps (_a) are. The encoder is simple
 * and quick, aimed at a faithful image rather than the last bit of quality:
 * each block's endpoints are its colours' bounding box, inset a little, with
 * the shared bit each endpoint's channels round best with. The textures
 * suite decodes what it writes and compares.
 */
import type { Image } from './textures.ts'

/** BC7 mode 6's 4-bit weights (of 64). */
const W4 = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64]

/** A 4×4 block's pixels (edges repeated past the image), RGBA. */
function block(img: Image, bx: number, by: number): Uint8Array {
  const out = new Uint8Array(64)
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const sx = Math.min(img.width - 1, bx * 4 + x)
      const sy = Math.min(img.height - 1, by * 4 + y)
      const s = (sy * img.width + sx) * 4
      out.set(img.rgba.subarray(s, s + 4), (y * 4 + x) * 4)
    }
  return out
}

/** Bits written low to high, as BC7 stores them. */
class Bits {
  private bytes = new Uint8Array(16)
  private at = 0
  put(value: number, count: number): void {
    for (let k = 0; k < count; k++, this.at++) if ((value >> k) & 1) this.bytes[this.at >> 3] |= 1 << (this.at & 7)
  }
  done(): Uint8Array {
    return this.bytes
  }
}

/** An endpoint's 7-bit channels and shared bit that come nearest to an RGBA colour. */
function quantize(c: number[]): { q: number[]; p: number } {
  let best = { q: [0, 0, 0, 0], p: 0, err: Infinity }
  for (const p of [0, 1]) {
    const q = c.map((v) => Math.max(0, Math.min(127, Math.round((v - p) / 2))))
    const err = q.reduce((n, v, k) => n + (((v << 1) | p) - c[k]) ** 2, 0)
    if (err < best.err) best = { q, p, err }
  }
  return { q: best.q, p: best.p }
}

function encodeBc7Block(px: Uint8Array): Uint8Array {
  const lo = [255, 255, 255, 255]
  const hi = [0, 0, 0, 0]
  for (let i = 0; i < 16; i++)
    for (let c = 0; c < 4; c++) {
      lo[c] = Math.min(lo[c], px[i * 4 + c])
      hi[c] = Math.max(hi[c], px[i * 4 + c])
    }
  // Inset the box a little: the extremes are rarely worth a whole endpoint.
  const e0 = lo.map((v, c) => v + (hi[c] - v) / 32)
  const e1 = hi.map((v, c) => v - (v - lo[c]) / 32)
  let a = quantize(e0)
  let b = quantize(e1)
  const colours = (qa: typeof a, qb: typeof b) => {
    const ca = qa.q.map((v) => (v << 1) | qa.p)
    const cb = qb.q.map((v) => (v << 1) | qb.p)
    return W4.map((w) => ca.map((v, c) => ((64 - w) * v + w * cb[c] + 32) >> 6))
  }
  const palette = colours(a, b)
  const indices = new Array<number>(16)
  for (let i = 0; i < 16; i++) {
    let best = 0
    let bestErr = Infinity
    for (let k = 0; k < 16; k++) {
      let err = 0
      for (let c = 0; c < 4; c++) err += (palette[k][c] - px[i * 4 + c]) ** 2
      if (err < bestErr) {
        bestErr = err
        best = k
      }
    }
    indices[i] = best
  }
  // The first pixel's index has an implied high bit of 0: swap the endpoints if it's 8 or more.
  if (indices[0] >= 8) {
    ;[a, b] = [b, a]
    for (let i = 0; i < 16; i++) indices[i] = 15 - indices[i]
  }
  const out = new Bits()
  out.put(1 << 6, 7)
  for (let c = 0; c < 4; c++) {
    out.put(a.q[c], 7)
    out.put(b.q[c], 7)
  }
  out.put(a.p, 1)
  out.put(b.p, 1)
  indices.forEach((v, i) => out.put(v, i === 0 ? 3 : 4))
  return out.done()
}

function encodeBc4Block(px: Uint8Array): Uint8Array {
  let r0 = 0
  let r1 = 255
  for (let i = 0; i < 16; i++) {
    r0 = Math.max(r0, px[i * 4])
    r1 = Math.min(r1, px[i * 4])
  }
  const out = new Uint8Array(8)
  out[0] = r0
  out[1] = r1
  if (r0 === r1) return out
  // Eight shades from r0 down to r1 (r0 > r1): index 0 is r0, 1 is r1, 2..7 between.
  const shade = (k: number) => (k === 0 ? r0 : k === 1 ? r1 : ((8 - k) * r0 + (k - 1) * r1) / 7)
  let bits = 0n
  for (let i = 0; i < 16; i++) {
    let best = 0
    let bestErr = Infinity
    for (let k = 0; k < 8; k++) {
      const err = Math.abs(shade(k) - px[i * 4])
      if (err < bestErr) {
        bestErr = err
        best = k
      }
    }
    bits |= BigInt(best) << BigInt(i * 3)
  }
  for (let k = 0; k < 6; k++) out[2 + k] = Number((bits >> BigInt(k * 8)) & 0xffn)
  return out
}

/** Half the size, each pixel the average of four. */
function halve(img: Image): Image {
  const width = Math.max(1, img.width >> 1)
  const height = Math.max(1, img.height >> 1)
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 4; c++) {
        let n = 0
        let sum = 0
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const sx = Math.min(img.width - 1, x * 2 + dx)
          const sy = Math.min(img.height - 1, y * 2 + dy)
          sum += img.rgba[(sy * img.width + sx) * 4 + c]
          n++
        }
        rgba[(y * width + x) * 4 + c] = Math.round(sum / n)
      }
  return { width, height, rgba }
}

export type PackedFormat = 'BC7' | 'BC4'

/** Whether an image is a greyscale mask: every pixel grey, fully opaque. */
export function isGreyscaleMask(img: Image): boolean {
  for (let i = 0; i < img.rgba.length; i += 4) {
    const [r, g, b, a] = [img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]]
    if (a !== 255 || Math.abs(r - g) > 2 || Math.abs(r - b) > 2) return false
  }
  return true
}

/** A DDS (DX10 header) of an image packed as BC7 (linear or sRGB) or BC4, with every mip level. */
export function encodeDds(img: Image, format: PackedFormat, srgb = false): Buffer {
  const levels: Image[] = [img]
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1)
    levels.push(halve(levels[levels.length - 1]))
  const blockSize = format === 'BC7' ? 16 : 8
  const encode = format === 'BC7' ? encodeBc7Block : encodeBc4Block
  const parts: Buffer[] = []
  for (const l of levels) {
    const bw = Math.max(1, Math.ceil(l.width / 4))
    const bh = Math.max(1, Math.ceil(l.height / 4))
    const out = Buffer.alloc(bw * bh * blockSize)
    for (let by = 0; by < bh; by++)
      for (let bx = 0; bx < bw; bx++) out.set(encode(block(l, bx, by)), (by * bw + bx) * blockSize)
    parts.push(out)
  }
  const header = Buffer.alloc(0x94)
  header.write('DDS ', 0, 'ascii')
  header.writeUInt32LE(124, 0x04)
  // CAPS | HEIGHT | WIDTH | PIXELFORMAT | MIPMAPCOUNT | LINEARSIZE
  header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000, 0x08)
  header.writeUInt32LE(img.height, 0x0c)
  header.writeUInt32LE(img.width, 0x10)
  header.writeUInt32LE(parts[0].length, 0x14)
  header.writeUInt32LE(levels.length, 0x1c)
  header.writeUInt32LE(32, 0x4c)
  header.writeUInt32LE(0x4, 0x50)
  header.write('DX10', 0x54, 'ascii')
  // TEXTURE | COMPLEX | MIPMAP
  header.writeUInt32LE(0x1000 | 0x8 | 0x400000, 0x6c)
  header.writeUInt32LE(format === 'BC7' ? (srgb ? 99 : 98) : 80, 0x80)
  header.writeUInt32LE(3, 0x84)
  header.writeUInt32LE(0, 0x88)
  header.writeUInt32LE(1, 0x8c)
  header.writeUInt32LE(0, 0x90)
  return Buffer.concat([header, ...parts])
}
