/**
 * ParamDatabase — every param in a regulation.bin, joined with its def,
 * Smithbox metadata and community row names, plus reference resolution.
 *
 * Credit: Smithbox (Vawser and contributors; MIT): the param definitions,
 * metadata and community row names come from it.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readRegulation, writeRegulation, paramNameFromPath, type RegulationBundle } from '../formats/regulation.ts'
import { loadParamDefs, parseRegulationVersion, type FieldDef, type ParamDef } from './paramDef.ts'
import { readParam, readParamType, writeParam, getField, type Param, type ParamRow } from './param.ts'
import {
  loadParamMetas,
  loadRowNames,
  loadParamEnums,
  type EnumOption,
  formatExtRefPath,
  type FieldMeta,
  type ParamMeta,
} from './paramMeta.ts'
import { loadFieldLayouts, type FieldGroup } from './fieldLayout.ts'

/**
 * The folder holding Defs/, Param Meta/, ... — either Spellforge's bundled
 * data/er or a Smithbox install (whose data lives in Assets/PARAM/ER).
 */
export function resolveErDataDir(root: string): string {
  const smithbox = path.join(root, 'Assets', 'PARAM', 'ER')
  if (fs.existsSync(path.join(smithbox, 'Defs'))) return smithbox
  return root
}

export function hasErData(root: string): boolean {
  return !!root && fs.existsSync(path.join(resolveErDataDir(root), 'Defs'))
}

export interface SmithboxPaths {
  /** Smithbox install folder (contains Assets/). */
  root: string
}

export interface LoadedParam {
  /** Param name as used by refs, e.g. `Bullet`, `AtkParam_Pc`. */
  name: string
  /** Index of this param's entry in the regulation BND4. */
  entryIndex: number
  def: ParamDef
  param: Param
  meta: ParamMeta
  /** Smithbox's grouping of its fields for the row editor, when its meta names one. */
  layout?: FieldGroup[]
  rowNames: Map<number, string>
  /** row id -> index into param.rows. Rebuilt by `reindex`. */
  index: Map<number, number>
  dirty: boolean
}

/** One resolved outgoing reference from a row. */
export interface RowRef {
  field: string
  /** Field label for display, e.g. "Hit Bullet ID". */
  fieldLabel: string
  targetParam: string
  targetId: number
  /** Smithbox's "owned" hint: the target is meant to be copied with the row. */
  deepCopyTarget?: string
}

/** One resolved reference into an effect file. */
export interface SfxRef {
  field: string
  fieldLabel: string
  sfxId: number
  /** Container relative to the game root, e.g. `sfx\sfxbnd_commoneffects.ffxbnd.dcx`. */
  container: string
  /** In-archive path, e.g. `N:\GR\data\INTERROOT_win64\sfx\effect\f000523010.fxr`. */
  entryPath: string
}

/**
 * Params whose rows belong unambiguously to the player or to NPCs. Refs from
 * them into a Pc/Npc table pair resolve to their own side only. Others — a
 * Bullet can be fired by either — keep both.
 */
const SIDE_OF_PARAM: Record<string, 'pc' | 'npc'> = {
  BehaviorParam_PC: 'pc',
  BehaviorParam: 'npc',
}

export class ParamDatabase {
  readonly bundle: RegulationBundle
  readonly version: number
  readonly params = new Map<string, LoadedParam>()
  /** Value lists for enum fields (Param Enums). */
  enums = new Map<string, EnumOption[]>()

  private constructor(bundle: RegulationBundle) {
    this.bundle = bundle
    this.version = parseRegulationVersion(bundle.bnd.version)
  }

  static load(regulation: Buffer, smithbox: SmithboxPaths): ParamDatabase {
    const db = new ParamDatabase(readRegulation(regulation))
    const er = resolveErDataDir(smithbox.root)
    const defs = loadParamDefs(path.join(er, 'Defs'), path.join(er, 'Param Annotations', 'English'), db.version)
    const metas = loadParamMetas(path.join(er, 'Param Meta'))
    const layouts = loadFieldLayouts(er)
    const namesDir = path.join(er, 'Param Row Names', 'English')
    db.enums = loadParamEnums(path.join(er, 'Param Enums'))

    db.bundle.bnd.entries.forEach((entry, entryIndex) => {
      const name = paramNameFromPath(entry.name)
      const def = defs.get(readParamType(entry.data))
      if (!def) return // unknown params are carried through untouched
      const param = readParam(entry.data, def.rowSize)
      const loaded: LoadedParam = {
        name,
        entryIndex,
        def,
        param,
        meta: metas.get(def.defFile) ?? new Map(),
        layout: layouts.get(def.defFile),
        rowNames: loadRowNames(path.join(namesDir, `${name}.json`)),
        index: new Map(),
        dirty: false,
      }
      ParamDatabase.reindex(loaded)
      db.params.set(name, loaded)
    })

    return db
  }

