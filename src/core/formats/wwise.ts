/**
 * Wwise sound banks (.bnk) as Elden Ring ships them: Wwise 2019.2, bank
 * version 135, in the sd archives (sd/ and sd/enus/).
 *
 * A bank is a list of sections: BKHD (header: version, bank id), DIDX (the
 * embedded media: u32 id, offset, size each), DATA (the media), HIRC (the
 * objects) and a few others kept as they are (STID bank names, INIT, STMG,
 * ENVS, PLAT). HIRC is a u32 count, then per object u8 type, u32 size, u32
 * id and size - 4 bytes of body.
 *
 * The game posts events by the hash of a name (Play_c213006002, see
 * wwiseHash); an event lists actions (Play, Stop...) whose target is a node
 * of the sound tree: sounds (a .wem, embedded in a bank or streamed from
 * sd/wem/<first two digits>/<id>.wem), random/sequence, switch and layer
 * containers and actor-mixers. Every node names its parent; containers
 * also list their children. Attenuations (distance falloff), effects and
 * buses are referenced by id; buses live in init.bnk, always loaded.
 *
 * Every retail bank stores objects bottom-up (a child before its parent,
 * attenuations first, an event's actions just before it), and sorts DIDX
 * by media id with each file 16-byte aligned in DATA. The layouts below are
 * checked against every object of the game's banks (the wwise suite).
 *
 * Credit: wwiser (bnnm), the reference bank parser, documents the layouts for
 * this Wwise version.
 */

export const HIRC = {
  State: 1,
  Sound: 2,
  Action: 3,
  Event: 4,
  RanSeqCntr: 5,
  SwitchCntr: 6,
  ActorMixer: 7,
  Bus: 8,
  LayerCntr: 9,
  MusicSegment: 10,
  MusicTrack: 11,
  MusicSwitch: 12,
  MusicRanSeq: 13,
  Attenuation: 14,
  DialogueEvent: 15,
  FxShareSet: 16,
  FxCustom: 17,
  AuxBus: 18,
  LFO: 19,
  Envelope: 20,
  AudioDevice: 21,
  TimeMod: 22,
} as const

/** Property ids (AkPropID, v128-145) that hold an object id rather than a value. */
const PROP_ATTENUATION = 0x46
const PROP_ATTACHED_FX = 0x39
/** Action types (high byte; the low byte is the scope). */
const ACTION_PLAY = 0x04

/** The id Wwise gives a name: 32-bit FNV-1 of the lower-case name. */
export function wwiseHash(name: string): number {
  let h = 2166136261
  for (const c of Buffer.from(name.toLowerCase(), 'utf8')) {
    h = Math.imul(h, 16777619) >>> 0
    h = (h ^ c) >>> 0
  }
  return h >>> 0
}

export interface HircObject {
  type: number
  id: number
  /** Everything after the id. */
  body: Buffer
}

export interface WwiseBank {
  version: number
  /** The bank's own id (the hash of its name). */
  id: number
  /** Sections in file order. HIRC, DIDX and DATA are rebuilt from `objects` and `media` when written. */
  sections: { tag: string; data: Buffer }[]
  objects: HircObject[]
  byId: Map<number, HircObject>
  /** Embedded media (.wem) by id. */
  media: Map<number, Buffer>
}

