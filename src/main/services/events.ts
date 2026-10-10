/**
 * The game's event scripts (event/*.emevd.dcx) on the Events page: every
 * script and its events in Spellforge's words (core/events/instructions.ts),
 * what starts each event, and the project's own events, made from recipes
 * (core/events/recipes.ts) and written on Save, each started from its
 * script's event 0.
 *
 * Kept in .spellforge/events.json: the recipes, the test markers put on
 * events, and the event ids Spellforge wrote into each script at the last
 * save (the next save takes them out before writing the current ones, so a
 * recipe deleted or moved leaves nothing behind).
 *
 * Ids: a recipe's events get ids in its script's own block (a map's
 * AABB0000, or 10AABBCC0000 in the open world; 8000s in the common script)
 * that no script uses as an event and nothing uses as a flag (an event that
 * finishes sets the flag of its own id). A flag Spellforge picks (an item
 * given once, a new flag for a recipe) is one nothing in the game uses, in a
 * thousand-block the game itself keeps flags in, below the map block's
 * 2000s (which the game clears on every load): the map's own, or for the
 * common script the block the game keeps its event items' flags in
 * (400000s).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../../core/project/project.ts'
import { dcxCompress, dcxDecompress, type DcxInfo } from '../../core/formats/dcx.ts'
import { readEmevd, writeEmevd, type Emevd, type EmevdEvent } from '../../core/formats/emevd.ts'
import { describeInstruction } from '../../core/events/instructions.ts'
import { applyEventPlan, compileRecipe, type EventPlan } from '../../core/events/recipes.ts'
import { eventCount, eventRecipeProblems, type EventRecipe } from '../../shared/eventRecipes.ts'
import type * as A from '../../shared/api.ts'

const EVENTS_RECORD = '.spellforge/events.json'
const COMMON = 'common'
const SHARED = 'common_func'

interface EventRecord {
  recipes: EventRecipe[]
  markers: { file: string; event: number }[]
  /** Event ids Spellforge wrote into each script at the last save. */
  owned: { [file: string]: number[] }
  /** Events given the test marker at the last save, by script. */
  marked: { [file: string]: number[] }
}

export interface EventHost {
  project: Project
  /** A map's name ("Stormveil Castle"), or ''. */
  mapName(map: string): string
  /** Whether anything in the game or the project uses a flag (scripts, talk, params, names). */
  flagUsed(flag: number): boolean
  /** The event scripts were written: what reads them reads them again. */
  scriptsChanged(): void
}

const relOf = (file: string) => `event/${file}.emevd.dcx`
const fileOf = (rel: string) =>
  rel
    .split(/[\\/]/)
    .pop()!
    .replace(/\.emevd\.dcx$/i, '')

export class EventService {
  private host: EventHost
  private record: EventRecord | null = null
  private dirty = false
  /** Scripts as read (the project's own copy, else the game's), by file. */
  private scripts = new Map<string, { script: Emevd; dcx: DcxInfo }>()
  /** Every event id of every script (for free ids), and who starts each shared event. */
  private index: { ids: Set<number>; shared: Map<number, A.EventStart[]> } | null = null

  constructor(host: EventHost) {
    this.host = host
  }

  private load(): EventRecord {
    if (this.record) return this.record
    try {
      const r = JSON.parse(
        fs.readFileSync(path.join(this.host.project.config.modDir, EVENTS_RECORD), 'utf8'),
      ) as Partial<EventRecord>
      this.record = {
        recipes: Array.isArray(r.recipes) ? r.recipes : [],
        markers: Array.isArray(r.markers) ? r.markers : [],
        owned: r.owned && typeof r.owned === 'object' ? r.owned : {},
        marked: r.marked && typeof r.marked === 'object' ? r.marked : {},
      }
    } catch {
      this.record = { recipes: [], markers: [], owned: {}, marked: {} }
    }
    return this.record
  }

  /* -------------------------------- reading -------------------------------- */

  private read(file: string): { script: Emevd; dcx: DcxInfo } {
    const hit = this.scripts.get(file)
    if (hit) return hit
    const rel = relOf(file)
    if (!this.host.project.resolve(rel)) throw new Error(`There's no event script ${file}`)
    const d = dcxDecompress(this.host.project.read(rel).data)
    const out = { script: readEmevd(d.data), dcx: d.info }
    this.scripts.set(file, out)
    return out
  }

