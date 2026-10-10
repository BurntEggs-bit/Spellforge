/**
 * What the game's event scripts (formats/emevd.ts) do with event flags.
 *
 * The flag instructions and their argument layouts were worked out from the
 * game's own scripts (no public documentation is free to use): each takes
 * a state byte, a target-type byte (0: an event flag; 1 and 2 refer to an
 * event instead) and a u32 flag, or two for a range of flags:
 *
 *   3[0]      if flag             [1] state, [2] type, @4 flag
 *   3[1]      if range of flags   [1] how, [2] type, @4 first, @8 last
 *   1003[0]   wait for flag       [0] state, [1] type, @4 flag
 *   1003[1]   skip if flag        [1] state, [2] type, @4 flag
 *   1003[2]   end if flag         [1] state, [2] type, @4 flag
 *   1003[3]   skip if range       [1] how, [2] type, @4 first, @8 last
 *   1003[4]   end if range        [1] how, [2] type, @4 first, @8 last
 *   1003[101] go to if flag       [1] state, [2] type, @4 flag
 *   1003[103] go to if range      [1] how, [2] type, @4 first, @8 last
 *   2003[22]  set a range         @0 first, @4 last, [8] state
 *   2003[63]  set one of a range at random   @0 first, @4 last
 *   2003[66]  set flag            [0] type, @4 flag, [8] state (1 on, 0 off)
 *   2003[69]  set flag (shared with other players)   as 2003[66]
 *
 * Context, for saying what an event is about:
 *   2003[4]   award item lot      @0 ItemLotParam id
 *   2003[11]  boss health bar     @12 NpcName text id (the boss's name)
 *   2000[0]   start an event (same file)    @4 event id, @8.. its arguments
 *   2000[6]   start a common event          @4 event id, @8.. its arguments
 *
 * A started event's parameters copy argument bytes into its instructions;
 * filling them in per call is how flags handed to common_func's events
 * (90005xxx) are found, and attributed to the event that made the call.
 *
 * Talk scripts (formats/esd.ts) too, worked out the same way: function 15
 * reads a flag (its one argument), command 1:11 sets one (flag, state).
 */
import type { Emevd, EmevdEvent, EmevdInstruction } from '../formats/emevd.ts'
import { esdCalls, esdConstant, type EsdScript } from '../formats/esd.ts'

type FlagAction = 'set' | 'clear' | 'check' | 'wait' | 'random'

interface FlagSpec {
  what: 'check' | 'wait' | 'set' | 'random'
  /** Byte offsets of the flag (or the range's first and last). */
  flags: number[]
  range?: boolean
  /** Byte offset of the target type (0: an event flag). */
  type?: number
  /** Byte offset of the state (set: 1 on, 0 off). */
  state?: number
}

const FLAG_INSTRUCTIONS: Record<string, FlagSpec> = {
  '3:0': { what: 'check', flags: [4], type: 2, state: 1 },
  '3:1': { what: 'check', flags: [4, 8], range: true, type: 2 },
  '1003:0': { what: 'wait', flags: [4], type: 1, state: 0 },
  '1003:1': { what: 'check', flags: [4], type: 2, state: 1 },
  '1003:2': { what: 'check', flags: [4], type: 2, state: 1 },
  '1003:3': { what: 'check', flags: [4, 8], range: true, type: 2 },
  '1003:4': { what: 'check', flags: [4, 8], range: true, type: 2 },
  '1003:101': { what: 'check', flags: [4], type: 2, state: 1 },
  '1003:103': { what: 'check', flags: [4, 8], range: true, type: 2 },
  '2003:22': { what: 'set', flags: [0, 4], range: true, state: 8 },
  '2003:63': { what: 'random', flags: [0, 4], range: true },
  '2003:66': { what: 'set', flags: [4], type: 0, state: 8 },
  '2003:69': { what: 'set', flags: [4], type: 0, state: 8 },
}

const AWARD_ITEM_LOT = '2003:4'
const BOSS_HEALTH_BAR = '2003:11'

/** One place a script uses a flag. */
export interface FlagUse {
  /** An event script's event, or a talk script (its talk id in `event`). */
  kind: 'event' | 'talk'
  /** The script file (m10_00_00_00, common), or for talk the map binder's. */
  file: string
  event: number
  /** The common or other event the flag was handed to, when it came in as an argument. */
  via?: number
  what: FlagAction
  /** For a range of flags: its first and last. */
  range?: [number, number]
}

