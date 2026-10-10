/**
 * DCX — FromSoftware's single-file compression wrapper.
 *
 * Elden Ring uses two variants, both with an identical 0x4C-byte header that
 * only differs in the format tag and compression level:
 *
 *   0x00  "DCX\0"
 *   0x04  u32be  0x00011000
 *   0x08  u32be  0x18          offset of the DCS chunk
 *   0x0C  u32be  0x24          offset of the DCP chunk
 *   0x10  u32be  0x44          offset of the DCA chunk
 *   0x14  u32be  0x4C          offset of the payload
 *   0x18  "DCS\0"
 *   0x1C  u32be  uncompressedSize
 *   0x20  u32be  compressedSize
 *   0x24  "DCP\0"
 *   0x28  char[4] "KRAK" | "ZSTD" | "DFLT"
 *   0x2C  u32be  0x20
 *   0x30  u8     compression level   (KRAK uses 6, ZSTD uses 21)
 *   0x31  zeros through 0x3F
 *   0x40  u32be  0x00010100
 *   0x44  "DCA\0"
 *   0x48  u32be  0x08
 *   0x4C  payload
 *
 * Verified against sfxbnd_*.ffxbnd.dcx (KRAK) and the inner stream of
 * regulation.bin (ZSTD).
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the DCX container.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import { SEEK_CHUNK, oodleCompress, oodleDecompress } from './oodle.ts'

export type DcxFormat = 'KRAK' | 'ZSTD' | 'DFLT' | 'NONE'

export interface DcxInfo {
  format: DcxFormat
  /** Compression level recorded in the header, so a re-write matches the original. */
  level: number
}

/** Defaults FromSoft uses, so files we create look like files the game shipped. */
const DEFAULT_LEVELS: Record<DcxFormat, number> = { KRAK: 6, ZSTD: 21, DFLT: 9, NONE: 0 }

const HEADER_SIZE = 0x4c

function tag(buf: Buffer, offset: number): string {
  return buf.toString('ascii', offset, offset + 4)
}

function isDcx(buf: Buffer): boolean {
  return buf.length >= HEADER_SIZE && tag(buf, 0) === 'DCX\0'
}

/** Reads the header without decompressing — cheap enough to call on a big file. */
export function readDcxInfo(buf: Buffer): DcxInfo {
  if (!isDcx(buf)) throw new Error('Not a DCX file')
  const format = tag(buf, 0x28) as DcxFormat
  return { format, level: buf[0x30] }
}

export interface DcxResult {
  data: Buffer
  info: DcxInfo
}

export function dcxDecompress(buf: Buffer): DcxResult {
  if (!isDcx(buf)) return { data: buf, info: { format: 'NONE', level: 0 } }

  const info = readDcxInfo(buf)
  const uncompressedSize = buf.readUInt32BE(0x1c)
  const compressedSize = buf.readUInt32BE(0x20)
  const payloadOffset = buf.readUInt32BE(0x14)
  const payload = buf.subarray(payloadOffset, payloadOffset + compressedSize)

  switch (info.format) {
    case 'KRAK':
      return { data: oodleDecompress(payload, uncompressedSize), info }
    case 'ZSTD':
      return { data: zlib.zstdDecompressSync(payload), info }
    case 'DFLT':
      return { data: zlib.inflateSync(payload), info }
    case 'NONE':
      return { data: Buffer.from(payload), info }
    default:
      throw new Error(`Unsupported DCX format: ${info.format}`)
  }
}

export function dcxCompress(data: Buffer, info: Partial<DcxInfo> = {}): Buffer {
  const format = info.format ?? 'KRAK'
  if (format === 'NONE') return data

  const level = info.level ?? DEFAULT_LEVELS[format]

  let payload: Buffer
  switch (format) {
    case 'KRAK':
      payload = oodleCompress(data, 'Kraken', level)
      break
    case 'ZSTD':
      // Mirror the frame Smithbox writes — a 64 KB window and no content-size
      // or checksum fields — since that is known to load in-game. Node's
      // defaults otherwise add a content-size field retail frames never have.
      payload = zlib.zstdCompressSync(data, {
        params: {
          [zlib.constants.ZSTD_c_compressionLevel]: level,
          [zlib.constants.ZSTD_c_windowLog]: 16,
          [zlib.constants.ZSTD_c_contentSizeFlag]: 0,
          [zlib.constants.ZSTD_c_checksumFlag]: 0,
        },
      })
      break
    case 'DFLT':
      payload = zlib.deflateSync(data, { level })
      break
    default:
      throw new Error(`Unsupported DCX format: ${format}`)
  }

  // Pad the payload to a 4-byte boundary, matching the retail files.
  const padding = (4 - (payload.length % 4)) % 4
  const out = Buffer.alloc(HEADER_SIZE + payload.length + padding)

  out.write('DCX\0', 0, 'ascii')
  out.writeUInt32BE(0x00011000, 0x04)
  out.writeUInt32BE(0x18, 0x08)
  out.writeUInt32BE(0x24, 0x0c)
  out.writeUInt32BE(0x44, 0x10)
  out.writeUInt32BE(HEADER_SIZE, 0x14)
  out.write('DCS\0', 0x18, 'ascii')
  out.writeUInt32BE(data.length, 0x1c)
  out.writeUInt32BE(payload.length, 0x20)
  out.write('DCP\0', 0x24, 'ascii')
  out.write(format, 0x28, 'ascii')
  out.writeUInt32BE(0x20, 0x2c)
  out[0x30] = level
  out.writeUInt32BE(0x00010100, 0x40)
  out.write('DCA\0', 0x44, 'ascii')
  out.writeUInt32BE(0x08, 0x48)
  payload.copy(out, HEADER_SIZE)

  return out
}

