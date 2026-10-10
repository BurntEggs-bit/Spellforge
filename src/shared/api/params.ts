/** IPC contract: browsing and editing param rows: lists, the reference tree, fields, cloning and duplicating. */
import type { ProjectState } from './project.ts'

export type BrowseKind = 'weapons' | 'goods' | 'spells' | 'skills' | 'bullets' | 'effects'

export interface BrowseRow {
  param: string
  id: number
  name: string
  state: ProjectState
  /** Short secondary text, e.g. a weapon's motion category. */
  detail?: string
}

export interface TreeNode {
  /** `param:id` for rows, `fxr:id` for effects. */
  key: string
  kind: 'row' | 'effect'
  param?: string
  id: number
  name: string
  state: ProjectState
  /** Field the parent reached this through, e.g. "Hit Bullet ID". */
  via?: string
  /** Effects this row uses. */
  effects: { field: string; label: string; id: number; exists: boolean; name: string }[]
  /** Child keys not yet expanded (lazy). */
  hasChildren: boolean
  /** For player behaviors: how many animations fire this row. */
  animationCount?: number
}

export interface FieldView {
  name: string
  label: string
  /** The heading it's listed under (Smithbox's field layout for the param), when the param has one. */
  group?: string
  description?: string
  /** Spellforge's plain-English hint for this field, when it has one. */
  hint?: string
  /** Listed even when 0 (the editor hides zeros by default): a switch whose 0 means something. */
  key?: boolean
  type: string
  value: number | string | number[]
  min?: number
  max?: number
  isBool: boolean
  /** Resolved ref targets for this value, if it is a ref field. */
  refs: { param: string; id: number; name: string }[]
  /** Effect file for an SFX field, and its name. */
  effect?: { id: number; exists: boolean; name?: string }
  /** A reference that points at nothing: no row with this id in the param(s) it can name, e.g. "No Bullet 12345". */
  refMissing?: string
  /**
   * The game's menu icon an icon field shows (kind: Item, Status, MapIcon); `exists` false when the game has no such
   * icon. `known`: a value the game itself uses there (or a named option), so a missing picture isn't a mistake
   * (a blocked grace's map icon 2 is drawn from the grace's).
   */
  icon?: { kind: string; id: number; exists: boolean; known?: boolean }
  /** What the value means when it isn't another param's row: an event flag, a text id, an id shared by fields. */
  about?: FieldAbout
  /** Named values for enum fields. */
  enumOptions?: { value: number; label: string }[]
}

/** One line about a field's value; `lookup` opens "What is this ID?" for it. */
export interface FieldAbout {
  kind: 'flag' | 'text' | 'vref' | 'entity'
  label: string
  lookup?: number
}

export interface ParamInfo {
  name: string
  paramType: string
  description?: string
  rows: number
  added: number
  changed: number
}

export interface RowReferrer {
  param: string
  id: number
  name: string
  field: string
}

export interface AnimationLink {
  /** e.g. a680_040000 */
  animation: string
  event: string
  start: number
  end: number
  dummyPoly?: number
}

export interface RowView {
  param: string
  id: number
  name: string
  state: ProjectState
  paramDescription?: string
  /** The row's own icon in game (an item's, a status effect's), when it has one. */
  icon?: { kind: string; id: number }
  fields: FieldView[]
  /** For player behaviors: animations whose events fire this row. */
  animations?: AnimationLink[]
  /** The judge id those animations use for this row (e.g. 3570). */
  animationJudge?: number
  /** For items with an in-game name (weapons, armor, goods, ...): that name. */
  gameName?: string
  /** What doesn't work as it's set (a lasting SpEffect whose cycle never fires…), in words. */
  warnings?: string[]
  /**
   * A bullet whose attack exists only for enemies (AtkParam_Npc): fired by
   * the player it would do no damage until AtkParam_Pc has the same row.
   */
  enemyAttack?: { id: number; name: string }
  /** A skill, spell (or its item) or bullet: "Scale…" resizes its effects and hitboxes. */
  scalable?: boolean
  /**
   * A shop row (ShopLineupParam): the shops whose range holds its id. A shop
   * lists only the rows between the two ids its dialogue opens; empty: no
   * shop sells this row.
   */
  shops?: ShopRange[]
}

/** A weapon's attack at one upgrade level (core/params/weaponStats.ts). */
export interface WeaponLevelView {
  level: number
  /** Physical, magic, fire, lightning and holy, at the stats asked for. */
  attack: number[]
  /** The same before scaling. */
  base: number[]
  total: number
  /** Strength, dexterity, intelligence, faith and arcane scaling, as percent. */
  scaling: number[]
}

export interface WeaponLevelsView {
  levels: WeaponLevelView[]
  /** Strength, dexterity, intelligence, faith and arcane requirements. */
  requirements: number[]
  /** For each stat, the damage types it raises (0 physical … 4 holy). */
  feeds: number[][]
}

/** Where the player gets an item. */
export interface WhereToGetView {
  /** Item lots that hold it, and what gives each. */
  lots: { param: string; id: number; name: string; count: number; givenBy: string[]; once: boolean }[]
  /** Shop rows that sell it, and the shops that list them. */
  shops: { param: string; id: number; price: number; by: string }[]
}