/** What an event does besides flags, for describing it. */
export interface EventContext {
  itemLots: number[]
  /** NpcName text ids of the boss health bars it shows. */
  bosses: number[]
}

export interface FlagIndex {
  /** flag -> where scripts use it (single flags). */
  uses: Map<number, FlagUse[]>
  /** Range uses, checked by containment. */
  ranges: FlagUse[]
  /** `${file}:${event}` (or `${file}:${event}>${via}`) -> context. */
  events: Map<string, EventContext>
}

const fileKey = (rel: string) =>
  rel
    .split(/[\\/]/)
    .pop()!
    .replace(/\.emevd(\.dcx)?$/i, '')

/** Indexes every script: `scripts` maps a file (event/m10_00_00_00.emevd.dcx) to its parsed events. */
export function indexEventFlags(scripts: Map<string, Emevd>): FlagIndex {
  const index: FlagIndex = { uses: new Map(), ranges: [], events: new Map() }
  const byFile = new Map<string, Map<number, EmevdEvent>>()
  const anywhere = new Map<number, EmevdEvent>()
  let commonFunc: Map<number, EmevdEvent> | null = null
  for (const [rel, sc] of scripts) {
    const m = new Map(sc.events.map((e) => [e.id, e]))
    byFile.set(fileKey(rel), m)
    if (/common_func/i.test(rel)) commonFunc = m
    for (const e of sc.events) if (!anywhere.has(e.id)) anywhere.set(e.id, e)
  }

  const record = (ins: EmevdInstruction, file: string, event: number, via: number | undefined) => {
    const key = `${ins.bank}:${ins.id}`
    const spec = FLAG_INSTRUCTIONS[key]
    const a = ins.args
    if (spec) {
      if (spec.type !== undefined && (a.length <= spec.type || a[spec.type] !== 0)) return
      if (spec.flags.some((o) => o + 4 > a.length)) return
      const values = spec.flags.map((o) => a.readUInt32LE(o))
      const what: FlagAction =
        spec.what === 'set' && spec.state !== undefined && a.length > spec.state && a[spec.state] === 0
          ? 'clear'
          : spec.what
      if (spec.range) {
        const [first, last] = values[0] <= values[1] ? values : [values[1], values[0]]
        if (first <= 0) return
        if (first === last) add(index, first, { kind: 'event', file, event, via, what })
        else index.ranges.push({ kind: 'event', file, event, via, what, range: [first, last] })
      } else if (values[0] > 0) add(index, values[0], { kind: 'event', file, event, via, what })
      return
    }
    const ctx = () => {
      const k = via === undefined ? `${file}:${event}` : `${file}:${event}>${via}`
      let c = index.events.get(k)
      if (!c) index.events.set(k, (c = { itemLots: [], bosses: [] }))
      return c
    }
    if (key === AWARD_ITEM_LOT && a.length >= 4) {
      const lot = a.readUInt32LE(0)
      if (lot > 0 && !ctx().itemLots.includes(lot)) ctx().itemLots.push(lot)
    } else if (key === BOSS_HEALTH_BAR && a.length >= 16) {
      const name = a.readUInt32LE(12)
      if (name > 0 && !ctx().bosses.includes(name)) ctx().bosses.push(name)
    }
  }

  /**
   * A started event's instructions with this call's arguments filled in
   * (only those its parameters reach), recorded for the calling event; the
   * events those start in turn are followed too.
   */
  const call = (ins: EmevdInstruction, file: string, event: number, depth: number) => {
    if (ins.bank !== 2000 || (ins.id !== 0 && ins.id !== 6) || ins.args.length < 8 || depth > 4) return
    const id = ins.args.readUInt32LE(4)
    const target =
      ins.id === 6 ? (commonFunc?.get(id) ?? anywhere.get(id)) : (byFile.get(file)?.get(id) ?? anywhere.get(id))
    if (!target || !target.parameters.length) return
    const callArgs = ins.args.subarray(8)
    const copies = new Map<number, EmevdInstruction>()
    for (const p of target.parameters) {
      const orig = target.instructions[p.instruction]
      if (!orig || p.source + p.bytes > callArgs.length || p.target + p.bytes > orig.args.length) continue
      let c = copies.get(p.instruction)
      if (!c) copies.set(p.instruction, (c = { bank: orig.bank, id: orig.id, args: Buffer.from(orig.args) }))
      callArgs.copy(c.args, p.target, p.source, p.source + p.bytes)
    }
    for (const c of copies.values()) {
      record(c, file, event, target.id === event ? undefined : target.id)
      call(c, file, event, depth + 1)
    }
  }

  for (const [rel, sc] of scripts) {
    const file = fileKey(rel)
    for (const ev of sc.events) {
      for (const ins of ev.instructions) {
        record(ins, file, ev.id, undefined)
        call(ins, file, ev.id, 0)
      }
    }
  }
  return index
}