  /** What Spellforge writes into a script: its recipes' events, and the test markers. */
  private planFor(file: string): EventPlan {
    const r = this.load()
    const mine = r.recipes.filter((x) => x.file === file)
    return {
      remove: [...(r.owned[file] ?? []), ...mine.flatMap((x) => x.events)],
      add: mine.filter((x) => !x.off).flatMap((x) => compileRecipe(x)),
      markers: r.markers.filter((m) => m.file === file).map((m) => m.event),
      unmark: r.marked[file] ?? [],
    }
  }

  /** A script as it will be written: as read, with Spellforge's events in it. */
  private effective(file: string): Emevd {
    return applyEventPlan(this.read(file).script, this.planFor(file))
  }

  /** Every script's event ids, and who starts each shared event (read once, the first time it's needed). */
  private globalIndex(): NonNullable<EventService['index']> {
    if (this.index) return this.index
    const ids = new Set<number>()
    const shared = new Map<number, A.EventStart[]>()
    for (const rel of this.host.project.list('event', /\.emevd\.dcx$/i)) {
      const file = fileOf(rel)
      let script: Emevd
      try {
        script = this.read(file).script
      } catch {
        continue
      }
      for (const e of script.events) {
        ids.add(e.id)
        for (const i of e.instructions) {
          if (i.bank !== 2000 || i.id !== 6 || i.args.length < 8) continue
          const id = i.args.readUInt32LE(4)
          const list = shared.get(id) ?? []
          if (list.length < 200)
            list.push({ file, event: e.id, slot: i.args.readInt32LE(0), args: wordsFrom(i.args, 8) })
          shared.set(id, list)
        }
      }
    }
    this.index = { ids, shared }
    return this.index
  }

