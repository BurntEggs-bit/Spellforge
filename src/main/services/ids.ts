/**
 * What an id means, for the ids params hold that aren't rows of another
 * param: event flags above all, and text ids, shared variation ids...
 *
 * For an event flag, every source the game's files offer:
 *   - its community name (Smithbox's alias list, data/er/Aliases), when it
 *     has one;
 *   - the map its number belongs to (eventScripts.ts flagMap: 10000800 is
 *     Stormveil Castle's flag 800), named from the alias list;
 *   - every param field that uses it (Smithbox marks them FlagAlias), with
 *     what that means: the item lot a pickup flag guards and its items, the
 *     shop row and item a shop flag counts or unlocks, the grace a grace
 *     flag marks...;
 *   - every event script that sets, clears, checks or waits for it
 *     (eventScripts.ts), with what those events do: the boss whose health
 *     bar they show, the item lots they award;
 *   - every talk script (NPC dialogue) that sets or checks it, named after
 *     its community name or else the character the maps place with it.
 * Its summary is the most telling of those.
 *
 * And for an entity id, what the maps place with it (msb.ts): a character,
 * named from its NpcParam, an asset, a region... and where.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../../core/project/project.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import type { FieldMeta } from '../../core/params/paramMeta.ts'
import { readEmevd, type Emevd } from '../../core/formats/emevd.ts'
import { readEsd, esdShopRanges, type EsdScript } from '../../core/formats/esd.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { readFmg } from '../../core/formats/fmg.ts'
import { readMsb, PART_TYPES, REGION_TYPES, type MsbEntry } from '../../core/formats/msb.ts'
import {
  indexEventFlags,
  indexTalkFlags,
  flagUses,
  flagMap,
  type FlagIndex,
  type FlagUse,
} from '../../core/project/eventScripts.ts'
import { MapIndex, mapOfFile, type Placement } from '../../core/project/mapIndex.ts'
import type * as A from '../../shared/api.ts'

const MSG_FILES = [
  'msg/engus/item.msgbnd.dcx',
  'msg/engus/item_dlc01.msgbnd.dcx',
  'msg/engus/item_dlc02.msgbnd.dcx',
  'msg/engus/menu.msgbnd.dcx',
  'msg/engus/menu_dlc01.msgbnd.dcx',
  'msg/engus/menu_dlc02.msgbnd.dcx',
]

/** Smithbox's text table names (FmgRef) -> the game's table files. */
const TEXT_TABLES: Record<string, string> = {
  Title_Locations: 'PlaceName',
  Title_Characters: 'NpcName',
  Network_Messages: 'NetworkMessage',
  Modern_Menu_Text: 'GR_MenuText',
  Modern_Menu_Line_Help: 'GR_LineHelp',
  Action_Button_Text: 'ActionButtonText',
  Effect_Weapons: 'WeaponEffect',
  Talk_Messages: 'TalkMsg',
  Dialog_Goods: 'GoodsDialog',
  Loading_Title: 'LoadingTitle',
  Title_Goods: 'GoodsName',
  Title_Skill: 'ArtsName',
  Tutorial_Title: 'TutorialTitle',
}

/** ItemLotParam lotItemCategory -> param (ITEMLOT_ITEMCATEGORY). */
const LOT_CATEGORY: Record<number, string> = {
  1: 'EquipParamGoods',
  2: 'EquipParamWeapon',
  3: 'EquipParamProtector',
  4: 'EquipParamAccessory',
  5: 'EquipParamGem',
  6: 'EquipParamCustomWeapon',
}
/** ShopLineupParam equipType -> param (SHOP_LINEUP_EQUIPTYPE). */
const SHOP_TYPE: Record<number, string> = {
  0: 'EquipParamWeapon',
  1: 'EquipParamProtector',
  2: 'EquipParamAccessory',
  3: 'EquipParamGoods',
  4: 'EquipParamGem',
  5: 'EquipParamCustomWeapon',
}
/** The text table naming each item param, and what to call an unnamed one. */
const ITEM_TEXT: Record<string, string> = {
  EquipParamGoods: 'GoodsName',
  EquipParamWeapon: 'WeaponName',
  EquipParamProtector: 'ProtectorName',
  EquipParamAccessory: 'AccessoryName',
  EquipParamGem: 'GemName',
}
const ITEM_KIND: Record<string, string> = {
  EquipParamGoods: 'goods',
  EquipParamWeapon: 'weapon',
  EquipParamProtector: 'armor',
  EquipParamAccessory: 'talisman',
  EquipParamGem: 'Ash of War',
  EquipParamCustomWeapon: 'custom weapon',
}
/** Script uses in this order: what sets a flag says most about it. */
const USE_ORDER: Record<string, number> = { set: 0, clear: 1, random: 2, wait: 3, check: 4 }
/** The talk command that opens a regular shop (OpenRegularShop, bank 1); 1:111 is Enia's remembrance exchange. */
const OPEN_REGULAR_SHOP = 22

