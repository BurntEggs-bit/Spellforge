/**
 * The game's text for the text editor: languages, the text binders the game
 * actually reads, their FMG files with readable titles, grouped like the
 * game splits them (base game, DLC 1, DLC 2), and which param each table
 * names (WeaponName row ids are EquipParamWeapon ids).
 *
 *   msg/<lang>/item_dlc02.msgbnd.dcx   every item table: base, _dlc01, _dlc02
 *   msg/<lang>/menu_dlc02.msgbnd.dcx   every menu table: dialogue, menus, ...
 *
 * With the DLC installed the game reads the _dlc02 binders, which contain
 * the base and DLC 1 tables as well; older binders (item, item_dlc01) are
 * fallbacks for installs without them.
 */
import { fileNameOf } from '../formats/paths.ts'

export const LANGUAGES: { code: string; name: string }[] = [
  { code: 'engus', name: 'English (US)' },
  { code: 'frafr', name: 'French' },
  { code: 'deude', name: 'German' },
  { code: 'itait', name: 'Italian' },
  { code: 'jpnjp', name: 'Japanese' },
  { code: 'kokr', name: 'Korean' },
  { code: 'polpl', name: 'Polish' },
  { code: 'rusru', name: 'Russian' },
  { code: 'spaes', name: 'Spanish' },
  { code: 'spaar', name: 'Spanish (Latin America)' },
  { code: 'porbr', name: 'Portuguese (Brazil)' },
  { code: 'zhotw', name: 'Traditional Chinese' },
  { code: 'zhocn', name: 'Simplified Chinese' },
  { code: 'thath', name: 'Thai' },
  { code: 'araae', name: 'Arabic' },
]

/** The binder the game reads for each kind, newest first. */
export const CONTAINERS: { kind: 'item' | 'menu'; label: string; files: string[] }[] = [
  { kind: 'item', label: 'Items', files: ['item_dlc02.msgbnd.dcx', 'item_dlc01.msgbnd.dcx', 'item.msgbnd.dcx'] },
  {
    kind: 'menu',
    label: 'Menus & dialogue',
    files: ['menu_dlc02.msgbnd.dcx', 'menu_dlc01.msgbnd.dcx', 'menu.msgbnd.dcx'],
  },
]

const TITLES: Record<string, string> = {
  WeaponName: 'Weapon names',
  WeaponInfo: 'Weapon short descriptions',
  WeaponCaption: 'Weapon descriptions',
  WeaponEffect: 'Weapon effect text',
  ProtectorName: 'Armor names',
  ProtectorInfo: 'Armor short descriptions',
  ProtectorCaption: 'Armor descriptions',
  AccessoryName: 'Talisman names',
  AccessoryInfo: 'Talisman short descriptions',
  AccessoryCaption: 'Talisman descriptions',
  GoodsName: 'Item names (incl. spells)',
  GoodsInfo: 'Item short descriptions',
  GoodsInfo2: 'Item extra info',
  GoodsCaption: 'Item descriptions (incl. spells)',
  GoodsDialog: 'Item use prompts',
  GemName: 'Ash of War names',
  GemInfo: 'Ash of War short descriptions',
  GemCaption: 'Ash of War descriptions',
  GemEffect: 'Ash of War effect text',
  ArtsName: 'Skill names',
  ArtsCaption: 'Skill descriptions',
  MagicName: 'Spell names (unused: spells are items)',
  MagicInfo: 'Spell short descriptions (unused)',
  MagicCaption: 'Spell descriptions (unused)',
  NpcName: 'NPC names',
  PlaceName: 'Place names',
  TalkMsg: 'NPC dialogue',
  BloodMsg: 'Player message templates',
  MovieSubtitle: 'Cutscene subtitles',
  NetworkMessage: 'Online messages',
  ActionButtonText: 'Action prompts',
  EventTextForTalk: 'Event text (talking)',
  EventTextForMap: 'Event text (on the map)',
  GR_MenuText: 'Menu text',
  GR_LineHelp: 'Menu help lines',
  GR_KeyGuide: 'Button guides',
  GR_System_Message_win64: 'System messages',
  GR_Dialogues: 'Dialog boxes',
  LoadingTitle: 'Loading screen titles',
  LoadingText: 'Loading screen text',
  TutorialTitle: 'Tutorial titles',
  TutorialBody: 'Tutorial text',
  TextEmbedImageName_win64: 'Inline icon names',
  ToS_win64: 'Terms of service',
}

/** Tables whose entry ids are row ids of a param. */
const PARAM_OF: [RegExp, string][] = [
  [/^Weapon/, 'EquipParamWeapon'],
  [/^Protector/, 'EquipParamProtector'],
  [/^Accessory/, 'EquipParamAccessory'],
  [/^Goods/, 'EquipParamGoods'],
  [/^Gem/, 'EquipParamGem'],
  [/^Arts/, 'SwordArtsParam'],
]

export interface TextFileInfo {
  /** FMG file name without folder or extension, e.g. WeaponName_dlc01. */
  file: string
  /** Its table, without the _dlcNN suffix. */
  table: string
  title: string
  group: 'Base game' | 'DLC 1' | 'DLC 2'
  /** Param whose row ids the entries use, if any. */
  param?: string
}

export function textFileInfo(entryName: string): TextFileInfo {
  const file = fileNameOf(entryName).replace(/\.fmg$/i, '')
  const m = /^(.*?)_dlc0?(\d)$/i.exec(file)
  const table = m ? m[1] : file
  const dlc = m ? Number(m[2]) : 0
  return {
    file,
    table,
    title:
      TITLES[table] ??
      table
        .replace(/^GR_/, '')
        .replace(/_win64$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2'),
    group: dlc === 2 ? 'DLC 2' : dlc === 1 ? 'DLC 1' : 'Base game',
    param: PARAM_OF.find(([re]) => re.test(table))?.[1],
  }
}