  /** Every event script: the common one, the shared events, then the maps, with the project's own counted. */
  files(): A.EventFileView[] {
    const r = this.load()
    const out: A.EventFileView[] = []
    for (const rel of this.host.project.list('event', /\.emevd\.dcx$/i)) {
      const file = fileOf(rel)
      const where = this.host.project.resolve(rel)
      out.push({
        file,
        title: file === COMMON ? 'Always loaded' : file === SHARED ? 'Shared events' : this.host.mapName(file),
        own: r.recipes.filter((x) => x.file === file).length + r.markers.filter((m) => m.file === file).length,
        edited: where?.source === 'project',
        canAdd: file !== SHARED,
      })
    }
    const rank = (f: A.EventFileView) => (f.file === COMMON ? 0 : f.file === SHARED ? 1 : 2)
    return out.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file))
  }

  /** A script's events, each in a line: what it does, whether anything starts it, and whether it's the project's. */
  events(file: string): A.EventSummary[] {
    const script = this.effective(file)
    const r = this.load()
    const started = this.startsIn(script)
    const shared = file === SHARED ? this.globalIndex().shared : null
    return script.events.map((e) => {
      const recipe = r.recipes.find((x) => x.file === file && x.events.includes(e.id))
      return {
        id: e.id,
        restarts: e.restBehavior === 1,
        lines: e.instructions.length,
        about: aboutEvent(e),
        started: e.id === 0 || e.id === 50 || started.has(e.id) || (shared?.get(e.id)?.length ?? 0) > 0,
        recipe: recipe?.id,
        // A recipe's own events carry the marker in the recipe; any other event in the record's markers.
        marker: recipe
          ? !!recipe.test && recipe.events[0] === e.id
          : r.markers.some((m) => m.file === file && m.event === e.id),
      }
    })
  }

  /** Events of a script started by its own events (Start event lines). */
  private startsIn(script: Emevd): Map<number, A.EventStart[]> {
    const out = new Map<number, A.EventStart[]>()
    for (const e of script.events)
      for (const i of e.instructions) {
        if (i.bank !== 2000 || i.id !== 0 || i.args.length < 8) continue
        const id = i.args.readUInt32LE(4)
        const list = out.get(id) ?? []
        list.push({ file: '', event: e.id, slot: i.args.readInt32LE(0), args: wordsFrom(i.args, 8) })
        out.set(id, list)
      }
    return out
  }

  /** One event: its lines in words, what starts it, and its recipe when it's the project's. */
  event(file: string, id: number): A.EventView {
    const script = this.effective(file)
    const e = script.events.find((x) => x.id === id)
    if (!e) throw new Error(`${file} has no event ${id}`)
    const r = this.load()
    const startedBy =
      file === SHARED ? (this.globalIndex().shared.get(id) ?? []) : (this.startsIn(script).get(id) ?? [])
    const params = new Map(e.parameters.map((p) => [p.instruction, p]))
    const recipe = r.recipes.find((x) => x.file === file && x.events.includes(id))
    return {
      file,
      id,
      restarts: e.restBehavior === 1,
      lines: e.instructions.map((ins, index) => {
        const d = describeInstruction(ins)
        const p = params.get(index)
        return {
          index,
          text: d.text,
          refs: d.refs,
          known: d.known,
          code: `${ins.bank}[${ins.id}]`,
          ...(p ? { argument: true } : {}),
        }
      }),
      parameters: e.parameters.length,
      startedBy,
      runsAlone: id === 0 || id === 50,
      recipe,
      marker: recipe
        ? !!recipe.test && recipe.events[0] === id
        : r.markers.some((m) => m.file === file && m.event === id),
    }
  }

  /* ------------------------------- the recipes ------------------------------ */

  recipes(): EventRecipe[] {
    return this.load().recipes
  }

  /** Adds or changes a recipe: its events get ids in its script's block (new ones when it's new or moved). */
  setRecipe(recipe: EventRecipe): EventRecipe {
    const problems = eventRecipeProblems(recipe)
    if (problems.length) throw new Error(problems[0])
    if (recipe.file === SHARED)
      throw new Error('The shared events are started by the maps: add yours to a map or to the common script')
    this.read(recipe.file)
    const r = this.load()
    const old = r.recipes.find((x) => x.id === recipe.id)
    let events = recipe.events
    if (!old || old.file !== recipe.file || events.length !== eventCount(recipe))
      events = this.freeEventIds(recipe.file, eventCount(recipe), recipe.id)
    const next = { ...recipe, events } as EventRecipe
    r.recipes = old ? r.recipes.map((x) => (x.id === recipe.id ? next : x)) : [...r.recipes, next]
    this.dirty = true
    return next
  }

  deleteRecipe(id: string): void {
    const r = this.load()
    r.recipes = r.recipes.filter((x) => x.id !== id)
    this.dirty = true
  }

  /** Puts the test marker (a Rowa Fruit when the event starts) on an event, or takes it off. */
  setMarker(file: string, event: number, on: boolean): void {
    const r = this.load()
    const own = r.recipes.find((x) => x.file === file && x.events.includes(event))
    if (own) {
      r.recipes = r.recipes.map((x) => (x === own ? ({ ...x, test: on } as EventRecipe) : x))
    } else {
      r.markers = r.markers.filter((m) => !(m.file === file && m.event === event))
      if (on) {
        if (!this.read(file).script.events.some((e) => e.id === event)) throw new Error(`${file} has no event ${event}`)
        r.markers.push({ file, event })
      }
    }
    this.dirty = true
  }

  /* ---------------------------------- ids ---------------------------------- */

  /** A script's id block: the base its own events' ids share (18000000 for m18_00_00_00, 1042360000 for m60_42_36_00). */
  private blockOf(file: string): number {
    if (file === COMMON) return 0
    const m = /^m(\d\d)_(\d\d)_(\d\d)_(\d\d)$/.exec(file)
    const counts = new Map<number, number>()
    for (const e of this.read(file).script.events) {
      if (e.id < 10000) continue
      const b = e.id - (e.id % 10000)
      counts.set(b, (counts.get(b) ?? 0) + 1)
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0]
    if (best) return best[0]
    if (!m) return 0
    const [aa, bb, cc] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return aa >= 60 ? 1_000_000_000 + bb * 1_000_000 + cc * 10_000 : aa * 1_000_000 + bb * 10_000
  }

  /** Event ids for a recipe in a script: unused as events anywhere and as flags. */
  private freeEventIds(file: string, n: number, recipeId: string): number[] {
    const base = this.blockOf(file)
    const { ids } = this.globalIndex()
    const taken = new Set(
      this.load()
        .recipes.filter((x) => x.id !== recipeId)
        .flatMap((x) => x.events),
    )
    const [lo, hi] = file === COMMON ? [8000, 8999] : [base + 7000, base + 9999]
    const out: number[] = []
    for (let id = lo; id <= hi && out.length < n; id++)
      if (!ids.has(id) && !taken.has(id) && !this.host.flagUsed(id)) out.push(id)
    if (out.length < n) throw new Error(`No free event ids are left in ${file}'s block`)
    return out
  }

  /**
   * A flag nothing uses, kept across loads, for a script: in a thousand-block
   * the game keeps flags in (the map's own below its 2000s; the common
   * script's: the event item block, 400000s).
   */
  newFlag(file: string): number {
    const base = file === COMMON ? 400_000 : this.blockOf(file)
    const blocks = file === COMMON ? [400_000] : [base, base + 1000]
    const mine = new Set(this.load().recipes.flatMap((x) => recipeFlags(x)))
    for (const lo of blocks) {
      let valid = false
      for (let f = lo; f < lo + 1000 && !valid; f++) if (this.host.flagUsed(f)) valid = true
      if (!valid) continue
      // From the top of the block down: the game fills its blocks from the bottom.
      for (let f = lo + 999; f >= lo; f--) if (!this.host.flagUsed(f) && !mine.has(f)) return f
    }
    throw new Error(`No free flag is left in ${file}'s blocks`)
  }

  /* --------------------------------- saving -------------------------------- */

  private touchedFiles(): string[] {
    const r = this.load()
    return [
      ...new Set([
        ...r.recipes.map((x) => x.file),
        ...r.markers.map((m) => m.file),
        ...Object.keys(r.owned),
        ...Object.keys(r.marked),
      ]),
    ].sort()
  }

  dirtyFiles(): string[] {
    return this.dirty ? [EVENTS_RECORD, ...this.touchedFiles().map(relOf)] : []
  }

  save(): string[] {
    if (!this.dirty) return []
    const r = this.load()
    const written: string[] = []
    const owned: EventRecord['owned'] = {}
    const marked: EventRecord['marked'] = {}
    for (const file of this.touchedFiles()) {
      const { dcx } = this.read(file)
      const out = this.effective(file)
      const mine = r.recipes.filter((x) => x.file === file && !x.off).flatMap((x) => x.events)
      if (mine.length) owned[file] = mine
      const marks = r.markers.filter((m) => m.file === file).map((m) => m.event)
      if (marks.length) marked[file] = marks
      const level = dcx.format === 'KRAK' ? { format: 'KRAK' as const, level: 4 } : dcx
      written.push(this.host.project.writeProjectFile(relOf(file), dcxCompress(writeEmevd(out), level)))
    }
    r.owned = owned
    r.marked = marked
    written.push(this.host.project.writeProjectFile(EVENTS_RECORD, Buffer.from(JSON.stringify(r, null, 2))))
    this.dirty = false
    this.scripts.clear()
    this.index = null
    this.host.scriptsChanged()
    return written
  }
}