export function readBank(buf: Buffer): WwiseBank {
  const sections: WwiseBank['sections'] = []
  const objects: HircObject[] = []
  const media = new Map<number, Buffer>()
  let didx: Buffer | null = null
  let data: Buffer | null = null
  let at = 0
  while (at + 8 <= buf.length) {
    const tag = buf.toString('latin1', at, at + 4)
    const size = buf.readUInt32LE(at + 4)
    const body = buf.subarray(at + 8, at + 8 + size)
    if (body.length !== size) throw new Error(`Sound bank section ${tag} runs past the end of the file`)
    sections.push({ tag, data: body })
    if (tag === 'DIDX') didx = body
    else if (tag === 'DATA') data = body
    else if (tag === 'HIRC') {
      const count = body.readUInt32LE(0)
      let q = 4
      for (let i = 0; i < count; i++) {
        const type = body[q]
        const len = body.readUInt32LE(q + 1)
        objects.push({ type, id: body.readUInt32LE(q + 5), body: body.subarray(q + 9, q + 5 + len) })
        q += 5 + len
      }
      if (q !== size) throw new Error('Sound bank objects (HIRC) don’t fill their section')
    }
    at += 8 + size
  }
  if (at !== buf.length) throw new Error('Sound bank has trailing data')
  const head = sections[0]
  if (head?.tag !== 'BKHD') throw new Error('Not a Wwise sound bank (no BKHD)')
  if (didx && data) {
    for (let i = 0; i + 12 <= didx.length; i += 12) {
      const off = didx.readUInt32LE(i + 4)
      media.set(didx.readUInt32LE(i), data.subarray(off, off + didx.readUInt32LE(i + 8)))
    }
  }
  return {
    version: head.data.readUInt32LE(0),
    id: head.data.readUInt32LE(4),
    sections,
    objects,
    byId: new Map(objects.map((o) => [o.id, o])),
    media,
  }
}

/**
 * Writes a bank. The header is padded (as Wwise does) so that the media in
 * DATA start at a multiple of the bank's alignment (16) from the file's start.
 */
export function writeBank(bank: WwiseBank): Buffer {
  const ids = [...bank.media.keys()].sort((a, b) => a - b)
  const didx = Buffer.alloc(ids.length * 12)
  const chunks: Buffer[] = []
  let off = 0
  ids.forEach((id, i) => {
    const m = bank.media.get(id)!
    const pad = (16 - (off % 16)) % 16
    if (pad) chunks.push(Buffer.alloc(pad))
    off += pad
    didx.writeUInt32LE(id, i * 12)
    didx.writeUInt32LE(off, i * 12 + 4)
    didx.writeUInt32LE(m.length, i * 12 + 8)
    chunks.push(m)
    off += m.length
  })
  const hircHead = Buffer.alloc(4)
  hircHead.writeUInt32LE(bank.objects.length)
  const hirc: Buffer[] = [hircHead]
  for (const o of bank.objects) {
    const h = Buffer.alloc(9)
    h[0] = o.type
    h.writeUInt32LE(o.body.length + 4, 1)
    h.writeUInt32LE(o.id, 5)
    hirc.push(h, o.body)
  }
  const tags = bank.sections.map((s) => s.tag)
  const sections = bank.sections.slice()
  // A bank that gains its first embedded media gets DIDX and DATA after its header.
  if (ids.length && !tags.includes('DIDX'))
    sections.splice(1, 0, { tag: 'DIDX', data: Buffer.alloc(0) }, { tag: 'DATA', data: Buffer.alloc(0) })
  if (bank.objects.length && !tags.includes('HIRC'))
    sections.splice(sections.findIndex((s) => s.tag === 'DATA') + 1 || 1, 0, { tag: 'HIRC', data: Buffer.alloc(0) })
  const body = (s: { tag: string; data: Buffer }) =>
    s.tag === 'DIDX' ? didx : s.tag === 'DATA' ? Buffer.concat(chunks) : s.tag === 'HIRC' ? Buffer.concat(hirc) : s.data
  const datas = sections.map(body)
  const dataAt = sections.findIndex((s) => s.tag === 'DATA')
  if (dataAt > 0 && sections[0].tag === 'BKHD') {
    // Header: 20 bytes of fields (version, bank, language, alignment, project), then zeros.
    const head = datas[0]
    const align = head.length >= 14 ? head.readUInt16LE(12) || 16 : 16
    let before = 8 + 20
    for (let i = 1; i < dataAt; i++) before += 8 + datas[i].length
    before += 8
    const pad = (align - (before % align)) % align
    datas[0] = Buffer.concat([head.subarray(0, 20), Buffer.alloc(pad)])
  }
  const out: Buffer[] = []
  sections.forEach((s, i) => {
    const h = Buffer.alloc(8)
    h.write(s.tag, 0, 'latin1')
    h.writeUInt32LE(datas[i].length, 4)
    out.push(h, datas[i])
  })
  return Buffer.concat(out)
}

/* --------------------------------- objects -------------------------------- */

