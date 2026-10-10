/**
 * Effect textures: TPF containers of DDS images, decoded to RGBA for
 * thumbnails and previews.
 *
 * Survey of sfxbnd_commoneffects (452 textures): BC1/DXT1, BC4/ATI1 and BC7
 * only. BC2, BC3, BC5 and plain RGBA8 are handled too for other bundles.
 * The block decoders below are written from the Direct3D block-compression
 * specification; only BC7's fixed partition tables come from the spec data.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the TPF layout.
 */
import zlib from 'node:zlib'
import { ANCHOR2, ANCHOR3_2, ANCHOR3_3, P2, P3, WEIGHTS } from './bc7Tables.ts'

/* --------------------------------- TPF ---------------------------------- */

export interface TpfTexture {
  name: string
  /** TPF's own format byte (informational). */
  format: number
  /** A complete DDS file. */
  dds: Buffer
  type: number
  mipmaps: number
  flags: number
}

/**
 * PC TPF layout:
 *   0x00 "TPF\0", 0x04 i32 dataSize, 0x08 i32 count,
 *   0x0C u8 platform (0 = PC), u8 flag2, u8 encoding (1 = UTF-16 names), u8 0
 *   0x10 entries of 0x14 bytes: u32 offset, i32 size, u8 format, u8 type,
 *        u8 mipmaps, u8 flags, u32 nameOffset, i32 unk
 */
export function readTpf(buf: Buffer): TpfTexture[] {
  if (buf.toString('ascii', 0, 4) !== 'TPF\0') throw new Error('Not a TPF')
  const count = buf.readInt32LE(0x08)
  const unicode = buf[0x0e] === 1
  const out: TpfTexture[] = []
  for (let i = 0; i < count; i++) {
    const o = 0x10 + i * 0x14
    const offset = buf.readUInt32LE(o)
    const size = buf.readInt32LE(o + 4)
    const nameOffset = buf.readUInt32LE(o + 0x0c)
    let end = nameOffset
    let name: string
    if (unicode) {
      while (buf.readUInt16LE(end) !== 0) end += 2
      name = buf.toString('utf16le', nameOffset, end)
    } else {
      while (buf[end] !== 0) end++
      name = buf.toString('latin1', nameOffset, end)
    }
    out.push({
      name,
      format: buf[o + 8],
      dds: buf.subarray(offset, offset + size),
      type: buf[o + 9],
      mipmaps: buf[o + 10],
      flags: buf[o + 11],
    })
  }
  return out
}

export interface TpfWriteTexture {
  name: string
  format: number
  dds: Buffer
  /** Mip count recorded in the entry; read from the DDS when omitted. */
  mipmaps?: number
  type?: number
  flags?: number
}

/**
 * Writes a PC TPF: header, one 0x14-byte entry per texture, UTF-16 names,
 * then the DDS files back to back. Matches retail effect TPFs byte for
 * byte.
 */
export function writeTpf(textures: TpfWriteTexture[]): Buffer {
  const entriesEnd = 0x10 + textures.length * 0x14
  const names = textures.map((t) => Buffer.from(t.name + '\0', 'utf16le'))
  const nameOffsets: number[] = []
  let cursor = entriesEnd
  for (const n of names) {
    nameOffsets.push(cursor)
    cursor += n.length
  }
  const dataOffsets: number[] = []
  for (const t of textures) {
    dataOffsets.push(cursor)
    cursor += t.dds.length
  }
  const out = Buffer.alloc(cursor)
  out.write('TPF\0', 0, 'ascii')
  out.writeInt32LE(
    textures.reduce((n, t) => n + t.dds.length, 0),
    0x04,
  )
  out.writeInt32LE(textures.length, 0x08)
  out[0x0c] = 0 // PC
  out[0x0d] = 3
  out[0x0e] = 1 // UTF-16 names
  out[0x0f] = 0
  textures.forEach((t, i) => {
    const o = 0x10 + i * 0x14
    out.writeUInt32LE(dataOffsets[i], o)
    out.writeInt32LE(t.dds.length, o + 4)
    out[o + 8] = t.format
    out[o + 9] = t.type ?? 0 // 0 = texture, 1 = cubemap, 2 = volume
    out[o + 10] = t.mipmaps ?? readDdsInfo(t.dds).mipCount
    out[o + 11] = t.flags ?? 0
    out.writeUInt32LE(nameOffsets[i], o + 0x0c)
    out.writeInt32LE(0, o + 0x10)
    names[i].copy(out, nameOffsets[i])
    t.dds.copy(out, dataOffsets[i])
  })
  return out
}

