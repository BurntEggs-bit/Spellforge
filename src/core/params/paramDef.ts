/**
 * PARAMDEF — the schema describing a param's row layout.
 *
 * We load Smithbox's XML defs (Assets/PARAM/ER/Defs/*.xml) rather than the
 * binary .paramdef files, since Smithbox keeps them current with game patches.
 * Each field is declared as:
 *
 *   <Field Def="<type> <name>[<count>]:<bits> = <default>">
 *
 * where `[count]`, `:bits` and `= default` are each optional.
 *
 * Layout rules (matching SoulsFormats):
 *  - Fields are laid out in declaration order with no implicit padding.
 *  - A run of bitfields of the same storage type shares one storage unit
 *    until the next field would overflow it; any non-bitfield, a change of
 *    type, or an overflow starts a new unit. `dummy8` bitfields store as u8.
 *  - `dummy8 x[n]` is n raw bytes, `fixstr x[n]` is n bytes of Shift-JIS,
 *    `fixstrW x[n]` is n UTF-16 code units (2n bytes).
 *
 * The computed row size was checked against the real row stride of every
 * param in regulation.bin.
 *
 * Credit: Smithbox (Vawser and contributors; MIT): the definitions are its XML
 * files. SoulsFormats (TKGP; read as documentation only) documents the layout
 * rules.
 */
import fs from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'

export type FieldType =
  's8' | 'u8' | 's16' | 'u16' | 's32' | 'u32' | 'f32' | 'f64' | 'b32' | 'angle32' | 'dummy8' | 'fixstr' | 'fixstrW'

export interface FieldDef {
  name: string
  type: FieldType
  /** Element count for arrays (dummy8/fixstr/fixstrW); 1 otherwise. */
  arrayLength: number
  /** Bit width for bitfields; -1 for ordinary fields. */
  bitSize: number
  defaultValue: number | string
  /** Byte offset of the field (or of its storage unit, for bitfields). */
  byteOffset: number
  /** Bit offset within the storage unit; 0 for ordinary fields. */
  bitOffset: number
  /** English display name from Smithbox's annotations, when available. */
  displayName?: string
  description?: string
  minimum?: number
  maximum?: number
  sortId?: number
  /** Name of a Param Enums list for this field, from the def's <Enum>. */
  enumName?: string
}

export interface ParamDef {
  /** e.g. `BULLET_PARAM_ST` */
  paramType: string
  /**
   * Basename of the def file, e.g. `BulletParam`. Smithbox's metadata files
   * share this name, which is how a param finds its meta.
   */
  defFile: string
  dataVersion: number
  formatVersion: number
  unicode: boolean
  fields: FieldDef[]
  rowSize: number
  /** Short English description of the whole param, from annotations. */
  description?: string
  fieldsByName: Map<string, FieldDef>
}

const DEF_PATTERN = /^\s*(\w+)\s+(\w+)\s*(?:\[\s*(\d+)\s*\])?\s*(?::\s*(\d+))?\s*(?:=\s*(.+?))?\s*$/

const SCALAR_SIZE: Record<string, number> = {
  s8: 1,
  u8: 1,
  dummy8: 1,
  s16: 2,
  u16: 2,
  s32: 4,
  u32: 4,
  f32: 4,
  b32: 4,
  angle32: 4,
  f64: 8,
}

/** Storage unit bit capacity, used for bitfield packing. */
function bitCapacity(type: FieldType): number {
  return (SCALAR_SIZE[type] ?? 1) * 8
}

/** Byte size of one non-bitfield field, including arrays. */
function fieldByteSize(type: FieldType, arrayLength: number): number {
  if (type === 'fixstr' || type === 'dummy8') return arrayLength
  if (type === 'fixstrW') return arrayLength * 2
  return (SCALAR_SIZE[type] ?? 0) * arrayLength
}

function parseDefString(def: string): {
  type: FieldType
  name: string
  arrayLength: number
  bitSize: number
  defaultValue: number | string
} {
  const m = DEF_PATTERN.exec(def)
  if (!m) throw new Error(`Unparseable field Def: "${def}"`)
  const [, type, name, count, bits, dflt] = m
  if (!(type in SCALAR_SIZE) && type !== 'fixstr' && type !== 'fixstrW') {
    throw new Error(`Unknown field type "${type}" in Def "${def}"`)
  }
  let defaultValue: number | string = 0
  if (dflt !== undefined) {
    const n = Number(dflt)
    defaultValue = Number.isNaN(n) ? dflt : n
  } else if (type === 'fixstr' || type === 'fixstrW') {
    defaultValue = ''
  }
  return {
    type: type as FieldType,
    name,
    arrayLength: count ? Number(count) : 1,
    bitSize: bits ? Number(bits) : -1,
    defaultValue,
  }
}