/** Words of an instruction's arguments from a byte on (the arguments a start line hands an event). */
function wordsFrom(args: Buffer, at: number): number[] {
  const out: number[] = []
  for (let o = at; o + 4 <= args.length; o += 4) out.push(args.readInt32LE(o))
  return out
}

/** Flags a recipe sets or reads (kept away from new flags). */
function recipeFlags(r: EventRecipe): number[] {
  switch (r.kind) {
    case 'giveItems':
      return [r.flag]
    case 'setFlag':
      return [r.flag, ...(r.when.kind === 'flag' ? [r.when.flag] : [])]
    case 'whileSpEffect':
      return r.do.kind === 'flag' ? [r.do.flag] : []
    case 'enableEnemy':
      return [r.flag]
    case 'boss':
      return [r.defeatFlag]
  }
}

/** An event in a few words, from what it does. */
function aboutEvent(e: EmevdEvent): string {
  const parts: string[] = []
  let starts = 0
  for (const i of e.instructions) {
    if (i.bank === 2000 && (i.id === 0 || i.id === 6)) starts++
    else if (i.bank === 2003 && i.id === 4 && i.args.length >= 4) parts.push(`gives item lot ${i.args.readUInt32LE(0)}`)
    else if (i.bank === 2003 && i.id === 11 && i.args.length >= 16 && i.args[0])
      parts.push(`boss health bar (text ${i.args.readUInt32LE(12)})`)
    else if (i.bank === 2003 && i.id === 12) parts.push('boss defeat')
    else if (i.bank === 2004 && i.id === 8 && i.args.length >= 8) parts.push(`gives SpEffect ${i.args.readUInt32LE(4)}`)
  }
  if (starts) parts.unshift(`starts ${starts} event${starts === 1 ? '' : 's'}`)
  const unique = [...new Set(parts)]
  return unique.slice(0, 3).join(', ') + (unique.length > 3 ? '…' : '')
}

export type { EventRecipe }
