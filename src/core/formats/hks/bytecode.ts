/**
 * Compiled HavokScript (.hks bytecode), the format of Elden Ring's behaviour
 * scripts (action/script/c0000.hks and friends). HavokScript is Havok's fork
 * of Lua 5.1; its compiled chunks are Lua 5.1 dumps with a different header,
 * a type table, size_t counts and a structures section. Layout as written by
 * the game's compiler (checked byte for byte against every retail script by
 * the hks suite):
 *
 *   header (14 bytes)   "\x1bLua", version 0x51, format 0x0E, endianness
 *                       (0 = big), sizeof int (4), size_t (8), instruction (4),
 *                       lua_Number (4: float32), integral flag (0),
 *                       compatibility bits (3: global memoization, structures),
 *                       shared-state flag (0)
 *   type table          int count, then { int id, int size, name + NUL }
 *                       (TNIL ... TSTRUCT, 13 entries)
 *   main function       (recursively, children after their parent):
 *     int upvalues, int params, byte vararg flags, int max stack,
 *     size_t instruction count, '_' padding to a multiple of 4 from the
 *     file start, the instructions,
 *     int constant count, then { byte type, value }: nil, boolean (byte),
 *     number (float), string (size_t size incl. NUL, bytes, NUL),
 *     light userdata (size_t), ui64 (8 bytes),
 *     debug info: int 1 (0 = stripped: nothing follows), int line count,
 *     int local count, int upvalue name count, int first line, int last line,
 *     source (only on the main function, "@"; children store a null string),
 *     function name, then the lines (int per instruction), the locals
 *     { name, int start pc, int end pc }, the upvalue names,
 *     int child count, the children
 *   structures          int 1, then structure prototypes, ended by a null
 *                       string (retail scripts have none)
 *
 * Strings are byte strings: they're kept as JS strings with one char per byte
 * (latin1), so any encoding round-trips.
 *
 * Credit: hksc (Jake-NotTheMuss) documents this layout.
 */

export type HksConstant =
  | { type: 'nil' }
  | { type: 'boolean'; value: boolean }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'lightuserdata'; value: bigint }
  | { type: 'ui64'; value: bigint }

/** Constant type tags (the type table's ids). */
const HKS_TYPE = { nil: 0, boolean: 1, lightuserdata: 2, number: 3, string: 4, ui64: 11 } as const

export interface HksLocal {
  name: string
  /** First instruction where the local is live. */
  start: number
  /** First instruction where it's dead again. */
  end: number
}

export interface HksDebug {
  /** Source line of each instruction. */
  lines: number[]
  locals: HksLocal[]
  upvalueNames: string[]
  lineDefined: number
  lastLineDefined: number
  /** "@" on the main function, null on the others. */
  source: string | null
  /** The function's name ("(main chunk)", "ExecEvent", "Foo:Bar", ...). */
  name: string | null
}

export interface HksProto {
  upvalueCount: number
  paramCount: number
  /** Lua 5.1 VARARG_* bits: 2 = is vararg (the main chunk), 1 = has `arg`. */
  varargFlags: number
  maxStack: number
  code: number[]
  constants: HksConstant[]
  /** null when stripped. */
  debug: HksDebug | null
  children: HksProto[]
}

export interface HksStructSlot {
  name: string
  structId: bigint
  typeId: number
  reserved: number
  position: bigint
}

export interface HksStruct {
  name: string
  id: bigint
  hasMeta: number
  hasProxy: number
  slots: HksStructSlot[]
}

export interface HksHeader {
  version: number
  format: number
  /** 0 = big-endian (Elden Ring), 1 = little. */
  endianness: number
  sizeInt: number
  sizeSize: number
  sizeInstruction: number
  sizeNumber: number
  integral: number
  compatibility: number
  shared: number
}

export interface HksChunk {
  header: HksHeader
  types: { id: number; name: string }[]
  main: HksProto
  /** The structures section's leading int (1). */
  structMarker: number
  structs: HksStruct[]
  /** Zero bytes after the end, kept so the file writes back as it was (older game versions' c0000.hks has 5). */
  padding?: number
}

/** Elden Ring's header and type table, for writing new chunks. */
export const ER_HKS_HEADER: HksHeader = {
  version: 0x51,
  format: 0x0e,
  endianness: 0,
  sizeInt: 4,
  sizeSize: 8,
  sizeInstruction: 4,
  sizeNumber: 4,
  integral: 0,
  compatibility: 3,
  shared: 0,
}

export const ER_HKS_TYPES = [
  'TNIL',
  'TBOOLEAN',
  'TLIGHTUSERDATA',
  'TNUMBER',
  'TSTRING',
  'TTABLE',
  'TFUNCTION',
  'TUSERDATA',
  'TTHREAD',
  'TIFUNCTION',
  'TCFUNCTION',
  'TUI64',
  'TSTRUCT',
].map((name, id) => ({ id, name }))