  static reindex(p: LoadedParam): void {
    p.index.clear()
    p.param.rows.forEach((row, i) => p.index.set(row.id, i))
  }

  /**
   * Layers row names over the community names: a folder of <Param>.json files
   * in Smithbox's format (Smithbox keeps a project's own names in
   * `.smithbox/Project/Stripped Row Names`).
   */
  overlayRowNamesFromDir(dir: string): number {
    if (!fs.existsSync(dir)) return 0
    let count = 0
    for (const p of this.params.values()) {
      for (const [id, name] of loadRowNames(path.join(dir, `${p.name}.json`))) {
        p.rowNames.set(id, name)
        count++
      }
    }
    return count
  }

  overlayRowNames(names: Record<string, Record<string, string>>): void {
    for (const [param, rows] of Object.entries(names)) {
      const p = this.params.get(param)
      if (!p) continue
      for (const [id, name] of Object.entries(rows)) p.rowNames.set(Number(id), name)
    }
  }

  /* ------------------------------- lookups ------------------------------- */

  get(name: string): LoadedParam {
    const p = this.params.get(name)
    if (!p) throw new Error(`Unknown param "${name}"`)
    return p
  }

  row(paramName: string, id: number): ParamRow | undefined {
    const p = this.params.get(paramName)
    if (!p) return undefined
    const i = p.index.get(id)
    return i === undefined ? undefined : p.param.rows[i]
  }

  hasRow(paramName: string, id: number): boolean {
    return this.params.get(paramName)?.index.has(id) ?? false
  }

  field(paramName: string, fieldName: string): FieldDef | undefined {
    return this.params.get(paramName)?.def.fieldsByName.get(fieldName)
  }

  value(paramName: string, id: number, fieldName: string): number | string | number[] | undefined {
    const row = this.row(paramName, id)
    const f = this.field(paramName, fieldName)
    return row && f ? getField(row.data, f) : undefined
  }

  /** A numeric field's value, or `fallback` when the row or field is missing or isn't a number. */
  num(paramName: string, id: number, fieldName: string, fallback = 0): number {
    const v = this.value(paramName, id, fieldName)
    return typeof v === 'number' ? v : fallback
  }

  /** Smithbox community name, falling back to the in-file name. */
  rowName(paramName: string, id: number): string {
    const p = this.params.get(paramName)
    if (!p) return ''
    return p.rowNames.get(id) ?? this.row(paramName, id)?.name ?? ''
  }

  fieldLabel(paramName: string, fieldName: string): string {
    return this.field(paramName, fieldName)?.displayName ?? fieldName
  }

  /* ----------------------------- references ------------------------------ */

  /**
   * Outgoing row references, with conditional refs resolved against the
   * row's own values. Only refs whose target row exists are returned, and 0
   * / negative ids are treated as "none" — that is the convention across ER
   * params, and following them would drag unrelated rows into a clone.
   */
  refsFrom(paramName: string, id: number): RowRef[] {
    const p = this.params.get(paramName)
    const row = this.row(paramName, id)
    if (!p || !row) return []

    const out: RowRef[] = []
    for (const [fieldName, fm] of p.meta) {
      if (fm.refs.length === 0) continue
      const f = p.def.fieldsByName.get(fieldName)
      if (!f) continue
      const value = getField(row.data, f)
      if (typeof value !== 'number' || value <= 0) continue

      for (const target of this.applicableTargets(p, row, fm)) {
        if (!this.hasRow(target, value)) continue
        out.push({
          field: fieldName,
          fieldLabel: f.displayName ?? fieldName,
          targetParam: target,
          targetId: value,
          deepCopyTarget: fm.deepCopyTarget,
        })
      }
    }
    return out
  }

