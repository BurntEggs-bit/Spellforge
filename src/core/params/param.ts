/**
 * PARAM — a table of fixed-size rows described by a PARAMDEF.
 *
 * Elden Ring header (format flags 0x2D = 0x85, 0x2E = 0x07):
 *   0x00  u32  stringsOffset       start of the param-type + row-name strings
 *   0x04  u16  unk04
 *   0x06  u16  unk06
 *   0x08  u16  paramdefDataVersion
 *   0x0A  u16  rowCount
 *   0x0C  u32  0
 *   0x10  i64  paramTypeOffset     (OffsetParamType flag)
 *   0x18  zeros through 0x2B
 *   0x2C  u8   0x00 little-endian / 0xFF big-endian
 *   0x2D  u8   format2D            0x80 OffsetParamType | 0x04 LongDataOffset | 0x01
 *   0x2E  u8   format2E            0x01 UnicodeRowNames | 0x02 | 0x04
 *   0x2F  u8   paramdefFormatVersion
 *   0x30  i64  dataOffset
 *   0x38  i64  0
 *   0x40  row headers: { i32 id, i32 0, i64 dataOffset, i64 nameOffset } x rowCount
 *         row data:    rowSize bytes x rowCount
 *         strings:     param type (ASCII), then row names (UTF-16)
 *
 * Verified by byte-exact round-trip of every param in regulation.bin.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the PARAM layout and its flag names.
 */
import type { FieldDef, ParamDef } from './paramDef.ts'

const FORMAT2D_OFFSET_PARAM_TYPE = 0x80
const FORMAT2D_LONG_DATA_OFFSET = 0x04
const FORMAT2E_UNICODE_ROW_NAMES = 0x01

const HEADER_SIZE = 0x40
const ROW_HEADER_SIZE = 24

export interface ParamRow {
  id: number
  /** Row name stored in the file. Retail ER params leave these empty. */
  name: string
  data: Buffer
}

export interface Param {
  paramType: string
  dataVersion: number
  unk04: number
  unk06: number
  format2D: number
  format2E: number
  paramdefFormatVersion: number
  rowSize: number
  rows: ParamRow[]
  /**
   * `stringsOffset - paramTypeOffset` in the source file. It is 0 for every
   * retail param except AssetMaterialSfxParam (8). The game accepts 0
   * (Smithbox always writes 0); we replay it so an untouched param rewrites
   * byte-identical.
   */
  stringsOffsetDelta: number
  /**
   * Zero bytes between the end of the row data and the param type string.
   * Usually 0; a few single-row retail params (EnemyCommonParam, ...) carry
   * 4 or 8. Replayed for byte-identical rewrites.
   */
  dataPadding: number
  /**
   * True when every row's name pointer is 0 (no name strings at all), as in
   * NetworkParam and the *CommonParam singletons.
   */
  noRowNames: boolean
  /** Zero bytes after the last string. 2 for most params, 0 or 8 for a few. */
  trailingPadding: number
}

function readCString(buf: Buffer, offset: number): string {
  let end = offset
  while (end < buf.length && buf[end] !== 0) end++
  return buf.toString('latin1', offset, end)
}

function readWString(buf: Buffer, offset: number): string {
  let end = offset
  while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2
  return buf.toString('utf16le', offset, end)
}

/** Reads the param type string without parsing rows — used to pick a def. */
export function readParamType(buf: Buffer): string {
  const format2D = buf[0x2d]
  if (format2D & FORMAT2D_OFFSET_PARAM_TYPE) {
    return readCString(buf, Number(buf.readBigInt64LE(0x10)))
  }
  return readCString(buf, 0x0c)
}