class Reader {
  at = 0
  readonly b: Buffer
  constructor(b: Buffer) {
    this.b = b
  }
  u8(): number {
    return this.b[this.at++]
  }
  u16(): number {
    const v = this.b.readUInt16LE(this.at)
    this.at += 2
    return v
  }
  u32(): number {
    const v = this.b.readUInt32LE(this.at)
    this.at += 4
    return v
  }
  /** Wwise's variable-length integer: 7 bits a byte, high bit set while more follow. */
  var(): number {
    let cur = this.u8()
    let v = cur & 0x7f
    for (let n = 0; cur & 0x80 && n < 5; n++) {
      cur = this.u8()
      v = (v << 7) | (cur & 0x7f)
    }
    return v >>> 0
  }
  skip(n: number): void {
    this.at += n
  }
}

/** What a sound-tree node (sound, container, actor-mixer) says about itself and what it uses. */
export interface WwiseNode {
  parent: number
  /** Output bus, when the node sets its own (0: its parent's). */
  bus: number
  /** Properties (AkPropID -> raw 32-bit value). */
  props: Map<number, number>
  /** Effects, attenuations, modulators and aux buses it refers to. */
  refs: number[]
  /** Containers' children, in their list order. */
  children: number[]
  /** Sounds: the media they play. */
  source?: { plugin: number; stream: number; media: number; size: number }
  /** Random/sequence containers: what they play from (children, with weights), and whether in turn (sequence) or at random. */
  playlist?: { id: number; weight: number }[]
  sequence?: boolean
  /** Switch containers: the switch played when none is set, and the children each switch plays. */
  switches?: { fallback: number; packages: { id: number; nodes: number[] }[] }
  /** Where reading stopped (the body's length for a complete read). */
  end: number
}

/** A source plugin (generator) carries its parameters; codecs don't. */
const isSourcePlugin = (plugin: number) => (plugin & 0x0f) === 2

function readPropBundles(r: Reader, props: Map<number, number>): void {
  const n = r.u8()
  const ids: number[] = []
  for (let i = 0; i < n; i++) ids.push(r.u8())
  for (const id of ids) props.set(id, r.u32())
  const ranged = r.u8()
  r.skip(ranged + ranged * 8)
}

function readRtpcs(r: Reader, refs: number[]): void {
  const n = r.u16()
  for (let i = 0; i < n; i++) {
    const id = r.u32()
    const type = r.u8()
    r.u8() // accumulation
    r.var() // parameter
    r.u32() // curve id
    r.u8() // scaling
    const points = r.u16()
    r.skip(points * 12)
    if (type === 2) refs.push(id) // a modulator (LFO, envelope, time): an object
  }
}

/** States the node reacts to; each state's values are an object of their own (a State). */
function readStateChunk(r: Reader, refs: number[]): void {
  const props = r.var()
  for (let i = 0; i < props; i++) {
    r.var()
    r.skip(2)
  }
  const groups = r.var()
  for (let i = 0; i < groups; i++) {
    r.skip(5)
    const states = r.var()
    for (let k = 0; k < states; k++) {
      r.u32() // the state
      refs.push(r.u32()) // its values
    }
  }
}

/** NodeBaseParams (v135): effects, bus and parent, properties, positioning, aux, limits, states, RTPCs. */
function readNodeBase(r: Reader, node: WwiseNode): void {
  r.u8() // overrides the parent's effects
  const fx = r.u8()
  if (fx) {
    r.u8() // bypass bits
    for (let i = 0; i < fx; i++) {
      r.u8() // slot
      node.refs.push(r.u32())
      r.skip(2) // shareset, rendered
    }
  }
  r.u8() // overrides attachment params
  node.bus = r.u32()
  node.parent = r.u32()
  r.u8() // priority bits
  readPropBundles(r, node.props)
  for (const p of [PROP_ATTENUATION, PROP_ATTACHED_FX]) {
    const v = node.props.get(p)
    if (v) node.refs.push(v)
  }
  // Positioning: 3D settings and automation paths when it overrides its parent's.
  const bits = r.u8()
  if (bits & 1 && bits & 2) {
    r.u8()
    if ((bits >> 5) & 3) {
      r.skip(5) // path mode, transition time
      const vertices = r.u32()
      r.skip(vertices * 16)
      const items = r.u32()
      r.skip(items * 8 + items * 12)
    }
  }
  // Aux sends.
  const aux = r.u8()
  if (aux & 8) for (let i = 0; i < 4; i++) node.refs.push(r.u32())
  node.refs.push(r.u32()) // reflections aux bus
  r.skip(6) // advanced settings: voice limits, virtual voices, HDR
  readStateChunk(r, node.refs)
  readRtpcs(r, node.refs)
}

