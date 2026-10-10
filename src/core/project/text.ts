/**
 * Official item names from the game's text files, layered like everything
 * else: a project's msg files override the game's.
 *
 * msg/engus/item.msgbnd.dcx, item_dlc01 and item_dlc02 each hold FMG tables
 * (WeaponName.fmg, WeaponName_dlc01.fmg, ...). They're merged in that order,
 * later text winning, and each table is mapped to the param whose row ids it
 * names.
 */
import { dcxDecompress } from '../formats/dcx.ts'
import { readBnd4 } from '../formats/bnd4.ts'
import { readFmg, writeFmg } from '../formats/fmg.ts'
import type { Project } from './project.ts'

const ITEM_MSG_FILES = [
  'msg/engus/item.msgbnd.dcx',
  'msg/engus/item_dlc01.msgbnd.dcx',
  'msg/engus/item_dlc02.msgbnd.dcx',
]

/** Text table (without its _dlcNN suffix) -> the param it names. */
const NAME_TABLES: Record<string, string> = {
  WeaponName: 'EquipParamWeapon',
  ProtectorName: 'EquipParamProtector',
  AccessoryName: 'EquipParamAccessory',
  GoodsName: 'EquipParamGoods',
  GemName: 'EquipParamGem',
  ArtsName: 'SwordArtsParam',
}

/**
 * Params whose rows are named by another param's text. A sorcery or
 * incantation is an item: the game shows the name of its EquipParamGoods row
 * (GoodsName, same id). MagicName is empty in the game and never shown.
 */
export const NAMED_LIKE: Record<string, string> = { Magic: 'EquipParamGoods' }

/**
 * Params whose rows find their text through a field rather than their own id:
 * a skill shows ArtsName[textId] (Loretta's Slash 1165 uses 118's text).
 */
export const TEXT_ID_FIELD: Record<string, string> = { SwordArtsParam: 'textId' }

/**
 * Whether a name is a stand-in rather than a real name: empty, the game's
 * "%null%" and "[ERROR]", or a bracketed label ("[Weapon] ...", the
 * community's names for rows the game never names).
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  return !name || !name.trim() || name.startsWith('[') || /%null%|\[ERROR\]/i.test(name)
}

/** The params one in-game name applies to: EquipParamGoods -> [EquipParamGoods, Magic]. */
export function paramsNamedBy(param: string): string[] {
  const root = NAMED_LIKE[param] ?? param
  return [root, ...Object.keys(NAMED_LIKE).filter((p) => NAMED_LIKE[p] === root)]
}

function tableName(entryName: string): string {
  const base = entryName.slice(Math.max(entryName.lastIndexOf('\\'), entryName.lastIndexOf('/')) + 1)
  return base.replace(/\.fmg$/i, '').replace(/_dlc\d+$/i, '')
}

/** param -> the text table that names it (reverse of NAME_TABLES; a spell's is its item's). */
export function nameTableFor(param: string): string | null {
  const named = NAMED_LIKE[param] ?? param
  return Object.entries(NAME_TABLES).find(([, p]) => p === named)?.[0] ?? null
}

export interface OpenMsgBnd {
  rel: string
  bnd: ReturnType<typeof readBnd4>
  dcx: ReturnType<typeof dcxDecompress>['info']
}

/**
 * Sets an item's in-game name inside one msgbnd: in the table variant that
 * already has the id (WeaponName_dlc02 before WeaponName), else the base
 * table. Returns false if the msgbnd has no table for that param.
 */
export function setNameInMsgBnd(msg: OpenMsgBnd, param: string, id: number, text: string): boolean {
  const table = nameTableFor(param)
  return table ? setTextInMsgBnd(msg, table, id, text) : false
}

/** The description table of a param's rows: WeaponName -> WeaponCaption, ArtsName -> ArtsCaption. */
export function captionTableFor(param: string): string | null {
  const name = nameTableFor(param)
  return name ? name.replace(/Name$/, 'Caption') : null
}

/** Sets one entry of a text table inside one msgbnd, in the variant that already has it (DLC first), else the base table. */
export function setTextInMsgBnd(msg: OpenMsgBnd, table: string, id: number, text: string): boolean {
  const candidates = msg.bnd.entries.filter((e) => tableName(e.name) === table)
  if (!candidates.length) return false
  // DLC tables override base ones, so edit where the name actually lives.
  const ordered = [...candidates].sort((a, b) => Number(/_dlc\d+/i.test(b.name)) - Number(/_dlc\d+/i.test(a.name)))
  const target =
    ordered.find((e) => readFmg(e.data).get(id)) ?? candidates.find((e) => !/_dlc\d+/i.test(e.name)) ?? candidates[0]
  const fmg = readFmg(target.data)
  fmg.set(id, text)
  target.data = writeFmg(fmg)
  target.sourceOffset = undefined
  return true
}

export interface ItemText {
  /** param -> row id -> official name */
  names: Record<string, Record<string, string>>
  /** Which files were read, and from where. */
  sources: { file: string; source: 'project' | 'game' }[]
}

/** One item text table by name (e.g. NpcName, keyed by NpcParam.nameId), DLC text winning. */
export function loadItemTable(project: Project, table: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const rel of ITEM_MSG_FILES) {
    if (!project.resolve(rel)) continue
    let bnd
    try {
      bnd = readBnd4(dcxDecompress(project.read(rel).data).data)
    } catch {
      continue
    }
    const ordered = [...bnd.entries].sort((a, b) => Number(/_dlc\d+/i.test(a.name)) - Number(/_dlc\d+/i.test(b.name)))
    for (const e of ordered) {
      if (tableName(e.name) !== table) continue
      try {
        for (const [id, text] of readFmg(e.data)) if (text && text.trim() && text !== '%null%') out.set(id, text.trim())
      } catch {
        /* a damaged table: skip it */
      }
    }
  }
  return out
}

export function loadItemText(project: Project): ItemText {
  const names: Record<string, Record<string, string>> = {}
  const sources: ItemText['sources'] = []
  for (const rel of ITEM_MSG_FILES) {
    const r = project.resolve(rel)
    if (!r) continue
    let bnd
    try {
      bnd = readBnd4(dcxDecompress(project.read(rel).data).data)
    } catch {
      continue // a damaged text file shouldn't stop a project opening
    }
    sources.push({ file: rel, source: r.source })
    // Base tables first, then _dlc tables, so DLC text wins within a file.
    const ordered = [...bnd.entries].sort((a, b) => Number(/_dlc\d+/i.test(a.name)) - Number(/_dlc\d+/i.test(b.name)))
    for (const e of ordered) {
      const param = NAME_TABLES[tableName(e.name)]
      if (!param) continue
      let fmg
      try {
        fmg = readFmg(e.data)
      } catch {
        continue
      }
      const target = (names[param] ??= {})
      for (const [id, text] of fmg) {
        if (text && text.trim() && text !== '%null%') target[String(id)] = text.trim()
      }
    }
  }
  return { names, sources }
}