/**
 * TPF format byte for a DDS's compression, as Elden Ring's own textures use
 * it. Only formats observed in retail TPFs are accepted.
 */
export function tpfFormatFor(dds: Buffer): number {
  const info = readDdsInfo(dds)
  switch (info.format) {
    case 'BC1':
      return 0
    case 'BC4':
      return 103
    case 'BC7':
      return 102
    default:
      throw new Error(
        `${info.format} textures aren't used by Elden Ring effects. Re-export the DDS as BC7 (colour + alpha), BC1 (no alpha) or BC4 (greyscale masks).`,
      )
  }
}

/* --------------------------------- DDS ---------------------------------- */

export type BlockFormat = 'BC1' | 'BC2' | 'BC3' | 'BC4' | 'BC5' | 'BC7' | 'RGBA8' | 'BGRA8'

export interface DdsInfo {
  width: number
  height: number
  mipCount: number
  format: BlockFormat
  dataOffset: number
}

const DXGI: Record<number, BlockFormat> = {
  28: 'RGBA8',
  29: 'RGBA8',
  71: 'BC1',
  72: 'BC1',
  74: 'BC2',
  75: 'BC2',
  77: 'BC3',
  78: 'BC3',
  80: 'BC4',
  81: 'BC4',
  83: 'BC5',
  84: 'BC5',
  87: 'BGRA8',
  91: 'BGRA8',
  98: 'BC7',
  99: 'BC7',
}

const FOURCC: Record<string, BlockFormat> = {
  DXT1: 'BC1',
  DXT2: 'BC2',
  DXT3: 'BC2',
  DXT4: 'BC3',
  DXT5: 'BC3',
  ATI1: 'BC4',
  BC4U: 'BC4',
  ATI2: 'BC5',
  BC5U: 'BC5',
}

function readDdsInfo(dds: Buffer): DdsInfo {
  if (dds.toString('ascii', 0, 4) !== 'DDS ') throw new Error('Not a DDS')
  const height = dds.readUInt32LE(0x0c)
  const width = dds.readUInt32LE(0x10)
  const mipCount = Math.max(1, dds.readUInt32LE(0x1c))
  const pfFlags = dds.readUInt32LE(0x50)
  const fourCC = dds.toString('ascii', 0x54, 0x58)

  if (fourCC === 'DX10') {
    const dxgi = dds.readUInt32LE(0x80)
    const format = DXGI[dxgi]
    if (!format) throw new Error(`Unsupported DXGI format ${dxgi}`)
    return { width, height, mipCount, format, dataOffset: 0x94 }
  }
  if (pfFlags & 0x4) {
    const format = FOURCC[fourCC]
    if (!format) throw new Error(`Unsupported DDS FourCC ${JSON.stringify(fourCC)}`)
    return { width, height, mipCount, format, dataOffset: 0x80 }
  }
  // Uncompressed: tell RGBA from BGRA by the red mask.
  const bits = dds.readUInt32LE(0x58)
  if (bits !== 32) throw new Error(`Unsupported ${bits}-bit uncompressed DDS`)
  const rMask = dds.readUInt32LE(0x5c)
  return { width, height, mipCount, format: rMask === 0xff ? 'RGBA8' : 'BGRA8', dataOffset: 0x80 }
}

function blockBytes(format: BlockFormat): number {
  return format === 'BC1' || format === 'BC4' ? 8 : 16
}

function mipSize(format: BlockFormat, w: number, h: number): number {
  if (format === 'RGBA8' || format === 'BGRA8') return w * h * 4
  return Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4)) * blockBytes(format)
}