export function readParam(buf: Buffer, rowSize?: number): Param {
  if (buf[0x2c] === 0xff) throw new Error('Big-endian params are not supported')

  const format2D = buf[0x2d]
  const format2E = buf[0x2e]
  if (!(format2D & FORMAT2D_LONG_DATA_OFFSET)) {
    throw new Error(`Unsupported param format 0x${format2D.toString(16)}: only Elden Ring's 64-bit layout is supported`)
  }

  const stringsOffset = buf.readUInt32LE(0x00)
  const rowCount = buf.readUInt16LE(0x0a)
  const unicodeNames = (format2E & FORMAT2E_UNICODE_ROW_NAMES) !== 0

  const headers: { id: number; dataOffset: number; nameOffset: number }[] = []
  for (let i = 0; i < rowCount; i++) {
    const o = HEADER_SIZE + i * ROW_HEADER_SIZE
    headers.push({
      id: buf.readInt32LE(o),
      dataOffset: Number(buf.readBigInt64LE(o + 8)),
      nameOffset: Number(buf.readBigInt64LE(o + 16)),
    })
  }

  // Derive the row size from the file if the caller didn't give one. Every
  // row is the same size, so consecutive data offsets give it directly.
  const paramTypeOffset = format2D & FORMAT2D_OFFSET_PARAM_TYPE ? Number(buf.readBigInt64LE(0x10)) : stringsOffset

  // Every row is the same size, so with 2+ rows the stride gives it exactly.
  // With fewer, padding before the type string makes the file ambiguous —
  // pass the def's rowSize for those.
  let size = rowSize
  if (size === undefined) {
    if (rowCount >= 2) size = headers[1].dataOffset - headers[0].dataOffset
    else if (rowCount === 1) size = paramTypeOffset - headers[0].dataOffset
    else size = 0
  }
  const dataEnd = (rowCount > 0 ? headers[0].dataOffset : HEADER_SIZE) + rowCount * size

  const rows: ParamRow[] = headers.map((h) => ({
    id: h.id,
    name:
      h.nameOffset > 0 && h.nameOffset < buf.length
        ? unicodeNames
          ? readWString(buf, h.nameOffset)
          : readCString(buf, h.nameOffset)
        : '',
    // Copy so edits never write through to the container buffer.
    data: Buffer.from(buf.subarray(h.dataOffset, h.dataOffset + size!)),
  }))

  const noRowNames = headers.length > 0 && headers.every((h) => h.nameOffset === 0)
  let contentEnd = buf.indexOf(0, paramTypeOffset) + 1
  if (!noRowNames) {
    for (const h of headers) {
      if (h.nameOffset <= 0) continue
      let e = h.nameOffset
      if (unicodeNames) {
        while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2
        e += 2
      } else {
        while (e < buf.length && buf[e] !== 0) e++
        e += 1
      }
      contentEnd = Math.max(contentEnd, e)
    }
  }

  return {
    paramType: readParamType(buf),
    dataVersion: buf.readUInt16LE(0x08),
    unk04: buf.readUInt16LE(0x04),
    unk06: buf.readUInt16LE(0x06),
    format2D,
    format2E,
    paramdefFormatVersion: buf[0x2f],
    rowSize: size!,
    rows,
    stringsOffsetDelta: stringsOffset - paramTypeOffset,
    dataPadding: Math.max(0, paramTypeOffset - dataEnd),
    noRowNames,
    trailingPadding: Math.max(0, buf.length - contentEnd),
  }
}

