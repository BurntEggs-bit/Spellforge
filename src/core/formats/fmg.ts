/**
 * FMG — FromSoftware's text tables (item names, descriptions, ...), as found
 * in msg/<language>/item*.msgbnd.dcx.
 *
 * Elden Ring uses version 2, little-endian, UTF-16:
 *   0x00 u8 0, u8 bigEndian, u8 version (2), u8 0
 *   0x04 i32 fileSize
 *   0x08 u8 1, u8 0, u8 0, u8 0
 *   0x0C i32 groupCount
 *   0x10 i32 stringCount
 *   0x14 i32 0xFF
 *   0x18 i64 stringOffsetsOffset
 *   0x20 i64 0
 *   0x28 groups: { i32 firstStringIndex, i32 firstId, i32 lastId, i32 0 }
 *   then i64 string offsets (0 = no text), then UTF-16 strings
 *
 * A group is a run of consecutive ids; ids absent from every group have no
 * entry. Verified by byte-exact round-trip of every FMG in item_dlc02.msgbnd.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the FMG layout.
 */

/** id -> text. `null` means the id exists with no text. */
export type FmgEntries = Map<number, string | null>

export function readFmg(buf: Buffer): FmgEntries {
  if (buf[2] !== 2) throw new Error(`Unsupported FMG version ${buf[2]}`)
  if (buf[1] !== 0) throw new Error('Big-endian FMG is not supported')
  const groupCount = buf.readInt32LE(0x0c)
  const offsetsOffset = Number(buf.readBigInt64LE(0x18))
  const out: FmgEntries = new Map()
  for (let g = 0; g < groupCount; g++) {
    const o = 0x28 + g * 16
    const first = buf.readInt32LE(o)
    const firstId = buf.readInt32LE(o + 4)
    const lastId = buf.readInt32LE(o + 8)
    for (let id = firstId; id <= lastId; id++) {
      const at = Number(buf.readBigInt64LE(offsetsOffset + (first + id - firstId) * 8))
      if (at === 0) {
        out.set(id, null)
        continue
      }
      let end = at
      while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2
      out.set(id, buf.toString('utf16le', at, end))
    }
  }
  return out
}

export function writeFmg(entries: FmgEntries): Buffer {
  const ids = [...entries.keys()].sort((a, b) => a - b)

  // Consecutive ids share a group.
  const groups: { first: number; firstId: number; lastId: number }[] = []
  ids.forEach((id, i) => {
    const g = groups[groups.length - 1]
    if (g && id === g.lastId + 1) g.lastId = id
    else groups.push({ first: i, firstId: id, lastId: id })
  })

  const groupsOffset = 0x28
  const offsetsOffset = groupsOffset + groups.length * 16
  const stringsOffset = offsetsOffset + ids.length * 8

  // Every string is stored, duplicates included, as FromSoft's files do.
  const strings: Buffer[] = []
  const offsets: number[] = []
  let cursor = stringsOffset
  for (const id of ids) {
    const text = entries.get(id)
    if (text === null || text === undefined) {
      offsets.push(0)
      continue
    }
    const bytes = Buffer.from(text + '\0', 'utf16le')
    strings.push(bytes)
    offsets.push(cursor)
    cursor += bytes.length
  }

  // Files are padded to a 4-byte boundary.
  const size = cursor + ((4 - (cursor % 4)) % 4)
  const out = Buffer.alloc(size)
  out[2] = 2
  out.writeInt32LE(size, 0x04)
  out[0x08] = 1
  out.writeInt32LE(groups.length, 0x0c)
  out.writeInt32LE(ids.length, 0x10)
  out.writeInt32LE(0xff, 0x14)
  out.writeBigInt64LE(BigInt(offsetsOffset), 0x18)
  groups.forEach((g, i) => {
    const o = groupsOffset + i * 16
    out.writeInt32LE(g.first, o)
    out.writeInt32LE(g.firstId, o + 4)
    out.writeInt32LE(g.lastId, o + 8)
  })
  offsets.forEach((v, i) => out.writeBigInt64LE(BigInt(v), offsetsOffset + i * 8))
  let p = stringsOffset
  for (const s of strings) {
    s.copy(out, p)
    p += s.length
  }
  return out
}