export interface KrakChunks {
  /** 256 KB seek chunks in the file. */
  total: number
  /** Chunks that restart the decoder, so they unpack on their own. */
  independent: number
  /** Where each chunk's packed bytes start in the file, then where the last ends. */
  starts: number[]
}

/**
 * For a DCX_KRAK file, how many of its 256 KB chunks unpack on their own, read
 * from the block headers without decompressing. Elden Ring unpacks one chunk
 * at a time, so a file it can read has every chunk independent (as every
 * retail file does). Null for other formats, or when a block isn't Kraken.
 *
 * Each 256 KB of output starts a block: byte 0 has 0xC in its low nibble, bit 7
 * "restart decoder" and bit 6 "stored"; byte 1 is the decoder (6, 10 or 12 are
 * Kraken's, one quantum per block), bit 7 "checksums". A stored block's raw
 * bytes follow; otherwise a 3-byte big-endian quantum header whose low 18 bits
 * are the compressed size - 1 (0x3FFFF: a 4-byte fill quantum), plus 3 checksum
 * bytes when flagged, then the compressed bytes.
 */
export function krakChunks(buf: Buffer): KrakChunks | null {
  return walkKrak((at, n) => buf.subarray(at, at + n))
}

/** krakChunks for a file on disk, reading only its block headers. */
export function krakChunksOfFile(file: string): KrakChunks | null {
  const fd = fs.openSync(file, 'r')
  try {
    return walkKrak((at, n) => {
      const b = Buffer.alloc(n)
      return b.subarray(0, fs.readSync(fd, b, 0, n, at))
    })
  } finally {
    fs.closeSync(fd)
  }
}

function walkKrak(read: (at: number, n: number) => Buffer): KrakChunks | null {
  const head = read(0, HEADER_SIZE)
  if (!isDcx(head) || tag(head, 0x28) !== 'KRAK') return null
  const raw = head.readUInt32BE(0x1c)
  let p = head.readUInt32BE(0x14)
  const end = p + head.readUInt32BE(0x20)
  let total = 0
  let independent = 0
  const starts: number[] = []
  for (let off = 0; off < raw; off += SEEK_CHUNK) {
    const b = read(p, 5)
    if (b.length < 2 || p + 2 > end) return null
    if ((b[0] & 0xf) !== 0xc || ![6, 10, 12].includes(b[1] & 0x7f)) return null
    total++
    starts.push(p)
    if (b[0] & 0x80) independent++
    p += 2
    if (b[0] & 0x40) {
      p += Math.min(SEEK_CHUNK, raw - off)
      continue
    }
    if (b.length < 5 || p + 3 > end) return null
    const size = ((b[2] << 16) | (b[3] << 8) | b[4]) & 0x3ffff
    p += size === 0x3ffff ? 4 : (b[1] & 0x80 ? 6 : 3) + size + 1
  }
  starts.push(p)
  return p <= end ? { total, independent, starts } : null
}

/**
 * Unpacks one 256 KB chunk of a DCX_KRAK file by itself, as the game does.
 * Throws when the chunk can't be unpacked alone.
 */
export function unpackKrakChunk(buf: Buffer, chunks: KrakChunks, k: number): Buffer {
  const raw = buf.readUInt32BE(0x1c)
  return oodleDecompress(
    buf.subarray(chunks.starts[k], chunks.starts[k + 1]),
    Math.min(SEEK_CHUNK, raw - k * SEEK_CHUNK),
  )
}

/** Packs a DCX file again the way it is now packed (same format and level): the same contents. */
export function repackDcx(buf: Buffer): Buffer {
  const { data, info } = dcxDecompress(buf)
  return dcxCompress(data, info)
}