  /** The params a field of a row can point at (its refs whose conditions this row meets). */
  refTargets(paramName: string, id: number, field: string): string[] {
    const p = this.params.get(paramName)
    const row = this.row(paramName, id)
    const fm = p?.meta.get(field)
    if (!p || !row || !fm?.refs.length) return []
    return this.applicableTargets(p, row, fm)
  }

  /** Targets of a field's Refs that apply given the row's condition fields. */
  private applicableTargets(p: LoadedParam, row: ParamRow, fm: FieldMeta): string[] {
    const side = SIDE_OF_PARAM[p.name]
    const out: string[] = []
    for (const t of fm.refs) {
      // BehaviorParam and BehaviorParam_PC share one meta listing both attack
      // tables; a player behavior uses AtkParam_Pc and an NPC one AtkParam_Npc.
      if (side === 'pc' && t.param.endsWith('_Npc')) continue
      if (side === 'npc' && t.param.endsWith('_Pc')) continue
      if (t.conditionField !== undefined) {
        const cf = p.def.fieldsByName.get(t.conditionField)
        if (!cf || getField(row.data, cf) !== t.conditionValue) continue
      }
      if (this.params.has(t.param)) out.push(t.param)
    }
    return out
  }

  /** References from a row into effect files (SFX ids -> .fxr paths). */
  sfxRefsFrom(paramName: string, id: number): SfxRef[] {
    const p = this.params.get(paramName)
    const row = this.row(paramName, id)
    if (!p || !row) return []

    const out: SfxRef[] = []
    for (const [fieldName, fm] of p.meta) {
      const ext = fm.extRefs.find((e) => e.pathTemplate.toLowerCase().endsWith('.fxr'))
      if (!ext) continue
      const f = p.def.fieldsByName.get(fieldName)
      if (!f) continue
      const value = getField(row.data, f)
      if (typeof value !== 'number' || value <= 0) continue
      out.push({
        field: fieldName,
        fieldLabel: f.displayName ?? fieldName,
        sfxId: value,
        container: ext.container,
        entryPath: 'N:\\' + formatExtRefPath(ext.pathTemplate, value),
      })
    }
    return out
  }

  /**
   * Every row (in any param) whose resolved refs point at `targetParam`/`targetId`.
   * Scans the whole regulation, so callers wanting many lookups should use
   * `buildIncomingIndex` instead.
   */
  refsTo(targetParam: string, targetId: number): { param: string; id: number; field: string }[] {
    return this.buildIncomingIndex(targetParam).get(targetId) ?? []
  }

  /** Map of targetId -> referencing rows, for one target param. */
  buildIncomingIndex(targetParam: string): Map<number, { param: string; id: number; field: string }[]> {
    const index = new Map<number, { param: string; id: number; field: string }[]>()
    for (const p of this.params.values()) {
      // Pre-select fields that can ever point at the target param.
      const candidates: { fieldName: string; f: FieldDef; fm: FieldMeta }[] = []
      for (const [fieldName, fm] of p.meta) {
        if (!fm.refs.some((r) => r.param === targetParam)) continue
        const f = p.def.fieldsByName.get(fieldName)
        if (f) candidates.push({ fieldName, f, fm })
      }
      if (candidates.length === 0) continue

      for (const row of p.param.rows) {
        for (const { fieldName, f, fm } of candidates) {
          const value = getField(row.data, f)
          if (typeof value !== 'number' || value <= 0) continue
          if (!this.applicableTargets(p, row, fm).includes(targetParam)) continue
          let list = index.get(value)
          if (!list) index.set(value, (list = []))
          list.push({ param: p.name, id: row.id, field: fieldName })
        }
      }
    }
    return index
  }

  /* -------------------------------- saving ------------------------------- */

  /** Re-serialises dirty params into the bundle and returns a new regulation.bin. */
  toRegulation(): Buffer {
    for (const p of this.params.values()) {
      if (!p.dirty) continue
      const entry = this.bundle.bnd.entries[p.entryIndex]
      entry.data = writeParam(p.param)
      // The entry's size changed, so its original offset no longer applies.
      entry.sourceOffset = undefined
    }
    return writeRegulation(this.bundle)
  }
}