/** A range of ShopLineupParam rows a talk script (an NPC's dialogue) opens as a shop. */
export interface ShopRange {
  from: number
  to: number
  /** Opened as a regular shop (OpenRegularShop); else another menu, e.g. Enia's remembrance exchange. */
  regular: boolean
  /** Who opens it: the talk scripts' names (or `talk t<id>`). */
  by: string
}

export interface ClonePlanRequest {
  roots: { param: string; id: number }[]
  /** Params the walk may enter (default: weapons, skills, behaviors, bullets, attacks, SpEffects…). */
  followParams?: string[]
  forceClone?: string[]
  forceShare?: string[]
  offsets?: Record<string, number>
  /** New ids picked by hand, by plan node key. */
  idOverrides?: Record<string, number>
  behaviorVariation?: number
  nameSuffix?: string
  /** For predicting effect ids in the plan (the same options the duplicate uses). */
  cloneEffects?: boolean
  includeChildEffects?: boolean
  /** First id to try for copied effects (default: the setting, 900000000). */
  effectIdStart?: number
}

export interface PlanNodeView {
  key: string
  param: string
  id: number
  name: string
  status: 'root' | 'clone' | 'shared'
  sharedReason?: string
  newId?: number
  effects: number[]
}

export interface ClonePlanView {
  nodes: PlanNodeView[]
  offsets: Record<string, number>
  behaviorVariations: [number, number][]
  errors: string[]
  effects: { id: number; exists: boolean; children: number[] }[]
  /** Effects the duplicate will copy, [original, new id], when it copies effects. */
  effectIds: [number, number][]
}

export interface DuplicateRequest extends ClonePlanRequest {
  cloneEffects: boolean
  includeChildEffects: boolean
}

export interface DuplicateResultView {
  rowsAdded: Record<string, number>
  fieldsRelinked: number
  effectMapping: [number, number][]
  sfxFieldsRelinked: number
  newRoots: { param: string; id: number }[]
}

/** The params channels: request and response of each. */
export interface ParamsChannels {
  /** A weapon's own copy of its model, under a free model id (its affinities follow); waits for Save. */
  'weapon:ownModel': [{ id: number }, { model: number; rows: number }]
  /** A model (.flver) and textures (.png or .dds, named like its own) into the weapon's own model. */
  'weapon:importModel': [
    { id: number; files: { name: string; base64: string }[] },
    { model: number; replaced: string[]; added: string[] },
  ]

  /** A weapon's attack at each upgrade level, at the stats asked for (strength, dexterity, intelligence, faith, arcane). */
  'weapon:levels': [{ id: number; stats: number[] }, WeaponLevelsView]
  /** Where the player gets an item (a weapon, goods, armour, talisman or Ash of War): item lots and shops. */
  'item:whereToGet': [{ param: string; id: number }, WhereToGetView]
  /** An Ash of War item (EquipParamGem) for a skill: a copy of one with a skill of its kind; its id. */
  'skill:ashOfWar': [{ id: number }, number]
  /** A weapon buff's copy for the other hand, cast with it (the wiki's both-hands method); the copy's id. */
  'speffect:bothHands': [{ id: number }, number]

  'browse:list': [{ kind: BrowseKind; query: string; onlyProject: boolean; limit: number }, BrowseRow[]]
  'tree:root': [{ param: string; id: number }, TreeNode]
  'tree:children': [{ param: string; id: number }, TreeNode[]]
  'row:get': [{ param: string; id: number }, RowView]
  'row:set': [{ param: string; id: number; field: string; value: number | string | number[] }, RowView]
  /** Gives the player a copy of an enemy attack (AtkParam_Npc row → AtkParam_Pc, same id). */
  'row:playerAttack': [{ id: number }, RowView]
  /** A menu icon (kind Item, Status, MapIcon, CharacterCreator) as a PNG data URL, at most `size` pixels across; null if there's none. */
  'icon:get': [{ kind: string; id: number; size?: number }, string | null]
  'params:list': [void, ParamInfo[]]
  'params:rows': [{ param: string; query: string; onlyProject: boolean; limit: number }, BrowseRow[]]
  /** Add a row: a copy of `copyFrom`, or one filled with default values. */
  'row:add': [{ param: string; id: number; copyFrom?: number; name?: string }, RowView]
  'row:delete': [{ param: string; id: number }, void]
  'row:rename': [{ param: string; id: number; name: string }, RowView]
  'row:referrers': [{ param: string; id: number }, RowReferrer[]]
  /** First unused id at or after `from`. */
  'row:freeId': [{ param: string; from: number }, number]
  /** For copying a shop row: the first free id in the shop that holds `id`, or null (in no shop, or the shop's rows are all taken). */
  'shop:freeId': [{ id: number }, { id: number | null; shop: ShopRange | null }]
  'clone:plan': [ClonePlanRequest, ClonePlanView]
  'clone:apply': [DuplicateRequest, DuplicateResultView]
}
