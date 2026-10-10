/**
 * Event script instructions in Spellforge's own words: what each one does
 * and where its arguments sit, for the instructions worked out from the
 * game's own scripts (formats/emevd.ts), and builders for the ones recipes
 * write.
 *
 * Worked out from the game's data, matched against events whose purpose is
 * known (the wiki's walk-throughs of Soldier of Godrick's fight, the Godskin
 * Duo and Stormveil's eagles name what they do, not the bytes): the bytes
 * of every instruction below were read in those events, and the events
 * suite checks the builders against the game's own instances. No
 * instruction list of another tool is used or shipped.
 *
 * Conditions (banks 0 to 4) go into a group, their first byte: 0 is the
 * event itself (it waits there until the condition holds), 1 to 7 are
 * groups that pass when all their conditions do, -1 to -7 when any does;
 * 0[0] then waits for (or tests) a whole group. Labels (1014[n]) are what
 * the "go to" instructions jump to. A flag argument comes with a type byte:
 * 0 an event flag, 1 an event (its slot's end), 2 this event's own slot.
 *
 * Instructions not listed here show as their numbers and words: Spellforge
 * keeps them as they are.
 */
import type { EmevdInstruction } from '../formats/emevd.ts'

export type ArgType = 'u8' | 's8' | 'u16' | 's16' | 'u32' | 's32' | 'f32'

/** What an argument names, for links and pickers. */
export type ArgKind =
  | 'flag'
  | 'entity'
  | 'area'
  | 'itemLot'
  | 'speffect'
  | 'event'
  | 'text'
  | 'sound'
  | 'group'
  | 'label'
  | 'number'
  | 'seconds'
  | 'state'

export interface ArgDef {
  name: string
  at: number
  type: ArgType
  kind: ArgKind
}

export interface InstructionDef {
  bank: number
  id: number
  /** Short name, in Spellforge's words. */
  name: string
  args: ArgDef[]
  /** Arguments after the fixed ones: a list of words (the arguments an event is started with). */
  rest?: { at: number }
  /** The line as it reads, from its arguments. */
  line: (a: Record<string, number>, rest: number[]) => string
}

/** A reference an instruction makes, for links. */
export interface InstructionRef {
  kind: ArgKind
  value: number
}

const SIZE: Record<ArgType, number> = { u8: 1, s8: 1, u16: 2, s16: 2, u32: 4, s32: 4, f32: 4 }

const on = (v: number) => (v ? 'on' : 'off')
const num = (v: number) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000))

/** A condition group as a reader sees it: the event itself, all of group n, any of group n. */
export function groupName(g: number): string {
  return g === 0 ? 'the event' : g > 0 ? `group A${g}` : `group O${-g}`
}

/** A flag-like argument with its type byte. */
function flagRef(type: number, flag: number): string {
  return type === 0 ? `flag ${flag}` : type === 1 ? `event ${flag}’s end` : 'this event’s end'
}

/** A condition: "Wait until …" in the event itself, else "In group …: …". */
function condition(group: number, text: string): string {
  return group === 0 ? `Wait until ${text}` : `In ${groupName(group)}: ${text}`
}

const BANNERS: Record<number, string> = {
  15: 'Legend felled',
  16: 'Demigod felled',
  17: 'Great enemy felled',
  18: 'Enemy felled',
}

/** The banners the game shows when a boss falls (2003[12]), as the game's bosses use them. */
export const BOSS_BANNERS = BANNERS

const G: ArgDef = { name: 'group', at: 0, type: 's8', kind: 'group' }

