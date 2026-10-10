/**
 * Event recipes (shared/eventRecipes.ts) written into event scripts.
 *
 * Each recipe becomes one event (a boss fight two) in its script, started
 * from the script's event 0, which the game runs whenever the script loads
 * (its constructor), as the game's own events are. The start lines go at
 * the end of event 0, where modders add theirs; where event 0 ends or jumps
 * partway whatever happens, at its start instead (before any skip, so no
 * skip counts them). A script without an event 0 gets one.
 *
 * The events are laid out as the game's own of the same kind:
 *   - a boss: Soldier of Godrick's fight (m18 event 18002860 and its
 *     defeat, 18002850): gone once its flag is on, AI off until the player
 *     is in the arena, then its health bar; when it dies, the banner and
 *     the flag;
 *   - an enemy kept away until a flag: hidden, then shown when the flag turns
 *     on;
 *   - a SpEffect reaction: wait until it's on, act, wait until it's off,
 *     undo, start again.
 *
 * Spellforge's events are written again on every save: the ones it wrote
 * before (by id) are taken out with their start lines first, so editing a
 * recipe never leaves an old copy behind; everything else in the script is
 * kept as it is.
 *
 * Credit: the Souls Modding wiki's Elden Ring event tutorials (the boss
 * pattern, the item lot test marker 997200): the techniques; Spellforge's
 * own reading of the game's scripts: the bytes.
 */
import type { Emevd, EmevdEvent, EmevdInstruction } from '../formats/emevd.ts'
import { type EventRecipe, type EventWhen, TEST_ITEM_LOT } from '../../shared/eventRecipes.ts'
import { ins, PLAYER } from './instructions.ts'

/** Rest behaviour: 0 runs once per load; 1 starts again when the player rests at a grace. */
const ONCE_PER_LOAD = 0
const AGAIN_ON_REST = 1

/** The lines that wait for a recipe's moment. */
function waitFor(when: EventWhen): EmevdInstruction[] {
  if (when.kind === 'flag') return [ins.ifFlag(when.flag, true)]
  if (when.kind === 'area') return [ins.ifInArea(PLAYER, when.area, true)]
  return []
}

/** The events a recipe writes, under the ids it was given (r.events). */
export function compileRecipe(r: EventRecipe): EmevdEvent[] {
  const ev = (k: number, rest: number, lines: EmevdInstruction[]): EmevdEvent => ({
    id: r.events[k],
    restBehavior: rest,
    // The test marker: a Rowa Fruit the moment the (first) event starts.
    instructions: r.test && k === 0 ? [ins.giveItemLot(TEST_ITEM_LOT), ...lines] : lines,
    parameters: [],
  })
  switch (r.kind) {
    case 'giveItems':
      return [
        ev(
          0,
          ONCE_PER_LOAD,
          r.flag
            ? [ins.endIfFlag(r.flag, true), ins.giveItemLot(r.lot), ins.setFlag(r.flag, true)]
            : [ins.giveItemLot(r.lot)],
        ),
      ]
    case 'setFlag':
      return [ev(0, ONCE_PER_LOAD, [...waitFor(r.when), ins.setFlag(r.flag, r.state)])]
    case 'whileSpEffect': {
      const d = r.do
      const act =
        d.kind === 'speffect'
          ? ins.giveSpEffect(r.entity, d.speffect)
          : d.kind === 'flag'
            ? ins.setFlag(d.flag, true)
            : ins.giveItemLot(d.lot)
      const undo =
        d.kind === 'speffect'
          ? [ins.takeSpEffect(r.entity, d.speffect)]
          : d.kind === 'flag'
            ? [ins.setFlag(d.flag, false)]
            : []
      return [
        ev(0, AGAIN_ON_REST, [
          ins.ifHasSpEffect(r.entity, r.speffect, true),
          act,
          ins.ifHasSpEffect(r.entity, r.speffect, false),
          ...undo,
          ins.end(true),
        ]),
      ]
    }
    case 'enableEnemy':
      return [
        ev(0, AGAIN_ON_REST, [
          ins.gotoIfFlag(0, r.flag, true),
          ins.show(r.entity, false),
          ins.ifFlag(r.flag, true),
          ins.label(0),
          ins.show(r.entity, true),
        ]),
      ]
    case 'boss':
      return [
        ev(0, AGAIN_ON_REST, [
          ins.gotoIfFlag(0, r.defeatFlag, false),
          ins.show(r.entity, false),
          ins.collision(r.entity, false),
          ins.kill(r.entity, false),
          ins.end(),
          ins.label(0),
          ins.ai(r.entity, false),
          ins.ifInArea(PLAYER, r.arena, true),
          ins.ai(r.entity, true),
          ...(r.name ? [ins.bossBar(r.entity, r.name)] : []),
        ]),
        ev(1, AGAIN_ON_REST, [
          ins.endIfFlag(r.defeatFlag, true),
          ins.ifDead(r.entity),
          ins.bossDefeated(r.entity, r.banner),
          ins.setFlag(r.defeatFlag, true),
        ]),
      ]
  }
}