export function isHksBytecode(buf: Buffer): boolean {
  return buf.length >= 14 && buf.toString('latin1', 0, 5) === '\x1bLuaQ' && buf[5] === 0x0e
}

class Reader {
  buf: Buffer
  pos = 0
  big = true
  sizeSize = 8
  sizeInt = 4
  sizeNumber = 4

  constructor(buf: Buffer) {
    this.buf = buf
  }

  need(n: number) {
    if (this.pos + n > this.buf.length) throw new Error(`HKS: unexpected end of file at 0x${this.pos.toString(16)}`)
  }

  u8(): number {
    this.need(1)
    return this.buf[this.pos++]
  }

  int(): number {
    this.need(this.sizeInt)
    let v: number
    if (this.sizeInt === 2) v = this.big ? this.buf.readInt16BE(this.pos) : this.buf.readInt16LE(this.pos)
    else v = this.big ? this.buf.readInt32BE(this.pos) : this.buf.readInt32LE(this.pos)
    this.pos += this.sizeInt
    return v
  }

  size(): bigint {
    this.need(this.sizeSize)
    let v: bigint
    if (this.sizeSize === 8) v = this.big ? this.buf.readBigUInt64BE(this.pos) : this.buf.readBigUInt64LE(this.pos)
    else if (this.sizeSize === 4)
      v = BigInt(this.big ? this.buf.readUInt32BE(this.pos) : this.buf.readUInt32LE(this.pos))
    else v = BigInt(this.big ? this.buf.readUInt16BE(this.pos) : this.buf.readUInt16LE(this.pos))
    this.pos += this.sizeSize
    return v
  }

  count(what: string): number {
    const n = this.size()
    if (n > BigInt(this.buf.length)) throw new Error(`HKS: bad ${what} count ${n} at 0x${this.pos.toString(16)}`)
    return Number(n)
  }

  u32(): number {
    this.need(4)
    const v = this.big ? this.buf.readUInt32BE(this.pos) : this.buf.readUInt32LE(this.pos)
    this.pos += 4
    return v
  }

  u64(): bigint {
    this.need(8)
    const v = this.big ? this.buf.readBigUInt64BE(this.pos) : this.buf.readBigUInt64LE(this.pos)
    this.pos += 8
    return v
  }

  number(): number {
    this.need(this.sizeNumber)
    let v: number
    if (this.sizeNumber === 8) v = this.big ? this.buf.readDoubleBE(this.pos) : this.buf.readDoubleLE(this.pos)
    else v = this.big ? this.buf.readFloatBE(this.pos) : this.buf.readFloatLE(this.pos)
    this.pos += this.sizeNumber
    return v
  }

  /** size_t size (incl. the NUL), the bytes, NUL; size 0 = no string. */
  string(): string | null {
    const n = this.count('string')
    if (n === 0) return null
    this.need(n)
    const s = this.buf.toString('latin1', this.pos, this.pos + n - 1)
    if (this.buf[this.pos + n - 1] !== 0)
      throw new Error(`HKS: string at 0x${this.pos.toString(16)} isn't NUL-terminated`)
    this.pos += n
    return s
  }
}