export interface Image {
  width: number
  height: number
  /** RGBA, 8 bits per channel. */
  rgba: Uint8Array
}

/**
 * Decodes one mip level. `maxSize` picks the smallest mip that is still at
 * least that big, which keeps thumbnails fast for 2048px textures.
 */
export function decodeDds(dds: Buffer, maxSize = Infinity): Image & { format: BlockFormat } {
  const info = readDdsInfo(dds)
  let { width: w, height: h } = info
  let offset = info.dataOffset
  // Step down while the next mip would still be at least maxSize.
  for (let mip = 0; mip < info.mipCount - 1 && Math.max(w, h) / 2 >= maxSize; mip++) {
    offset += mipSize(info.format, w, h)
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  const data = dds.subarray(offset, offset + mipSize(info.format, w, h))
  return { width: w, height: h, rgba: decodeBlocks(info.format, data, w, h), format: info.format }
}

/**
 * Decodes one rectangle of a DDS's top mip: only the 4×4 blocks under it
 * (one icon of a 4096-pixel menu atlas, say).
 */
export function decodeRegion(dds: Buffer, x: number, y: number, w: number, h: number): Image {
  const info = readDdsInfo(dds)
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > info.width || y + h > info.height)
    throw new Error(`Region ${x},${y} ${w}×${h} is outside the ${info.width}×${info.height} texture`)
  const data = dds.subarray(info.dataOffset)
  let tile: { rgba: Uint8Array; width: number; ox: number; oy: number }
  if (info.format === 'RGBA8' || info.format === 'BGRA8') {
    const rows = Buffer.alloc(w * h * 4)
    for (let j = 0; j < h; j++)
      data.copy(rows, j * w * 4, ((y + j) * info.width + x) * 4, ((y + j) * info.width + x + w) * 4)
    tile = { rgba: decodeBlocks(info.format, rows, w, h), width: w, ox: 0, oy: 0 }
  } else {
    const bb = blockBytes(info.format)
    const across = Math.ceil(info.width / 4)
    const bx0 = Math.floor(x / 4)
    const by0 = Math.floor(y / 4)
    const cols = Math.ceil((x + w) / 4) - bx0
    const rows = Math.ceil((y + h) / 4) - by0
    const blocks = Buffer.alloc(cols * rows * bb)
    for (let r = 0; r < rows; r++)
      data.copy(blocks, r * cols * bb, ((by0 + r) * across + bx0) * bb, ((by0 + r) * across + bx0 + cols) * bb)
    tile = {
      rgba: decodeBlocks(info.format, blocks, cols * 4, rows * 4),
      width: cols * 4,
      ox: x - bx0 * 4,
      oy: y - by0 * 4,
    }
  }
  const out = new Uint8Array(w * h * 4)
  for (let j = 0; j < h; j++)
    out.set(
      tile.rgba.subarray(((tile.oy + j) * tile.width + tile.ox) * 4, ((tile.oy + j) * tile.width + tile.ox + w) * 4),
      j * w * 4,
    )
  return { width: w, height: h, rgba: out }
}

/* ---------------------------- block decoders ---------------------------- */