function add(index: FlagIndex, flag: number, use: FlagUse): void {
  const l = index.uses.get(flag)
  if (!l) index.uses.set(flag, [use])
  else if (
    !l.some(
      (u) =>
        u.kind === use.kind && u.file === use.file && u.event === use.event && u.via === use.via && u.what === use.what,
    )
  )
    l.push(use)
}

/** Talk script function that reads a flag, and command (bank:id) that sets one. */
const TALK_GET_FLAG = 15
const TALK_SET_FLAG = '1:11'

/**
 * Adds talk scripts' flag uses to an index: `talks` are each map binder's
 * (script/talk/m10_00_00_00.talkesdbnd.dcx) scripts with their talk ids.
 */
export function indexTalkFlags(index: FlagIndex, talks: { binder: string; talk: number; script: EsdScript }[]): void {
  for (const { binder, talk, script } of talks) {
    const file = binder
      .split(/[\\/]/)
      .pop()!
      .replace(/\.talkesdbnd(\.dcx)?$/i, '')
    for (const c of script.commands) {
      if (`${c.bank}:${c.id}` !== TALK_SET_FLAG || c.args.length < 2) continue
      const flag = esdConstant(c.args[0])
      const state = esdConstant(c.args[1])
      if (flag !== null && flag > 0)
        add(index, flag, { kind: 'talk', file, event: talk, what: state === 0 ? 'clear' : 'set' })
    }
    const read = (expr: Buffer) => {
      for (const call of esdCalls(expr))
        if (call.fn === TALK_GET_FLAG && typeof call.args[0] === 'number' && call.args[0] > 0)
          add(index, call.args[0], { kind: 'talk', file, event: talk, what: 'check' })
    }
    for (const e of script.evaluators) read(e)
    for (const c of script.commands) for (const a of c.args) read(a)
  }
}

/** The flag's uses: its own, and the ranges it falls in. */
export function flagUses(index: FlagIndex, flag: number): FlagUse[] {
  return [
    ...(index.uses.get(flag) ?? []),
    ...index.ranges.filter((r) => r.range && flag >= r.range[0] && flag <= r.range[1]),
  ]
}

/**
 * The map a flag belongs to, read from its number (the game's numbering):
 *   10 digits  1AAXXYYNNN.. open world: 10 -> m60_XX_YY, 20 -> m61 (DLC),
 *              the last four digits the flag within that map;
 *   8 digits   AABBNNNN: legacy dungeons and other maps mAA_BB, last four
 *              digits the flag within it;
 * shorter flags are the game's global ones (progression, items, graces).
 */
export function flagMap(flag: number): { map: string; local: number } | null {
  if (flag >= 1_000_000_000 && flag < 3_000_000_000) {
    const area = Math.floor(flag / 100_000_000)
    const world = area === 10 ? 60 : area === 20 ? 61 : null
    if (world === null) return null
    const x = Math.floor(flag / 1_000_000) % 100
    const y = Math.floor(flag / 10_000) % 100
    return { map: `m${world}_${pad(x)}_${pad(y)}_00`, local: flag % 10_000 }
  }
  if (flag >= 10_000_000 && flag < 100_000_000) {
    const aa = Math.floor(flag / 1_000_000)
    const bb = Math.floor(flag / 10_000) % 100
    return { map: `m${pad(aa)}_${pad(bb)}_00_00`, local: flag % 10_000 }
  }
  return null
}

const pad = (n: number) => String(n).padStart(2, '0')