function readChildren(r: Reader, node: WwiseNode): void {
  const n = r.u32()
  for (let i = 0; i < n; i++) node.children.push(r.u32())
}

/** A sound-tree node's parent, children and references; null for other object types. */
export function readNode(o: HircObject): WwiseNode | null {
  const node: WwiseNode = { parent: 0, bus: 0, props: new Map(), refs: [], children: [], end: 0 }
  const r = new Reader(o.body)
  switch (o.type) {
    case HIRC.Sound: {
      const plugin = r.u32()
      const stream = r.u8()
      const media = r.u32()
      const size = r.u32()
      r.u8() // source bits
      if (isSourcePlugin(plugin)) r.skip(r.u32())
      node.source = { plugin, stream, media, size }
      readNodeBase(r, node)
      break
    }
    case HIRC.RanSeqCntr: {
      readNodeBase(r, node)
      r.skip(6 + 12 + 2 + 2) // loop counts, transition times, avoid repeats, transition and random modes
      node.sequence = r.u8() === 1 // 0 random, 1 sequence
      r.u8() // flags
      readChildren(r, node)
      const items = r.u16()
      node.playlist = []
      for (let i = 0; i < items; i++) node.playlist.push({ id: r.u32(), weight: r.u32() | 0 })
      break
    }
    case HIRC.SwitchCntr: {
      readNodeBase(r, node)
      r.skip(1 + 4) // group type, group
      const fallback = r.u32()
      r.u8() // continuous validation
      readChildren(r, node)
      const count = r.u32()
      const packages: { id: number; nodes: number[] }[] = []
      for (let i = 0; i < count; i++) {
        const id = r.u32()
        const nodes: number[] = []
        for (let k = r.u32(); k > 0; k--) nodes.push(r.u32())
        packages.push({ id, nodes })
      }
      node.switches = { fallback, packages }
      r.skip(r.u32() * 14) // per-child switch params
      break
    }
    case HIRC.ActorMixer:
      readNodeBase(r, node)
      readChildren(r, node)
      break
    case HIRC.LayerCntr: {
      readNodeBase(r, node)
      readChildren(r, node)
      const layers = r.u32()
      for (let i = 0; i < layers; i++) {
        r.u32() // layer id
        readRtpcs(r, node.refs)
        const rtpc = r.u32()
        if (r.u8() === 2) node.refs.push(rtpc)
        const assoc = r.u32()
        for (let k = 0; k < assoc; k++) {
          r.u32() // child
          r.skip(r.u32() * 12)
        }
      }
      r.u8() // continuous validation
      break
    }
    default:
      return null
  }
  node.end = r.at
  node.refs = node.refs.filter((x) => x !== 0)
  return node
}

/** An event's actions. */
export function readEvent(o: HircObject): number[] {
  const r = new Reader(o.body)
  const n = r.var()
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r.u32())
  return out
}

/** An action's kind (e.g. 0x0403 Play), the object (or bus) it acts on, and for Play the bank it names. */
export function readAction(o: HircObject): { kind: number; target: number; isBus: boolean; play: boolean } {
  const kind = o.body.readUInt16LE(0)
  return { kind, target: o.body.readUInt32LE(2), isBus: (o.body[6] & 1) === 1, play: kind >> 8 === ACTION_PLAY }
}

