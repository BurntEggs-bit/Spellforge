/**
 * Full read/write of Elden Ring TAE files (animation event tables, "TAE "
 * version 0x1000C/D, 64-bit little-endian), for editing events and adding
 * animations. src/core/formats/tae.ts keeps the light read-only scan used for
 * behaviour lookups.
 *
 * File layout, in write order (offsets are absolute u64s):
 *   header + skeleton/SIB names        kept verbatim up to the animation table, except its sizes,
 *                                      counts, offsets and its id (at 0x50, 0x90 and 0x94)
 *   animation table                    { id, header offset } per animation
 *   animation groups                   count, offset, then runs of consecutive ids
 *                                      { first id, last id, table entry offset }
 *   animation headers (0x30 each)      { event headers, event groups, times,
 *                                        file, event count, group count, time count, 0 }
 *   then per animation:
 *     file reference   { type, sub } + sub { name, a, b, c, d } + UTF-16 name, pad 16
 *                      type 0 = its own .hkt, type 1 = imports another animation (a = id)
 *     times            unique event times (float), pad 16
 *     event headers    { start time ptr, end time ptr, data ptr } (0x18 each)
 *     event data       { type, unk, params ptr } + params, each padded to 16
 *     group headers    { count, event pointers ptr, data ptr, 0 } (0x20 each)
 *     group blocks     16 bytes of group data, then u32 event-header pointers, pad 16
 *
 * Each event keeps its stored parameter bytes (up to the next block, so the
 * file round-trips exactly); DSAS's ER template (data/er/tae-template.json)
 * decodes them and sizes new events.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors; MIT): the event
 * template that sizes and names events is its Elden Ring template.
 */

export interface TaeFileEvent {
  type: number
  unk: number
  start: number
  end: number
  params: Buffer
}

export interface TaeFileGroup {
  /** 16 bytes; the first i64 is the group's event type. */
  data: Buffer
  /** Indices into the animation's events. */
  events: number[]
}

export interface TaeFileAnimation {
  id: number
  file: {
    /** 0 = own motion file, 1 = imports another animation's motion. */
    type: number
    name: string
    /** For type 1, the imported animation id. */
    a: number
    b: number
    c: bigint
    d: bigint
  }
  events: TaeFileEvent[]
  groups: TaeFileGroup[]
  /** Times table as stored (written back unchanged if events still use exactly these). */
  times: number[]
}

export interface TaeFile {
  /** Bytes from 0 to the animation table, verbatim (header, names). */
  prefix: Buffer
  id: number
  animations: TaeFileAnimation[]
}

/** Parameter byte sizes by event type (from the template). */
export type ParamSizes = Map<number, number>

/**
 * Where Elden Ring's files disagree with DSAS's template, measured from the
 * spans between event blocks in every retail player TAE: Blend stores no
 * parameters, EnableTwistModifier 40 bytes (template: 52), and type 17
 * (not in the template) 16.
 */
const ER_SIZE_OVERRIDES: Record<number, number> = { 16: 0, 17: 16, 700: 40 }

/** Parameter sizes for reading/writing: the template's, with ER's corrections. */
export function paramSizes(template: { events: Record<string, { size: number }> }): ParamSizes {
  const m: ParamSizes = new Map(Object.entries(template.events).map(([k, v]) => [Number(k), v.size]))
  for (const [k, v] of Object.entries(ER_SIZE_OVERRIDES)) m.set(Number(k), v)
  return m
}

const align = (n: number, a: number) => (n + a - 1) & ~(a - 1)