function readProto(r: Reader, depth: number): HksProto {
  if (depth > 200) throw new Error('HKS: functions nested too deeply')
  const upvalueCount = r.int()
  const paramCount = r.int()
  const varargFlags = r.u8()
  const maxStack = r.int()
  const n = r.count('instruction')
  // Padding to the next instruction boundary, from the start of the file.
  while (r.pos % 4) {
    if (r.u8() !== 0x5f) throw new Error(`HKS: unexpected padding byte at 0x${(r.pos - 1).toString(16)}`)
  }
  r.need(n * 4)
  const code: number[] = new Array(n)
  for (let i = 0; i < n; i++) code[i] = r.u32()
  const nk = r.int()
  const constants: HksConstant[] = []
  for (let i = 0; i < nk; i++) {
    const t = r.u8()
    if (t === HKS_TYPE.nil) constants.push({ type: 'nil' })
    else if (t === HKS_TYPE.boolean) constants.push({ type: 'boolean', value: r.u8() !== 0 })
    else if (t === HKS_TYPE.number) constants.push({ type: 'number', value: r.number() })
    else if (t === HKS_TYPE.string) {
      const s = r.string()
      if (s === null) throw new Error(`HKS: null string constant at 0x${r.pos.toString(16)}`)
      constants.push({ type: 'string', value: s })
    } else if (t === HKS_TYPE.lightuserdata) constants.push({ type: 'lightuserdata', value: r.size() })
    else if (t === HKS_TYPE.ui64) constants.push({ type: 'ui64', value: r.u64() })
    else throw new Error(`HKS: unknown constant type ${t} at 0x${(r.pos - 1).toString(16)}`)
  }
  let debug: HksDebug | null = null
  const hasDebug = r.int()
  if (hasDebug !== 0) {
    if (hasDebug !== 1) throw new Error(`HKS: unknown debug info flag ${hasDebug} at 0x${(r.pos - 4).toString(16)}`)
    const nlines = r.int()
    const nlocals = r.int()
    const nups = r.int()
    const lineDefined = r.int()
    const lastLineDefined = r.int()
    const source = r.string()
    const name = r.string()
    const lines: number[] = new Array(nlines)
    for (let i = 0; i < nlines; i++) lines[i] = r.int()
    const locals: HksLocal[] = []
    for (let i = 0; i < nlocals; i++) locals.push({ name: r.string() ?? '', start: r.int(), end: r.int() })
    const upvalueNames: string[] = []
    for (let i = 0; i < nups; i++) upvalueNames.push(r.string() ?? '')
    debug = { lines, locals, upvalueNames, lineDefined, lastLineDefined, source, name }
  }
  const nchildren = r.int()
  const children: HksProto[] = []
  for (let i = 0; i < nchildren; i++) children.push(readProto(r, depth + 1))
  return { upvalueCount, paramCount, varargFlags, maxStack, code, constants, debug, children }
}

export function readHks(buf: Buffer): HksChunk {
  if (!isHksBytecode(buf)) throw new Error('Not a compiled HavokScript file')
  const header: HksHeader = {
    version: buf[4],
    format: buf[5],
    endianness: buf[6],
    sizeInt: buf[7],
    sizeSize: buf[8],
    sizeInstruction: buf[9],
    sizeNumber: buf[10],
    integral: buf[11],
    compatibility: buf[12],
    shared: buf[13],
  }
  if (
    header.sizeInstruction !== 4 ||
    ![2, 4].includes(header.sizeInt) ||
    ![2, 4, 8].includes(header.sizeSize) ||
    ![4, 8].includes(header.sizeNumber) ||
    header.integral !== 0
  )
    throw new Error('HKS: unsupported number or instruction sizes')
  const r = new Reader(buf)
  r.big = header.endianness === 0
  r.sizeInt = header.sizeInt
  r.sizeSize = header.sizeSize
  r.sizeNumber = header.sizeNumber
  r.pos = 14
  const types: { id: number; name: string }[] = []
  const ntypes = r.int()
  if (ntypes < 0 || ntypes > 64) throw new Error(`HKS: bad type count ${ntypes}`)
  for (let i = 0; i < ntypes; i++) {
    const id = r.int()
    const size = r.int()
    r.need(size)
    if (size < 1 || buf[r.pos + size - 1] !== 0) throw new Error(`HKS: bad type name at 0x${r.pos.toString(16)}`)
    types.push({ id, name: buf.toString('latin1', r.pos, r.pos + size - 1) })
    r.pos += size
  }
  const main = readProto(r, 0)
  const structMarker = r.int()
  const structs: HksStruct[] = []
  for (;;) {
    const name = r.string()
    if (name === null) break
    const id = r.size()
    const hasMeta = r.int()
    const hasProxy = r.int()
    const nslots = r.count('slot')
    const slots: HksStructSlot[] = []
    for (let i = 0; i < nslots; i++)
      slots.push({ name: r.string() ?? '', structId: r.size(), typeId: r.int(), reserved: r.int(), position: r.size() })
    structs.push({ name, id, hasMeta, hasProxy, slots })
  }
  // Zero padding after the end is allowed (and kept); anything else isn't.
  const rest = buf.subarray(r.pos)
  if (rest.some((b) => b !== 0)) throw new Error(`HKS: ${rest.length} unexpected bytes after the structures section`)
  return { header, types, main, structMarker, structs, ...(rest.length ? { padding: rest.length } : {}) }
}

/** Writes in the file's byte order and field sizes, into 64 KiB chunks. */
class Writer {
  parts: Buffer[] = []
  cur = Buffer.alloc(1 << 16)
  view = new DataView(this.cur.buffer, this.cur.byteOffset, this.cur.byteLength)
  at = 0
  total = 0
  big = true
  sizeSize = 8
  sizeInt = 4
  sizeNumber = 4

  get pos() {
    return this.total
  }