/** Objects other than nodes that refer to more objects: attenuations (modulators) and effects (media, modulators). */
export function readOther(o: HircObject): { refs: number[]; media: number[]; end: number } | null {
  const r = new Reader(o.body)
  const refs: number[] = []
  const media: number[] = []
  if (o.type === HIRC.Attenuation) {
    if (r.u8() & 1) r.skip(20) // cone
    r.skip(7) // which curve each property uses
    const curves = r.u8()
    for (let i = 0; i < curves; i++) {
      r.u8()
      r.skip(r.u16() * 12)
    }
    readRtpcs(r, refs)
  } else if (o.type === HIRC.FxCustom || o.type === HIRC.FxShareSet) {
    if (r.u32()) r.skip(r.u32()) // plugin and its parameters
    const n = r.u8()
    for (let i = 0; i < n; i++) {
      r.u8()
      media.push(r.u32())
    }
    readRtpcs(r, refs)
    readStateChunk(r, refs)
    const values = r.u16()
    for (let i = 0; i < values; i++) {
      r.var()
      r.skip(5)
    }
  } else return null
  return { refs: refs.filter((x) => x !== 0), media, end: r.at }
}

/* ------------------------------ copying events ----------------------------- */

export interface CopyReport {
  /** Events copied, and events that were already in the destination. */
  copied: number[]
  present: number[]
  /** Events the source doesn't have. */
  missing: number[]
  /** Objects and embedded media added to the destination, and their size in bytes. */
  objects: number
  media: number
  mediaBytes: number
  /** Media played from loose .wem files (sd/wem/...), which every install has. */
  streamed: number[]
}

/**
 * Everything the given events need to play, from one bank: the events, their
 * actions, the nodes their actions start and everything under those, the
 * nodes' ancestors (for their bus, volume and positioning), attenuations,
 * effects and modulators, and the embedded media of every sound.
 */
export function eventClosure(
  bank: WwiseBank,
  events: number[],
): { objects: Set<number>; media: Set<number>; streamed: Set<number> } {
  const objects = new Set<number>()
  const media = new Set<number>()
  const streamed = new Set<number>()
  // Children by parent: containers list theirs, but a node always names its parent.
  const kids = new Map<number, number[]>()
  const nodes = new Map<number, WwiseNode>()
  for (const o of bank.objects) {
    const n = readNode(o)
    if (!n) continue
    nodes.set(o.id, n)
    const l = kids.get(n.parent) ?? []
    l.push(o.id)
    kids.set(n.parent, l)
  }
  const side = (id: number) => {
    // Attenuations, effects, modulators: copied as they are (with their own references).
    if (objects.has(id) || !bank.byId.has(id)) return
    const o = bank.byId.get(id)!
    if (o.type === HIRC.Bus || o.type === HIRC.AuxBus || o.type === HIRC.AudioDevice) return
    objects.add(id)
    const x = readOther(o)
    if (!x) return
    for (const m of x.media) if (bank.media.has(m)) media.add(m)
    x.refs.forEach(side)
  }
  const nodeRefs = (id: number) => {
    const n = nodes.get(id)!
    n.refs.forEach(side)
    if (n.source) {
      if (n.source.stream !== 2 && bank.media.has(n.source.media)) media.add(n.source.media)
      if (n.source.stream !== 0) streamed.add(n.source.media)
    }
  }
  const up = (id: number) => {
    for (
      let p = nodes.get(id)?.parent ?? 0, n = 0;
      p && nodes.has(p) && !objects.has(p) && n < 64;
      p = nodes.get(p)!.parent, n++
    ) {
      objects.add(p)
      nodeRefs(p)
    }
  }
  const down = (id: number) => {
    if (objects.has(id) || !nodes.has(id)) return
    objects.add(id)
    nodeRefs(id)
    for (const c of new Set([...nodes.get(id)!.children, ...(kids.get(id) ?? [])])) down(c)
    up(id)
  }
  // Events, and the events their actions post in turn.
  const queue = [...events]
  while (queue.length) {
    const e = queue.shift()!
    const ev = bank.byId.get(e)
    if (!ev || ev.type !== HIRC.Event || objects.has(e)) continue
    objects.add(e)
    for (const a of readEvent(ev)) {
      const act = bank.byId.get(a)
      if (!act || act.type !== HIRC.Action) continue
      objects.add(a)
      const { target, isBus } = readAction(act)
      if (isBus || !target) continue
      const t = bank.byId.get(target)
      if (!t) continue
      if (nodes.has(target)) down(target)
      else if (t.type === HIRC.Event) queue.push(target)
      else side(target)
    }
  }
  return { objects, media, streamed }
}

