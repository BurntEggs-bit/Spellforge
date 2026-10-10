/**
 * EMEVD: the game's event scripts (event/*.emevd.dcx: common, common_func and
 * one per map). Elden Ring's are 64-bit, version 0xCD (layout as SoulsFormats
 * documents it, checked against every file):
 *
 *   header (0x90): "EVD\0", 00 FF 01 FF, u32 0xCD, u32 file size, then i64
 *     count + i64 offset for events, instructions, (unused), layers,
 *     parameters and linked files; i64 args length + offset; i64 strings
 *     length + offset.
 *   event (0x30): i64 id, i64 instruction count, i64 instructions offset
 *     (into the instruction table), i64 parameter count, i64 parameters
 *     offset (-1: none), u32 rest behavior, u32 0.
 *   instruction (0x20): u32 bank, u32 id, i64 args length, i64 args offset
 *     (into the args block), i64 layer offset (-1: none).
 *   parameter (0x20): i64 instruction index, i64 target byte, i64 source
 *     byte, u32 byte count, u32 unknown: when the event is started
 *     (InitializeEvent), bytes of its arguments are copied into an
 *     instruction's: that's how shared events (common_func) take flags,
 *     entities and items as arguments.
 *   layer (0x20): u32 2, u32 mask, i64 0, i64 -1, i64 1 (an instruction
 *     that runs only in some map layers; the game's own files have none).
 *
 * The sections follow each other in this order: header, events,
 * instructions, layers, arguments (each instruction's, in order, padded to
 * 4 bytes; the block to 16), parameters, linked files, strings. writeEmevd writes them so,
 * and the game's files come back byte for byte (checked by the events
 * suite).
 *
 * Instructions are numbered bank[id] (2003[66] sets an event flag, say);
 * their argument layouts are worked out in core/events/instructions.ts and
 * eventScripts.ts from the game's own scripts.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the EMEVD layout.
 */

export interface EmevdInstruction {
  bank: number
  id: number
  args: Buffer
  /** The map layers it runs in (a mask), when it's limited to some. */
  layer?: number
}

export interface EmevdParameter {
  instruction: number
  target: number
  source: number
  bytes: number
  unknown?: number
}

export interface EmevdEvent {
  id: number
  restBehavior: number
  instructions: EmevdInstruction[]
  parameters: EmevdParameter[]
}

export interface Emevd {
  events: EmevdEvent[]
  /** Other event files this one uses (common_func). */
  linkedFiles: string[]
  /** The strings block and where each linked file's name starts in it, kept for writing. */
  strings?: { data: Buffer; linkOffsets: number[] }
}

export function readEmevd(b: Buffer): Emevd {
  if (b.toString('latin1', 0, 4) !== 'EVD\0') throw new Error('Not an EMEVD file')
  if (b[5] !== 0xff) throw new Error('Only 64-bit EMEVD files are supported')
  const q = (o: number) => Number(b.readBigInt64LE(o))
  const [eventCount, eventsAt] = [q(0x10), q(0x18)]
  const instrAt = q(0x28)
  const paramsAt = q(0x58)
  const [linkCount, linksAt] = [q(0x60), q(0x68)]
  const layersAt = q(0x48)
  const argsAt = q(0x78)
  const stringsAt = q(0x88)
  const events: EmevdEvent[] = []
  for (let e = 0; e < eventCount; e++) {
    const o = eventsAt + e * 0x30
    const count = q(o + 8)
    const first = instrAt + q(o + 16)
    const pCount = q(o + 24)
    const pFirst = paramsAt + q(o + 32)
    const instructions: EmevdInstruction[] = []
    for (let i = 0; i < count; i++) {
      const io = first + i * 0x20
      const len = q(io + 8)
      const at = argsAt + q(io + 16)
      const layerAt = q(io + 24)
      instructions.push({
        bank: b.readUInt32LE(io),
        id: b.readUInt32LE(io + 4),
        args: len > 0 ? Buffer.from(b.subarray(at, at + len)) : Buffer.alloc(0),
        ...(layerAt >= 0 ? { layer: b.readUInt32LE(layersAt + layerAt + 4) } : {}),
      })
    }
    const parameters: EmevdParameter[] = []
    for (let p = 0; p < pCount; p++) {
      const po = pFirst + p * 0x20
      parameters.push({
        instruction: q(po),
        target: q(po + 8),
        source: q(po + 16),
        bytes: b.readUInt32LE(po + 24),
        unknown: b.readUInt32LE(po + 28),
      })
    }
    events.push({ id: q(o), restBehavior: b.readUInt32LE(o + 40), instructions, parameters })
  }
  const linkedFiles: string[] = []
  const linkOffsets: number[] = []
  for (let l = 0; l < linkCount; l++) {
    const rel = q(linksAt + l * 8)
    linkOffsets.push(rel)
    let at = stringsAt + rel
    const start = at
    while (at + 1 < b.length && b.readUInt16LE(at) !== 0) at += 2
    linkedFiles.push(b.toString('utf16le', start, at))
  }
  const stringsLength = q(0x80)
  return {
    events,
    linkedFiles,
    strings: { data: Buffer.from(b.subarray(stringsAt, stringsAt + stringsLength)), linkOffsets },
  }
}

