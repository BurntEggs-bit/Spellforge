/**
 * PNG files read into RGBA pixels (for textures made from your own images).
 * 8- and 16-bit greyscale, RGB, palette, greyscale + alpha and RGBA images,
 * not interlaced; 16-bit channels keep their high byte.
 */
import zlib from 'node:zlib'
import type { Image } from './textures.ts'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function isPng(b: Buffer): boolean {
  return b.length > 8 && b.subarray(0, 8).equals(SIGNATURE)
}

export function decodePng(b: Buffer): Image {
  if (!isPng(b)) throw new Error('Not a PNG file')
  let at = 8
  let width = 0
  let height = 0
  let depth = 0
  let color = 0
  let interlace = 0
  let palette: Buffer | null = null
  let alphas: Buffer | null = null
  const data: Buffer[] = []
  while (at + 8 <= b.length) {
    const len = b.readUInt32BE(at)
    const type = b.toString('ascii', at + 4, at + 8)
    const body = b.subarray(at + 8, at + 8 + len)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      color = body[9]
      interlace = body[12]
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') alphas = body
    else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    at += 12 + len
  }
  if (!width || !height) throw new Error('The PNG has no image header')
  if (interlace) throw new Error('Interlaced PNGs aren’t supported: save it without interlacing')
  if (depth !== 8 && depth !== 16) throw new Error(`${depth}-bit PNGs aren’t supported: save it as 8-bit`)
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color as 0 | 2 | 3 | 4 | 6]
  if (!channels) throw new Error(`PNG colour type ${color} isn’t supported`)
  if (color === 3 && depth !== 8) throw new Error('Palette PNGs must be 8-bit')
  const bpp = channels * (depth / 8)
  const raw = zlib.inflateSync(Buffer.concat(data))
  const stride = width * bpp
  const pixels = Buffer.alloc(stride * height)
  // Undo each row's filter (None, Sub, Up, Average, Paeth).
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[dst + x - bpp] : 0
      const up = y > 0 ? pixels[dst - stride + x] : 0
      const c = x >= bpp && y > 0 ? pixels[dst - stride + x - bpp] : 0
      let v = raw[src + x]
      if (filter === 1) v += a
      else if (filter === 2) v += up
      else if (filter === 3) v += (a + up) >> 1
      else if (filter === 4) {
        const p = a + up - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      }
      pixels[dst + x] = v & 0xff
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  const step = depth / 8
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp
    const ch = (k: number) => pixels[s + k * step]
    let r: number, g: number, bl: number, al: number
    if (color === 0) [r, g, bl, al] = [ch(0), ch(0), ch(0), 255]
    else if (color === 2) [r, g, bl, al] = [ch(0), ch(1), ch(2), 255]
    else if (color === 3) {
      const idx = pixels[s]
      if (!palette) throw new Error('The PNG’s palette is missing')
      ;[r, g, bl] = [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]]
      al = alphas && idx < alphas.length ? alphas[idx] : 255
    } else if (color === 4) [r, g, bl, al] = [ch(0), ch(0), ch(0), ch(1)]
    else [r, g, bl, al] = [ch(0), ch(1), ch(2), ch(3)]
    rgba.set([r, g, bl, al], i * 4)
  }
  return { width, height, rgba }
}