function decodeBlocks(format: BlockFormat, data: Buffer, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  if (format === 'RGBA8' || format === 'BGRA8') {
    for (let i = 0; i < width * height; i++) {
      const o = i * 4
      if (format === 'RGBA8') {
        out[o] = data[o]
        out[o + 1] = data[o + 1]
        out[o + 2] = data[o + 2]
        out[o + 3] = data[o + 3]
      } else {
        out[o] = data[o + 2]
        out[o + 1] = data[o + 1]
        out[o + 2] = data[o]
        out[o + 3] = data[o + 3]
      }
    }
    return out
  }

  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  const size = blockBytes(format)
  const block = new Uint8Array(64) // 16 pixels x RGBA

  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const o = (by * bw + bx) * size
      switch (format) {
        case 'BC1':
          decodeBC1(data, o, block, true)
          break
        case 'BC2':
          decodeBC1(data, o + 8, block, false)
          for (let i = 0; i < 16; i++) {
            const nibble = (data[o + (i >> 1)] >> ((i & 1) * 4)) & 0xf
            block[i * 4 + 3] = nibble * 17
          }
          break
        case 'BC3':
          decodeBC1(data, o + 8, block, false)
          decodeBC4(data, o, block, 3)
          break
        case 'BC4':
          decodeBC4(data, o, block, 0)
          for (let i = 0; i < 16; i++) {
            block[i * 4 + 1] = block[i * 4 + 2] = block[i * 4]
            block[i * 4 + 3] = 255
          }
          break
        case 'BC5':
          decodeBC4(data, o, block, 0)
          decodeBC4(data, o + 8, block, 1)
          for (let i = 0; i < 16; i++) {
            block[i * 4 + 2] = 255 // show normal maps the way artists expect
            block[i * 4 + 3] = 255
          }
          break
        case 'BC7':
          decodeBC7(data, o, block)
          break
      }
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py
        if (y >= height) break
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          if (x >= width) break
          const s = (py * 4 + px) * 4
          const d = (y * width + x) * 4
          out[d] = block[s]
          out[d + 1] = block[s + 1]
          out[d + 2] = block[s + 2]
          out[d + 3] = block[s + 3]
        }
      }
    }
  }
  return out
}

function expand565(c: number): [number, number, number] {
  const r = (c >> 11) & 31
  const g = (c >> 5) & 63
  const b = c & 31
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

/** BC1 color block. `allowAlpha` enables the 3-color + transparent mode. */
function decodeBC1(data: Buffer, o: number, out: Uint8Array, allowAlpha: boolean): void {
  const c0 = data.readUInt16LE(o)
  const c1 = data.readUInt16LE(o + 2)
  const a = expand565(c0)
  const b = expand565(c1)
  const palette: number[][] = [
    [...a, 255],
    [...b, 255],
  ]
  if (c0 > c1 || !allowAlpha) {
    palette.push([0, 1, 2].map((i) => Math.round((2 * a[i] + b[i]) / 3)).concat(255))
    palette.push([0, 1, 2].map((i) => Math.round((a[i] + 2 * b[i]) / 3)).concat(255))
  } else {
    palette.push([0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2)).concat(255))
    palette.push([0, 0, 0, 0])
  }
  const bits = data.readUInt32LE(o + 4)
  for (let i = 0; i < 16; i++) {
    const p = palette[(bits >>> (i * 2)) & 3]
    out[i * 4] = p[0]
    out[i * 4 + 1] = p[1]
    out[i * 4 + 2] = p[2]
    if (allowAlpha) out[i * 4 + 3] = p[3]
  }
}

/** BC4 single-channel block, written into `channel` of each pixel. */
function decodeBC4(data: Buffer, o: number, out: Uint8Array, channel: number): void {
  const r0 = data[o]
  const r1 = data[o + 1]
  const v: number[] = [r0, r1]
  if (r0 > r1) {
    for (let i = 1; i <= 6; i++) v.push(Math.round(((7 - i) * r0 + i * r1) / 7))
  } else {
    for (let i = 1; i <= 4; i++) v.push(Math.round(((5 - i) * r0 + i * r1) / 5))
    v.push(0, 255)
  }
  // 48 bits of 3-bit indices, little-endian.
  const lo = data.readUInt32LE(o + 2)
  const hi = data.readUInt16LE(o + 6)
  for (let i = 0; i < 16; i++) {
    const bitPos = i * 3
    let idx: number
    if (bitPos + 3 <= 32) idx = (lo >>> bitPos) & 7
    else if (bitPos >= 32) idx = (hi >>> (bitPos - 32)) & 7
    else idx = ((lo >>> bitPos) | (hi << (32 - bitPos))) & 7
    out[i * 4 + channel] = v[idx]
  }
}

/* --------------------------------- BC7 ---------------------------------- */