export function readTaeFile(buf: Buffer, _sizes?: ParamSizes): TaeFile {
  if (buf.toString('ascii', 0, 4) !== 'TAE ') throw new Error('Not a TAE file')
  if (buf[4] !== 0 || buf[7] !== 0xff) throw new Error('Only little-endian 64-bit TAE (Elden Ring) is supported')
  const i64 = (o: number) => Number(buf.readBigInt64LE(o))
  const animsOffset = i64(0x58)
  const count = buf.readInt32LE(0x54)

  // Every block start in the file. An event's parameters run to the next
  // block: the stored length, which round-trips exactly even where the
  // template's size is wrong for Elden Ring.
  const starts: number[] = [buf.length]
  for (let a = 0; a < count; a++) {
    const at = i64(animsOffset + a * 16 + 8)
    const headers = i64(at)
    const fileAt = i64(at + 24)
    starts.push(at, fileAt, i64(at + 8), i64(at + 16), headers)
    starts.push(i64(fileAt + 8))
    const eventCount = buf.readInt32LE(at + 32)
    for (let e = 0; e < eventCount; e++) starts.push(i64(headers + e * 0x18 + 0x10))
    const groupsAt = i64(at + 8)
    const groupCount = buf.readInt32LE(at + 36)
    for (let g = 0; g < groupCount; g++) starts.push(i64(groupsAt + g * 0x20 + 8), i64(groupsAt + g * 0x20 + 16))
  }
  const sorted = [...new Set(starts.filter((x) => x > 0))].sort((x, y) => x - y)
  const blockAt = new Set(sorted)
  const nextStart = (after: number) => {
    let lo = 0
    let hi = sorted.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] > after) hi = mid
      else lo = mid + 1
    }
    return sorted[lo] > after ? sorted[lo] : buf.length
  }

  const animations: TaeFileAnimation[] = []
  for (let a = 0; a < count; a++) {
    const id = i64(animsOffset + a * 16)
    const at = i64(animsOffset + a * 16 + 8)
    const headers = i64(at)
    const groupsAt = i64(at + 8)
    const timesAt = i64(at + 16)
    const fileAt = i64(at + 24)
    const eventCount = buf.readInt32LE(at + 32)
    const groupCount = buf.readInt32LE(at + 36)
    const timeCount = buf.readInt32LE(at + 40)

    const sub = i64(fileAt + 8)
    const namePtr = i64(sub)
    // An empty name still points just past the block, where the next block
    // starts; only read a name where nothing else begins.
    let name = ''
    if (namePtr < buf.length && !blockAt.has(namePtr)) {
      let e = namePtr
      while (e + 1 < buf.length && buf.readUInt16LE(e) !== 0) e += 2
      name = buf.toString('utf16le', namePtr, e)
    }
    const file = {
      type: i64(fileAt),
      name,
      a: buf.readInt32LE(sub + 8),
      b: buf.readInt32LE(sub + 12),
      c: buf.readBigInt64LE(sub + 16),
      d: buf.readBigInt64LE(sub + 24),
    }

    const times: number[] = []
    for (let k = 0; k < timeCount; k++) times.push(buf.readFloatLE(timesAt + k * 4))

    const headerAt = new Map<number, number>()
    const dataStarts: number[] = []
    for (let e = 0; e < eventCount; e++) dataStarts.push(i64(headers + e * 0x18 + 0x10))
    const events: TaeFileEvent[] = []
    for (let e = 0; e < eventCount; e++) {
      const h = headers + e * 0x18
      headerAt.set(h, e)
      const data = dataStarts[e]
      const type = buf.readInt32LE(data)
      const params = i64(data + 8)
      // Stored bytes up to the next block (includes alignment padding).
      const size = Math.max(0, nextStart(params - 1) - params)
      events.push({
        type,
        unk: buf.readInt32LE(data + 4),
        start: buf.readFloatLE(i64(h)),
        end: buf.readFloatLE(i64(h + 8)),
        params: Buffer.from(buf.subarray(params, params + size)),
      })
    }

    const groups: TaeFileGroup[] = []
    for (let g = 0; g < groupCount; g++) {
      const gh = groupsAt + g * 0x20
      const n = i64(gh)
      const ptrs = i64(gh + 8)
      const data = i64(gh + 16)
      const evs: number[] = []
      for (let k = 0; k < n; k++) {
        const idx = headerAt.get(buf.readUInt32LE(ptrs + k * 4))
        if (idx === undefined) throw new Error(`Animation ${id}: group ${g} points outside its events`)
        evs.push(idx)
      }
      groups.push({ data: Buffer.from(buf.subarray(data, data + 16)), events: evs })
    }

    animations.push({ id, file, events, groups, times })
  }
  // With no animations the table offset is 0 and the prefix ends at the (empty) group table.
  const prefixEnd = animsOffset || i64(0x60)
  return { prefix: Buffer.from(buf.subarray(0, prefixEnd)), id: buf.readInt32LE(0x50), animations }
}