  /**
   * Where the next n bytes go, after making room for them. It may start a new
   * chunk, so call it before reading `cur` or `view`: in
   * `this.view.set…(this.take(n), …)` the old view would get the bytes.
   */
  private take(n: number): number {
    if (this.at + n > this.cur.length) {
      this.parts.push(this.cur.subarray(0, this.at))
      this.cur = Buffer.alloc(Math.max(1 << 16, n))
      this.view = new DataView(this.cur.buffer, this.cur.byteOffset, this.cur.byteLength)
      this.at = 0
    }
    const at = this.at
    this.at += n
    this.total += n
    return at
  }

  u8(v: number) {
    const at = this.take(1)
    this.cur[at] = v
  }

  int(v: number) {
    const at = this.take(this.sizeInt)
    if (this.sizeInt === 2) this.view.setInt16(at, v, !this.big)
    else this.view.setInt32(at, v, !this.big)
  }

  size(v: bigint | number) {
    const at = this.take(this.sizeSize)
    if (this.sizeSize === 8) this.view.setBigUint64(at, BigInt(v), !this.big)
    else if (this.sizeSize === 4) this.view.setUint32(at, Number(v), !this.big)
    else this.view.setUint16(at, Number(v), !this.big)
  }

  u32(v: number) {
    const at = this.take(4)
    this.view.setUint32(at, v >>> 0, !this.big)
  }

  u64(v: bigint) {
    const at = this.take(8)
    this.view.setBigUint64(at, v, !this.big)
  }

  number(v: number) {
    const at = this.take(this.sizeNumber)
    if (this.sizeNumber === 8) this.view.setFloat64(at, v, !this.big)
    else this.view.setFloat32(at, v, !this.big)
  }

  bytes(s: string) {
    const at = this.take(s.length)
    this.cur.write(s, at, 'latin1')
  }

  string(s: string | null) {
    if (s === null) return this.size(0)
    this.size(s.length + 1)
    this.bytes(s)
    this.u8(0)
  }

  done(): Buffer {
    this.parts.push(this.cur.subarray(0, this.at))
    return Buffer.concat(this.parts)
  }
}

function writeProto(w: Writer, f: HksProto) {
  w.int(f.upvalueCount)
  w.int(f.paramCount)
  w.u8(f.varargFlags)
  w.int(f.maxStack)
  w.size(f.code.length)
  while (w.pos % 4) w.u8(0x5f)
  for (const i of f.code) w.u32(i)
  w.int(f.constants.length)
  for (const k of f.constants) {
    w.u8(HKS_TYPE[k.type])
    if (k.type === 'boolean') w.u8(k.value ? 1 : 0)
    else if (k.type === 'number') w.number(k.value)
    else if (k.type === 'string') w.string(k.value)
    else if (k.type === 'lightuserdata') w.size(k.value)
    else if (k.type === 'ui64') w.u64(k.value)
  }
  const d = f.debug
  if (!d) w.int(0)
  else {
    w.int(1)
    w.int(d.lines.length)
    w.int(d.locals.length)
    w.int(d.upvalueNames.length)
    w.int(d.lineDefined)
    w.int(d.lastLineDefined)
    w.string(d.source)
    w.string(d.name)
    for (const l of d.lines) w.int(l)
    for (const l of d.locals) {
      w.string(l.name)
      w.int(l.start)
      w.int(l.end)
    }
    for (const u of d.upvalueNames) w.string(u)
  }
  w.int(f.children.length)
  for (const c of f.children) writeProto(w, c)
}

export function writeHks(chunk: HksChunk): Buffer {
  const h = chunk.header
  const w = new Writer()
  w.big = h.endianness === 0
  w.sizeInt = h.sizeInt
  w.sizeSize = h.sizeSize
  w.sizeNumber = h.sizeNumber
  w.bytes('\x1bLua')
  for (const b of [
    h.version,
    h.format,
    h.endianness,
    h.sizeInt,
    h.sizeSize,
    h.sizeInstruction,
    h.sizeNumber,
    h.integral,
    h.compatibility,
    h.shared,
  ])
    w.u8(b)
  w.int(chunk.types.length)
  for (const t of chunk.types) {
    w.int(t.id)
    w.int(t.name.length + 1)
    w.bytes(t.name)
    w.u8(0)
  }
  writeProto(w, chunk.main)
  w.int(chunk.structMarker)
  for (const s of chunk.structs) {
    w.string(s.name)
    w.size(s.id)
    w.int(s.hasMeta)
    w.int(s.hasProxy)
    w.size(s.slots.length)
    for (const sl of s.slots) {
      w.string(sl.name)
      w.size(sl.structId)
      w.int(sl.typeId)
      w.int(sl.reserved)
      w.size(sl.position)
    }
  }
  w.string(null)
  for (let i = 0; i < (chunk.padding ?? 0); i++) w.u8(0)
  return w.done()
}
