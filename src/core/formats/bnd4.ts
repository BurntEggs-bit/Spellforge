/**
 * BND4 — FromSoftware's container format. Used by regulation.bin (holding the
 * .param files) and by sfxbnd_*.ffxbnd (holding .fxr, .dds, .flver, .hkx).
 *
 * Header (0x40 bytes, little-endian):
 *   0x00  "BND4"
 *   0x04  u8   unk04
 *   0x05  u8   unk05
 *   0x08  u32  0x00010000
 *   0x0C  i32  fileCount
 *   0x10  i64  0x40                  header size
 *   0x18  char[8] version            e.g. "11611000"
 *   0x20  i64  fileHeaderSize        0x24 for the format bits ER uses
 *   0x28  i64  dataOffset
 *   0x30  u8   unicode
 *   0x31  u8   rawFormat             0x74 = Compression|IDs|Names1|Names2
 *   0x32  u8   extended              4 = a path-hash table is present
 *   0x34  i32  0
 *   0x38  i64  hashTableOffset       when extended == 4
 *
 * Entry header (fileHeaderSize bytes each, starting at 0x40). Which fields are
 * present depends on rawFormat; for the 0x74 files ER uses it is all of them:
 *   +0x00  u8   flags                0x40 = uncompressed
 *   +0x04  i32  -1
 *   +0x08  i64  compressedSize
 *   +0x10  i64  uncompressedSize     present when the Compression bit is set
 *   +0x18  u32  dataOffset
 *   +0x1C  i32  id                   present when the IDs bit is set
 *   +0x20  u32  nameOffset           present when a Names bit is set
 *
 * Verified by byte-exact round-trip against retail regulation.bin and
 * sfxbnd_*.ffxbnd files.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the BND4 layout and its flag names.
 */
import { fileNameOf } from './paths.ts'

const BinderFormat = {
  Compression: 0x04,
  IDs: 0x10,
  Names1: 0x20,
  Names2: 0x40,
} as const

export interface Bnd4Entry {
  id: number
  /** Full in-archive path, e.g. `N:\GR\data\...\Bullet.param`. */
  name: string
  flags: number
  /** Entry payload. A read returns a zero-copy view into the container buffer. */
  data: Buffer
  /**
   * Offset this entry occupied in the container it was read from, so an
   * untouched container can be rewritten byte-for-byte. Absent on new entries.
   *
   * Retail files are not consistently aligned — in sfxbnd_commoneffects the
   * .fxr/.tpf/.flver payloads sit on 16-byte boundaries while .ffxreslist
   * payloads are packed flush — so the original offsets are the only way to
   * reproduce the exact layout.
   */
  sourceOffset?: number
}

export interface Bnd4 {
  unk04: number
  unk05: number
  version: string
  unicode: number
  rawFormat: number
  extended: number
  entries: Bnd4Entry[]
}

const HEADER_SIZE = 0x40

function hasFlag(rawFormat: number, flag: number): boolean {
  return (rawFormat & flag) !== 0
}

/** Size of one entry header for a given format, matching how we read/write it. */
function entryHeaderSize(rawFormat: number): number {
  // flags + 3 pad + int32 -1 (8) + compressedSize (8)
  let size = 0x10
  if (hasFlag(rawFormat, BinderFormat.Compression)) size += 8 // uncompressedSize
  size += 4 // dataOffset
  if (hasFlag(rawFormat, BinderFormat.IDs)) size += 4
  if (hasFlag(rawFormat, BinderFormat.Names1) || hasFlag(rawFormat, BinderFormat.Names2)) size += 4
  return size
}

function readTerminatedString(buf: Buffer, offset: number, unicode: boolean): string {
  if (unicode) {
    let end = offset
    while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2
    return buf.subarray(offset, end).toString('utf16le')
  }
  let end = offset
  while (end < buf.length && buf[end] !== 0) end += 1
  return buf.subarray(offset, end).toString('latin1')
}

function isBnd4(buf: Buffer): boolean {
  return buf.length >= HEADER_SIZE && buf.toString('ascii', 0, 4) === 'BND4'
}

/** An entry's file name without the folders the binder stores it under, lower case. */
export function entryFileName(entry: { name: string }): string {
  return fileNameOf(entry.name).toLowerCase()
}

/** The entry with this file name, in any folder, any case. */
export function findEntry(bnd: Bnd4, fileName: string): Bnd4Entry | undefined {
  const want = fileName.toLowerCase()
  return bnd.entries.find((e) => entryFileName(e) === want)
}