export const INSTRUCTIONS: InstructionDef[] = [
  // Conditions.
  {
    bank: 0,
    id: 0,
    name: 'Group passes',
    args: [G, { name: 'state', at: 1, type: 'u8', kind: 'state' }, { name: 'of', at: 2, type: 's8', kind: 'group' }],
    line: (a) => condition(a.group, `${groupName(a.of)} ${a.state ? 'passes' : 'fails'}`),
  },
  {
    bank: 3,
    id: 0,
    name: 'Flag is',
    args: [
      G,
      { name: 'state', at: 1, type: 'u8', kind: 'state' },
      { name: 'type', at: 2, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
    ],
    line: (a) => condition(a.group, `${flagRef(a.type, a.flag)} is ${on(a.state)}`),
  },
  {
    bank: 3,
    id: 2,
    name: 'In area',
    args: [
      G,
      { name: 'inside', at: 1, type: 'u8', kind: 'state' },
      { name: 'entity', at: 4, type: 'u32', kind: 'entity' },
      { name: 'area', at: 8, type: 'u32', kind: 'area' },
      { name: 'count', at: 12, type: 's32', kind: 'number' },
    ],
    line: (a) => condition(a.group, `${a.entity} is ${a.inside ? 'inside' : 'outside'} area ${a.area}`),
  },
  {
    bank: 4,
    id: 0,
    name: 'Dead or alive',
    args: [
      G,
      { name: 'entity', at: 4, type: 'u32', kind: 'entity' },
      { name: 'dead', at: 8, type: 'u8', kind: 'state' },
    ],
    line: (a) => condition(a.group, `${a.entity} is ${a.dead ? 'dead' : 'alive'}`),
  },
  {
    bank: 4,
    id: 5,
    name: 'Has SpEffect',
    args: [
      G,
      { name: 'entity', at: 4, type: 'u32', kind: 'entity' },
      { name: 'speffect', at: 8, type: 'u32', kind: 'speffect' },
      { name: 'has', at: 12, type: 'u8', kind: 'state' },
    ],
    line: (a) => condition(a.group, `${a.entity} ${a.has ? 'has' : 'doesn’t have'} SpEffect ${a.speffect}`),
  },
  // Control.
  {
    bank: 1000,
    id: 4,
    name: 'End',
    args: [{ name: 'restart', at: 0, type: 'u8', kind: 'state' }],
    line: (a) => (a.restart ? 'Start the event again' : 'End the event'),
  },
  {
    bank: 1001,
    id: 0,
    name: 'Wait',
    args: [{ name: 'seconds', at: 0, type: 'f32', kind: 'seconds' }],
    line: (a) => `Wait ${num(a.seconds)} s`,
  },
  {
    bank: 1003,
    id: 0,
    name: 'Wait for flag',
    args: [
      { name: 'state', at: 0, type: 'u8', kind: 'state' },
      { name: 'type', at: 1, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
    ],
    line: (a) => `Wait until ${flagRef(a.type, a.flag)} is ${on(a.state)}`,
  },
  {
    bank: 1003,
    id: 1,
    name: 'Skip if flag',
    args: [
      { name: 'lines', at: 0, type: 'u8', kind: 'number' },
      { name: 'state', at: 1, type: 'u8', kind: 'state' },
      { name: 'type', at: 2, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
    ],
    line: (a) => `Skip ${a.lines} line${a.lines === 1 ? '' : 's'} if ${flagRef(a.type, a.flag)} is ${on(a.state)}`,
  },
  {
    bank: 1003,
    id: 2,
    name: 'End if flag',
    args: [
      { name: 'restart', at: 0, type: 'u8', kind: 'state' },
      { name: 'state', at: 1, type: 'u8', kind: 'state' },
      { name: 'type', at: 2, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
    ],
    line: (a) => `${a.restart ? 'Start again' : 'End'} if ${flagRef(a.type, a.flag)} is ${on(a.state)}`,
  },
  {
    bank: 1003,
    id: 101,
    name: 'Go to if flag',
    args: [
      { name: 'label', at: 0, type: 'u8', kind: 'label' },
      { name: 'state', at: 1, type: 'u8', kind: 'state' },
      { name: 'type', at: 2, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
    ],
    line: (a) => `Go to label ${a.label} if ${flagRef(a.type, a.flag)} is ${on(a.state)}`,
  },
  // Actions.
  {
    bank: 2000,
    id: 0,
    name: 'Start event',
    args: [
      { name: 'slot', at: 0, type: 's32', kind: 'number' },
      { name: 'event', at: 4, type: 'u32', kind: 'event' },
    ],
    rest: { at: 8 },
    line: (a, rest) =>
      `Start event ${a.event}${a.slot ? ` (slot ${a.slot})` : ''}${rest.some((v) => v !== 0) ? ` with ${rest.join(', ')}` : ''}`,
  },
  {
    bank: 2000,
    id: 6,
    name: 'Start shared event',
    args: [
      { name: 'slot', at: 0, type: 's32', kind: 'number' },
      { name: 'event', at: 4, type: 'u32', kind: 'event' },
    ],
    rest: { at: 8 },
    line: (a, rest) => `Start shared event ${a.event}${rest.length ? ` with ${rest.join(', ')}` : ''}`,
  },
  {
    bank: 2003,
    id: 4,
    name: 'Give item lot',
    args: [{ name: 'lot', at: 0, type: 'u32', kind: 'itemLot' }],
    line: (a) => `Give item lot ${a.lot}`,
  },
  {
    bank: 2003,
    id: 11,
    name: 'Boss health bar',
    args: [
      { name: 'show', at: 0, type: 'u8', kind: 'state' },
      { name: 'entity', at: 4, type: 'u32', kind: 'entity' },
      { name: 'slot', at: 8, type: 's16', kind: 'number' },
      { name: 'name', at: 12, type: 'u32', kind: 'text' },
    ],
    line: (a) => `Boss health bar ${on(a.show)}: ${a.entity}, named by text ${a.name}`,
  },
  {
    bank: 2003,
    id: 12,
    name: 'Boss defeated',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'banner', at: 4, type: 'u32', kind: 'number' },
    ],
    line: (a) => `Boss ${a.entity} defeated: “${BANNERS[a.banner] ?? `banner ${a.banner}`}”`,
  },
  {
    bank: 2003,
    id: 66,
    name: 'Set flag',
    args: [
      { name: 'type', at: 0, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
      { name: 'state', at: 8, type: 'u8', kind: 'state' },
    ],
    line: (a) => `Set ${flagRef(a.type, a.flag)} ${on(a.state)}`,
  },
  {
    bank: 2003,
    id: 69,
    name: 'Set flag for everyone',
    args: [
      { name: 'type', at: 0, type: 'u8', kind: 'number' },
      { name: 'flag', at: 4, type: 'u32', kind: 'flag' },
      { name: 'state', at: 8, type: 'u8', kind: 'state' },
    ],
    line: (a) => `Set ${flagRef(a.type, a.flag)} ${on(a.state)}, for every player in the world`,
  },
  {
    bank: 2004,
    id: 1,
    name: 'AI',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'state', at: 4, type: 'u8', kind: 'state' },
    ],
    line: (a) => `${a.entity}: AI ${on(a.state)}`,
  },
  {
    bank: 2004,
    id: 4,
    name: 'Kill',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'runes', at: 4, type: 'u8', kind: 'state' },
    ],
    line: (a) => `Kill ${a.entity}${a.runes ? ', giving its runes' : ', no runes'}`,
  },
  {
    bank: 2004,
    id: 5,
    name: 'Show',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'state', at: 4, type: 'u8', kind: 'state' },
    ],
    line: (a) => `${a.state ? 'Show' : 'Hide'} ${a.entity}${a.state ? '' : ' (no AI, no damage)'}`,
  },
  {
    bank: 2004,
    id: 8,
    name: 'Give SpEffect',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'speffect', at: 4, type: 'u32', kind: 'speffect' },
    ],
    line: (a) => `Give ${a.entity} SpEffect ${a.speffect}`,
  },
  {
    bank: 2004,
    id: 21,
    name: 'Take SpEffect',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'speffect', at: 4, type: 'u32', kind: 'speffect' },
    ],
    line: (a) => `Take SpEffect ${a.speffect} from ${a.entity}`,
  },
  {
    bank: 2004,
    id: 39,
    name: 'Collision',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'state', at: 4, type: 'u8', kind: 'state' },
    ],
    line: (a) => `${a.entity}: collision ${on(a.state)}`,
  },
  {
    bank: 2010,
    id: 2,
    name: 'Play sound',
    args: [
      { name: 'entity', at: 0, type: 'u32', kind: 'entity' },
      { name: 'type', at: 4, type: 'u32', kind: 'number' },
      { name: 'sound', at: 8, type: 'u32', kind: 'sound' },
    ],
    line: (a) => `Play sound ${a.sound} (type ${a.type}) at ${a.entity}`,
  },
]

