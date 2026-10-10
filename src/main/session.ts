/**
 * Main-process state: settings, the open project, its param databases and
 * effect library. Every UI request lands here; nothing in the renderer
 * touches files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { setOodleSearchPaths, oodleAvailable } from '../core/formats/oodle.ts'
import { Project } from '../core/project/project.ts'
import { ParamDatabase, hasErData } from '../core/params/paramDb.ts'
import { EffectLibrary } from '../core/effects/effects.ts'
import { GameFiles, inspectGameFolder, findEldenRingInstalls, normalizeGameFolder } from '../core/project/gameFiles.ts'
import { VanillaStore, gameVersionLabel, SNAPSHOT_ANIBND } from '../core/project/vanilla.ts'
import { writeBnd4 } from '../core/formats/bnd4.ts'
import { dcxCompress, repackDcx } from '../core/formats/dcx.ts'
import { badlyPacked } from '../core/project/packing.ts'
import { diffParams } from '../core/params/diff.ts'
import { isPlaceholderName, loadItemText, NAMED_LIKE, TEXT_ID_FIELD, type OpenMsgBnd } from '../core/project/text.ts'
import { parseCsv } from '../core/formats/csv.ts'
import { type ClonePlan } from '../core/params/clone.ts'
import { AnimationService } from './services/animations.ts'
import { CharacterService } from './services/character.ts'
import { EnemyService } from './services/enemies.ts'
import { SoundService } from './services/sounds.ts'
import { AssetService } from './services/assets.ts'
import { CloneService } from './services/clone.ts'
import { GameUpdateService } from './services/gameUpdate.ts'
import { EffectService } from './services/effects.ts'
import { ParamService } from './services/params.ts'
import { TextService } from './services/text.ts'
import { IconService, isIconKind } from './services/icons.ts'
import { IdService } from './services/ids.ts'
import { EnemyMoves } from './workflows/enemyMoves.ts'
import { Scaler, SCALES_RECORD, emptyScaleRecord, type ScaleRecord } from './workflows/scale.ts'
import { Movesets, MOVESETS_RECORD, emptyMovesetRecord, type MovesetRecord } from './workflows/moveset.ts'
import { Recovery, projectFingerprint, type JournalEntry } from './services/recovery.ts'
import { GameLink } from './services/gameLink.ts'
import { findMe3, launchMe3, me3PlayArgs, PLAY_SAVEFILE } from './services/gameLaunch.ts'
import { BehaviourService, eventNames } from './services/behavior.ts'
import { EventService } from './services/events.ts'
import type * as A from '../shared/api.ts'
import { categoryLabel } from '../shared/animIds.ts'

const DEFAULT_SETTINGS: A.Settings = {
  gameDir: '',
  smithboxDir: '',
  recentProjects: [],
  effectIdStart: 900_000_000,
  effectNamesCsv: '',
  theme: { preset: 'roundtable', overrides: {}, fontSize: 13, density: 'comfortable', v: 3 },
}

/**
 * Reads "id, name" pairs from a CSV: the first column that is a whole number
 * is the id, the first other non-empty column is the name. Tolerates header
 * rows, quoting and extra columns, so a spreadsheet export works as-is.
 */
function parseEffectNamesCsv(text: string): Map<number, string> {
  const names = new Map<number, string>()
  for (const raw of parseCsv(text)) {
    const cells = raw.map((c) => c.trim())
    const idIndex = cells.findIndex((c) => /^\d{1,9}$/.test(c))
    if (idIndex === -1) continue
    const name = cells.find((c, i) => i !== idIndex && c && !/^\d+$/.test(c))
    if (name && !names.has(Number(cells[idIndex]))) names.set(Number(cells[idIndex]), name)
  }
  return names
}

export interface Open {
  project: Project
  db: ParamDatabase
  /**
   * The vanilla regulation of the game version the project was made with
   * (the installed game's when that version isn't kept), for marking rows
   * the project added or changed. After a game update the project's rows
   * differ from the new game wherever FromSoftware changed something; those
   * aren't the modder's edits.
   */
  base: ParamDatabase
  /** The installed game's regulation. */
  gameDb: ParamDatabase
  lib: EffectLibrary
  /** sfx id -> rows using it; built on demand, dropped on edits. */
  effectUsers: Map<number, { param: string; id: number; field: string }[]> | null
  lastPlan: ClonePlan | null
  /** Names Spellforge gave rows (its copies), kept in mod/.spellforge. */
  spellforgeNames: Record<string, Record<string, string>>
  namesDirty: boolean
  /** Official in-game names (game text, project overriding game). */
  gameNames: Record<string, Record<string, string>>
  /** Item text files edited this session, written on save. */
  msgs: Map<string, OpenMsgBnd>
  /** Animation events and the behaviour graph, loaded on first use. */
  anims: AnimationService
  /** Skeleton, animation clips and equipment models for the animation viewport. */
  character: CharacterService
  /** Other characters (enemies, bosses, NPCs): their moves and models. */
  enemies: EnemyService
  /** Sound banks: where sound events are, and others' sounds brought into the player's. */
  sounds: SoundService
  /** The game's menu icons (items, status effects, map). */
  icons: IconService
  /** What ids mean: event flags, text ids, shared ids. */
  ids: IdService
  /** Sizes skills, spells and effects were scaled to (.spellforge/scales.json). */
  scales: ScaleRecord
  scalesDirty: boolean
  /** The player's behaviour script and its recipes (.spellforge/behaviour.json). */
  behaviour: BehaviourService
  /** The game's event scripts and the project's event recipes (.spellforge/events.json). */
  events: EventService
  /** Weapons given movesets of their own (.spellforge/movesets.json). */
  movesets: MovesetRecord
  movesetsDirty: boolean
  /** Effect copies the project made, and what each is a copy of (.spellforge/effect-copies.json): named after their originals. */
  effectCopies: Record<string, number>
  effectCopiesDirty: boolean
  /** Packed files an earlier Spellforge wrote that the game can't unpack (see badlyPacked): packed again on save. */
  repack: string[]
  /** Its params: browsing, the trees of what rows use, row fields, adding and naming rows. */
  params: ParamService
  /** Its game text. */
  text: TextService
  /** Its effects. */
  effects: EffectService
  /** Textures, models, thumbnails, icons and light probes. */
  assets: AssetService
  /** Cloning rows with everything they use. */
  clone: CloneService
  /** Bringing the project up to the installed game's version. */
  gameUpdate: GameUpdateService
}