export function writeParam(param: Param): Buffer {
  const { rows, rowSize } = param
  const unicodeNames = (param.format2E & FORMAT2E_UNICODE_ROW_NAMES) !== 0

  const dataOffset = HEADER_SIZE + rows.length * ROW_HEADER_SIZE
  // The param type string sits immediately after the row data.
  const paramTypeOffset = dataOffset + rows.length * rowSize + param.dataPadding
  const stringsOffset = paramTypeOffset + param.stringsOffsetDelta

  // Row names follow the type string's terminator with no alignment — an odd
  // offset is normal. Rows with the same name share one copy: retail and
  // Smithbox-written files alike point every row at a single empty name.
  const typeBytes = Buffer.from(param.paramType + '\0', 'latin1')
  const nameChunks: Buffer[] = []
  const nameOffsetByName = new Map<string, number>()
  let cursor = paramTypeOffset + typeBytes.length

  const nameStart = cursor
  const rowNameOffsets = rows.map((row) => {
    if (param.noRowNames) return 0
    const existing = nameOffsetByName.get(row.name)
    if (existing !== undefined) return existing
    const bytes = unicodeNames ? Buffer.from(row.name + '\0', 'utf16le') : Buffer.from(row.name + '\0', 'latin1')
    const at = cursor
    nameChunks.push(bytes)
    nameOffsetByName.set(row.name, at)
    cursor += bytes.length
    return at
  })

  const out = Buffer.alloc(cursor + param.trailingPadding)

  out.writeUInt32LE(stringsOffset, 0x00)
  out.writeUInt16LE(param.unk04, 0x04)
  out.writeUInt16LE(param.unk06, 0x06)
  out.writeUInt16LE(param.dataVersion, 0x08)
  out.writeUInt16LE(rows.length, 0x0a)
  out.writeUInt32LE(0, 0x0c)
  out.writeBigInt64LE(BigInt(paramTypeOffset), 0x10)
  out[0x2c] = 0
  out[0x2d] = param.format2D
  out[0x2e] = param.format2E
  out[0x2f] = param.paramdefFormatVersion
  out.writeBigInt64LE(BigInt(dataOffset), 0x30)
  out.writeBigInt64LE(0n, 0x38)

  rows.forEach((row, i) => {
    const o = HEADER_SIZE + i * ROW_HEADER_SIZE
    out.writeInt32LE(row.id, o)
    out.writeInt32LE(0, o + 4)
    out.writeBigInt64LE(BigInt(dataOffset + i * rowSize), o + 8)
    out.writeBigInt64LE(BigInt(rowNameOffsets[i]), o + 16)
    if (row.data.length !== rowSize) {
      throw new Error(`${param.paramType} row ${row.id} is ${row.data.length} bytes, expected ${rowSize}`)
    }
    row.data.copy(out, dataOffset + i * rowSize)
  })

  typeBytes.copy(out, paramTypeOffset)
  let p = nameStart
  for (const chunk of nameChunks) {
    chunk.copy(out, p)
    p += chunk.length
  }

  return out
}

/* ----------------------------- field access ------------------------------ */

export type FieldValue = number | string | number[]

const decoderSJIS = (() => {
  try {
    return new TextDecoder('shift_jis')
  } catch {
    return null
  }
})()

function readScalar(data: Buffer, type: string, offset: number): number {
  switch (type) {
    case 's8':
      return data.readInt8(offset)
    case 'u8':
    case 'dummy8':
      return data.readUInt8(offset)
    case 's16':
      return data.readInt16LE(offset)
    case 'u16':
      return data.readUInt16LE(offset)
    case 's32':
    case 'b32':
      return data.readInt32LE(offset)
    case 'u32':
      return data.readUInt32LE(offset)
    case 'f32':
    case 'angle32':
      return data.readFloatLE(offset)
    case 'f64':
      return data.readDoubleLE(offset)
    default:
      throw new Error(`Cannot read scalar of type ${type}`)
  }
}

function writeScalar(data: Buffer, type: string, offset: number, value: number): void {
  switch (type) {
    case 's8':
      data.writeInt8(value, offset)
      return
    case 'u8':
    case 'dummy8':
      data.writeUInt8(value, offset)
      return
    case 's16':
      data.writeInt16LE(value, offset)
      return
    case 'u16':
      data.writeUInt16LE(value, offset)
      return
    case 's32':
    case 'b32':
      data.writeInt32LE(value, offset)
      return
    case 'u32':
      data.writeUInt32LE(value >>> 0, offset)
      return
    case 'f32':
    case 'angle32':
      data.writeFloatLE(value, offset)
      return
    case 'f64':
      data.writeDoubleLE(value, offset)
      return
    default:
      throw new Error(`Cannot write scalar of type ${type}`)
  }
}

function storageType(field: FieldDef): string {
  return field.type === 'dummy8' ? 'u8' : field.type
}

