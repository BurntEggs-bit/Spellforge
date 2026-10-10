/**
 * Havok 2018 binary tagfiles (TAG0), as used by Elden Ring behaviour graphs
 * (chr/c0000.behbnd.dcx -> Behaviors/c0000.hkx).
 *
 * Layout (big-endian section headers: u32 size | flags << 30, then a 4-char tag):
 *   TAG0
 *     SDKV  "20180100"
 *     DATA  every object's bytes, little-endian, packed back to back
 *     TYPE
 *       TPTR  pointer-sized slots (unused on disk)
 *       TSTR  type and template-parameter names, null separated
 *       TNA1  type names: count, then name, template count, (name, value)...
 *       FSTR  field names, null separated
 *       TBDY  type bodies: parent, format, element type, size, members...
 *       THSH  type hashes
 *       TPAD  padding
 *     INDX
 *       ITEM  items: u32 type | flags << 24, u32 DATA offset, u32 count
 *       PTCH  per type: u32 type, u32 count, then u32 DATA offsets of item references
 *
 * Objects refer to each other by item index. The reader keeps the TYPE
 * section's bytes verbatim, so writing an unchanged file is byte-identical,
 * and edits only add data, items and patch offsets.
 */
export interface TagMember {
  name: string
  flags: number
  offset: number
  type: number
}

export interface TagType {
  index: number
  name: string
  templates: { name: string; value: number }[]
  parent: number
  /** Format bits: kind in the low 5 bits (0 void, 1 opaque, 2 bool, 3 string, 4 int, 5 float, 6 pointer, 7 record, 8 array). */
  format: number
  /** Element/target type for pointers and arrays. */
  subType: number
  version: number
  size: number
  align: number
  flags: number
  members: TagMember[]
  interfaces: { type: number; value: number }[]
  hash?: number
}

export interface TagItem {
  type: number
  /** High byte of the type word (pointer / array kind flags). */
  flags: number
  offset: number
  count: number
}

export interface Tagfile {
  sdk: string
  data: Buffer
  /** Raw TYPE section (header included), written back untouched. For files
   *  whose types live in a compendium, the raw TCRF section instead. */
  typeSection: Buffer
  types: TagType[]
  items: TagItem[]
  /** Item-reference offsets in DATA, grouped by the type of the referencing field's target. */
  patches: { type: number; offsets: number[] }[]
}

/** Type kinds (the low five bits of a type's format). */
export const Kind = {
  Void: 0,
  Opaque: 1,
  Bool: 2,
  String: 3,
  Int: 4,
  Float: 5,
  Pointer: 6,
  Record: 7,
  Array: 8,
} as const
export type Kind = (typeof Kind)[keyof typeof Kind]

interface Section {
  tag: string
  start: number
  body: number
  end: number
  leaf: boolean
}

function sections(buf: Buffer, start: number, end: number): Section[] {
  const out: Section[] = []
  let o = start
  while (o + 8 <= end) {
    const h = buf.readUInt32BE(o)
    const size = h & 0x3fffffff
    if (size < 8) throw new Error(`Bad tagfile section at ${o}`)
    out.push({
      tag: buf.toString('ascii', o + 4, o + 8),
      start: o,
      body: o + 8,
      end: o + size,
      leaf: (h & 0x40000000) !== 0,
    })
    o += size
  }
  return out
}

/** Havok's packed unsigned integers: the leading bits of the first byte give the length. */
class PackedReader {
  pos: number
  private buf: Buffer
  constructor(buf: Buffer, pos: number) {
    this.buf = buf
    this.pos = pos
  }
  u(): number {
    const b = this.buf
    const p = this.pos
    const b0 = b[p]
    if ((b0 & 0x80) === 0) {
      this.pos += 1
      return b0
    }
    if ((b0 & 0xc0) === 0x80) {
      this.pos += 2
      return ((b0 << 8) | b[p + 1]) & 0x3fff
    }
    if ((b0 & 0xe0) === 0xc0) {
      this.pos += 3
      return ((b0 << 16) | (b[p + 1] << 8) | b[p + 2]) & 0x1fffff
    }
    if ((b0 & 0xf8) === 0xe0) {
      this.pos += 4
      return (((b0 << 24) >>> 0) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) & 0x07ffffff
    }
    if ((b0 & 0xf8) === 0xe8) {
      this.pos += 5
      return (b0 & 0x07) * 2 ** 32 + b.readUInt32BE(p + 1)
    }
    if ((b0 & 0xf8) === 0xf8) {
      this.pos += 8
      return (b0 & 0x07) * 2 ** 56 + b.readUIntBE(p + 1, 7)
    }
    throw new Error(`Unsupported packed integer 0x${b0.toString(16)} at ${p}`)
  }
}

function strings(buf: Buffer, s: Section): string[] {
  const text = buf.toString('utf8', s.body, s.end)
  const parts = text.split('\0')
  // Trailing padding produces empty strings at the end; indices stay aligned.
  return parts
}