const BY_KEY = new Map(INSTRUCTIONS.map((d) => [`${d.bank}:${d.id}`, d]))

/** Labels (1014[n]) carry their number in their id. */
const LABEL_BANK = 1014

export function instructionDef(bank: number, id: number): InstructionDef | undefined {
  return BY_KEY.get(`${bank}:${id}`)
}

function read(args: Buffer, a: ArgDef): number {
  if (a.at + SIZE[a.type] > args.length) return 0
  switch (a.type) {
    case 'u8':
      return args.readUInt8(a.at)
    case 's8':
      return args.readInt8(a.at)
    case 'u16':
      return args.readUInt16LE(a.at)
    case 's16':
      return args.readInt16LE(a.at)
    case 'u32':
      return args.readUInt32LE(a.at)
    case 's32':
      return args.readInt32LE(a.at)
    case 'f32':
      return args.readFloatLE(a.at)
  }
}

/** An instruction in words, with what it names. */
export function describeInstruction(ins: EmevdInstruction): { text: string; refs: InstructionRef[]; known: boolean } {
  if (ins.bank === LABEL_BANK) return { text: `Label ${ins.id}`, refs: [], known: true }
  const def = instructionDef(ins.bank, ins.id)
  if (!def) {
    const words: number[] = []
    for (let o = 0; o + 4 <= ins.args.length; o += 4) words.push(ins.args.readInt32LE(o))
    return { text: `${ins.bank}[${ins.id}]${words.length ? ` ${words.join(' ')}` : ''}`, refs: [], known: false }
  }
  const a: Record<string, number> = {}
  const refs: InstructionRef[] = []
  for (const arg of def.args) {
    a[arg.name] = read(ins.args, arg)
    if (
      ['flag', 'entity', 'area', 'itemLot', 'speffect', 'event', 'text', 'sound'].includes(arg.kind) &&
      a[arg.name] > 0
    )
      refs.push({ kind: arg.kind, value: a[arg.name] })
  }
  const rest: number[] = []
  if (def.rest) for (let o = def.rest.at; o + 4 <= ins.args.length; o += 4) rest.push(ins.args.readInt32LE(o))
  return { text: def.line(a, rest), refs, known: true }
}