const SPELLFORGE_NAMES = '.spellforge/row-names.json'
const EFFECT_COPIES = '.spellforge/effect-copies.json'

export class Session {
  private settingsFile: string
  settings: A.Settings
  private open: Open | null = null
  private effectNames = new Map<number, string>()

  private bundledDataDir: string
  /** Vanilla regulation and text of every game version seen (see vanilla.ts). */
  vanilla: VanillaStore
  /** The running game, for reloading the character in it (F5). */
  readonly gameLink = new GameLink()

  /** Starts the game with the open project's mod folder through me3, offline, on Spellforge's own save. */
  play(): { me3: string; savefile: string } {
    const o = this.requireOpen()
    if (this.gameLink.status().running)
      throw new Error(
        'Elden Ring is running already: F5 reloads your character in it. Close the game to start it again with Play.',
      )
    const me3 = findMe3()
    if (!me3)
      throw new Error(
        'Playing needs ModEngine 3 (me3), and it wasn’t found. Install it, then Play starts the game with your mod.',
      )
    launchMe3(me3, me3PlayArgs(o.project.config.modDir))
    return { me3, savefile: PLAY_SAVEFILE }
  }

  constructor(userDataDir: string, bundledDataDir = path.resolve('data', 'er'), options: { vanillaDir?: string } = {}) {
    this.bundledDataDir = bundledDataDir
    this.vanilla = new VanillaStore(options.vanillaDir ?? path.join(userDataDir, 'vanilla'))
    this.settingsFile = path.join(userDataDir, 'settings.json')
    this.settings = { ...DEFAULT_SETTINGS }
    try {
      this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) }
    } catch {
      /* first run */
    }
    // The default theme changed twice (Ember, then Glintstone, then Roundtable): an untouched setup of an
    // older default moves to the current one, once. A theme someone picked or customised stays.
    const t = this.settings.theme
    if (t && (t.v ?? 1) < 3) {
      const untouched = !Object.keys(t.overrides ?? {}).length
      const oldDefault = (t.v ?? 1) < 2 ? 'ember' : 'glintstone'
      this.settings.theme = { ...t, preset: untouched && t.preset === oldDefault ? 'roundtable' : t.preset, v: 3 }
    }
    // First run (or the folder moved): find the player's own install, so new
    // users don't need to unpack anything or know where Steam put the game.
    if (!this.settings.gameDir || !inspectGameFolder(this.settings.gameDir).regulation) {
      try {
        const found = findEldenRingInstalls()
        if (found.length) this.settings.gameDir = found[0]
      } catch {
        /* detection is a convenience */
      }
    }
    this.applyOodlePaths()
    if (this.settings.effectNamesCsv) {
      try {
        this.effectNames = parseEffectNamesCsv(fs.readFileSync(this.settings.effectNamesCsv, 'utf8'))
      } catch {
        /* the CSV moved; names are optional */
      }
    }
  }

  loadEffectNames(file: string): number {
    this.effectNames = parseEffectNamesCsv(fs.readFileSync(file, 'utf8'))
    this.saveSettings({ effectNamesCsv: file })
    return this.effectNames.size
  }

  /** Community sheet data bundled with the app, loaded on first use. */
  private sheet: { credit: string; effects: Record<string, A.EffectDetails> } | null = null

  effectSheet(): { credit: string; effects: Record<string, A.EffectDetails> } {
    if (this.sheet) return this.sheet
    this.sheet = { credit: '', effects: {} }
    try {
      const data = JSON.parse(fs.readFileSync(path.join(this.bundledDataDir, 'effect-names.json'), 'utf8'))
      const who = (data.source?.contributors ?? []).join(', ')
      this.sheet = {
        credit: `Effect info: ${data.source?.name ?? 'community FXR ID sheet'}${who ? ` — ${who}` : ''}`,
        effects: data.effects ?? {},
      }
    } catch {
      /* names are optional */
    }
    return this.sheet
  }

  effectDetails(id: number): A.EffectDetails {
    return { ...this.effectSheet().effects[String(id)], category: effectCategory(id) }
  }

  /** Imported CSV names win; otherwise "Origin: what it looks like" from the sheet. */
  effectName(id: number): string {
    const imported = this.effectNames.get(id)
    if (imported) return imported
    const d = this.effectSheet().effects[String(id)]
    if (!d) {
      // A copy (made to be scaled, by a duplicate, for a skill): named after its original.
      const from = this.open?.scales.copies[id] ?? this.open?.effectCopies[String(id)]
      return from && from !== id ? `${this.effectName(from) || `Effect ${from}`} (copy of ${from})` : ''
    }
    if (d.origin && d.behaviour) return `${d.origin}: ${d.behaviour}`
    return d.origin ?? d.behaviour ?? ''
  }

  private gameFilesCache: GameFiles | null = null

  /**
   * The chosen game folder's files: loose, or inside a normal install's
   * packed archives (headers cached in the user data folder).
   */
  gameFiles(): GameFiles {
    const dir = path.resolve(this.settings.gameDir || '.')
    if (this.gameFilesCache?.dir === dir) return this.gameFilesCache
    this.gameFilesCache?.close()
    this.gameFilesCache = new GameFiles(dir, {
      cacheDir: path.join(path.dirname(this.settingsFile), 'archive-cache'),
      dictionaryFile: path.join(this.bundledDataDir, 'file-dictionary.txt'),
    })
    return this.gameFilesCache
  }

  private applyOodlePaths(): void {
    setOodleSearchPaths([
      this.settings.gameDir,
      (process as { resourcesPath?: string }).resourcesPath ?? '',
      process.cwd(),
    ])
  }

  requireOpen(): Open {
    if (!this.open) throw new Error('No project is open')
    return this.open
  }

  /** The open project's params (browse, trees, rows, the param editor). */
  get params(): ParamService {
    return this.requireOpen().params
  }

  /** The open project's game text. */
  get text(): TextService {
    return this.requireOpen().text
  }

  /** The open project's effects. */
  get effects(): EffectService {
    return this.requireOpen().effects
  }

  /** Textures, models, thumbnails, icons and light probes. */
  get assets(): AssetService {
    return this.requireOpen().assets
  }

  /** Cloning rows with everything they use. */
  get clone(): CloneService {
    return this.requireOpen().clone
  }

  /** Bringing the open project up to the installed game's version. */
  get gameUpdate(): GameUpdateService {
    return this.requireOpen().gameUpdate
  }

  /** The Animations workspace (TAE events and behaviour registration). */
  get animations(): AnimationService {
    return this.requireOpen().anims
  }

  /** The animation viewport's character. */
  get character(): CharacterService {
    return this.requireOpen().character
  }

  /** Other characters: enemies, bosses, NPCs and creatures. */
  get enemies(): EnemyService {
    return this.requireOpen().enemies
  }

  /** The player's behaviour script (c0000.hks) and its recipes. */
  get behaviour(): BehaviourService {
    return this.requireOpen().behaviour
  }

  /** The game's event scripts and the project's event recipes. */
  get events(): EventService {
    return this.requireOpen().events
  }

  /**
   * An item lot (ItemLotParam_map) that gives one item, for an event to give:
   * a copy of the Rowa Fruit lot (a single item, no flag) at an id whose
   * neighbours are free too, since the game carries on into the next lot's
   * row when it has one.
   */
  eventItemLot(category: number, item: number, count: number): number {
    const o = this.requireOpen()
    const PARAM = 'ItemLotParam_map'
    const ITEM_PARAMS: Record<number, string> = {
      1: 'EquipParamGoods',
      2: 'EquipParamWeapon',
      3: 'EquipParamProtector',
      4: 'EquipParamAccessory',
      5: 'EquipParamGem',
    }
    const itemParam = ITEM_PARAMS[category]
    if (!itemParam) throw new Error('Pick an item, a weapon, armour, a talisman or an Ash of War')
    if (!o.db.hasRow(itemParam, item)) throw new Error(`There's no ${itemParam} ${item}`)
    if (!(Number.isInteger(count) && count >= 1 && count <= 255)) throw new Error('Give 1 to 255 of it')
    let id = 997300
    while (o.db.hasRow(PARAM, id - 1) || o.db.hasRow(PARAM, id) || o.db.hasRow(PARAM, id + 1)) id += 10
    const name = this.params.rowView(itemParam, item).gameName || o.db.rowName(itemParam, item) || `item ${item}`
    this.params.addRow(PARAM, id, o.db.hasRow(PARAM, 997200) ? 997200 : undefined, `${name} (given by an event)`)
    this.params.setRowField(PARAM, id, 'lotItemId01', item)
    this.params.setRowField(PARAM, id, 'lotItemCategory01', category)
    this.params.setRowField(PARAM, id, 'lotItemNum01', count)
    this.params.setRowField(PARAM, id, 'lotItemBasePoint01', 1000)
    this.params.setRowField(PARAM, id, 'getItemFlagId', 0)
    return id
  }

  /**
   * The behaviour events recipes can play: the game's event names
   * (action/eventnameid.txt) whose state plays an animation id (the
   * behaviour graph's selector X_CMSG is the state of event W_X).
   */
  private behaviourSlots(): A.BehaviourSlot[] {
    const o = this.requireOpen()
    let names = new Set<string>()
    try {
      names = eventNames(o.project.read('action/eventnameid.txt').data)
    } catch {
      /* without the list, the graph's own states */
    }
    const out = new Map<string, A.BehaviourSlot>()
    for (const sel of o.anims.behaviourSelectors()) {
      const state = sel.name.replace(/_CMSG\d*$/, '')
      let event = `W_${state}`
      // The game's graph spells two selectors AttackRightLigh5 / Ligh6 (030040, 030050); their events are AttackRightLight5 / 6.
      if (names.size && !names.has(event) && names.has(event.replace(/Ligh(\d)$/, 'Light$1')))
        event = event.replace(/Ligh(\d)$/, 'Light$1')
      if (names.size && !names.has(event)) continue
      if (!out.has(event)) out.set(event, { event, animId: sel.animId, state: sel.name })
    }
    return [...out.values()].sort((a, b) => a.animId - b.animId || a.event.localeCompare(b.event))
  }

  /** Weapons with a special category of their own (spAtkcategory 50 and up): the project's first. */
  behaviourWeapons(): A.BehaviourWeapon[] {
    const o = this.requireOpen()
    const out: A.BehaviourWeapon[] = []
    for (const r of o.db.get('EquipParamWeapon').param.rows) {
      if (r.id % 10000 !== 0) continue
      const category = o.db.num('EquipParamWeapon', r.id, 'spAtkcategory')
      if (category < 50) continue
      const name = o.db.rowName('EquipParamWeapon', r.id)
      if (isPlaceholderName(name)) continue
      out.push({ id: r.id, name, category, project: !!this.params.rowState('EquipParamWeapon', r.id) })
    }
    return out.sort((a, b) => Number(b.project) - Number(a.project) || a.name.localeCompare(b.name))
  }

  /**
   * Skill types (swordArtsTypeNew) the project's skills use that no skill of
   * the installed game does: the behaviour script gives them entries in the
   * game's per-type tables (recipes.ts skillTypeEntries), or L2 does nothing.
   */
  newSkillTypes(): number[] {
    const o = this.requireOpen()
    const typesIn = (db: ParamDatabase) =>
      new Set(db.get('SwordArtsParam').param.rows.map((r) => db.num('SwordArtsParam', r.id, 'swordArtsTypeNew')))
    const game = typesIn(o.gameDb)
    return [...typesIn(o.db)].filter((t) => !game.has(t)).sort((a, b) => a - b)
  }

  /** Skills with a type (swordArtsTypeNew): the project's first. */
  behaviourSkills(): A.BehaviourSkill[] {
    const o = this.requireOpen()
    const out: A.BehaviourSkill[] = []
    for (const r of o.db.get('SwordArtsParam').param.rows) {
      const type = o.db.num('SwordArtsParam', r.id, 'swordArtsTypeNew')
      if (type <= 0) continue
      const name = o.db.rowName('SwordArtsParam', r.id)
      if (isPlaceholderName(name)) continue
      out.push({ id: r.id, name, type, project: !!this.params.rowState('SwordArtsParam', r.id) })
    }
    return out.sort((a, b) => Number(b.project) - Number(a.project) || a.name.localeCompare(b.name))
  }

  /**
   * A recipe's window: a marker SpEffect (a copy of the game's own [HKS]
   * flag SpEffect 100000: nothing but its id, lasting while an event keeps
   * it on) and an AddSpEffect event (type 67) for it in the animation.
   * Ids are below 16,777,216, exact in the behaviour script's numbers.
   */
  behaviourWindow(req: A.Req<'behaviour:window'>): { speffect: number } {
    const o = this.requireOpen()
    let id = req.speffect ?? -1
    if (!(id > 0) || !o.db.hasRow('SpEffectParam', id)) {
      if (!(id > 0)) id = this.params.freeId('SpEffectParam', 7_810_000)
      if (id > 16_777_216) throw new Error('No free SpEffect id the behaviour script can test exactly')
      this.params.addRow(
        'SpEffectParam',
        id,
        o.db.hasRow('SpEffectParam', 100000) ? 100000 : undefined,
        `[Spellforge] ${req.name}`.slice(0, 120),
      )
    }
    const added = o.anims.addEvent({ name: req.animation, type: 67, start: req.start, end: req.end })
    o.anims.setEvent({ name: req.animation, index: added.index, field: { type: 's32', offset: 0, value: id } })
    return { speffect: id }
  }

  /** Sound banks: where sound events are, and others' sounds brought into the player's. */
  get sounds(): SoundService {
    return this.requireOpen().sounds
  }

  /** Where an animation event's sound is (SoundService.place), with the character's name for a character's. */
  soundPlace(type: number, id: number): A.SoundPlaceView {
    const at = this.sounds.place(type, id)
    if (at.where !== 'character' || !at.chr) return at
    let owner: string | undefined
    try {
      owner = this.enemies.list().find((e) => e.chr === at.chr)?.name
    } catch {
      /* no names */
    }
    return owner ? { ...at, owner } : at
  }

  /** What ids mean: event flags, text ids, shared ids, and lookups of any number. */
  get ids(): IdService {
    return this.requireOpen().ids
  }

  /** After any param edit: what was derived from the params is worked out again. */
  paramsEdited(o: Open): void {
    o.effectUsers = null
    o.ids.paramsChanged()
  }

  /** Enemy moves and bullets made into the player's skills and spells. */
  get enemyMoves(): EnemyMoves {
    return new EnemyMoves(this)
  }

  /* ------------------------- unsaved changes kept -------------------------- */

  /** The journal of unsaved changes (services/recovery.ts), in the settings folder. */
  private recoveryStore: Recovery | null = null
  private get recovery(): Recovery {
    return (this.recoveryStore ??= new Recovery(path.dirname(this.settingsFile)))
  }

  /** A change was made through the app: kept until it's saved. */
  recordChange(channel: string, req: unknown): void {
    const o = this.open
    if (!o) return
    try {
      this.recovery.record(o.project.config.modDir, String(o.gameDb.version ?? ''), channel, req)
    } catch (e) {
      // Keeping a copy must never stop the edit itself.
      console.error('[recovery]', e)
    }
  }

  /** Saved (or replaced by the game's): nothing left to keep. */
  changesSaved(): void {
    if (this.open) this.recovery.clear(this.open.project.config.modDir)
  }

  /** Every project with unsaved changes kept from last time. */
  recoveryList(): A.RecoveryInfo[] {
    return this.recovery.pending().map((p) => ({ ...p, filesChanged: false, gameChanged: false }))
  }

  /** The open project's unsaved changes kept from last time, if any. */
  recoveryStatus(): A.RecoveryInfo | null {
    const o = this.requireOpen()
    const kept = this.recovery.read(o.project.config.modDir)
    if (!kept) return null
    const { header, entries } = kept
    return {
      modDir: o.project.config.modDir,
      changes: entries.length,
      started: header.started,
      last: Math.max(header.started, ...entries.map((e) => e.t)),
      filesChanged: header.files !== projectFingerprint(o.project.config.modDir),
      gameChanged: header.game !== String(o.gameDb.version ?? ''),
    }
  }

  /** The open project's kept changes, to make again (dispatch.ts restoreChanges). */
  keptChanges(): JournalEntry[] {
    return this.recovery.read(this.requireOpen().project.config.modDir)?.entries ?? []
  }

  /** Drops the kept changes of a project (the open one if none is named). */
  discardKept(modDir?: string): void {
    const dir = modDir ?? this.open?.project.config.modDir
    if (dir) this.recovery.clear(dir)
  }

  /**
   * Where the user was in each project (the window's place: page, row,
   * animation…), in places.json in the settings folder, written as they
   * move, so it survives a crash too.
   */
  private placesFile(): string {
    return path.join(path.dirname(this.settingsFile), 'places.json')
  }
  private readPlaces(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.placesFile(), 'utf8'))
    } catch {
      return {}
    }
  }
  lastPlace(modDir: string): unknown {
    return this.readPlaces()[path.resolve(modDir).toLowerCase()] ?? null
  }
  keepPlace(modDir: string, place: unknown): void {
    const places = this.readPlaces()
    places[path.resolve(modDir).toLowerCase()] = place
    try {
      fs.writeFileSync(this.placesFile(), JSON.stringify(places))
    } catch {
      /* not kept this time */
    }
  }

  /** Skills, spells and effects scaled to a chosen size (workflows/scale.ts). */
  get scaler(): Scaler {
    this.requireOpen()
    return new Scaler(this)
  }

  /** The sizes things were scaled to; edit it, then call scaleRecordChanged. */
  scaleRecord(): ScaleRecord {
    return this.requireOpen().scales
  }

  scaleRecordChanged(): void {
    this.requireOpen().scalesDirty = true
  }

  /** Weapons' own movesets (workflows/moveset.ts). */
  get movesets(): Movesets {
    this.requireOpen()
    return new Movesets(this)
  }

  /** The weapons given movesets of their own; edit it, then call movesetRecordChanged. */
  movesetRecord(): MovesetRecord {
    return this.requireOpen().movesets
  }

  movesetRecordChanged(): void {
    this.requireOpen().movesetsDirty = true
  }

  /** A row's name in game (its text), else its row name. */
  displayName(param: string, id: number): string {
    const o = this.requireOpen()
    return o.gameNames[param]?.[String(id)] || o.db.rowName(param, id)
  }

  /** The open project's params, files and effects, for the tools built on the session (workflows/enemyMoves.ts). */
  internals(): { db: ParamDatabase; project: Project; lib: EffectLibrary; effectIdStart: number } {
    const o = this.requireOpen()
    return { db: o.db, project: o.project, lib: o.lib, effectIdStart: this.settings.effectIdStart }
  }

  /* --------------------------------- setup -------------------------------- */

  status(): A.SetupStatus {
    const s = this.settings
    const problems: string[] = []
    // A normal install (packed archives) or an unpacked copy; both have regulation.bin loose.
    const info = s.gameDir ? inspectGameFolder(s.gameDir) : null
    const gameKind: A.SetupStatus['gameKind'] = !info?.regulation
      ? null
      : info.unpacked
        ? 'unpacked'
        : info.archives
          ? 'install'
          : null
    const gameOk = gameKind !== null
    if (!gameOk) {
      problems.push(
        s.gameDir && info?.archives === false && !info.regulation
          ? 'That folder isn’t Elden Ring’s Game folder. Pick …\\ELDEN RING\\Game (the one with eldenring.exe and regulation.bin).'
          : 'Pick Elden Ring’s Game folder (your Steam install, …\\ELDEN RING\\Game), or an unpacked copy.',
      )
    }
    // Smithbox is optional: Spellforge ships its own copy of the param data.
    const smithboxOk = hasErData(s.smithboxDir)
    if (!smithboxOk && !hasErData(this.bundledDataDir)) {
      problems.push(
        'Spellforge’s built-in param data is missing — reinstall, or pick a Smithbox folder to use its data.',
      )
    }
    const oodleOk = gameOk && oodleAvailable()
    if (gameOk && !oodleOk) problems.push('oo2core_*_win64.dll was not found in the game folder.')
    return { settings: s, gameOk, gameKind, smithboxOk, oodleOk, problems, dataSource: this.dataSource() }
  }

  /** Param data folder: the user's Smithbox if set and valid, else the bundled copy. */
  dataRoot(): string {
    return hasErData(this.settings.smithboxDir) ? this.settings.smithboxDir : this.bundledDataDir
  }

  private dataSource(): A.SetupStatus['dataSource'] {
    if (hasErData(this.settings.smithboxDir)) {
      return { kind: 'smithbox', path: this.settings.smithboxDir, version: path.basename(this.settings.smithboxDir) }
    }
    let version = 'built-in'
    try {
      version = JSON.parse(fs.readFileSync(path.join(this.bundledDataDir, 'SOURCE.json'), 'utf8')).version ?? version
    } catch {
      /* no source record */
    }
    return { kind: 'bundled', path: this.bundledDataDir, version }
  }

  saveSettings(patch: Partial<A.Settings>): A.SetupStatus {
    // Picking …\ELDEN RING instead of …\ELDEN RING\Game is forgiven.
    if (patch.gameDir) patch = { ...patch, gameDir: normalizeGameFolder(patch.gameDir) }
    // Switching game folders (e.g. an old unpacked copy to the installed
    // game): keep the old one's vanilla files first, while they're reachable.
    if (patch.gameDir && this.settings.gameDir && path.resolve(patch.gameDir) !== path.resolve(this.settings.gameDir))
      this.snapshotGame(this.settings.gameDir)
    this.settings = { ...this.settings, ...patch }
    fs.mkdirSync(path.dirname(this.settingsFile), { recursive: true })
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2))
    this.applyOodlePaths()
    return this.status()
  }

  /**
   * Keeps a copy of a game folder's regulation and text, once per game
   * version, so a project made with that version can still be compared with
   * it after the game updates. Best effort: a failure only loses that.
   */
  private snapshotGame(dir: string): void {
    try {
      if (!dir || !inspectGameFolder(dir).regulation) return
      const resolved = path.resolve(dir)
      const shared = this.gameFiles()
      const game =
        shared.dir === resolved
          ? shared
          : new GameFiles(resolved, {
              cacheDir: path.join(path.dirname(this.settingsFile), 'archive-cache'),
              dictionaryFile: path.join(this.bundledDataDir, 'file-dictionary.txt'),
            })
      try {
        this.vanilla.snapshot(game)
      } finally {
        if (game !== shared) game.close()
      }
    } catch {
      /* the comparison falls back to the installed game */
    }
  }

  /* -------------------------------- project ------------------------------- */

  openProject(requestedDir: string): A.ProjectSummary {
    const st = this.status()
    if (st.problems.length) throw new Error(st.problems.join('\n'))
    const modDir = resolveModDir(requestedDir)
    if (requestedDir !== modDir) {
      // Keep the recent list pointing at the real mod folder.
      this.settings.recentProjects = this.settings.recentProjects.filter((p) => p !== requestedDir)
    }

    const project = new Project({
      gameDir: this.settings.gameDir,
      modDir,
      smithboxDir: this.settings.smithboxDir,
      game: this.gameFiles(),
    })
    const sb = { root: this.dataRoot() }
    this.snapshotGame(this.settings.gameDir)
    const reg = project.read('regulation.bin')
    const db = ParamDatabase.load(reg.data, sb)
    const gameDb = ParamDatabase.load(project.readGame('regulation.bin'), sb)
    // A project made with another game version is compared with that
    // version's vanilla rows, when Spellforge has kept them.
    let base = gameDb
    if (reg.source === 'project' && db.version && db.version !== gameDb.version) {
      const old = this.vanilla.read(db.version, 'regulation.bin')
      if (old) {
        try {
          base = ParamDatabase.load(old, sb)
        } catch {
          /* compare with the installed game */
        }
      }
    }
    const lib = new EffectLibrary(project)

    // Names: community (bundled data) < official game text (the project's msg
    // files over the game's) < this project's Smithbox names < ours.
    const gameNames = loadItemText(project).names
    // A skill's in-game name is the text its textId names.
    for (const [param, field] of Object.entries(TEXT_ID_FIELD)) {
      const byText = gameNames[param] ?? {}
      const byRow: Record<string, string> = {}
      for (const r of db.get(param).param.rows) {
        const name = byText[String(db.value(param, r.id, field))]
        if (name) byRow[String(r.id)] = name
      }
      gameNames[param] = byRow
    }
    // A spell's in-game name is its item's (same id; see NAMED_LIKE).
    for (const [param, like] of Object.entries(NAMED_LIKE)) {
      const names = gameNames[like] ?? {}
      gameNames[param] = Object.fromEntries(
        db
          .get(param)
          .param.rows.filter((r) => names[r.id])
          .map((r) => [String(r.id), names[r.id]]),
      )
    }
    db.overlayRowNames(gameNames)
    db.overlayRowNamesFromDir(path.join(modDir, '.smithbox', 'Project', 'Stripped Row Names'))
    let spellforgeNames: Record<string, Record<string, string>> = {}
    const namesFile = project.projectPath(SPELLFORGE_NAMES)
    if (fs.existsSync(namesFile)) {
      try {
        spellforgeNames = JSON.parse(fs.readFileSync(namesFile, 'utf8'))
      } catch {
        /* ignore a damaged names file rather than refuse to open */
      }
    }
    db.overlayRowNames(spellforgeNames)

    // Animations, too, compare with the project's own game version when it was kept.
    const baseVersion = base !== gameDb ? db.version : null
    const anims = new AnimationService(
      {
        project,
        db,
        effectName: (id) => this.effectName(id),
        baseAnibnd: () => (baseVersion ? this.vanilla.read(baseVersion, SNAPSHOT_ANIBND) : null),
        bodyDummyBone: (id) => this.open?.character.bodyDummyBone(id) ?? null,
      },
      path.join(this.bundledDataDir, 'tae-template.json'),
    )
    anims.onEventsChanged = () => {
      this.assets.animIndex = null
      this.effects.effectSpawns = null
    }
    const character = new CharacterService(project, db, anims, (param, id) => this.params.rowState(param, id))
    character.displayName = (param, id) => this.displayName(param, id)
    const enemies = new EnemyService(project, db, {
      effectName: (id) => this.effectName(id),
      commonEffect: (id) => lib.hasEffect(id),
      ...anims.templateData(),
    })
    character.setOthers(enemies)
    character.setMaterials((mtd) => this.assets.matbins().samplers(mtd))
    const sounds = new SoundService(
      project,
      db,
      path.join(this.bundledDataDir, 'wwise', 'packed_codebooks_aoTuV_603.bin'),
    )
    const icons = new IconService(project, path.join(path.dirname(this.settingsFile), 'icon-cache'))
    const ids = new IdService(project, db, this.bundledDataDir, {
      effectName: (id) => this.effectName(id),
      hasIcon: (kind, id) => isIconKind(kind) && !!icons.sprite(kind, id),
    })
    // The maps name dialogue scripts and entity ids: read them while the user looks around.
    this.open?.ids.stop()
    ids.warm(3000)
    let scales = emptyScaleRecord()
    try {
      const file = project.projectPath(SCALES_RECORD)
      if (fs.existsSync(file)) scales = { ...emptyScaleRecord(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }
    } catch {
      /* a damaged record: sizes count from now */
    }
    let movesets = emptyMovesetRecord()
    try {
      const file = project.projectPath(MOVESETS_RECORD)
      if (fs.existsSync(file)) movesets = { ...emptyMovesetRecord(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }
    } catch {
      /* a damaged record: the weapons keep their movesets, made again from here */
    }
    let effectCopies: Record<string, number> = {}
    try {
      const file = project.projectPath(EFFECT_COPIES)
      if (fs.existsSync(file)) effectCopies = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      /* a damaged record: copies show their own ids */
    }
    this.open = {
      project,
      db,
      base,
      gameDb,
      lib,
      effectUsers: null,
      lastPlan: null,
      spellforgeNames,
      namesDirty: false,
      gameNames,
      msgs: new Map(),
      anims,
      character,
      enemies,
      sounds,
      icons,
      ids,
      scales,
      scalesDirty: false,
      movesets,
      movesetsDirty: false,
      effectCopies,
      effectCopiesDirty: false,
      repack: badlyPacked(modDir),
      events: new EventService({
        project,
        mapName: (map) => ids.mapName(map),
        flagUsed: (flag) => ids.flagUsed(flag),
        scriptsChanged: () => ids.scriptsChanged(),
      }),
      behaviour: new BehaviourService({
        project,
        cacheDir: path.join(path.dirname(this.settingsFile), 'hks-cache'),
        slots: () => this.behaviourSlots(),
        events: () => eventNames(project.read('action/eventnameid.txt').data),
        skillTypes: () => this.newSkillTypes(),
      }),
      params: new ParamService(this),
      text: new TextService(this),
      effects: new EffectService(this),
      assets: new AssetService(this),
      clone: new CloneService(this),
      gameUpdate: new GameUpdateService(this),
    }
    const opened = this.open
    lib.onClone = (from, to) => {
      opened.effectCopies[String(to)] = opened.effectCopies[String(from)] ?? from
      opened.effectCopiesDirty = true
    }

    const recent = [modDir, ...this.settings.recentProjects.filter((p) => p !== modDir)].slice(0, 8)
    this.saveSettings({ recentProjects: recent })

    // What an earlier Spellforge wrote wrong: fixed now, written on save.
    const repaired: string[] = []
    if (opened.repack.length) {
      const one = opened.repack.length === 1
      repaired.push(
        `${opened.repack.length} packed ${one ? 'file' : 'files'} Elden Ring can't unpack (${opened.repack.join(', ')}): an earlier Spellforge compressed ${one ? 'it' : 'them'} so the game reads garbage past ${one ? 'its' : 'their'} first 256 KB, and it crashes at startup. Save to pack ${one ? 'it' : 'them'} again.`,
      )
    }
    try {
      const fixed = anims.repairedCategories()
      if (fixed.length)
        repaired.push(
          `Fixed ${fixed.length} animation ${fixed.length === 1 ? 'category' : 'categories'} (${fixed.map((c) => categoryLabel(c)).join(', ')}): an earlier Spellforge left another category's id in their headers, where every game file repeats its own. Save to write the fix.`,
        )
    } catch {
      /* the animations don't read: the Animations page says why */
    }
    try {
      const rebuilt = opened.sounds.repairPlayerBank()
      if (rebuilt)
        repaired.push(
          `The player's sound bank (sd/enus/cs_main.bnk) was put together by an earlier Spellforge in a way Elden Ring drops, so menu and player sounds went silent. Built again: the game's own, with the ${rebuilt.events} sounds brought in. Save to write it.`,
        )
    } catch {
      /* the banks don't read: the sounds stay as they are */
    }
    try {
      const stops = opened.sounds.repairStops()
      if (stops)
        repaired.push(
          `${stops.events} sounds brought into the player's sound bank couldn't be stopped: an earlier Spellforge left out their Stop events, so a looping one (like Morgott's lingering swords' hum) played on forever. Added. Save to write them.`,
        )
    } catch {
      /* the banks don't read: the sounds stay as they are */
    }
    try {
      const types = opened.behaviour.missingSkillTypes()
      if (types.length)
        repaired.push(
          `Skill ${types.length === 1 ? 'type' : 'types'} ${types.join(', ')} ${types.length === 1 ? 'needs entries' : 'need entries'} in the behaviour script: the game's skill tables don't list ${types.length === 1 ? 'it' : 'them'}, and without ${types.length === 1 ? 'it' : 'them'} L2 does nothing in game. Save to add them.`,
        )
    } catch {
      /* the skills don't read: nothing to add */
    }

    return {
      modDir,
      regulationSource: reg.source,
      regulationVersion: db.version,
      counts: {
        weapons: db.get('EquipParamWeapon').param.rows.length,
        bullets: db.get('Bullet').param.rows.length,
        effects: lib.allEffectIds().length,
      },
      changes: diffParams(base, db).map((d) => ({
        param: d.param,
        added: d.added.length,
        changed: d.changed.length,
        removed: d.removed.length,
      })),
      version: this.versionInfo(db, base, gameDb),
      ...(repaired.length ? { repaired } : {}),
    }
  }

  /** How the project's game version relates to the installed game's, when they differ. */
  private versionInfo(db: ParamDatabase, base: ParamDatabase, gameDb: ParamDatabase): A.VersionInfo | undefined {
    if (!db.version || db.version === gameDb.version) return undefined
    const known = base !== gameDb
    let updateChanged = 0
    let updateAdded = 0
    if (known) {
      // What the newer game changed or added since, that the project's
      // regulation (from the older version) doesn't have.
      for (const d of diffParams(base, gameDb)) {
        const mine = db.params.get(d.param)
        updateAdded += d.added.filter((id) => !mine || !db.hasRow(d.param, id)).length
        updateChanged += d.changed.length
      }
    }
    return {
      project: gameVersionLabel(db.version),
      game: gameVersionLabel(gameDb.version),
      projectVersion: db.version,
      gameVersion: gameDb.version,
      older: db.version < gameDb.version,
      known,
      updateChanged,
      updateAdded,
    }
  }

  /** The installed game's regulation, when it's newer than the project's (its ids are taken too). */
  newerGame(): ParamDatabase | null {
    const o = this.requireOpen()
    return o.db.version && o.gameDb.version > o.db.version ? o.gameDb : null
  }

  dirty(): A.DirtyState {
    const o = this.requireOpen()
    return {
      regulation: [...o.db.params.values()].some((p) => p.dirty),
      bundles: [
        ...o.lib
          .loadedBundles()
          .filter((b) => b.dirty)
          .map((b) => b.rel),
        ...(o.namesDirty ? [SPELLFORGE_NAMES] : []),
        ...(o.scalesDirty ? [SCALES_RECORD] : []),
        ...(o.movesetsDirty ? [MOVESETS_RECORD] : []),
        ...(o.effectCopiesDirty ? [EFFECT_COPIES] : []),
        ...o.msgs.keys(),
        ...o.anims.dirtyFiles(),
        ...o.sounds.dirtyFiles(),
        ...o.behaviour.dirtyFiles(),
        ...o.events.dirtyFiles(),
        ...o.project.stagedFiles(),
        ...o.repack,
      ],
    }
  }

  save(): A.SaveResult {
    const o = this.requireOpen()
    const written: string[] = []
    if ([...o.db.params.values()].some((p) => p.dirty)) {
      written.push(o.project.writeProjectFile('regulation.bin', o.db.toRegulation()))
      for (const p of o.db.params.values()) p.dirty = false
    }
    written.push(...o.lib.saveToProject())
    for (const [rel, msg] of o.msgs) {
      const dcx = msg.dcx.format === 'KRAK' ? { format: 'KRAK' as const, level: 4 } : msg.dcx
      written.push(o.project.writeProjectFile(rel, dcxCompress(writeBnd4(msg.bnd), dcx)))
    }
    o.msgs.clear()
    written.push(...o.anims.save())
    written.push(...o.sounds.save())
    written.push(...o.behaviour.save())
    written.push(...o.events.save())
    written.push(...o.project.writeStaged())
    if (o.namesDirty) {
      written.push(
        o.project.writeProjectFile(SPELLFORGE_NAMES, Buffer.from(JSON.stringify(o.spellforgeNames, null, 2))),
      )
      o.namesDirty = false
    }
    if (o.scalesDirty) {
      written.push(o.project.writeProjectFile(SCALES_RECORD, Buffer.from(JSON.stringify(o.scales, null, 2))))
      o.scalesDirty = false
    }
    if (o.movesetsDirty) {
      written.push(o.project.writeProjectFile(MOVESETS_RECORD, Buffer.from(JSON.stringify(o.movesets, null, 2))))
      o.movesetsDirty = false
    }
    if (o.effectCopiesDirty) {
      written.push(o.project.writeProjectFile(EFFECT_COPIES, Buffer.from(JSON.stringify(o.effectCopies, null, 2))))
      o.effectCopiesDirty = false
    }
    // Badly packed files nothing above wrote again: packed again as they are.
    const done = new Set(written.map((w) => path.resolve(w).toLowerCase()))
    for (const rel of o.repack) {
      const file = o.project.projectPath(rel)
      if (done.has(path.resolve(file).toLowerCase()) || !fs.existsSync(file)) continue
      written.push(o.project.writeProjectFile(rel, repackDcx(fs.readFileSync(file))))
    }
    o.repack = []
    return { written, backupsFolder: o.project.backupsFolder }
  }
}

/* -------------------------------- helpers -------------------------------- */

/** Effect id ranges, from the community sheet's notes on FromSoft's numbering. */
const EFFECT_CATEGORIES: [number, number, string][] = [
  [1_000, 9_999, 'Status effects'],
  [30_000, 39_999, 'Online'],
  [100_000, 199_999, 'Footsteps & materials'],
  [200_000, 299_999, 'Attack sparks'],
  [300_000, 399_999, 'Goods & accessories'],
  [400_000, 499_999, 'Weapons'],
  [500_000, 599_999, 'Magic'],
  [600_000, 699_999, 'Characters'],
  [700_000, 799_999, 'Faraway effects'],
  [800_000, 899_999, 'Assets & environments'],
  [1_000_000, 1_999_999, 'Debug'],
  [2_000_000, 2_999_999, 'Damage effects'],
  [5_000_000, 5_999_999, 'Arrows & bolts'],
  [7_000_000, 7_999_999, 'Cutscenes'],
]

function effectCategory(id: number): string | undefined {
  return EFFECT_CATEGORIES.find(([lo, hi]) => id >= lo && id <= hi)?.[2]
}

/**
 * Accepts a project's `mod` folder, or a folder containing one — directly
 * (`X/mod`) or one level down (`X/ME2 - Name/mod`), the usual ModEngine2
 * layouts — and returns the `mod` folder itself.
 */
function resolveModDir(dir: string): string {
  const isMod = (d: string) => path.basename(d).toLowerCase() === 'mod'
  if (isMod(dir)) return dir
  const direct = path.join(dir, 'mod')
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct
  const nested: string[] = []
  for (const child of safeReaddir(dir)) {
    const candidate = path.join(dir, child, 'mod')
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) nested.push(candidate)
  }
  if (nested.length === 1) return nested[0]
  if (nested.length > 1) {
    throw new Error(`That folder holds several mod folders — open one of them:\n${nested.join('\n')}`)
  }
  return dir
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}