interface Bc7Mode {
  subsets: number
  partitionBits: number
  rotationBits: number
  indexSelBits: number
  colorBits: number
  alphaBits: number
  endpointPBits: number
  sharedPBits: number
  indexBits: number
  index2Bits: number
}

const BC7_MODES: Bc7Mode[] = [
  {
    subsets: 3,
    partitionBits: 4,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 4,
    alphaBits: 0,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 3,
    index2Bits: 0,
  },
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 6,
    alphaBits: 0,
    endpointPBits: 0,
    sharedPBits: 1,
    indexBits: 3,
    index2Bits: 0,
  },
  {
    subsets: 3,
    partitionBits: 6,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 5,
    alphaBits: 0,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  },
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 7,
    alphaBits: 0,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  },
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 2,
    indexSelBits: 1,
    colorBits: 5,
    alphaBits: 6,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 3,
  },
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 2,
    indexSelBits: 0,
    colorBits: 7,
    alphaBits: 8,
    endpointPBits: 0,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 2,
  },
  {
    subsets: 1,
    partitionBits: 0,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 7,
    alphaBits: 7,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 4,
    index2Bits: 0,
  },
  {
    subsets: 2,
    partitionBits: 6,
    rotationBits: 0,
    indexSelBits: 0,
    colorBits: 5,
    alphaBits: 5,
    endpointPBits: 1,
    sharedPBits: 0,
    indexBits: 2,
    index2Bits: 0,
  },
]

/** LSB-first bit reader over one 16-byte block. */
class Bits {
  private pos = 0
  private data: Buffer
  private base: number
  constructor(data: Buffer, base: number) {
    this.data = data
    this.base = base
  }
  read(n: number): number {
    let v = 0
    for (let i = 0; i < n; i++) {
      const p = this.pos + i
      const bit = (this.data[this.base + (p >> 3)] >> (p & 7)) & 1
      v |= bit << i
    }
    this.pos += n
    return v
  }
}

function decodeBC7(data: Buffer, o: number, out: Uint8Array): void {
  const first = data[o]
  let mode = 0
  while (mode < 8 && !(first & (1 << mode))) mode++
  if (mode === 8) {
    out.fill(0) // reserved mode: transparent black, per spec
    return
  }
  const m = BC7_MODES[mode]
  const bits = new Bits(data, o)
  bits.read(mode + 1)

  const partition = bits.read(m.partitionBits)
  const rotation = bits.read(m.rotationBits)
  const indexSel = bits.read(m.indexSelBits)
  const endpoints = m.subsets * 2

  // Endpoints: all R values, then all G, then all B, then all A.
  const ep: number[][] = Array.from({ length: endpoints }, () => [0, 0, 0, 255])
  for (let c = 0; c < 3; c++) for (let e = 0; e < endpoints; e++) ep[e][c] = bits.read(m.colorBits)
  if (m.alphaBits) for (let e = 0; e < endpoints; e++) ep[e][3] = bits.read(m.alphaBits)

  // P-bits extend each endpoint by one low bit.
  let colorPrec = m.colorBits
  let alphaPrec = m.alphaBits
  if (m.endpointPBits || m.sharedPBits) {
    const pbits: number[] = []
    if (m.endpointPBits) for (let e = 0; e < endpoints; e++) pbits.push(bits.read(1))
    else
      for (let s = 0; s < m.subsets; s++) {
        const b = bits.read(1)
        pbits.push(b, b)
      }
    for (let e = 0; e < endpoints; e++) {
      for (let c = 0; c < 3; c++) ep[e][c] = (ep[e][c] << 1) | pbits[e]
      if (m.alphaBits) ep[e][3] = (ep[e][3] << 1) | pbits[e]
    }
    colorPrec++
    if (m.alphaBits) alphaPrec++
  }

  // Expand to 8 bits by replicating the top bits.
  for (let e = 0; e < endpoints; e++) {
    for (let c = 0; c < 3; c++) ep[e][c] = expandBits(ep[e][c], colorPrec)
    if (m.alphaBits) ep[e][3] = expandBits(ep[e][3], alphaPrec)
  }

  const subsetOf = (i: number) => (m.subsets === 1 ? 0 : m.subsets === 2 ? P2[partition][i] : P3[partition][i])
  const isAnchor = (i: number) => {
    if (i === 0) return true
    if (m.subsets === 2) return i === ANCHOR2[partition]
    if (m.subsets === 3) return i === ANCHOR3_2[partition] || i === ANCHOR3_3[partition]
    return false
  }

  const idx1: number[] = []
  for (let i = 0; i < 16; i++) idx1.push(bits.read(isAnchor(i) ? m.indexBits - 1 : m.indexBits))
  const idx2: number[] = []
  if (m.index2Bits) for (let i = 0; i < 16; i++) idx2.push(bits.read(i === 0 ? m.index2Bits - 1 : m.index2Bits))

  for (let i = 0; i < 16; i++) {
    const s = subsetOf(i)
    const e0 = ep[s * 2]
    const e1 = ep[s * 2 + 1]
    let colorIdx = idx1[i]
    let colorBitsUsed = m.indexBits
    let alphaIdx = idx1[i]
    let alphaBitsUsed = m.indexBits
    if (m.index2Bits) {
      if (indexSel === 0) {
        alphaIdx = idx2[i]
        alphaBitsUsed = m.index2Bits
      } else {
        colorIdx = idx2[i]
        colorBitsUsed = m.index2Bits
      }
    }
    const wc = WEIGHTS[colorBitsUsed][colorIdx]
    const wa = WEIGHTS[alphaBitsUsed][alphaIdx]
    let r = interp(e0[0], e1[0], wc)
    let g = interp(e0[1], e1[1], wc)
    let b = interp(e0[2], e1[2], wc)
    let a = m.alphaBits ? interp(e0[3], e1[3], wa) : 255
    if (rotation === 1) [a, r] = [r, a]
    else if (rotation === 2) [a, g] = [g, a]
    else if (rotation === 3) [a, b] = [b, a]
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = a
  }
}

