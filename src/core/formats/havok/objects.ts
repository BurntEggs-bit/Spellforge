/**
 * Havok tagfile items as plain JavaScript values: any member of any type read
 * from the item data (numbers, vectors, strings, arrays, nested records),
 * following references to other items.
 */
import { type Tagfile, type TagType, kindOf, Kind, allMembers, sizeOf } from './tagfile.ts'

/** The type that carries a type's real format (aliases like hkInt16 have format 0). */
function concrete(tf: Tagfile, t: TagType): TagType {
  let c = t
  while (c && !c.format && c.parent) c = tf.types[c.parent]
  return c
}

export type HkValue =
  | number
  | boolean
  | string
  | null
  | HkValue[]
  | { [k: string]: HkValue }
  | Float32Array
  | Uint8Array
  | Int16Array
  | Uint32Array
  | Uint16Array
/**
 * Reads a value of `typeIndex` at DATA `offset`. Arrays of plain numbers come
 * back as typed arrays; objects referenced by pointer are followed once each
 * (`seen` breaks cycles).
 */
function readValue(tf: Tagfile, typeIndex: number, offset: number, seen = new Map<number, HkValue>()): HkValue {
  const t0 = tf.types[typeIndex]
  if (!t0) return null
  const t = concrete(tf, t0)
  const d = tf.data
  const fmt = t.format
  switch (kindOf(t)) {
    case Kind.Bool:
      return d[offset] !== 0
    case Kind.Int: {
      const signed = (fmt & 0x200) !== 0
      if (fmt & 0x2000) return signed ? d.readInt8(offset) : d.readUInt8(offset)
      if (fmt & 0x4000) return signed ? d.readInt16LE(offset) : d.readUInt16LE(offset)
      if (fmt & 0x8000) return signed ? d.readInt32LE(offset) : d.readUInt32LE(offset)
      return Number(signed ? d.readBigInt64LE(offset) : d.readBigUInt64LE(offset))
    }
    case Kind.Float:
      return t.size === 8 ? d.readDoubleLE(offset) : d.readFloatLE(offset)
    case Kind.String: {
      const item = tf.items[d.readUInt32LE(offset)]
      if (!item || !d.readUInt32LE(offset)) return ''
      const s = d.toString('utf8', item.offset, item.offset + item.count)
      const z = s.indexOf('\0')
      return z >= 0 ? s.slice(0, z) : s
    }
    case Kind.Pointer: {
      const idx = d.readUInt32LE(offset)
      if (!idx) return null
      return readItem(tf, idx, seen)
    }
    case Kind.Array: {
      const count = fmt >>> 8
      if (count) {
        // Inline tuple (hkVector4 = float[4], hkMatrix4 = float[16]).
        const el = concrete(tf, tf.types[t.subType])
        const size = sizeOf(tf, t.subType)
        if (kindOf(el) === Kind.Float && size === 4) {
          const out = new Float32Array(count)
          for (let i = 0; i < count; i++) out[i] = d.readFloatLE(offset + i * 4)
          return out
        }
        return Array.from({ length: count }, (_, i) => readValue(tf, t.subType, offset + i * size, seen))
      }
      const idx = d.readUInt32LE(offset)
      if (!idx) return []
      return readItem(tf, idx, seen)
    }
    case Kind.Record: {
      const out: { [k: string]: HkValue } = {}
      for (const m of allMembers(tf, t.index)) out[m.name] = readValue(tf, m.type, offset + m.offset, seen)
      return out
    }
    default:
      return null
  }
}
/** An item: one object, or an array of `count` elements of its type. */
function readItem(tf: Tagfile, index: number, seen = new Map<number, HkValue>()): HkValue {
  if (seen.has(index)) return seen.get(index)!
  const it = tf.items[index]
  if (!it) return null
  const el = concrete(tf, tf.types[it.type])
  const size = sizeOf(tf, it.type)
  const isArray = (it.flags & 0x20) !== 0
  if (!isArray) {
    const v = readValue(tf, it.type, it.offset, seen)
    seen.set(index, v)
    return v
  }
  // Numeric arrays as typed arrays.
  if (kindOf(el) === Kind.Int || kindOf(el) === Kind.Float) {
    const bytes = tf.data.subarray(it.offset, it.offset + it.count * size)
    const copy = new Uint8Array(bytes).buffer
    let v: HkValue
    if (kindOf(el) === Kind.Float && size === 4) v = new Float32Array(copy)
    else if (size === 1) v = new Uint8Array(copy)
    else if (size === 2) v = (el.format & 0x200 ? new Int16Array(copy) : new Uint16Array(copy)) as HkValue
    else if (size === 4) v = new Uint32Array(copy)
    else v = Array.from({ length: it.count }, (_, i) => readValue(tf, it.type, it.offset + i * size, seen))
    seen.set(index, v)
    return v
  }
  if (kindOf(el) === Kind.String && el.name === 'char') {
    const s = tf.data.toString('utf8', it.offset, it.offset + it.count).replace(/\0.*$/s, '')
    seen.set(index, s)
    return s
  }
  const out: HkValue[] = []
  seen.set(index, out)
  for (let i = 0; i < it.count; i++) out.push(readValue(tf, it.type, it.offset + i * size, seen))
  return out
}
/** Items of a type (by name), read as objects. */
export function itemsOfType(tf: Tagfile, name: string): { index: number; value: { [k: string]: HkValue } }[] {
  const out: { index: number; value: { [k: string]: HkValue } }[] = []
  tf.items.forEach((it, i) => {
    if (i && tf.types[it.type]?.name === name && !(it.flags & 0x20))
      out.push({ index: i, value: readItem(tf, i) as { [k: string]: HkValue } })
  })
  return out
}