export function getField(data: Buffer, field: FieldDef): FieldValue {
  if (field.bitSize !== -1) {
    const unit = readScalar(data, storageType(field), field.byteOffset) >>> 0
    const mask = field.bitSize >= 32 ? 0xffffffff : (1 << field.bitSize) - 1
    return (unit >>> field.bitOffset) & mask
  }

  switch (field.type) {
    case 'dummy8':
      return field.arrayLength === 1
        ? data[field.byteOffset]
        : Array.from(data.subarray(field.byteOffset, field.byteOffset + field.arrayLength))
    case 'fixstr': {
      const bytes = data.subarray(field.byteOffset, field.byteOffset + field.arrayLength)
      const end = bytes.indexOf(0)
      const slice = end === -1 ? bytes : bytes.subarray(0, end)
      return decoderSJIS ? decoderSJIS.decode(slice) : slice.toString('latin1')
    }
    case 'fixstrW': {
      const bytes = data.subarray(field.byteOffset, field.byteOffset + field.arrayLength * 2)
      const s = bytes.toString('utf16le')
      const end = s.indexOf('\0')
      return end === -1 ? s : s.slice(0, end)
    }
    default:
      return readScalar(data, field.type, field.byteOffset)
  }
}

export function setField(data: Buffer, field: FieldDef, value: FieldValue): void {
  if (field.bitSize !== -1) {
    const type = storageType(field)
    const unit = readScalar(data, type, field.byteOffset) >>> 0
    const mask = field.bitSize >= 32 ? 0xffffffff : (1 << field.bitSize) - 1
    const v = (Number(value) & mask) >>> 0
    const cleared = (unit & ~(mask << field.bitOffset)) >>> 0
    let next = (cleared | (v << field.bitOffset)) >>> 0
    // Re-sign for signed storage so writeInt* accepts it.
    if (type === 's8') next = (next << 24) >> 24
    else if (type === 's16') next = (next << 16) >> 16
    else if (type === 's32') next = next | 0
    writeScalar(data, type, field.byteOffset, next)
    return
  }

  switch (field.type) {
    case 'dummy8': {
      const arr = Array.isArray(value) ? value : [Number(value)]
      for (let i = 0; i < field.arrayLength; i++) data[field.byteOffset + i] = arr[i] ?? 0
      return
    }
    case 'fixstr': {
      const bytes = Buffer.alloc(field.arrayLength)
      Buffer.from(String(value), 'latin1').copy(bytes, 0, 0, field.arrayLength - 1)
      bytes.copy(data, field.byteOffset)
      return
    }
    case 'fixstrW': {
      const bytes = Buffer.alloc(field.arrayLength * 2)
      Buffer.from(String(value), 'utf16le').copy(bytes, 0, 0, field.arrayLength * 2 - 2)
      bytes.copy(data, field.byteOffset)
      return
    }
    default:
      writeScalar(data, field.type, field.byteOffset, Number(value))
  }
}

/** Convenience: a fresh row filled with every field's default value. */
export function defaultRowData(def: ParamDef): Buffer {
  const data = Buffer.alloc(def.rowSize)
  for (const field of def.fields) {
    if (field.type === 'dummy8' && field.bitSize === -1) continue
    if (typeof field.defaultValue === 'number' && field.defaultValue !== 0) {
      setField(data, field, field.defaultValue)
    } else if (typeof field.defaultValue === 'string' && field.defaultValue) {
      setField(data, field, field.defaultValue)
    }
  }
  return data
}

/**
 * Rows keyed by id and occurrence ("id#0", "id#1"…): the game's params repeat
 * some ids (RandomAppearParam has 26 duplicates), so ids alone can't pair rows.
 */
export function rowsByOccurrence(rows: ParamRow[]): Map<string, ParamRow> {
  const seen = new Map<number, number>()
  const out = new Map<string, ParamRow>()
  for (const r of rows) {
    const n = seen.get(r.id) ?? 0
    seen.set(r.id, n + 1)
    out.set(`${r.id}#${n}`, r)
  }
  return out
}