export function readBnd4(buf: Buffer): Bnd4 {
  if (!isBnd4(buf)) throw new Error('Not a BND4 container')

  const fileCount = buf.readInt32LE(0x0c)
  const version = buf.toString('ascii', 0x18, 0x20)
  const declaredEntrySize = Number(buf.readBigInt64LE(0x20))
  const unicode = buf[0x30]
  const rawFormat = buf[0x31]
  const extended = buf[0x32]

  const entries: Bnd4Entry[] = []
  for (let i = 0; i < fileCount; i++) {
    let o = HEADER_SIZE + i * declaredEntrySize
    const flags = buf[o]
    o += 8 // flags + 3 pad + int32 -1

    const compressedSize = Number(buf.readBigInt64LE(o))
    o += 8

    // Entries in these containers are stored uncompressed, so the
    // uncompressedSize field duplicates compressedSize; we only skip it.
    if (hasFlag(rawFormat, BinderFormat.Compression)) o += 8

    const dataOffset = buf.readUInt32LE(o)
    o += 4

    let id = i
    if (hasFlag(rawFormat, BinderFormat.IDs)) {
      id = buf.readInt32LE(o)
      o += 4
    }

    let name = ''
    if (hasFlag(rawFormat, BinderFormat.Names1) || hasFlag(rawFormat, BinderFormat.Names2)) {
      name = readTerminatedString(buf, buf.readUInt32LE(o), unicode === 1)
    }

    // Entries in the files we care about are stored uncompressed (flags 0x40),
    // so compressedSize is the on-disk length.
    entries.push({
      id,
      name,
      flags,
      data: buf.subarray(dataOffset, dataOffset + compressedSize),
      sourceOffset: dataOffset,
    })
  }

  return { unk04: buf[0x04], unk05: buf[0x05], version, unicode, rawFormat, extended, entries }
}

/* ------------------------------ path hashes ------------------------------ */

function isPrime(n: number): boolean {
  if (n < 2) return false
  if (n % 2 === 0) return n === 2
  for (let i = 3; i * i <= n; i += 2) if (n % i === 0) return false
  return true
}

/** The smallest prime at or above n. */
function primeAtLeast(n: number): number {
  let p = Math.max(2, n)
  while (!isPrime(p)) p++
  return p
}

const BACKSLASH = String.fromCharCode(92)

/** Hash used by the BND4 lookup table: `hash = hash * 37 + char` over `/path`. */
export function bnd4PathHash(text: string): number {
  let hashable = text.toLowerCase().split(BACKSLASH).join('/')
  if (!hashable.startsWith('/')) hashable = '/' + hashable
  let hash = 0
  for (let i = 0; i < hashable.length; i++) {
    hash = (Math.imul(hash, 37) + hashable.charCodeAt(i)) >>> 0
  }
  return hash
}

interface HashTable {
  buffer: Buffer
  size: number
}

/**
 * Builds the extended path-hash table: a 0x10-byte header, then one
 * {length, index} pair per bucket, then {hash, entryIndex} pairs sorted
 * within each bucket. There are as many buckets as the smallest prime at or
 * above a seventh of the file count, as the game's own binders have (the
 * formats suite rewrites retail binders byte for byte).
 */
function buildHashTable(names: string[], tableOffset: number): HashTable {
  const groupCount = primeAtLeast(Math.floor(names.length / 7))

  const buckets: { hash: number; index: number }[][] = Array.from({ length: groupCount }, () => [])
  names.forEach((name, index) => {
    const hash = bnd4PathHash(name)
    buckets[hash % groupCount].push({ hash, index })
  })
  for (const bucket of buckets) bucket.sort((a, b) => a.hash - b.hash)

  const headerSize = 0x10
  const groupsSize = groupCount * 8
  const hashesOffset = tableOffset + headerSize + groupsSize
  const size = headerSize + groupsSize + names.length * 8
  const buffer = Buffer.alloc(size)

  buffer.writeBigInt64LE(BigInt(hashesOffset), 0x00)
  buffer.writeInt32LE(groupCount, 0x08)
  buffer[0x0c] = 0x10
  buffer[0x0d] = 8
  buffer[0x0e] = 8
  buffer[0x0f] = 0

  let cursor = 0
  buckets.forEach((bucket, g) => {
    buffer.writeInt32LE(bucket.length, headerSize + g * 8)
    buffer.writeInt32LE(cursor, headerSize + g * 8 + 4)
    cursor += bucket.length
  })

  let hashCursor = headerSize + groupsSize
  for (const bucket of buckets) {
    for (const { hash, index } of bucket) {
      buffer.writeUInt32LE(hash, hashCursor)
      buffer.writeInt32LE(index, hashCursor + 4)
      hashCursor += 8
    }
  }

  return { buffer, size }
}

/* -------------------------------- writing -------------------------------- */

export interface WriteBnd4Options {
  /** Byte alignment for entry payloads when laying them out fresh. */
  dataAlignment?: number
  /**
   * Reuse each entry's `sourceOffset` when every entry still has one and they
   * describe a consistent layout. This reproduces the original file exactly.
   * Falls back to a fresh layout automatically. Default: true.
   */
  preserveLayout?: boolean
}

