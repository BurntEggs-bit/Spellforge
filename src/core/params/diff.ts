/**
 * What a project changes relative to the game, param by param.
 *
 * Rows are matched by (id, occurrence) rather than id alone: a few retail
 * params (RandomAppearParam, PhantomParam) repeat ids, and matching by id
 * alone pairs the wrong duplicates and reports phantom changes.
 */
import type { ParamDatabase } from './paramDb.ts'
import { rowsByOccurrence } from './param.ts'

export interface ParamDiff {
  param: string
  added: number[]
  removed: number[]
  changed: number[]
}

export function diffParams(base: ParamDatabase, project: ParamDatabase): ParamDiff[] {
  const out: ParamDiff[] = []
  for (const p of project.params.values()) {
    const b = base.params.get(p.name)
    if (!b) continue
    const before = rowsByOccurrence(b.param.rows)
    const after = rowsByOccurrence(p.param.rows)
    const diff: ParamDiff = { param: p.name, added: [], removed: [], changed: [] }
    for (const [k, row] of after) {
      const old = before.get(k)
      if (!old) diff.added.push(row.id)
      else if (!old.data.equals(row.data)) diff.changed.push(row.id)
    }
    for (const [k, row] of before) if (!after.has(k)) diff.removed.push(row.id)
    if (diff.added.length || diff.removed.length || diff.changed.length) out.push(diff)
  }
  return out
}