/* ------------------------------ playing events ----------------------------- */

/** Properties (AkPropID, v128-145) a voice's loudness and pitch add up from. */
const PROP_VOLUME = 0x00
const PROP_PITCH = 0x02
const PROP_MAKEUP_GAIN = 0x06

/** One sound an event plays. */
export interface WwiseVoice {
  /** The Sound object, and the media it plays. */
  sound: number
  media: number
  /** 0: in the bank; 1: its start in the bank, the whole streamed (sd/wem/...); 2: streamed only. */
  stream: number
  /** dB and cents, the sound's own plus every node's above it (actor-mixers included; buses left out). */
  volume: number
  pitch: number
}

const nodeCache = new WeakMap<WwiseBank, Map<number, WwiseNode | null>>()
function nodeIn(bank: WwiseBank, id: number): WwiseNode | null {
  let m = nodeCache.get(bank)
  if (!m) nodeCache.set(bank, (m = new Map()))
  if (!m.has(id)) {
    const o = bank.byId.get(id)
    let n: WwiseNode | null
    try {
      n = o ? readNode(o) : null
    } catch {
      n = null
    }
    m.set(id, n)
  }
  return m.get(id)!
}

const f32 = new DataView(new ArrayBuffer(4))
const asFloat = (raw: number | undefined) => {
  if (raw === undefined) return 0
  f32.setUint32(0, raw >>> 0, true)
  const v = f32.getFloat32(0, true)
  return Number.isFinite(v) ? v : 0
}

/**
 * What an event plays: the choices the game picks between (a random
 * container's children, by weight; a sequence's in turn), each a list of
 * sounds that play together (a layer container's layers, an event's several
 * Play actions). A switch container plays its default switch's children (or
 * its first switch's, when it has no default): the floor or armour the game
 * would pick isn't known here. Generators (silence, tones) and actions other
 * than Play are left out; delays and random ranges of pitch and volume too.
 */
export function eventVoices(
  bank: WwiseBank,
  event: number,
  maxChoices = 16,
): { choices: WwiseVoice[][]; weights: number[] } {
  const level = (id: number) => {
    let volume = 0
    let pitch = 0
    for (let p = id, n = 0; p && n < 64; n++) {
      const node = nodeIn(bank, p)
      if (!node) break
      volume += asFloat(node.props.get(PROP_VOLUME)) + asFloat(node.props.get(PROP_MAKEUP_GAIN))
      pitch += asFloat(node.props.get(PROP_PITCH))
      p = node.parent
    }
    return { volume, pitch }
  }
  // Every way of playing a node: choices (with weights) of voices that sound together.
  type Ways = { choices: WwiseVoice[][]; weights: number[] }
  const none: Ways = { choices: [], weights: [] }
  const together = (parts: Ways[]): Ways => {
    const live = parts.filter((p) => p.choices.length)
    if (!live.length) return none
    const n = Math.min(maxChoices, Math.max(...live.map((p) => p.choices.length)))
    const choices: WwiseVoice[][] = []
    const weights: number[] = []
    for (let i = 0; i < n; i++) {
      choices.push(live.flatMap((p) => p.choices[i % p.choices.length]))
      weights.push(live.reduce((w, p) => Math.max(w, p.weights[i % p.weights.length] ?? 1), 0) || 1)
    }
    return { choices, weights }
  }
  const either = (parts: { ways: Ways; weight: number }[]): Ways => {
    const out: Ways = { choices: [], weights: [] }
    for (const p of parts) {
      const share = p.weight / Math.max(1, p.ways.choices.length)
      for (const c of p.ways.choices) {
        if (out.choices.length >= maxChoices) break
        out.choices.push(c)
        out.weights.push(share > 0 ? share : 1)
      }
    }
    return out
  }
  const seen = new Set<number>()
  const ways = (id: number, depth: number): Ways => {
    const o = bank.byId.get(id)
    const node = nodeIn(bank, id)
    if (!o || !node || depth > 32 || seen.has(id)) return none
    seen.add(id)
    try {
      switch (o.type) {
        case HIRC.Sound: {
          const s = node.source
          if (!s || isSourcePlugin(s.plugin) || !s.media) return none
          const { volume, pitch } = level(id)
          return { choices: [[{ sound: id, media: s.media, stream: s.stream, volume, pitch }]], weights: [1] }
        }
        case HIRC.RanSeqCntr: {
          const list = node.playlist?.length ? node.playlist : node.children.map((c) => ({ id: c, weight: 50000 }))
          return either(
            list.map((x) => ({ ways: ways(x.id, depth + 1), weight: node.sequence ? 1 : Math.max(1, x.weight) })),
          )
        }
        case HIRC.SwitchCntr: {
          const sw = node.switches
          const pkg =
            sw?.packages.find((p) => p.id === sw.fallback && p.nodes.length) ?? sw?.packages.find((p) => p.nodes.length)
          const kids = pkg ? pkg.nodes : node.children.slice(0, 1)
          return together(kids.map((k) => ways(k, depth + 1)))
        }
        case HIRC.LayerCntr:
          return together(node.children.map((k) => ways(k, depth + 1)))
        default:
          return none
      }
    } finally {
      seen.delete(id)
    }
  }
  const played = (ev: number, depth: number): Ways => {
    const o = bank.byId.get(ev)
    if (!o || o.type !== HIRC.Event || depth > 4) return none
    const parts: Ways[] = []
    for (const a of readEvent(o)) {
      const act = bank.byId.get(a)
      if (!act || act.type !== HIRC.Action) continue
      const { target, isBus, play } = readAction(act)
      if (!play || isBus || !target) continue
      const t = bank.byId.get(target)
      parts.push(t?.type === HIRC.Event ? played(target, depth + 1) : ways(target, 0))
    }
    return together(parts)
  }
  return played(event, 0)
}