/**
 * Writes an event script as the game's are laid out (see the top of this
 * file). Linked files keep the strings block they were read with; a script
 * made from scratch gets one written for its linked files.
 */
export function writeEmevd(e: Emevd): Buffer {
  const instructions = e.events.flatMap((ev) => ev.instructions)
  const parameters = e.events.flatMap((ev) => ev.parameters)
  const layered = instructions.filter((i) => i.layer !== undefined)
  const pad4 = (n: number) => (n + 3) & ~3
  // Each instruction's arguments padded to 4 bytes, the block to 16.
  const argsLength = (instructions.reduce((n, i) => n + pad4(i.args.length), 0) + 15) & ~15
  let strings = e.strings
  if (!strings || strings.linkOffsets.length !== e.linkedFiles.length) {
    const parts: Buffer[] = []
    const linkOffsets: number[] = []
    let at = 0
    for (const f of e.linkedFiles) {
      linkOffsets.push(at)
      const bytes = Buffer.from(`${f}\0`, 'utf16le')
      parts.push(bytes)
      at += bytes.length
    }
    strings = { data: Buffer.concat(parts), linkOffsets }
  }
  const eventsAt = 0x90
  const instrAt = eventsAt + e.events.length * 0x30
  const layersAt = instrAt + instructions.length * 0x20
  const argsAt = layersAt + layered.length * 0x20
  const paramsAt = argsAt + argsLength
  const linksAt = paramsAt + parameters.length * 0x20
  const stringsAt = linksAt + e.linkedFiles.length * 8
  const size = stringsAt + strings.data.length
  const b = Buffer.alloc(size)
  const q = (o: number, v: number) => b.writeBigInt64LE(BigInt(v), o)
  b.write('EVD\0', 0, 'latin1')
  b.set([0x00, 0xff, 0x01, 0xff], 4)
  b.writeUInt32LE(0xcd, 8)
  b.writeUInt32LE(size, 0x0c)
  q(0x10, e.events.length)
  q(0x18, eventsAt)
  q(0x20, instructions.length)
  q(0x28, instrAt)
  q(0x30, 0)
  q(0x38, layersAt)
  q(0x40, layered.length)
  q(0x48, layersAt)
  q(0x50, parameters.length)
  q(0x58, paramsAt)
  q(0x60, e.linkedFiles.length)
  q(0x68, linksAt)
  q(0x70, argsLength)
  q(0x78, argsAt)
  q(0x80, strings.data.length)
  q(0x88, stringsAt)
  let instr = 0
  let param = 0
  let args = 0
  let layer = 0
  e.events.forEach((ev, k) => {
    const o = eventsAt + k * 0x30
    q(o, ev.id)
    q(o + 8, ev.instructions.length)
    q(o + 16, instr * 0x20)
    q(o + 24, ev.parameters.length)
    q(o + 32, ev.parameters.length ? param * 0x20 : -1)
    b.writeUInt32LE(ev.restBehavior, o + 40)
    for (const ins of ev.instructions) {
      const io = instrAt + instr * 0x20
      b.writeUInt32LE(ins.bank, io)
      b.writeUInt32LE(ins.id, io + 4)
      q(io + 8, ins.args.length)
      // No arguments: no offset (-1), as the game's files have it.
      q(io + 16, ins.args.length ? args : -1)
      ins.args.copy(b, argsAt + args)
      args += pad4(ins.args.length)
      if (ins.layer !== undefined) {
        const lo = layersAt + layer * 0x20
        b.writeUInt32LE(2, lo)
        b.writeUInt32LE(ins.layer, lo + 4)
        q(lo + 8, 0)
        q(lo + 16, -1)
        q(lo + 24, 1)
        q(io + 24, layer * 0x20)
        layer++
      } else q(io + 24, -1)
      instr++
    }
    for (const p of ev.parameters) {
      const po = paramsAt + param * 0x20
      q(po, p.instruction)
      q(po + 8, p.target)
      q(po + 16, p.source)
      b.writeUInt32LE(p.bytes, po + 24)
      b.writeUInt32LE(p.unknown ?? 0, po + 28)
      param++
    }
  })
  strings.linkOffsets.forEach((rel, l) => q(linksAt + l * 8, rel))
  strings.data.copy(b, stringsAt)
  return b
}