/** Talk binders many maps share: their scripts are in the map where their speaker stands. */
const SHARED_TALK: Record<string, string> = {
  m00_00_00_00: 'every map',
  m60_00_00_00: 'the Lands Between',
  m61_00_00_00: 'the Realm of Shadow',
}
/** Param fields holding an entity id (something placed in a map), by name. */
const ENTITY_FIELD = /EntityId(_|$)/i
/** Map files read per step while reading them in the background (about 30 ms). */
const MAPS_PER_STEP = 20
/** A map's own tile first, then its distant (_01, _02) and test (_99) versions. */
const mapRank = (map: string) => (/_00$/.test(map) ? 0 : 1)

type Aliases = Map<string, string>

export interface IdHost {
  /** The project's effect names (FXR). */
  effectName(id: number): string
  /** Whether the game has an icon (kind Item, Status, MapIcon) with this id. */
  hasIcon(kind: string, id: number): boolean
}

export class IdService {
  private project: Project
  private db: ParamDatabase
  private dataDir: string
  private host: IdHost
  private aliasCache = new Map<string, Aliases>()
  private texts: Map<string, Map<number, string>> | null = null
  private paramFlags: Map<number, A.FlagParamUse[]> | null = null
  private scripts: FlagIndex | null = null
  /** Every talk script, by talk id: its binder. */
  private talkFiles = new Map<number, string>()
  private talks: { binder: string; talk: number; script: EsdScript }[] | null = null
  /** Shop ranges the talk scripts open: `${from}-${to}-${command}` -> the talk ids opening it (read with the scripts). */
  private shopTalks = new Map<string, Set<number>>()
  private shops: A.ShopRange[] | null = null
  /** Rows sharing a value of a VRef kind, by `${kind}:${value}` (until the params change). */
  private shared = new Map<string, { param: string; id: number }[]>()
  private maps: MapIndex | null = null
  private mapBuild: { files: string[]; next: number; index: MapIndex } | null = null
  private warming: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(project: Project, db: ParamDatabase, dataDir: string, host: IdHost) {
    this.project = project
    this.db = db
    this.dataDir = dataDir
    this.host = host
  }

  /** Params changed: their flag uses are found again. */
  paramsChanged(): void {
    this.paramFlags = null
    this.shared.clear()
  }

  /** The project's event scripts were written: read them again when next needed. */
  scriptsChanged(): void {
    this.scripts = null
  }

  /** Whether anything uses a flag: an event or talk script, a param field, or the community's names for flags. */
  flagUsed(flag: number): boolean {
    if (this.flagsInParams().has(flag) || this.aliases('EventFlags').has(String(flag))) return true
    return flagUses(this.scriptIndex(), flag).length > 0
  }

  /* -------------------------------- maps -------------------------------- */

  /**
   * Starts reading the game's maps in the background, a few files at a time,
   * so the first lookup that needs them doesn't wait (all 1,300 take ~2 s).
   */
  warm(delay = 0): void {
    if (this.maps || this.warming || this.stopped) return
    const step = () => {
      this.warming = null
      if (this.stopped || this.readMaps(MAPS_PER_STEP)) return
      this.warming = setTimeout(step, 0)
      this.warming.unref?.()
    }
    this.warming = setTimeout(step, delay)
    this.warming.unref?.()
  }

  /** The project is closing: stop reading its maps. */
  stop(): void {
    this.stopped = true
    if (this.warming) clearTimeout(this.warming)
    this.warming = null
  }

  /** Reads up to `n` more map files; true once every map is read. */
  private readMaps(n: number): boolean {
    if (this.maps) return true
    const b = (this.mapBuild ??= {
      files: this.project.list('map/mapstudio', /\.msb\.dcx$/i),
      next: 0,
      index: new MapIndex(),
    })
    for (let k = 0; k < n && b.next < b.files.length; k++) {
      const rel = b.files[b.next++]
      try {
        b.index.add(mapOfFile(rel), readMsb(dcxDecompress(this.project.read(rel).data).data))
      } catch {
        /* an unreadable map */
      }
    }
    if (b.next < b.files.length) return false
    this.maps = b.index
    this.mapBuild = null
    return true
  }

  /** Every map's placements, read now if they aren't yet (or null if they aren't and `wait` is false). */
  private mapIndex(wait = true): MapIndex | null {
    if (!this.maps) {
      if (wait) this.readMaps(Infinity)
      else this.warm()
    }
    return this.maps
  }

