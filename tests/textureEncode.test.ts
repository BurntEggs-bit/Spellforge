/** Textures made from images: PNG read, BC7 / BC4 written, and decoded back close to the image. */
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { test } from 'node:test'
import { decodePng, isPng } from '../src/core/formats/png.ts'
import { encodeDds, isGreyscaleMask } from '../src/core/formats/bcEncode.ts'
import { decodeDds, type Image } from '../src/core/formats/textures.ts'

/** A test picture: colour gradients with a soft alpha ring. */
function picture(w: number, h: number, grey = false): Image {
  const rgba = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = Math.round((x / (w - 1)) * 255)
      const g = Math.round((y / (h - 1)) * 255)
      const b = Math.round(((x + y) / (w + h - 2)) * 255)
      const d = Math.hypot(x - w / 2, y - h / 2) / (w / 2)
      const a = grey ? 255 : Math.round(Math.max(0, Math.min(1, 1.2 - d)) * 255)
      rgba.set(grey ? [r, r, r, 255] : [r, g, b, a], (y * w + x) * 4)
    }
  return { width: w, height: h, rgba }
}

function psnr(a: Uint8Array, b: Uint8Array, channels: number[]): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4)
    for (const c of channels) {
      sum += (a[i + c] - b[i + c]) ** 2
      n++
    }
  return sum === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sum / n))
}

/** A minimal PNG (RGBA, filter 0 rows) for the reader. */
function png(img: Image): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(body.length)
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(tb))
    return Buffer.concat([len, tb, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.width, 0)
  ihdr.writeUInt32BE(img.height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const rows = Buffer.alloc((img.width * 4 + 1) * img.height)
  for (let y = 0; y < img.height; y++)
    rows.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), y * (img.width * 4 + 1) + 1)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

test('a PNG reads back as its pixels', () => {
  const img = picture(37, 21)
  const file = png(img)
  assert.ok(isPng(file))
  const back = decodePng(file)
  assert.equal(back.width, 37)
  assert.equal(back.height, 21)
  assert.deepEqual(Buffer.from(back.rgba), Buffer.from(img.rgba))
})

test('BC7 keeps colour and alpha close, with every mip level, linear or sRGB', () => {
  const img = picture(64, 48)
  const dds = encodeDds(img, 'BC7')
  assert.equal(dds.readUInt32LE(0x80), 98)
  assert.equal(encodeDds(img, 'BC7', true).readUInt32LE(0x80), 99)
  assert.equal(dds.readUInt32LE(0x1c), 7)
  const back = decodeDds(dds)
  assert.equal(back.format, 'BC7')
  assert.ok(psnr(img.rgba, back.rgba, [0, 1, 2]) > 33, `colour ${psnr(img.rgba, back.rgba, [0, 1, 2]).toFixed(1)} dB`)
  assert.ok(psnr(img.rgba, back.rgba, [3]) > 33, `alpha ${psnr(img.rgba, back.rgba, [3]).toFixed(1)} dB`)
})

test('a greyscale mask packs as BC4 and stays close', () => {
  const img = picture(32, 32, true)
  assert.ok(isGreyscaleMask(img))
  assert.ok(!isGreyscaleMask(picture(8, 8)))
  const back = decodeDds(encodeDds(img, 'BC4'))
  assert.equal(back.format, 'BC4')
  assert.ok(psnr(img.rgba, back.rgba, [0]) > 38, `${psnr(img.rgba, back.rgba, [0]).toFixed(1)} dB`)
})