class Out {
  chunks: Buffer[] = []
  size = 0
  put(b: Buffer): number {
    const at = this.size
    this.chunks.push(b)
    this.size += b.length
    return at
  }
  pad(a: number): void {
    const n = align(this.size, a) - this.size
    if (n) this.put(Buffer.alloc(n))
  }
  done(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

const u64 = (v: number | bigint) => {
  const b = Buffer.alloc(8)
  b.writeBigInt64LE(BigInt(v))
  return b
}

export function writeTaeFile(tae: TaeFile): Buffer {
  const anims = [...tae.animations].sort((x, y) => x.id - y.id)
  const n = anims.length
  const out = new Out()
  // Everything is laid out first with placeholders, then patched.
  const fixups: { at: number; value: () => number }[] = []
  const ptr = (value: () => number) => {
    const at = out.put(Buffer.alloc(8))
    fixups.push({ at, value })
    return at
  }

  out.put(Buffer.from(tae.prefix))
  const tableAt = out.size
  const headerAt: number[] = []
  for (let i = 0; i < n; i++) {
    out.put(u64(anims[i].id))
    const k = i
    ptr(() => headerAt[k])
  }

  // Animation groups: runs of consecutive ids.
  const runs: { first: number; last: number; index: number }[] = []
  for (let i = 0; i < n; i++) {
    const r = runs[runs.length - 1]
    if (r && anims[i].id === r.last + 1) r.last = anims[i].id
    else runs.push({ first: anims[i].id, last: anims[i].id, index: i })
  }
  const groupsAt = out.size
  out.put(u64(runs.length))
  out.put(u64(runs.length ? groupsAt + 0x10 : 0))
  for (const r of runs) {
    const b = Buffer.alloc(8)
    b.writeInt32LE(r.first, 0)
    b.writeInt32LE(r.last, 4)
    out.put(b)
    out.put(u64(tableAt + r.index * 16))
  }

  // Animation headers (filled in once each animation's blocks are placed).
  const firstHeader = out.size
  for (let i = 0; i < n; i++) headerAt.push(out.put(Buffer.alloc(0x30)))

  const headerValues: number[][] = []
  for (const anim of anims) {
    // File reference.
    const fileAt = out.put(u64(anim.file.type))
    out.put(u64(fileAt + 0x10))
    const sub = Buffer.alloc(0x20)
    sub.writeBigInt64LE(BigInt(fileAt + 0x30), 0)
    sub.writeInt32LE(anim.file.a, 8)
    sub.writeInt32LE(anim.file.b, 12)
    sub.writeBigInt64LE(anim.file.c, 16)
    sub.writeBigInt64LE(anim.file.d, 24)
    out.put(sub)
    if (anim.file.name) {
      out.put(Buffer.from(anim.file.name + '\0', 'utf16le'))
      out.pad(16)
    }

    let timesAt = 0
    let eventsAt = 0
    let groupsHeadAt = 0
    let times: number[] = []
    const evHeader: number[] = []
    if (anim.events.length) {
      // Times: keep the stored table when events still use exactly its values.
      const used = new Set<number>()
      for (const e of anim.events) {
        used.add(Math.fround(e.start))
        used.add(Math.fround(e.end))
      }
      const stored = anim.times.map((t) => Math.fround(t))
      const same = stored.length === used.size && stored.every((t) => used.has(t))
      times = same ? stored : [...used].sort((x, y) => x - y)
      timesAt = out.size
      const tb = Buffer.alloc(times.length * 4)
      times.forEach((t, k) => tb.writeFloatLE(t, k * 4))
      out.put(tb)
      out.pad(16)

      eventsAt = out.size
      for (let e = 0; e < anim.events.length; e++) evHeader.push(out.put(Buffer.alloc(0x18)))
      for (let e = 0; e < anim.events.length; e++) {
        const ev = anim.events[e]
        const dataAt = out.size
        const head = Buffer.alloc(0x10)
        head.writeInt32LE(ev.type, 0)
        head.writeInt32LE(ev.unk, 4)
        head.writeBigInt64LE(BigInt(dataAt + 0x10), 8)
        out.put(head)
        out.put(ev.params)
        out.pad(16)
        const startAt = timesAt + times.indexOf(Math.fround(ev.start)) * 4
        const endAt = timesAt + times.indexOf(Math.fround(ev.end)) * 4
        const h = evHeader[e]
        fixups.push(
          { at: h, value: () => startAt },
          { at: h + 8, value: () => endAt },
          { at: h + 16, value: () => dataAt },
        )
      }
    }

    // Groups can exist without events (all empty).
    if (anim.groups.length) {
      groupsHeadAt = out.size
      const gh: number[] = []
      for (let g = 0; g < anim.groups.length; g++) gh.push(out.put(Buffer.alloc(0x20)))
      anim.groups.forEach((g, gi) => {
        const dataAt = out.put(Buffer.from(g.data))
        const ptrsAt = out.size
        // Event pointers are 32-bit.
        const pb = Buffer.alloc(g.events.length * 4)
        g.events.forEach((idx, k) => pb.writeUInt32LE(evHeader[idx], k * 4))
        out.put(pb)
        out.pad(16)
        fixups.push({ at: gh[gi], value: () => g.events.length })
        fixups.push({ at: gh[gi] + 8, value: () => ptrsAt })
        fixups.push({ at: gh[gi] + 16, value: () => dataAt })
      })
    }
    headerValues.push([eventsAt, groupsHeadAt, timesAt, fileAt, anim.events.length, anim.groups.length, times.length])
  }

  const buf = out.done()
  for (const f of fixups) buf.writeBigInt64LE(BigInt(f.value()), f.at)
  headerValues.forEach((v, i) => {
    const h = headerAt[i]
    buf.writeBigInt64LE(BigInt(v[0]), h)
    buf.writeBigInt64LE(BigInt(v[1]), h + 8)
    buf.writeBigInt64LE(BigInt(v[2]), h + 16)
    buf.writeBigInt64LE(BigInt(v[3]), h + 24)
    buf.writeInt32LE(v[4], h + 32)
    buf.writeInt32LE(v[5], h + 36)
    buf.writeInt32LE(v[6], h + 40)
  })
  // Header fields that depend on the layout.
  buf.writeUInt32LE(buf.length, 0x0c)
  buf.writeInt32LE(tae.id, 0x50)
  // The id is stored twice more, at 0x90 and 0x94 (all 642 retail player TAEs agree); a category
  // made as a copy of another must not keep that one's.
  if (buf.length >= 0x98) {
    buf.writeInt32LE(tae.id, 0x90)
    buf.writeInt32LE(tae.id, 0x94)
  }
  buf.writeInt32LE(n, 0x54)
  buf.writeBigInt64LE(BigInt(n ? tableAt : 0), 0x58)
  buf.writeBigInt64LE(BigInt(groupsAt), 0x60)
  buf.writeBigInt64LE(BigInt(n), 0x70)
  buf.writeBigInt64LE(BigInt(n ? firstHeader : 0), 0x78)
  return buf
}
