/**
 * Smithbox's param metadata (Assets/PARAM/ER/Param Meta/*.xml) — the
 * reference graph between params, plus display hints.
 *
 * One meta file per *def*, not per param: AtkParam.xml covers AtkParam_Pc and
 * AtkParam_Npc, BehaviorParam.xml covers BehaviorParam and BehaviorParam_PC.
 *
 * Field attributes we use:
 *   Refs="A,B(field=value),..."   row references; a parenthesised condition
 *                                 means the ref only applies when another
 *                                 field of the same row has that value
 *   ExtRefs="label,bnd,path{0:D9}.fxr;..."  references into other files —
 *                                 notably SFX ids into the FXR effect bnd
 *   DeepCopyTarget="SpEffect"     Smithbox's hint that the ref is "owned"
 *                                 and copied along with the row
 *   Enum / IsBool                 display hints
 *   IconConfig="Item"             a menu icon id (Item, Status, MapIcon)
 *   FlagAlias                     an event flag id
 *   FmgRef="Table(field=v),..."   a text id, in which text table (Smithbox's
 *                                 table names), with conditions like Refs
 *   SoundAlias                    a sound id
 *   VRef="behaviorVariation"      an id of a kind with no param of its own,
 *                                 shared by the fields with the same VRef
 *
 * Credit: Smithbox (Vawser and contributors; MIT): the metadata is its XML
 * files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import { readTextAuto } from './paramDef.ts'

export interface RefTarget {
  /** Param name, e.g. `Bullet`, `AtkParam_Pc`. */
  param: string
  /** When set, the ref only applies if `row[conditionField] === conditionValue`. */
  conditionField?: string
  conditionValue?: number
}

export interface ExtRef {
  label: string
  /** Container path relative to the game root, e.g. `sfx\sfxbnd_commoneffects.ffxbnd.dcx`. */
  container: string
  /** In-archive path template, e.g. `...\effect\f{0:D9}.fxr`. */
  pathTemplate: string
}

export interface FieldMeta {
  refs: RefTarget[]
  extRefs: ExtRef[]
  deepCopyTarget?: string
  enumName?: string
  isBool: boolean
  /** A menu icon id of this kind (IconConfig). */
  icon?: string
  /** An event flag id (FlagAlias). */
  flag?: boolean
  /** A text id: the tables it's in (FmgRef; `param` is the table's name), conditions as for refs. */
  text?: RefTarget[]
  /** A sound id (SoundAlias). */
  sound?: boolean
  /** Ids of a kind with no param of its own, shared by fields with the same name (VRef). */
  vref?: string
}

export type ParamMeta = Map<string, FieldMeta>

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  preserveOrder: true,
})

const REF_PATTERN = /^\s*([A-Za-z0-9_]+)\s*(?:\(\s*([A-Za-z0-9_]+)\s*=\s*(-?\d+)\s*\))?\s*$/

function parseRefs(value: string): RefTarget[] {
  const out: RefTarget[] = []
  for (const part of value.split(',')) {
    if (!part.trim()) continue
    const m = REF_PATTERN.exec(part)
    if (!m) continue
    const [, param, field, cond] = m
    out.push(field ? { param, conditionField: field, conditionValue: Number(cond) } : { param })
  }
  return out
}

function parseExtRefs(value: string): ExtRef[] {
  return value
    .split(';')
    .map((group) => group.split(','))
    .filter((parts) => parts.length >= 3)
    .map(([label, container, pathTemplate]) => ({
      label: label.trim(),
      container: container.trim(),
      pathTemplate: pathTemplate.trim(),
    }))
}

/** Formats an ExtRef path template like `f{0:D9}.fxr` for an id. */
export function formatExtRefPath(template: string, id: number): string {
  return template.replace(/\{0(?::D(\d+))?\}/g, (_, width) =>
    width ? String(id).padStart(Number(width), '0') : String(id),
  )
}