function expandBits(v: number, bits: number): number {
  v <<= 8 - bits
  return (v | (v >> bits)) & 0xff
}

function interp(a: number, b: number, w: number): number {
  return ((64 - w) * a + w * b + 32) >> 6
}

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function encodePng(img: Image): Buffer {
  const { width, height, rgba } = img
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Nearest-neighbour downscale so the longest side is at most `max`. */
export function downscale(img: Image, max: number): Image {
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  if (scale === 1) return img
  const w = Math.max(1, Math.round(img.width * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale))
      const s = (sy * img.width + sx) * 4
      const d = (y * w + x) * 4
      out[d] = img.rgba[s]
      out[d + 1] = img.rgba[s + 1]
      out[d + 2] = img.rgba[s + 2]
      out[d + 3] = img.rgba[s + 3]
    }
  }
  return { width: w, height: h, rgba: out }
}

/**
 * A PNG thumbnail for a TPF's first texture. With `greyAsAlpha`, single-
 * channel (BC4) masks get their grey value as alpha too, the way particle
 * shaders use them; otherwise they show as opaque grey. `'mask'` (a second
 * texture layer that only shapes the first) does the same for any texture
 * without real alpha: an opaque white-on-black crest cuts out its shape
 * instead of a solid square.
 */
export function tpfThumbnail(tpf: Buffer, max = 128, greyAsAlpha: boolean | 'mask' = false): Buffer {
  const tex = readTpf(tpf)[0]
  if (!tex) throw new Error('Empty TPF')
  const img = decodeDds(tex.dds, max)
  const n = img.width * img.height
  let opaque = greyAsAlpha === 'mask'
  for (let i = 0; opaque && i < n; i++) if (img.rgba[i * 4 + 3] < 250) opaque = false
  if ((greyAsAlpha && img.format === 'BC4') || opaque) {
    for (let i = 0; i < n; i++) {
      const p = i * 4
      img.rgba[p + 3] = Math.max(img.rgba[p], img.rgba[p + 1], img.rgba[p + 2])
    }
  }
  return encodePng(downscale(img, max))
}
