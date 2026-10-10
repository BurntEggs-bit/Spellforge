/**
 * Brings a mod's params up to a newer game version.
 *
 * A mod keeps a whole regulation.bin of the game version it was made with.
 * After a game update that copy still holds the old version of every row
 * FromSoftware changed, and lacks the rows they added. This rebuilds it the
 * other way round: start from the new game's regulation and put the mod's
 * own changes back on top, field by field. The mod's changes are what differs
 * from the vanilla regulation of its own version (the "base"):
 *
 *   - a field the mod changed keeps the mod's value (even if the update
 *     changed it too: that's a conflict, counted);
 *   - every other field takes the new game's value;
 *   - rows the mod added are added (fields matched by name, so a param whose
 *     layout changed between versions still carries them; new fields get
 *     their defaults); rows the mod removed are removed;
 *   - rows the update added or changed and the mod never touched are simply
 *     the new game's.
 *
 * Rows are matched by id and, for the few params with repeated ids, by
 * which occurrence of the id they are.
 */
import type { FieldDef } from './paramDef.ts'
import { defaultRowData, getField, rowsByOccurrence, setField, type ParamRow } from './param.ts'
import { ParamDatabase, type LoadedParam } from './paramDb.ts'

export interface ParamMergeReport {
  /** Rows the project added, carried over. */
  added: number
  /** Rows the project changed, its changed fields carried over. */
  changed: number
  /** Rows the project removed, removed again. */
  removed: number
  /** Fields the project and the update both changed: the project's value is kept. */
  conflicts: number
  /** Rows the update added or changed that the project hadn't touched. */
  fromUpdate: { added: number; changed: number }
  /** Params whose row layout differs between the versions (fields matched by name). */
  relaid: string[]
  /** A few examples of conflicts, "Param id field". */
  conflictExamples: string[]
}

const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i])
  return a === b
}

/** Fields that hold data (padding is ignored), by name. */
const dataFields = (p: LoadedParam): Map<string, FieldDef> =>
  new Map(p.def.fields.filter((f) => f.type !== 'dummy8').map((f) => [f.name, f]))

/**
 * Merges `mod`'s changes against `base` into `game` (which must be a fresh
 * copy: it is changed in place and becomes the result).
 */
export function mergeParams(mod: ParamDatabase, base: ParamDatabase, game: ParamDatabase): ParamMergeReport {
  const report: ParamMergeReport = {
    added: 0,
    changed: 0,
    removed: 0,
    conflicts: 0,
    fromUpdate: { added: 0, changed: 0 },
    relaid: [],
    conflictExamples: [],
  }
  for (const [name, g] of game.params) {
    const m = mod.params.get(name)
    const b = base.params.get(name)
    if (!m || !b) continue
    const mFields = dataFields(m)
    const bFields = dataFields(b)
    const gFields = dataFields(g)
    const relaid =
      m.def.rowSize !== g.def.rowSize ||
      [...gFields.keys()].some((f) => !mFields.has(f)) ||
      [...mFields.keys()].some((f) => !gFields.has(f))
    if (relaid) report.relaid.push(name)

    const mRows = rowsByOccurrence(m.param.rows)
    const bRows = rowsByOccurrence(b.param.rows)
    const gRows = rowsByOccurrence(g.param.rows)
    let touched = false

    // What the update did to rows the project left alone (for the report).
    for (const [k, gr] of gRows) {
      const br = bRows.get(k)
      const mr = mRows.get(k)
      if (!br) {
        if (!mr) report.fromUpdate.added++
      } else if (mr && mr.data.equals(br.data) && !sameRow(br, gr, bFields, gFields)) report.fromUpdate.changed++
    }

    // The project's changes, onto the new game's rows.
    const removedKeys = new Set<string>()
    const additions: ParamRow[] = []
    for (const [k, mr] of mRows) {
      const br = bRows.get(k)
      const gr = gRows.get(k)
      if (!br) {
        // Added by the project (the update may have added the same id: the project's row wins).
        const row = convertRow(mr, mFields, g)
        if (gr) {
          gr.data = row.data
          gr.name = mr.name || gr.name
        } else additions.push(row)
        report.added++
        touched = true
        continue
      }
      if (mr.data.equals(br.data) && mr.name === br.name) continue
      // Changed by the project: carry its changed fields.
      const target =
        gr ??
        (() => {
          // The update removed the row; the project's version comes back.
          const row = convertRow(br, bFields, g)
          additions.push(row)
          return row
        })()
      for (const [fname, mf] of mFields) {
        const bf = bFields.get(fname)
        const gf = gFields.get(fname)
        if (!bf || !gf) continue
        const mv = getField(mr.data, mf)
        const bv = getField(br.data, bf)
        if (same(mv, bv)) continue
        if (gr) {
          const gv = getField(gr.data, gf)
          if (!same(gv, bv) && !same(gv, mv)) {
            report.conflicts++
            if (report.conflictExamples.length < 12) report.conflictExamples.push(`${name} ${mr.id} ${fname}`)
          }
        }
        setField(target.data, gf, mv)
      }
      if (mr.name !== br.name) target.name = mr.name
      report.changed++
      touched = true
    }
    for (const k of bRows.keys()) {
      if (mRows.has(k) || !gRows.has(k)) continue
      removedKeys.add(k)
      report.removed++
    }

    if (removedKeys.size || additions.length) {
      const keep = new Set([...gRows].filter(([k]) => !removedKeys.has(k)).map(([, r]) => r))
      g.param.rows = g.param.rows.filter((r) => keep.has(r))
      // Rows stay in id order (the game looks them up by binary search).
      for (const row of additions) {
        let at = g.param.rows.findIndex((r) => r.id > row.id)
        if (at < 0) at = g.param.rows.length
        g.param.rows.splice(at, 0, row)
      }
      touched = true
    }
    if (touched) {
      g.dirty = true
      ParamDatabase.reindex(g)
    }
  }
  return report
}

/** Whether two rows hold the same values in every field both layouts have. */
function sameRow(a: ParamRow, b: ParamRow, aFields: Map<string, FieldDef>, bFields: Map<string, FieldDef>): boolean {
  if (aFields === bFields || (a.data.length === b.data.length && sameLayout(aFields, bFields)))
    return a.data.equals(b.data)
  for (const [name, af] of aFields) {
    const bf = bFields.get(name)
    if (bf && !same(getField(a.data, af), getField(b.data, bf))) return false
  }
  return true
}

function sameLayout(a: Map<string, FieldDef>, b: Map<string, FieldDef>): boolean {
  if (a.size !== b.size) return false
  for (const [name, f] of a) {
    const g = b.get(name)
    if (
      !g ||
      g.byteOffset !== f.byteOffset ||
      g.bitOffset !== f.bitOffset ||
      g.type !== f.type ||
      g.bitSize !== f.bitSize
    )
      return false
  }
  return true
}

/** A row in another version's layout: same-named fields copied, new ones at their defaults. */
function convertRow(row: ParamRow, from: Map<string, FieldDef>, to: LoadedParam): ParamRow {
  const toFields = dataFields(to)
  if (row.data.length === to.def.rowSize && sameLayout(from, toFields))
    return { id: row.id, name: row.name, data: Buffer.from(row.data) }
  const data = defaultRowData(to.def)
  for (const [name, f] of from) {
    const t = toFields.get(name)
    if (t) setField(data, t, getField(row.data, f))
  }
  return { id: row.id, name: row.name, data }
}