/** An element as the parser's preserveOrder output has it: its name to its children, its attributes under ':@'. */
interface OrderedNode {
  [name: string]: OrderedNode[] | Record<string, string> | undefined
  ':@'?: Record<string, string>
}

/** The children of the first of these elements that has any named `name`. */
function childrenNamed(nodes: OrderedNode[], name: string): OrderedNode[] {
  const children = nodes.find((n) => n[name])?.[name]
  return Array.isArray(children) ? children : []
}

function loadParamMeta(file: string): ParamMeta {
  const meta: ParamMeta = new Map()
  if (!fs.existsSync(file)) return meta

  // preserveOrder yields [{ PARAMMETA: [ { Field: [ { fieldName: [], ':@': {attrs} } ] } ] }]
  const doc = parser.parse(readTextAuto(file)) as OrderedNode[]
  const fieldSection = childrenNamed(childrenNamed(doc, 'PARAMMETA'), 'Field')

  for (const node of fieldSection) {
    const name = Object.keys(node).find((k) => k !== ':@')
    if (!name) continue
    const attrs = node[':@'] ?? {}
    meta.set(name, {
      refs: attrs.Refs ? parseRefs(attrs.Refs) : [],
      extRefs: attrs.ExtRefs ? parseExtRefs(attrs.ExtRefs) : [],
      deepCopyTarget: attrs.DeepCopyTarget || undefined,
      enumName: attrs.Enum || undefined,
      isBool: attrs.IsBool !== undefined,
      icon: attrs.IconConfig || undefined,
      flag: attrs.FlagAlias !== undefined || undefined,
      text: attrs.FmgRef ? parseRefs(attrs.FmgRef) : undefined,
      sound: attrs.SoundAlias !== undefined || undefined,
      vref: attrs.VRef || undefined,
    })
  }
  return meta
}

/** Loads every meta in a directory, keyed by file basename (= def file basename). */
export function loadParamMetas(dir: string): Map<string, ParamMeta> {
  const metas = new Map<string, ParamMeta>()
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.xml')) continue
    metas.set(path.basename(name, path.extname(name)), loadParamMeta(path.join(dir, name)))
  }
  return metas
}

/* --------------------------------- enums -------------------------------- */

export interface EnumOption {
  value: number
  label: string
}

interface EnumFile {
  Key?: string
  Options?: { Key: string; Names?: { Language: string; Text: string }[] }[]
}

/** Smithbox's value lists (Param Enums/<NAME>.json), keyed by enum name. */
export function loadParamEnums(dir: string): Map<string, EnumOption[]> {
  const enums = new Map<string, EnumOption[]>()
  if (!fs.existsSync(dir)) return enums
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.json')) continue
    try {
      const data = JSON.parse(readTextAuto(path.join(dir, name))) as EnumFile
      const key = data.Key ?? path.basename(name, '.json')
      const options: EnumOption[] = []
      for (const o of data.Options ?? []) {
        const value = Number(o.Key)
        if (!Number.isFinite(value)) continue
        const label = o.Names?.find((n) => n.Language === 'English')?.Text ?? o.Names?.[0]?.Text ?? String(value)
        options.push({ value, label })
      }
      enums.set(key, options)
    } catch {
      /* skip a malformed enum file */
    }
  }
  return enums
}

/* ------------------------------- row names ------------------------------- */

interface RowNameFile {
  Name?: string
  Entries?: { ID: number; Entries?: string[] }[]
}

/** Smithbox's community row names (Param Row Names/English/<Param>.json). */
export function loadRowNames(file: string): Map<number, string> {
  const names = new Map<number, string>()
  if (!fs.existsSync(file)) return names
  try {
    const data = JSON.parse(readTextAuto(file)) as RowNameFile
    for (const e of data.Entries ?? []) {
      const name = e.Entries?.find((n) => n && n.trim())
      if (name) names.set(e.ID, name.trim())
    }
  } catch {
    /* a malformed names file just means no names */
  }
  return names
}