  /** A placed thing's name: a character's (its NpcParam's), an asset's or map piece's; else its model or name. */
  private placedName(e: MsbEntry): string {
    const model = e.model?.toLowerCase() ?? ''
    if (e.list === 'part' && (e.type === 2 || e.type === 10)) {
      const npc = e.npcParam && e.npcParam > 0 ? e.npcParam : 0
      // Name 0 is a placeholder text ("DLC dummy"): most enemies and bosses have it.
      const nameId = npc ? this.db.num('NpcParam', npc, 'nameId') : 0
      const named = npc ? (nameId > 0 && this.text('NpcName', nameId)) || this.db.rowName('NpcParam', npc) : ''
      // c0000 is every human: the model's name ("Player") would mislead.
      return named || (model !== 'c0000' && this.aliases('Characters').get(model)) || e.model || e.name
    }
    if (e.list === 'part' && (e.type === 13 || e.type === 9))
      return this.aliases('Assets').get(model) || e.model || e.name
    if (e.list === 'part' && e.type === 0) return this.aliases('MapPieces').get(model) || e.model || e.name
    // Regions' own names are FromSoftware's notes, mostly Japanese: say what the region is.
    if (e.list === 'region') {
      const kind = REGION_TYPES[e.type] ?? 'region'
      return kind[0].toUpperCase() + kind.slice(1)
    }
    return e.name
  }

  private placed(p: Placement): A.PlacedEntity {
    const e = p.entry
    return {
      kind:
        e.list === 'region'
          ? (REGION_TYPES[e.type] ?? `region (type ${e.type})`)
          : (PART_TYPES[e.type] ?? `part (type ${e.type})`),
      region: e.list === 'region' || undefined,
      name: this.placedName(e),
      map: p.map,
      mapName: this.mapName(p.map),
      part: e.name,
      model: e.model,
      entityId: e.entityId || undefined,
      npcParam: e.npcParam && e.npcParam > 0 && this.db.hasRow('NpcParam', e.npcParam) ? e.npcParam : undefined,
      talkId: e.talkId && e.talkId > 0 ? e.talkId : undefined,
      group: p.group,
    }
  }