/**
 * An actor-mixer's body with another children list (it ends with the list:
 * u32 count, then the ids). Null when the body doesn't end that way.
 */
function withChildren(o: HircObject, n: WwiseNode, children: number[]): Buffer | null {
  const at = n.end - 4 - 4 * n.children.length
  if (o.type !== HIRC.ActorMixer || at < 0 || o.body.readUInt32LE(at) !== n.children.length) return null
  const list = Buffer.alloc(4 + 4 * children.length)
  list.writeUInt32LE(children.length, 0)
  children.forEach((c, i) => list.writeUInt32LE(c, 4 + 4 * i))
  return Buffer.concat([o.body.subarray(0, at), list, o.body.subarray(n.end)])
}

/**
 * Copies events, and everything they play, from one bank into another (the
 * player's main bank, say), the way a bank of the game's own holds them:
 *   - objects the destination already has are left as they are (Wwise shares
 *     an id between banks, so a copy of the same object is the same object);
 *     new ones keep their ids;
 *   - a copied branch that hangs under a node the destination has goes just
 *     before that node, which lists it (an actor-mixer; children lists stay
 *     sorted by id, as in every game bank): no orphans;
 *   - a copied actor-mixer lists only the children the bank has (the game's
 *     banks never list a missing one);
 *   - a copied Play action names this bank (it named the source's);
 *   - attenuations, effects and branches with no parent here go first, events
 *     with their actions at the end (an event's actions before it).
 * Embedded media come along into DIDX/DATA. Breaking these rules (new
 * nodes before their parents, parents left unchanged, Play actions naming the
 * source bank) makes the game drop the whole player bank: menu and player
 * sounds go silent.
 *
 * Credit: er_soundbank_helper (ndahn): the community's working method for
 * copying sounds between banks, which this placement follows.
 */