/* -------------------------------- builders -------------------------------- */

/** An instruction from its definition and argument values (the rest: words after the fixed ones). */
function build(
  bank: number,
  id: number,
  values: Record<string, number>,
  size: number,
  rest: number[] = [],
): EmevdInstruction {
  const def = instructionDef(bank, id)!
  const args = Buffer.alloc(size + rest.length * 4)
  for (const a of def.args) {
    const v = values[a.name] ?? 0
    switch (a.type) {
      case 'u8':
        args.writeUInt8(v, a.at)
        break
      case 's8':
        args.writeInt8(v, a.at)
        break
      case 'u16':
        args.writeUInt16LE(v, a.at)
        break
      case 's16':
        args.writeInt16LE(v, a.at)
        break
      case 'u32':
        args.writeUInt32LE(v >>> 0, a.at)
        break
      case 's32':
        args.writeInt32LE(v, a.at)
        break
      case 'f32':
        args.writeFloatLE(v, a.at)
        break
    }
  }
  rest.forEach((v, k) => args.writeInt32LE(v, size + k * 4))
  return { bank, id, args }
}

/** The player's entity id. */
export const PLAYER = 10000

/**
 * Builders for the instructions recipes write, each laid out as the game's
 * own instances of it are (the events suite compares them).
 */
export const ins = {
  /** Start an event of this file (with no arguments the game writes one 0). */
  startEvent: (event: number, slot = 0, args: number[] = []): EmevdInstruction =>
    build(2000, 0, { slot, event }, 8, args.length ? args : [0]),
  giveItemLot: (lot: number) => build(2003, 4, { lot }, 4),
  setFlag: (flag: number, state: boolean) => build(2003, 66, { type: 0, flag, state: state ? 1 : 0 }, 12),
  /** Ends the event (or starts it again) if a flag is on (or off). */
  endIfFlag: (flag: number, state: boolean, restart = false) =>
    build(1003, 2, { restart: restart ? 1 : 0, state: state ? 1 : 0, type: 0, flag }, 8),
  gotoIfFlag: (label: number, flag: number, state: boolean) =>
    build(1003, 101, { label, state: state ? 1 : 0, type: 0, flag }, 8),
  label: (n: number): EmevdInstruction => ({ bank: LABEL_BANK, id: n, args: Buffer.alloc(0) }),
  end: (restart = false) => build(1000, 4, { restart: restart ? 1 : 0 }, 4),
  waitSeconds: (seconds: number) => build(1001, 0, { seconds }, 4),
  /** Conditions, into the event itself (group 0: it waits there) unless a group is given. */
  ifFlag: (flag: number, state: boolean, group = 0) => build(3, 0, { group, state: state ? 1 : 0, type: 0, flag }, 8),
  ifInArea: (entity: number, area: number, inside = true, group = 0) =>
    build(3, 2, { group, inside: inside ? 1 : 0, entity, area, count: 1 }, 16),
  ifDead: (entity: number, dead = true, group = 0) => {
    const i = build(4, 0, { group, entity, dead: dead ? 1 : 0 }, 16)
    i.args.writeFloatLE(1, 12)
    return i
  },
  ifHasSpEffect: (entity: number, speffect: number, has = true, group = 0) => {
    const i = build(4, 5, { group, entity, speffect, has: has ? 1 : 0 }, 20)
    i.args.writeFloatLE(1, 16)
    return i
  },
  ifGroup: (of: number, pass = true, group = 0) => build(0, 0, { group, state: pass ? 1 : 0, of }, 4),
  show: (entity: number, state: boolean) => build(2004, 5, { entity, state: state ? 1 : 0 }, 8),
  ai: (entity: number, state: boolean) => build(2004, 1, { entity, state: state ? 1 : 0 }, 8),
  collision: (entity: number, state: boolean) => build(2004, 39, { entity, state: state ? 1 : 0 }, 8),
  kill: (entity: number, runes = false) => build(2004, 4, { entity, runes: runes ? 1 : 0 }, 8),
  giveSpEffect: (entity: number, speffect: number) => build(2004, 8, { entity, speffect }, 8),
  takeSpEffect: (entity: number, speffect: number) => build(2004, 21, { entity, speffect }, 8),
  bossBar: (entity: number, name: number, show = true, slot = 0) =>
    build(2003, 11, { show: show ? 1 : 0, entity, slot, name }, 16),
  bossDefeated: (entity: number, banner: number) => build(2003, 12, { entity, banner }, 8),
}