/** What to do to one script. */
export interface EventPlan {
  /** Events Spellforge wrote before (taken out with their start lines first). */
  remove: number[]
  /** Events to add, each started from event 0. */
  add: EmevdEvent[]
  /** Events (the game's or the project's) given the test marker at their start. */
  markers: number[]
  /** Events given the marker at the last save: it's taken off first (the project's copy holds it). */
  unmark?: number[]
}

const isStart = (i: EmevdInstruction) => i.bank === 2000 && i.id === 0 && i.args.length >= 8
const isMarker = (i: EmevdInstruction) =>
  i.bank === 2003 && i.id === 4 && i.args.length === 4 && i.args.readUInt32LE(0) === TEST_ITEM_LOT
const startedEvent = (i: EmevdInstruction) => i.args.readUInt32LE(4)

/** Takes instructions out of an event, keeping its parameters pointed at the instructions they were. */
function dropInstructions(ev: EmevdEvent, drop: (i: EmevdInstruction) => boolean): void {
  const keep: EmevdInstruction[] = []
  const map = new Map<number, number>()
  ev.instructions.forEach((i, k) => {
    if (drop(i)) return
    map.set(k, keep.length)
    keep.push(i)
  })
  ev.parameters = ev.parameters
    .filter((p) => map.has(p.instruction))
    .map((p) => ({ ...p, instruction: map.get(p.instruction)! }))
  ev.instructions = keep
}

/** Puts instructions into an event at an index, keeping its parameters pointed at theirs. */
function insertInstructions(ev: EmevdEvent, at: number, lines: EmevdInstruction[]): void {
  ev.instructions.splice(at, 0, ...lines)
  ev.parameters = ev.parameters.map((p) =>
    p.instruction >= at ? { ...p, instruction: p.instruction + lines.length } : p,
  )
}

/**
 * Whether lines added at the bottom of event 0 might never run: it has an
 * unconditional end (1000[4]) or jump (1000[103]), even as its last line. A conditional end
 * skips the game's own start lines below it in the same situations, so the
 * project's follow them at the bottom.
 */
function endsEarly(ev: EmevdEvent): boolean {
  return ev.instructions.some((i) => i.bank === 1000 && (i.id === 4 || i.id === 103))
}

/** A script with Spellforge's events written into it (a copy; the original is left as it is). */
export function applyEventPlan(script: Emevd, plan: EventPlan): Emevd {
  const events: EmevdEvent[] = script.events.map((e) => ({
    ...e,
    instructions: [...e.instructions],
    parameters: [...e.parameters],
  }))
  const out: Emevd = { ...script, events }
  const gone = new Set([...plan.remove, ...plan.add.map((e) => e.id)])
  out.events = out.events.filter((e) => e.id === 0 || !gone.has(e.id))
  let zero = out.events.find((e) => e.id === 0)
  if (zero) dropInstructions(zero, (i) => isStart(i) && gone.has(startedEvent(i)))
  if (plan.add.length) {
    if (!zero) {
      zero = { id: 0, restBehavior: 0, instructions: [], parameters: [] }
      out.events.unshift(zero)
    }
    const lines = plan.add.map((e) => ins.startEvent(e.id))
    insertInstructions(zero, endsEarly(zero) ? 0 : zero.instructions.length, lines)
    out.events.push(
      ...plan.add.map((e) => ({ ...e, instructions: [...e.instructions], parameters: [...e.parameters] })),
    )
  }
  for (const id of plan.unmark ?? []) {
    const ev = out.events.find((e) => e.id === id)
    const first = ev?.instructions[0]
    if (ev && first && isMarker(first)) dropInstructions(ev, (i) => i === first)
  }
  for (const id of plan.markers) {
    const ev = out.events.find((e) => e.id === id)
    if (ev) insertInstructions(ev, 0, [ins.giveItemLot(TEST_ITEM_LOT)])
  }
  return out
}
