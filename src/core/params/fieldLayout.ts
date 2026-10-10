/**
 * How a row's fields are laid out in the row editor: Smithbox's field layouts
 * (Field Layouts/<name>.json) group related fields under a heading, in the
 * order its param editor shows them (a weapon's nine Correction Type fields
 * together, its guard cut rates together). A param's meta names its layout
 * (<Self FieldLayout="EquipParamWeapon" />); several params can share one
 * (AtkParam_Pc and AtkParam_Npc). Params without one keep the game's own
 * field order, its paramdefs' SortID, which already keeps families together.
 *
 * Credit: Smithbox (Vawser and contributors; MIT): the field layouts are its
 * JSON files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readTextAuto } from './paramDef.ts'

/** A heading and the fields under it, in order. */
export interface FieldGroup {
  name: string
  fields: string[]
}

interface LayoutFile {
  Name?: string
  Groups?: { Key?: string; Names?: { Language: string; Name: string }[]; Fields?: string[] }[]
}

/** One layout file's groups (empty when it's missing or malformed). */
function readLayout(file: string): FieldGroup[] {
  if (!fs.existsSync(file)) return []
  try {
    const data = JSON.parse(readTextAuto(file)) as LayoutFile
    return (data.Groups ?? [])
      .map((g) => ({
        // The key is the English heading; a few files' English names are slips ("English" for Lips).
        name: (g.Key ?? g.Names?.find((n) => n.Language === 'English')?.Name ?? '').trim(),
        fields: (g.Fields ?? []).filter((f) => typeof f === 'string' && f.length > 0),
      }))
      .filter((g) => g.name && g.fields.length)
  } catch {
    return []
  }
}

/**
 * The field layouts the param metas name, keyed like the metas (by def file
 * basename). `er` is the data folder holding Param Meta/ and Field Layouts/.
 */
export function loadFieldLayouts(er: string): Map<string, FieldGroup[]> {
  const out = new Map<string, FieldGroup[]>()
  const metaDir = path.join(er, 'Param Meta')
  const layoutDir = path.join(er, 'Field Layouts')
  if (!fs.existsSync(metaDir) || !fs.existsSync(layoutDir)) return out
  const cache = new Map<string, FieldGroup[]>()
  for (const name of fs.readdirSync(metaDir)) {
    if (!name.toLowerCase().endsWith('.xml')) continue
    const self = /<Self\b[^>]*\bFieldLayout="([^"]+)"/.exec(readTextAuto(path.join(metaDir, name)))
    if (!self) continue
    const layout = self[1]
    if (!cache.has(layout)) cache.set(layout, readLayout(path.join(layoutDir, `${layout}.json`)))
    const groups = cache.get(layout)!
    if (groups.length) out.set(path.basename(name, path.extname(name)), groups)
  }
  return out
}

/** Fields the layout doesn't list go last, under this heading. */
export const OTHER_GROUP = 'Other'

/**
 * Fields in the order the row editor lists them, each with its heading: the
 * layout's groups in order (a field listed twice shows once, in its first
 * group), then the fields it doesn't list under OTHER_GROUP. Without a
 * layout, by SortID with no headings. Fields without a SortID keep their
 * place after those with one; ties keep the paramdef's order.
 */
export function orderFields<T extends { name: string; sortId?: number }>(
  fields: T[],
  layout?: FieldGroup[],
): { field: T; group?: string }[] {
  const bySort = (list: T[]) =>
    list
      .map((field, i) => ({ field, i }))
      .sort((a, b) => (a.field.sortId ?? Infinity) - (b.field.sortId ?? Infinity) || a.i - b.i)
      .map((x) => x.field)
  if (!layout?.length) return bySort(fields).map((field) => ({ field }))
  const byName = new Map(fields.map((f) => [f.name, f]))
  const placed = new Set<string>()
  const out: { field: T; group?: string }[] = []
  for (const g of layout)
    for (const name of g.fields) {
      const field = byName.get(name)
      if (!field || placed.has(name)) continue
      placed.add(name)
      out.push({ field, group: g.name })
    }
  for (const field of bySort(fields.filter((f) => !placed.has(f.name)))) out.push({ field, group: OTHER_GROUP })
  return out
}