export function writeBnd4(bnd: Bnd4, options: WriteBnd4Options = {}): Buffer {
  const alignment = options.dataAlignment ?? 16
  const preserveLayout = options.preserveLayout ?? true
  const { entries, rawFormat, unicode } = bnd
  const unicodeNames = unicode === 1
  const ehs = entryHeaderSize(rawFormat)
  const hasNames = hasFlag(rawFormat, BinderFormat.Names1) || hasFlag(rawFormat, BinderFormat.Names2)

  // Lay out the name table immediately after the entry headers.
  const nameTableOffset = HEADER_SIZE + entries.length * ehs
  const nameOffsets: number[] = []
  const nameBuffers: Buffer[] = []
  let nameCursor = nameTableOffset
  for (const entry of entries) {
    nameOffsets.push(nameCursor)
    const encoded = unicodeNames ? Buffer.from(entry.name + '\0', 'utf16le') : Buffer.from(entry.name + '\0', 'latin1')
    nameBuffers.push(encoded)
    nameCursor += encoded.length
  }

  // Then the hash table, if this format carries one.
  let hashTable: HashTable | null = null
  let hashTableOffset = 0
  let afterTables = nameCursor
  if (bnd.extended === 4) {
    // 8-byte aligned: retail sfxbnd_commoneffects places it at 0x2327D8.
    hashTableOffset = align(nameCursor, 8)
    hashTable = buildHashTable(
      entries.map((e) => e.name),
      hashTableOffset,
    )
    afterTables = hashTableOffset + hashTable.size
  }

  // Then the payloads. The header's dataOffset field records the unaligned end
  // of the tables; the first payload sits at the next alignment boundary.
  let dataOffsets: number[]
  let dataCursor: number

  const canPreserve =
    preserveLayout &&
    entries.every((e) => e.sourceOffset !== undefined) &&
    // The tables must not have grown into the payload region.
    entries.every((e) => e.sourceOffset! >= afterTables) &&
    // Offsets must be ascending and leave room for each payload.
    entries.every((e, i) => i === 0 || e.sourceOffset! >= entries[i - 1].sourceOffset! + entries[i - 1].data.length)

  if (canPreserve) {
    dataOffsets = entries.map((e) => e.sourceOffset!)
    dataCursor = dataOffsets[entries.length - 1] + entries[entries.length - 1].data.length
  } else {
    dataCursor = align(afterTables, alignment)
    dataOffsets = []
    for (const entry of entries) {
      dataCursor = align(dataCursor, alignment)
      dataOffsets.push(dataCursor)
      dataCursor += entry.data.length
    }
  }

  const out = Buffer.alloc(dataCursor)

  out.write('BND4', 0, 'ascii')
  out[0x04] = bnd.unk04
  out[0x05] = bnd.unk05
  out.writeUInt32LE(0x00010000, 0x08)
  out.writeInt32LE(entries.length, 0x0c)
  out.writeBigInt64LE(BigInt(HEADER_SIZE), 0x10)
  out.write(bnd.version.padEnd(8, '\0').slice(0, 8), 0x18, 'ascii')
  out.writeBigInt64LE(BigInt(ehs), 0x20)
  out.writeBigInt64LE(BigInt(afterTables), 0x28)
  out[0x30] = unicode
  out[0x31] = rawFormat
  out[0x32] = bnd.extended
  out.writeInt32LE(0, 0x34)
  out.writeBigInt64LE(BigInt(hashTableOffset), 0x38)

  entries.forEach((entry, i) => {
    let o = HEADER_SIZE + i * ehs
    out[o] = entry.flags
    out[o + 1] = 0
    out[o + 2] = 0
    out[o + 3] = 0
    out.writeInt32LE(-1, o + 4)
    o += 8

    out.writeBigInt64LE(BigInt(entry.data.length), o)
    o += 8
    if (hasFlag(rawFormat, BinderFormat.Compression)) {
      out.writeBigInt64LE(BigInt(entry.data.length), o)
      o += 8
    }

    out.writeUInt32LE(dataOffsets[i], o)
    o += 4
    if (hasFlag(rawFormat, BinderFormat.IDs)) {
      out.writeInt32LE(entry.id, o)
      o += 4
    }
    if (hasNames) out.writeUInt32LE(nameOffsets[i], o)
  })

  nameBuffers.forEach((nb, i) => nb.copy(out, nameOffsets[i]))
  if (hashTable) hashTable.buffer.copy(out, hashTableOffset)
  entries.forEach((entry, i) => entry.data.copy(out, dataOffsets[i]))

  return out
}

function align(value: number, to: number): number {
  const rem = value % to
  return rem === 0 ? value : value + (to - rem)
}