export function copyEvents(src: WwiseBank, dst: WwiseBank, events: number[]): CopyReport {
  const report: CopyReport = { copied: [], present: [], missing: [], objects: 0, media: 0, mediaBytes: 0, streamed: [] }
  const wanted: number[] = []
  for (const e of events) {
    if (dst.byId.get(e)?.type === HIRC.Event) report.present.push(e)
    else if (src.byId.get(e)?.type === HIRC.Event) wanted.push(e)
    else report.missing.push(e)
  }
  if (!wanted.length) return report
  const { objects, media, streamed } = eventClosure(src, wanted)
  const copies: HircObject[] = src.objects
    .filter((o) => objects.has(o.id) && !dst.byId.has(o.id))
    .map((o) => ({ type: o.type, id: o.id, body: Buffer.from(o.body) }))
  const copied = new Map(copies.map((c) => [c.id, c]))
  const nodes = new Map<number, WwiseNode>()
  for (const c of copies) {
    const n = readNode(c)
    if (n) nodes.set(c.id, n)
  }
  // Actor-mixers list only children the bank has.
  for (const c of copies) {
    const n = nodes.get(c.id)
    if (c.type !== HIRC.ActorMixer || !n) continue
    const keep = n.children.filter((x) => copied.has(x) || dst.byId.has(x))
    if (keep.length === n.children.length) continue
    const body = withChildren(c, n, keep)
    if (body) {
      c.body = body
      nodes.set(c.id, readNode(c)!)
    }
  }
  // Play actions name the bank holding what they play: this one now.
  for (const c of copies)
    if (c.type === HIRC.Action && readAction(c).play && c.body.length >= 11)
      c.body.writeUInt32LE(dst.id, c.body.length - 4)
  // Where each new node goes: before the node of this bank its branch hangs under, else first.
  const anchorOf = (id: number): number => {
    let p = nodes.get(id)?.parent ?? 0
    for (let k = 0; p && copied.has(p) && k < 64; k++) p = nodes.get(p)?.parent ?? 0
    return p && dst.byId.has(p) ? p : 0
  }
  const front: HircObject[] = []
  const back: HircObject[] = []
  const before = new Map<number, HircObject[]>()
  for (const c of copies) {
    if (c.type === HIRC.Event || c.type === HIRC.Action) back.push(c)
    else {
      const a = nodes.has(c.id) ? anchorOf(c.id) : 0
      if (a) (before.get(a) ?? before.set(a, []).get(a)!).push(c)
      else front.push(c)
    }
  }
  // Those nodes list the branches now under them.
  const relisted = new Map<number, HircObject>()
  for (const c of copies) {
    const parent = nodes.get(c.id)?.parent ?? 0
    if (!parent || copied.has(parent)) continue
    const p = relisted.get(parent) ?? dst.byId.get(parent)
    if (!p || p.type !== HIRC.ActorMixer) continue
    const pn = readNode(p)!
    if (pn.children.includes(c.id)) continue
    const body = withChildren(
      p,
      pn,
      [...pn.children, c.id].sort((x, y) => x - y),
    )
    if (body) relisted.set(parent, { type: p.type, id: p.id, body })
  }
  const out: HircObject[] = [...front]
  for (const o of dst.objects) {
    out.push(...(before.get(o.id) ?? []), relisted.get(o.id) ?? o)
  }
  out.push(...back)
  dst.objects = out
  for (const o of [...copies, ...relisted.values()]) dst.byId.set(o.id, o)
  for (const m of media) {
    if (dst.media.has(m)) continue
    const data = Buffer.from(src.media.get(m)!)
    dst.media.set(m, data)
    report.media++
    report.mediaBytes += data.length
  }
  report.copied = wanted
  report.objects = copies.length
  report.streamed = [...streamed]
  // Nodes of dst read before (parents now listing new children) are stale.
  nodeCache.delete(dst)
  return report
}

/**
 * Whether a bank of the project's has a Play action naming another character's
 * bank, which the game's own copy of the bank never does (and which makes the
 * game drop the bank: see copyEvents). Such a bank is built again.
 */
export function namesOtherBanks(bank: WwiseBank, gameBank: WwiseBank): boolean {
  const named = (b: WwiseBank) => {
    const out = new Set<number>()
    for (const o of b.objects)
      if (o.type === HIRC.Action && readAction(o).play && o.body.length >= 11)
        out.add(o.body.readUInt32LE(o.body.length - 4))
    return out
  }
  const game = named(gameBank)
  return [...named(bank)].some((id) => id !== bank.id && !game.has(id))
}