  /** Where the maps place an entity id (or the members of an entity group): each once, own tiles first. */
  placements(id: number, wait = true): A.PlacedEntity[] {
    const seen = new Set<string>()
    return (this.mapIndex(wait)?.entities.get(id) ?? [])
      .filter((p) => {
        const key = `${p.map}|${p.entry.list}|${p.entry.name}|${!!p.group}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .sort((a, b) => Number(!!a.group) - Number(!!b.group) || mapRank(a.map) - mapRank(b.map))
      .map((p) => this.placed(p))
  }

  /** The characters the maps place with a talk script, own tiles first. */
  private speakers(talk: number, wait: boolean): Placement[] {
    return [...(this.mapIndex(wait)?.talks.get(talk) ?? [])].sort((a, b) => mapRank(a.map) - mapRank(b.map))
  }

  /** Every row whose VRef field of this kind holds this value. */
  private sharing(kind: string, value: number): { param: string; id: number }[] {
    const key = `${kind}:${value}`
    let out = this.shared.get(key)
    if (out) return out
    out = []
    for (const [name, p] of this.db.params) {
      const fields = p.def.fields.filter((f) => p.meta.get(f.name)?.vref === kind)
      if (!fields.length) continue
      for (const r of p.param.rows)
        if (fields.some((f) => this.db.num(name, r.id, f.name) === value)) out.push({ param: name, id: r.id })
    }
    this.shared.set(key, out)
    return out
  }

  /* ------------------------------- names -------------------------------- */

  /** A community name list (data/er/Aliases/<kind>.json): EventFlags, MapNames, Characters, TalkScripts... */
  aliases(kind: string): Aliases {
    let m = this.aliasCache.get(kind)
    if (m) return m
    m = new Map()
    try {
      const list = JSON.parse(
        fs.readFileSync(path.join(this.dataDir, 'Aliases', `${kind}.json`), 'utf8').replace(/^\uFEFF/, ''),
      ) as { ID: string; Name: string }[]
      for (const x of list) if (x.Name?.trim()) m.set(String(x.ID).toLowerCase(), x.Name.trim())
    } catch {
      /* no list: no names */
    }
    this.aliasCache.set(kind, m)
    return m
  }

  mapName(map: string): string {
    return this.aliases('MapNames').get(map.toLowerCase()) ?? ''
  }

  /** Every text table of the game (item and menu, DLC text winning), by table name. */
  private textTables(): Map<string, Map<number, string>> {
    if (this.texts) return this.texts
    const out = new Map<string, Map<number, string>>()
    for (const rel of MSG_FILES) {
      if (!this.project.resolve(rel)) continue
      let bnd
      try {
        bnd = readBnd4(dcxDecompress(this.project.read(rel).data).data)
      } catch {
        continue
      }
      const ordered = [...bnd.entries].sort((a, b) => Number(/_dlc\d+/i.test(a.name)) - Number(/_dlc\d+/i.test(b.name)))
      for (const e of ordered) {
        const table = e.name
          .split(/[\\/]/)
          .pop()!
          .replace(/\.fmg$/i, '')
          .replace(/_dlc\d+$/i, '')
        let t = out.get(table)
        if (!t) out.set(table, (t = new Map()))
        try {
          for (const [id, text] of readFmg(e.data)) if (text && text.trim() && text !== '%null%') t.set(id, text.trim())
        } catch {
          /* a damaged table */
        }
      }
    }
    this.texts = out
    return out
  }

  /** A text entry by table (the game's name, or Smithbox's) and id. */
  text(table: string, id: number): string | undefined {
    return this.textTables()
      .get(TEXT_TABLES[table] ?? table)
      ?.get(id)
  }

  /** The text tables that have an entry with this id. */
  textsWithId(id: number): { table: string; text: string }[] {
    const out: { table: string; text: string }[] = []
    for (const [table, t] of this.textTables()) {
      const text = t.get(id)
      if (text) out.push({ table, text })
    }
    return out
  }

  /* ------------------------------ helpers ------------------------------- */

  /** An item's name: its row's, else the game's text, else its upgrade-level base's (weapons). */
  private itemName(param: string, id: number): string {
    const table = ITEM_TEXT[param]
    const named = (n: number) =>
      (this.db.hasRow(param, n) && this.db.rowName(param, n)) || (table && this.text(table, n)) || ''
    return (
      named(id) || (param === 'EquipParamWeapon' ? named(id - (id % 100)) : '') || `${ITEM_KIND[param] ?? param} ${id}`
    )
  }

  /** "Smithing Stone [1] ×2, Golden Rune [1]": what an item lot gives. */
  lotItems(param: string, lot: number): string {
    if (!this.db.hasRow(param, lot)) return ''
    const out: string[] = []
    for (let k = 1; k <= 8; k++) {
      const n = String(k).padStart(2, '0')
      const id = this.db.num(param, lot, `lotItemId${n}`)
      const target = LOT_CATEGORY[this.db.num(param, lot, `lotItemCategory${n}`)]
      if (id <= 0 || !target) continue
      const count = this.db.num(param, lot, `lotItemNum${n}`)
      out.push(`${this.itemName(target, id)}${count > 1 ? ` ×${count}` : ''}`)
    }
    return out.join(', ')
  }

  private shopItem(id: number): string {
    const target = SHOP_TYPE[this.db.num('ShopLineupParam', id, 'equipType')]
    const item = this.db.num('ShopLineupParam', id, 'equipId')
    return target && item > 0 ? this.itemName(target, item) : `item ${item}`
  }

  private graceName(id: number): string {
    return (
      this.text('PlaceName', this.db.num('BonfireWarpParam', id, 'textId1')) ||
      this.db.rowName('BonfireWarpParam', id) ||
      `grace ${id}`
    )
  }

  /* ---------------------------- event flags ----------------------------- */

  /** What a param field using a flag means, in a few words. */
  private flagRole(param: string, id: number, field: string, label: string): string {
    const row = this.db.rowName(param, id)
    const base = param.replace(/_(map|enemy|m61)$/, '')
    if (base === 'ItemLotParam' && /^getItemFlagId/.test(field)) {
      const items = this.lotItems(param, id)
      return `${param === 'ItemLotParam_enemy' ? 'Dropped by an enemy' : 'Picked up'}${items ? `: ${items}` : ''} (item lot ${id})`
    }
    if (param === 'ShopLineupParam' && field === 'eventFlag_forStock')
      return `Bought in a shop: ${this.shopItem(id)}${row ? ` (${row})` : ''}`
    if (param === 'ShopLineupParam' && field === 'eventFlag_forRelease')
      return `Puts ${this.shopItem(id)} up for sale${row ? ` (${row})` : ''}`
    if (param === 'BonfireWarpParam' && field === 'eventflagId') return `Site of Grace found: ${this.graceName(id)}`
    if (param === 'BonfireWarpParam' && field === 'clearedEventFlagId')
      return `Site of Grace ${this.graceName(id)}: its area cleared`
    if (param === 'BonfireWarpParam' && /^text(En|Dis)able/.test(field))
      return `Site of Grace ${this.graceName(id)}: ${/Enable/.test(field) ? 'shows' : 'hides'} one of its map texts`
    if (param === 'WorldMapPointParam') {
      const text = this.text('PlaceName', this.db.num('WorldMapPointParam', id, 'textId1'))
      const what =
        field === 'eventFlagId'
          ? 'shown'
          : field === 'distViewEventFlagId'
            ? 'seen from afar'
            : field === 'clearedEventFlagId'
              ? 'cleared'
              : /Enable/.test(field)
                ? 'text shown'
                : 'text hidden'
      return `Map point ${what}: ${text || row || `point ${id}`}`
    }
    if (param === 'WorldMapPieceParam')
      return `Map fragment ${field === 'openEventFlagId' ? 'shown' : 'picked up'}: ${row || `piece ${id}`}`
    if (param === 'GameAreaParam') {
      const what =
        field === 'defeatBossFlagId'
          ? 'Boss defeated'
          : field === 'foundBossFlagId'
            ? 'Boss found'
            : field === 'bossChallengeFlagId'
              ? 'Boss challenged'
              : label
      return `${what}${row ? `: ${row}` : ''} (area ${id})`
    }
    if (param === 'TutorialParam')
      return `Tutorial unlocked: ${this.text('TutorialTitle', this.db.num('TutorialParam', id, 'textId')) || row || id}`
    if (/itemGetTutorialFlagId/.test(field)) return `Tutorial shown when you get ${this.itemName(param, id)}`
    if (param === 'ActionButtonParam') {
      const text = this.text('ActionButtonText', this.db.num('ActionButtonParam', id, 'textId'))
      return `Action "${text || id}" ${field === 'grayoutFlag' ? 'greyed out' : 'unavailable'} while set`
    }
    if (param === 'BuddyStoneParam') return `Spirit summoned (summoning pool ${id})`
    if (param === 'NpcParam') return `Tutorial when ${this.db.rowName('NpcParam', id) || `NPC ${id}`} dies`
    if (param === 'KnowledgeLoadScreenItemParam')
      return `Loading screen tip ${field === 'unlockFlagId' ? 'unlocked' : 'hidden'}${row ? `: ${row}` : ''}`
    if (param === 'PlayRegionParam') return `Online play: ${label} (play region ${id})`
    if (param === 'MapDefaultInfoParam') return `Fast travel allowed in map ${row || id}`
    return `${label} (${param} ${id}${row ? `, ${row}` : ''})`
  }

  /** Every param field holding each flag. */
  private flagsInParams(): Map<number, A.FlagParamUse[]> {
    if (this.paramFlags) return this.paramFlags
    const out = new Map<number, A.FlagParamUse[]>()
    for (const [name, p] of this.db.params) {
      const fields = p.def.fields.filter((f) => p.meta.get(f.name)?.flag)
      if (!fields.length) continue
      for (const r of p.param.rows) {
        for (const f of fields) {
          const v = this.db.num(name, r.id, f.name)
          if (v <= 0) continue
          const l = out.get(v) ?? []
          l.push({ param: name, id: r.id, name: this.db.rowName(name, r.id), field: f.name, role: '' })
          out.set(v, l)
        }
      }
    }
    this.paramFlags = out
    return out
  }

  /** Every event and talk script, indexed for flags (the project's own scripts first). */
  private scriptIndex(): FlagIndex {
    if (this.scripts) return this.scripts
    const scripts = new Map<string, Emevd>()
    for (const rel of this.project.list('event', /\.emevd\.dcx$/i)) {
      try {
        scripts.set(rel, readEmevd(dcxDecompress(this.project.read(rel).data).data))
      } catch {
        /* an unreadable script */
      }
    }
    const index = indexEventFlags(scripts)
    indexTalkFlags(index, this.readTalks())
    this.scripts = index
    return index
  }

  /** Every talk script (the project's own first), read once; notes each one's binder and the shop ranges it opens. */
  private readTalks(): { binder: string; talk: number; script: EsdScript }[] {
    if (this.talks) return this.talks
    const talks: { binder: string; talk: number; script: EsdScript }[] = []
    for (const rel of this.project.list('script/talk', /\.talkesdbnd\.dcx$/i)) {
      try {
        for (const e of readBnd4(dcxDecompress(this.project.read(rel).data).data).entries) {
          const m = /t(\d+)\.esd$/i.exec(e.name)
          if (!m) continue
          this.talkFiles.set(Number(m[1]), rel)
          const script = readEsd(e.data)
          talks.push({ binder: rel, talk: Number(m[1]), script })
          for (const r of esdShopRanges(script)) {
            const key = `${r.from}-${r.to}-${r.command}`
            ;(this.shopTalks.get(key) ?? this.shopTalks.set(key, new Set()).get(key)!).add(Number(m[1]))
          }
        }
      } catch {
        /* an unreadable binder */
      }
    }
    this.talks = talks
    return talks
  }

  /** Every shop range the talk scripts open, with who opens it (read with the scripts, once). */
  shopRanges(): A.ShopRange[] {
    if (!this.shops) {
      this.readTalks()
      this.shops = [...this.shopTalks].map(([key, talks]) => {
        const [from, to, command] = key.split('-').map(Number)
        return {
          from,
          to,
          regular: command === OPEN_REGULAR_SHOP,
          by: [...talks]
            .sort((a, b) => a - b)
            .map(String)
            .join(','),
        }
      })
      this.shops.sort((a, b) => a.from - b.from || a.to - b.to)
    }
    // Names now (a speaker's name comes once the maps are read). The shop's own merchant first: named
    // talks before unnamed ones, and a talk opening many ranges (the Twin Maiden Husks sell every
    // merchant's stock for its bell bearing) last.
    const ranges = new Map<number, number>()
    for (const r of this.shops) for (const t of r.by.split(',')) ranges.set(Number(t), (ranges.get(Number(t)) ?? 0) + 1)
    return this.shops.map((r) => {
      const named = (t: number) => (this.talkName(t, false) ? 0 : 1)
      const talks = r.by
        .split(',')
        .map(Number)
        .sort((a, b) => named(a) - named(b) || ranges.get(a)! - ranges.get(b)! || a - b)
      return { ...r, by: [...new Set(talks.map((t) => this.talkName(t, false) ?? `talk t${t}`))].join(', ') }
    })
  }

  /**
   * Where the player gets an item: the item lots that hold it (with what
   * gives each: the enemies whose drop it is, the event scripts that award
   * it) and the shop rows that sell it (with the shops listing them).
   */
  whereToGet(param: string, id: number): A.WhereToGetView {
    const lotCategory = Number(Object.entries(LOT_CATEGORY).find(([, p]) => p === param)?.[0] ?? -1)
    const shopType = Number(Object.entries(SHOP_TYPE).find(([, p]) => p === param)?.[0] ?? -1)
    const lots: A.WhereToGetView['lots'] = []
    const lotParams = ['ItemLotParam_map', 'ItemLotParam_enemy'].filter((p) => this.db.params.has(p))
    if (lotCategory >= 0)
      for (const lp of lotParams)
        for (const r of this.db.get(lp).param.rows) {
          for (let k = 1; k <= 8 && lots.length < 40; k++) {
            const n = String(k).padStart(2, '0')
            if (
              this.db.num(lp, r.id, `lotItemId${n}`) !== id ||
              this.db.num(lp, r.id, `lotItemCategory${n}`) !== lotCategory
            )
              continue
            lots.push({
              param: lp,
              id: r.id,
              name: this.db.rowName(lp, r.id),
              count: this.db.num(lp, r.id, `lotItemNum${n}`),
              givenBy: [],
              once: this.db.num(lp, r.id, 'getItemFlagId') > 0,
            })
            break
          }
        }
    if (lots.length) {
      // Enemies drop their NpcParam's lots; event scripts award lots (AwardItemLot).
      const wanted = new Set(lots.map((l) => l.id))
      const npcs = new Map<number, string[]>()
      if (this.db.params.has('NpcParam'))
        for (const r of this.db.get('NpcParam').param.rows)
          for (const f of ['itemLotId_enemy', 'itemLotId_map']) {
            const lot = this.db.num('NpcParam', r.id, f)
            if (!wanted.has(lot)) continue
            const list = npcs.get(lot) ?? []
            if (list.length < 3) list.push(this.db.rowName('NpcParam', r.id) || `NpcParam ${r.id}`)
            npcs.set(lot, list)
          }
      const events = new Map<number, string[]>()
      for (const [key, ctx] of this.scriptIndex().events)
        for (const lot of ctx.itemLots) {
          if (!wanted.has(lot)) continue
          const [file, event] = key.split(':')
          const list = events.get(lot) ?? []
          const where = file === 'common' ? 'the common script' : this.mapName(file) || file
          if (list.length < 3) list.push(`event ${event.split('>')[0]} in ${where}`)
          events.set(lot, list)
        }
      for (const l of lots)
        l.givenBy = [
          ...(npcs.get(l.id) ?? []).map((n) => `dropped by ${n}`),
          ...(events.get(l.id) ?? []).map((e) => `given by ${e}`),
        ]
    }
    const shops: A.WhereToGetView['shops'] = []
    if (shopType >= 0)
      for (const sp of ['ShopLineupParam', 'ShopLineupParam_Recipe'].filter((p) => this.db.params.has(p)))
        for (const r of this.db.get(sp).param.rows) {
          if (this.db.num(sp, r.id, 'equipId') !== id || this.db.num(sp, r.id, 'equipType') !== shopType) continue
          shops.push({
            param: sp,
            id: r.id,
            price: this.db.num(sp, r.id, 'value'),
            by:
              sp === 'ShopLineupParam'
                ? this.shopsOf(r.id)
                    .map((s) => s.by)
                    .join('; ')
                : '',
          })
          if (shops.length >= 20) break
        }
    return { lots, shops }
  }

  /** The shops whose range holds a ShopLineupParam row id. */
  shopsOf(id: number): A.ShopRange[] {
    return this.shopRanges().filter((r) => id >= r.from && id <= r.to)
  }

  /** The first id with no row in the shop that holds `id` (a regular shop's range first), or null. */
  shopFreeId(id: number): { id: number | null; shop: A.ShopRange | null } {
    const shops = this.shopsOf(id)
    const shop = shops.find((r) => r.regular) ?? shops[0] ?? null
    if (!shop) return { id: null, shop: null }
    for (let n = shop.from; n <= shop.to; n++) if (!this.db.hasRow('ShopLineupParam', n)) return { id: n, shop }
    return { id: null, shop }
  }

  /** A talk script's name: its community name, else its speaker's in the maps (if read, unless `wait`). */
  private talkName(talk: number, wait: boolean): string | undefined {
    const speaker = this.speakers(talk, wait)[0]
    return this.aliases('TalkScripts').get(String(talk)) ?? (speaker ? this.placedName(speaker.entry) : undefined)
  }

  private describeUse(u: FlagUse, wait: boolean): A.FlagScriptUse {
    const map = u.file.toLowerCase()
    let mapName = /^m\d/.test(map)
      ? this.mapName(map)
      : u.file === 'common_func'
        ? 'shared events'
        : u.file === 'common'
          ? 'every map'
          : ''
    // A shared binder's script: the map its speaker stands in, when there's one.
    if (u.kind === 'talk' && SHARED_TALK[map]) {
      const maps = [
        ...new Set(
          this.speakers(u.event, wait)
            .filter((p) => mapRank(p.map) === 0)
            .map((p) => p.map),
        ),
      ]
      mapName = maps.length === 1 ? this.mapName(maps[0]) || maps[0] : SHARED_TALK[map]
    }
    const notes: string[] = []
    if (u.kind === 'event') {
      const ctx =
        this.scriptIndex().events.get(u.via === undefined ? `${u.file}:${u.event}` : `${u.file}:${u.event}>${u.via}`) ??
        this.scriptIndex().events.get(`${u.file}:${u.event}`)
      for (const b of ctx?.bosses ?? []) notes.push(`boss: ${this.text('NpcName', b) ?? b}`)
      for (const lot of ctx?.itemLots ?? []) {
        const items = this.lotItems('ItemLotParam_map', lot) || this.lotItems('ItemLotParam_enemy', lot)
        notes.push(`awards ${items || `item lot ${lot}`}`)
      }
    }
    return {
      kind: u.kind,
      talkName: u.kind === 'talk' ? this.talkName(u.event, wait) : undefined,
      file: u.file,
      mapName,
      event: u.event,
      via: u.via,
      what: u.what,
      range: u.range,
      context: notes.slice(0, 4).join('; ') || undefined,
    }
  }

  /**
   * Everything about an event flag. Talk scripts are named after their
   * speakers once the maps are read; `wait` reads them now if they aren't.
   */
  describeFlag(flag: number, wait = false): A.FlagInfo {
    const name = this.aliases('EventFlags').get(String(flag))
    const where = flagMap(flag)
    const params = (this.flagsInParams().get(flag) ?? []).map((u) => ({
      ...u,
      role: this.flagRole(u.param, u.id, u.field, this.fieldLabel(u.param, u.field)),
    }))
    const scripts = flagUses(this.scriptIndex(), flag)
      .sort((a, b) => USE_ORDER[a.what] - USE_ORDER[b.what] || Number(!!a.range) - Number(!!b.range))
      .map((u) => this.describeUse(u, wait))
    const map = where ? { id: where.map, name: this.mapName(where.map), local: where.local } : undefined
    // The summary: the community name, else what a param says, else the scripts, else the map.
    const sets = scripts.filter((s) => s.what === 'set' && !s.range)
    const by = (s: A.FlagScriptUse) =>
      s.kind === 'talk'
        ? `${s.talkName ? `${s.talkName}’s dialogue` : `dialogue ${s.event}`}${s.mapName ? ` (${s.mapName})` : ''}`
        : `event ${s.event}${s.mapName ? ` in ${s.mapName}` : ''}`
    let summary = name ?? params[0]?.role ?? ''
    if (!summary && sets.length) {
      const s = sets[0]
      summary = `Set ${s.kind === 'talk' ? 'in' : 'by'} ${by(s)}${s.context ? ` (${s.context})` : ''}`
    }
    if (!summary && scripts.length) {
      const s = scripts[0]
      summary = `${s.what === 'check' || s.what === 'wait' ? 'Checked' : 'Used'} ${s.kind === 'talk' ? 'in' : 'by'} ${by(s)}`
    }
    const unused = !name && !params.length && !scripts.length
    if (!summary && map)
      summary = `${map.name || map.id}: its flag ${map.local}${unused ? ' (nothing in the game uses it)' : ''}`
    if (!summary) summary = 'Nothing in the game’s params or event scripts uses it'
    return { flag, summary, name, map, params, scripts, unused }
  }

  private fieldLabel(param: string, field: string): string {
    try {
      const f = this.db.get(param).def.fieldsByName.get(field)
      return f?.displayName || field
    } catch {
      return field
    }
  }

  /* ------------------------------- fields ------------------------------- */

  /**
   * What a field's value means, when it isn't a row of another param:
   * an event flag (what it's for), a text id (the text), an id of a kind
   * shared by fields (the rows sharing it), an entity id (what the maps
   * place with it).
   */
  fieldAbout(
    param: string,
    id: number,
    field: string,
    fm: FieldMeta | undefined,
    value: unknown,
  ): A.FieldAbout | undefined {
    if (typeof value !== 'number' || value <= 0) return undefined
    if (ENTITY_FIELD.test(field)) {
      const placed = this.placements(value)
      if (!placed.length) return { kind: 'entity', label: `No map places entity ${value}`, lookup: value }
      const p = placed.find((x) => !x.group)
      if (p) {
        const what = p.region ? p.name : `${p.name} (${p.kind}${p.model && p.model !== p.name ? `, ${p.model}` : ''})`
        return { kind: 'entity', label: `${what} in ${p.mapName || p.map}`, lookup: value }
      }
      // An entity group: who's in it.
      const names = [...new Set(placed.map((x) => x.name))]
      const maps = [...new Set(placed.map((x) => x.mapName || x.map))]
      return {
        kind: 'entity',
        label: `Entity group of ${placed.length}: ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''} in ${maps.slice(0, 2).join(', ')}${maps.length > 2 ? '…' : ''}`,
        lookup: value,
      }
    }
    if (!fm) return undefined
    if (fm.flag) {
      const info = this.describeFlag(value)
      // Shown in the row that uses it: its own use is no news, so say what else uses it.
      const others = info.params.filter((u) => !(u.param === param && u.id === id))
      const label =
        info.name ??
        (others[0]?.role ||
          (info.scripts.length
            ? info.summary
            : info.params.length
              ? `Only this row uses it${info.map ? ` (${info.map.name || info.map.id}, flag ${info.map.local})` : ''}`
              : info.summary))
      return { kind: 'flag', label, lookup: value }
    }
    if (fm.text?.length) {
      const target =
        fm.text.find((t) => !t.conditionField || this.db.num(param, id, t.conditionField) === t.conditionValue) ??
        fm.text[0]
      const text = this.text(target.param, value)
      return {
        kind: 'text',
        label: text
          ? `“${text.replace(/\s+/g, ' ').slice(0, 140)}”`
          : `No text ${value} in ${TEXT_TABLES[target.param] ?? target.param}`,
        lookup: value,
      }
    }
    if (fm.vref) {
      // Other rows with the same value, by param: "4 EquipParamWeapon (Uchigatana, Nagakiba…); 60 BehaviorParam".
      const byParam = new Map<string, number[]>()
      for (const r of this.sharing(fm.vref, value)) {
        if (r.param === param && r.id === id) continue
        byParam.set(r.param, [...(byParam.get(r.param) ?? []), r.id])
      }
      const groups = [...byParam].map(([name, rows]) => {
        const names = [
          ...new Set(rows.map((r) => this.db.rowName(name, r).replace(/^\[[^\]]*\]\s*/, '')).filter(Boolean)),
        ].slice(0, 3)
        return `${rows.length} ${name}${names.length ? ` (${names.join(', ')}${rows.length > names.length ? '…' : ''})` : ''}`
      })
      return {
        kind: 'vref',
        label: groups.length ? `Shared with ${groups.join('; ')}` : `Only this row uses ${fm.vref} ${value}`,
        lookup: value,
      }
    }
    return undefined
  }

  /* ------------------------------- lookup ------------------------------- */

  /** Everything a number could be in the game. */
  lookup(n: number): A.IdLookup {
    const rows: A.IdLookup['rows'] = []
    for (const [name, p] of this.db.params) {
      if (!this.db.hasRow(name, n)) continue
      rows.push({ param: name, id: n, name: this.db.rowName(name, n) })
      if (rows.length > 40) break
      void p
    }
    const flag = this.describeFlag(n, true)
    const chr = n >= 0 && n < 10000 ? `c${String(n).padStart(4, '0')}` : ''
    const character = chr ? this.aliases('Characters').get(chr) : undefined
    const effectName = this.host.effectName(n)
    const icons = (['Item', 'Status', 'MapIcon'] as const)
      .filter((k) => this.host.hasIcon(k, n))
      .map((kind) => ({ kind, id: n }))
    this.scriptIndex()
    const speakers = this.speakers(n, true)
    const talkFile = this.talkFiles.get(n)
    const seen = new Set<string>()
    return {
      id: n,
      flag: flag.unused && !flag.map ? undefined : flag,
      rows,
      texts: this.textsWithId(n),
      effect: effectName ? { id: n, name: effectName } : undefined,
      icons,
      character: character ? { chr, name: character } : undefined,
      placed: n > 0 ? this.placements(n) : [],
      talkScript:
        talkFile || speakers.length
          ? {
              name: this.talkName(n, true),
              file: talkFile ? mapOfFile(talkFile.replace(/\.talkesdbnd(\.dcx)?$/i, '')) : undefined,
              speakers: speakers
                .filter((p) => !seen.has(`${p.map}|${p.entry.name}`) && !!seen.add(`${p.map}|${p.entry.name}`))
                .map((p) => this.placed(p)),
            }
          : undefined,
    }
  }
}