/** Assigns byte/bit offsets to every field and returns the total row size. */
function layoutFields(fields: FieldDef[]): number {
  let offset = 0
  let bitType: FieldType | null = null
  let bitPos = 0
  let unitOffset = 0

  for (const field of fields) {
    if (field.bitSize === -1) {
      bitType = null
      field.byteOffset = offset
      field.bitOffset = 0
      offset += fieldByteSize(field.type, field.arrayLength)
      continue
    }

    // Bitfield: dummy8 bitfields share storage rules with u8.
    const storage: FieldType = field.type === 'dummy8' ? 'u8' : field.type
    const capacity = bitCapacity(storage)
    const startNewUnit = bitType === null || storage !== bitType || bitPos + field.bitSize > capacity

    if (startNewUnit) {
      unitOffset = offset
      offset += SCALAR_SIZE[storage]
      bitType = storage
      bitPos = 0
    }

    field.byteOffset = unitOffset
    field.bitOffset = bitPos
    bitPos += field.bitSize
  }

  return offset
}

/* -------------------------------- loading -------------------------------- */

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  isArray: (name) => name === 'Field',
  parseTagValue: false,
  trimValues: true,
})

/** Reads a text file that may be UTF-8 or UTF-16 (with or without a BOM). */
export function readTextAuto(file: string): string {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    // UTF-16 BE: swap to LE.
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  return buf.toString('utf8')
}

interface AnnotationFile {
  Description?: string
  Fields?: { Field: string; Name?: string; Description?: string }[]
}

/**
 * Regulation versions look like "11611000" (the BND4 version string of
 * regulation.bin). Defs mark patch-specific fields with FirstVersion /
 * RemovedVersion in the same numbering.
 */
export function parseRegulationVersion(version: string): number {
  const n = Number(version.replace(/[^0-9]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** A <Field> as the XML parser gives it: attributes and child elements, as text or numbers. */
interface XmlField {
  Def: string
  Minimum?: string | number
  Maximum?: string | number
  SortID?: string | number
  Enum?: string
  FirstVersion?: string | number
  RemovedVersion?: string | number
}

function fieldExistsIn(f: XmlField, version: number | undefined): boolean {
  if (version === undefined) return f.RemovedVersion === undefined
  if (f.FirstVersion !== undefined && version < Number(f.FirstVersion)) return false
  if (f.RemovedVersion !== undefined && version >= Number(f.RemovedVersion)) return false
  return true
}

/**
 * @param regulationVersion Only fields present in this regulation version are
 *   laid out. Omit to use the latest layout.
 */
function loadParamDefXml(file: string, annotationsDir?: string, regulationVersion?: number): ParamDef {
  const doc = xml.parse(readTextAuto(file))
  const root = doc.PARAMDEF
  if (!root) throw new Error(`${file}: not a PARAMDEF`)

  const rawFields: XmlField[] = (root.Fields?.Field ?? []).filter((f: XmlField) => fieldExistsIn(f, regulationVersion))
  const fields: FieldDef[] = rawFields.map((f) => {
    const parsed = parseDefString(f.Def)
    const num = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v))
    return {
      ...parsed,
      byteOffset: 0,
      bitOffset: 0,
      // Smithbox defs carry Japanese DisplayNames; English comes from annotations.
      minimum: num(f.Minimum),
      maximum: num(f.Maximum),
      sortId: num(f.SortID),
      enumName: f.Enum ? String(f.Enum) : undefined,
    }
  })

  const rowSize = layoutFields(fields)
  const paramType = String(root.ParamType)

  const def: ParamDef = {
    paramType,
    defFile: path.basename(file, path.extname(file)),
    dataVersion: Number(root.DataVersion ?? 0),
    formatVersion: Number(root.FormatVersion ?? 0),
    unicode: String(root.Unicode).toLowerCase() === 'true',
    fields,
    rowSize,
    fieldsByName: new Map(fields.map((f) => [f.name, f])),
  }

  if (annotationsDir) applyAnnotations(def, path.join(annotationsDir, `${paramType}.json`))
  return def
}

function applyAnnotations(def: ParamDef, file: string): void {
  if (!fs.existsSync(file)) return
  let ann: AnnotationFile
  try {
    ann = JSON.parse(readTextAuto(file))
  } catch {
    return
  }
  def.description = ann.Description
  for (const a of ann.Fields ?? []) {
    const field = def.fieldsByName.get(a.Field)
    if (!field) continue
    if (a.Name) field.displayName = a.Name
    if (a.Description) field.description = a.Description
  }
}

/**
 * Loads every def in a directory, keyed by paramType (e.g. BULLET_PARAM_ST).
 * The regulation identifies each param by its type string, which is how a
 * `.param` is matched to its def.
 */
export function loadParamDefs(
  defsDir: string,
  annotationsDir?: string,
  regulationVersion?: number,
): Map<string, ParamDef> {
  const defs = new Map<string, ParamDef>()
  for (const name of fs.readdirSync(defsDir)) {
    if (!name.toLowerCase().endsWith('.xml')) continue
    const def = loadParamDefXml(path.join(defsDir, name), annotationsDir, regulationVersion)
    defs.set(def.paramType, def)
  }
  return defs
}