const get = (list: Section[], tag: string) => {
  const s = list.find((x) => x.tag === tag)
  if (!s) throw new Error(`Tagfile is missing ${tag}`)
  return s
}

/**
 * A type compendium (TCM0: TCID ids, then a TYPE section) shared by the
 * animations of one binder; their files carry a TCRF reference instead of
 * their own types.
 */
export interface Compendium {
  ids: string[]
  types: TagType[]
}

export function readCompendium(buf: Buffer): Compendium {
  const top = sections(buf, 0, buf.length)
  if (top.length !== 1 || top[0].tag !== 'TCM0') throw new Error('Not a Havok type compendium (TCM0)')
  const parts = sections(buf, top[0].body, top[0].end)
  const tcid = get(parts, 'TCID')
  const ids: string[] = []
  for (let o = tcid.body; o + 8 <= tcid.end; o += 8) ids.push(buf.toString('hex', o, o + 8))
  return { ids, types: readTypes(buf, get(parts, 'TYPE')) }
}

export function readTagfile(buf: Buffer, compendium?: Compendium): Tagfile {
  const top = sections(buf, 0, buf.length)
  if (top.length !== 1 || top[0].tag !== 'TAG0') throw new Error('Not a Havok tagfile (TAG0)')
  const parts = sections(buf, top[0].body, top[0].end)
  const sdk = buf.toString('ascii', get(parts, 'SDKV').body, get(parts, 'SDKV').end)
  const dataSec = get(parts, 'DATA')
  const indx = get(parts, 'INDX')
  const idx = sections(buf, indx.body, indx.end)
  const typeSec = parts.find((x) => x.tag === 'TYPE') ?? get(parts, 'TCRF')
  let types: TagType[]
  if (typeSec.tag === 'TYPE') types = readTypes(buf, typeSec)
  else {
    const id = buf.toString('hex', typeSec.body, typeSec.body + 8)
    if (!compendium) throw new Error('This file’s types are in a compendium; pass it to readTagfile')
    if (!compendium.ids.includes(id))
      throw new Error(`Compendium ${compendium.ids.join(',')} doesn’t hold this file’s types (${id})`)
    types = compendium.types
  }

  // Items.
  const item = get(idx, 'ITEM')
  const items: TagItem[] = []
  for (let o = item.body; o + 12 <= item.end; o += 12) {
    const w = buf.readUInt32LE(o)
    items.push({ type: w & 0xffffff, flags: w >>> 24, offset: buf.readUInt32LE(o + 4), count: buf.readUInt32LE(o + 8) })
  }

  // Patches.
  const ptch = get(idx, 'PTCH')
  const patches: Tagfile['patches'] = []
  for (let o = ptch.body; o + 8 <= ptch.end;) {
    const type = buf.readUInt32LE(o)
    const n = buf.readUInt32LE(o + 4)
    o += 8
    const offsets: number[] = []
    for (let k = 0; k < n; k++) offsets.push(buf.readUInt32LE(o + k * 4))
    o += n * 4
    patches.push({ type, offsets })
  }

  return {
    sdk,
    data: Buffer.from(buf.subarray(dataSec.body, dataSec.end)),
    typeSection: Buffer.from(buf.subarray(typeSec.start, typeSec.end)),
    types,
    items,
    patches,
  }
}

function readTypes(buf: Buffer, typeSec: Section): TagType[] {
  const tparts = sections(buf, typeSec.body, typeSec.end)

  const typeNames = strings(buf, get(tparts, 'TSTR'))
  const fieldNames = strings(buf, get(tparts, 'FSTR'))

  // Type names (index 0 is the null type).
  const tna = get(tparts, 'TNA1')
  const r = new PackedReader(buf, tna.body)
  const count = r.u()
  const types: TagType[] = [
    {
      index: 0,
      name: '',
      templates: [],
      parent: 0,
      format: 0,
      subType: 0,
      version: 0,
      size: 0,
      align: 0,
      flags: 0,
      members: [],
      interfaces: [],
    },
  ]
  for (let i = 1; i < count; i++) {
    const name = typeNames[r.u()]
    const tcount = r.u()
    const templates: TagType['templates'] = []
    for (let k = 0; k < tcount; k++) {
      const tname = typeNames[r.u()]
      templates.push({ name: tname, value: r.u() })
    }
    types.push({
      index: i,
      name,
      templates,
      parent: 0,
      format: 0,
      subType: 0,
      version: 0,
      size: 0,
      align: 0,
      flags: 0,
      members: [],
      interfaces: [],
    })
  }

  // Type bodies.
  const tbd = get(tparts, 'TBDY')
  const b = new PackedReader(buf, tbd.body)
  while (b.pos < tbd.end) {
    const ti = b.u()
    if (ti === 0) continue
    const t = types[ti]
    if (!t) throw new Error(`TBDY refers to unknown type ${ti}`)
    t.parent = b.u()
    const opt = b.u()
    if (opt & 0x01) t.format = b.u()
    if (opt & 0x02) t.subType = b.u()
    if (opt & 0x04) t.version = b.u()
    if (opt & 0x08) {
      t.size = b.u()
      t.align = b.u()
    }
    if (opt & 0x10) t.flags = b.u()
    if (opt & 0x20) {
      // One retail type (hkPropertyId) carries two unexplained bytes here,
      // starting 0xC3; skip them so its single member reads correctly. The
      // TYPE section is written back verbatim, so nothing is lost.
      if (buf[b.pos] >= 0xc0 && buf[b.pos + 2] < 0x80) {
        const save = b.pos
        const probe = b.u()
        if (probe > 4096) b.pos = save + 2
        else b.pos = save
      }
      const n = b.u()
      for (let k = 0; k < n; k++) {
        const name = fieldNames[b.u()]
        const flags = b.u()
        const offset = b.u()
        const type = b.u()
        t.members.push({ name, flags, offset, type })
      }
    }
    if (opt & 0x40) {
      const n = b.u()
      for (let k = 0; k < n; k++) t.interfaces.push({ type: b.u(), value: b.u() })
    }
    if (opt & 0x80) throw new Error(`Type attributes are not supported (type ${t.name})`)
  }

  // Hashes (informational).
  const th = tparts.find((x) => x.tag === 'THSH')
  if (th) {
    const h = new PackedReader(buf, th.body)
    const n = h.u()
    for (let k = 0; k < n; k++) {
      const ti = h.u()
      const hash = buf.readUInt32LE(h.pos)
      h.pos += 4
      if (types[ti]) types[ti].hash = hash
    }
  }

  return types
}

function header(tag: string, size: number, leaf: boolean): Buffer {
  const h = Buffer.alloc(8)
  h.writeUInt32BE((size | (leaf ? 0x40000000 : 0)) >>> 0, 0)
  h.write(tag, 4, 'ascii')
  return h
}

export function writeTagfile(tf: Tagfile): Buffer {
  const sdk = Buffer.from(tf.sdk, 'ascii')
  const sdkv = Buffer.concat([header('SDKV', 8 + sdk.length, true), sdk])
  const data = Buffer.concat([header('DATA', 8 + tf.data.length, true), tf.data])
  const itemBody = Buffer.alloc(tf.items.length * 12)
  tf.items.forEach((it, i) => {
    itemBody.writeUInt32LE(((it.type & 0xffffff) | (it.flags << 24)) >>> 0, i * 12)
    itemBody.writeUInt32LE(it.offset, i * 12 + 4)
    itemBody.writeUInt32LE(it.count, i * 12 + 8)
  })
  const ptchParts: Buffer[] = []
  for (const p of tf.patches) {
    const b = Buffer.alloc(8 + p.offsets.length * 4)
    b.writeUInt32LE(p.type, 0)
    b.writeUInt32LE(p.offsets.length, 4)
    p.offsets.forEach((o, i) => b.writeUInt32LE(o, 8 + i * 4))
    ptchParts.push(b)
  }
  const ptchBody = Buffer.concat(ptchParts)
  const item = Buffer.concat([header('ITEM', 8 + itemBody.length, true), itemBody])
  const ptch = Buffer.concat([header('PTCH', 8 + ptchBody.length, true), ptchBody])
  const indx = Buffer.concat([header('INDX', 8 + item.length + ptch.length, false), item, ptch])
  const body = Buffer.concat([sdkv, data, tf.typeSection, indx])
  return Buffer.concat([header('TAG0', 8 + body.length, false), body])
}

/* ------------------------------------------------------------------ objects */
export function kindOf(t: TagType): Kind {
  return (t.format & 0x1f) as Kind
}

/** All members of a record type, including inherited ones. */
export function allMembers(tf: Tagfile, typeIndex: number): TagMember[] {
  const out: TagMember[] = []
  const chain: TagType[] = []
  for (let t = tf.types[typeIndex]; t && t.index; t = tf.types[t.parent]) chain.unshift(t)
  for (const t of chain) out.push(...t.members)
  return out
}

/** The concrete type behind a type index (follows the parent chain for size). */
export function sizeOf(tf: Tagfile, typeIndex: number): number {
  for (let t = tf.types[typeIndex]; t && t.index; t = tf.types[t.parent]) if (t.size) return t.size
  return 0
}

export function typeByName(tf: Tagfile, name: string): TagType | undefined {
  return tf.types.find((t) => t.name === name)
}

export function member(tf: Tagfile, typeIndex: number, name: string): TagMember {
  const m = allMembers(tf, typeIndex).find((x) => x.name === name)
  if (!m) throw new Error(`${tf.types[typeIndex]?.name} has no member ${name}`)
  return m
}

/** Item index stored in a reference field (pointer, array or string) at a DATA offset. */
/** A string item (char array) as text. */
export function itemString(tf: Tagfile, itemIndex: number): string {
  const it = tf.items[itemIndex]
  if (!it || !itemIndex) return ''
  const s = tf.data.toString('utf8', it.offset, it.offset + it.count)
  const z = s.indexOf('\0')
  return z >= 0 ? s.slice(0, z) : s
}
