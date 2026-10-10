/**
 * The Animations workspace: the player's animation events
 * (chr/c0000.anibnd.dcx, what DS Anim Studio edits) and the behaviour graph
 * that decides which animations the game can play (chr/c0000.behbnd.dcx, what
 * ERClipGeneratorTool edits).
 *
 * Both are read from the project when it has them, otherwise from the game,
 * and are only ever written into the project's folder.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../../core/project/project.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import { entryFileName, findEntry, readBnd4, type Bnd4, type Bnd4Entry, writeBnd4 } from '../../core/formats/bnd4.ts'
import { dcxCompress, dcxDecompress, type DcxInfo } from '../../core/formats/dcx.ts'
import {
  paramSizes,
  readTaeFile,
  type ParamSizes,
  type TaeFile,
  type TaeFileAnimation,
  type TaeFileEvent,
} from '../../core/formats/taeFile.ts'
import {
  readCompendium,
  readTagfile,
  writeTagfile,
  type Compendium,
  type Tagfile,
} from '../../core/formats/havok/tagfile.ts'
import {
  clipSettings,
  indexBehavior,
  registerAnimations,
  setClipSettings,
  type BehaviorIndex,
  type BehaviorSelector,
  type ClipSettings,
} from '../../core/animation/behavior.ts'
import { judgeOfBehaviorRow } from '../../core/params/behaviorIds.ts'
import {
  AnimationBinder,
  FIELD_SIZE,
  IMPORTS_MOTION,
  LOOPS_BY_DEFAULT,
  addEvent,
  animationSignature,
  cloneAnimation,
  countEventTypes,
  decodeEvent,
  deleteEvent,
  duplicateAnimation,
  entryCategory,
  eventSummary,
  flatFields,
  fullName,
  groupOf,
  linkOf,
  motionOf,
  motionReference,
  newEventParams,
  putAnimation,
  readField,
  taeAnimationCount,
  taeAnimationIds,
  refTarget,
  writeField,
  type TaeTemplate,
} from '../../core/animation/animations.ts'
import { animationName, categoryLabel, describeAnimationId, parseAnimationName } from '../../shared/animIds.ts'
import { parseDummyId, type DummyRef } from '../../core/animation/dummies.ts'
import type * as A from '../../shared/api.ts'
import { FLOAT_MAX, OPEN_EVENT_END } from '../../shared/api.ts'
import { taeSoundNames } from './sounds.ts'
import { isPlaceholderName } from '../../core/project/text.ts'
import { FPS, frameNumber } from '../../shared/frames.ts'
import { plural } from '../../shared/format.ts'

const ANIBND = 'chr/c0000.anibnd.dcx'
/** Which animation files Spellforge added to the project's copies of the player's binders (see recordedMotions). */
const MOTIONS_RECORD = '.spellforge/motions.json'
const BEHBND = 'chr/c0000.behbnd.dcx'

interface Anim {
  binder: AnimationBinder
  dcx: DcxInfo
  /** Edited since the last save. */
  dirty: boolean
  /** The game's TAE bytes by category, for marking what the project changed. */
  game: Map<number, Buffer>
  /** Game animation signatures by category (parsed on demand). */
  gameSigs: Map<number, Map<number, string>>
  /** Category -> animation id -> project state (cleared on edits). */
  states: Map<number, Map<number, A.ProjectState>>
  /** The project has its own anibnd (else this is the game's, unedited). */
  own: boolean
}

/** One undoable edit: the animations it changed, as they were (null: not there). */
/** Animations as an edit found them, and their clip settings when the edit changed those. */
type UndoStep = { name: string; category: number; anim: TaeFileAnimation | null; clip?: ClipSettings }[]

/** The project's own names and tags for animations (F2), kept with the project. */
const NOTES_RECORD = '.spellforge/animation-notes.json'

interface Beh {
  bnd: Bnd4
  dcx: DcxInfo
  entry: Bnd4Entry
  tf: Tagfile
  index: BehaviorIndex
  /** Every animation some clip plays. */
  played: Set<string>
  byId: Map<number, BehaviorSelector[]>
  dirty: boolean
}

export interface AnimationHost {
  project: Project
  db: ParamDatabase
  effectName(id: number): string
  /**
   * The game's anibnd as the game version the project was made with had it,
   * when that differs from the installed game's and Spellforge kept it (so a
   * game update's changes don't show as the project's). Null: use the game's.
   */
  baseAnibnd?(): Buffer | null
  /** The bone a player body dummy poly rides (c0000's model), for saying where it is. */
  bodyDummyBone?(id: number): string | null
}

/** Hand-written notes for categories whose use the params don't reveal. */
const CATEGORY_NOTES: Record<number, string> = {
  0: 'Common: movement, items, reactions',
}

/**
 * Effect events sharing a slot at the same time: a character holds one effect
 * per slot, so only one of them shows in game (character.ts shareSlots). Their
 * SlotID says so, with a slot that's free then.
 */
function noteSlotClashes(events: A.AnimEventView[]): void {
  const slotOf = (ev: A.AnimEventView) =>
    ev.fields.some((f) => f.link === 'effect' && f.value > 0)
      ? (ev.fields.find((f) => f.name === 'SlotID')?.value ?? -1)
      : -1
  const endOf = (ev: A.AnimEventView) => (ev.end >= OPEN_EVENT_END ? Infinity : ev.end)
  const overlaps = (a: A.AnimEventView, b: A.AnimEventView) => a.start < endOf(b) && b.start < endOf(a)
  for (const ev of events) {
    const slot = slotOf(ev)
    if (slot < 0) continue
    const other = events.find((o) => o !== ev && slotOf(o) === slot && overlaps(ev, o))
    if (!other) continue
    // The next one up that nothing holds then (11 taken: 12), as the game's own animations number theirs.
    const used = new Set(events.filter((o) => slotOf(o) >= 0 && overlaps(ev, o)).map(slotOf))
    let free = slot + 1
    while (used.has(free)) free++
    const fx = other.fields.find((f) => f.link === 'effect')?.value
    const f = ev.fields.find((x) => x.name === 'SlotID')!
    f.about = `Effect ${fx} (${other.start.toFixed(2)}–${endOf(other) === Infinity ? 'end' : other.end.toFixed(2)} s) holds slot ${slot} too: one effect per slot, so only one of them shows in game. Slot ${free} is free then.`
  }
}

export class AnimationService {
  private host: AnimationHost
  private template: TaeTemplate
  private sizes: ParamSizes
  private anim: Anim | null = null
  private beh: Beh | null = null
  private judges: Map<number, number[]> | null = null
  private judgeRowCount = 0
  private eventUses: Map<number, number> | null = null
  /**
   * Edits, newest last: the animations each one changed, as they were
   * before it (null: the animation didn't exist). Undoing one puts the
   * animations as they are then on the redo stack, and the other way round.
   */
  private undoStack: UndoStep[] = []
  private redoStack: UndoStep[] = []
  /** The project's own names and tags for animations (read on first use). */
  private notesCache: A.AnimNotes | null = null
  private notesDirty = false
  /** Called after edits that change which animations fire which behaviours. */
  onEventsChanged: () => void = () => {}

  constructor(host: AnimationHost, templateFile: string) {
    this.host = host
    this.template = { events: {} }
    try {
      this.template = JSON.parse(fs.readFileSync(templateFile, 'utf8'))
    } catch {
      /* without the template events show as raw bytes */
    }
    this.sizes = paramSizes(this.template)
  }

  /* --------------------------------- loading -------------------------------- */

  private load(): Anim {
    if (this.anim) return this.anim
    const { project } = this.host
    const file = project.read(ANIBND)
    const d = dcxDecompress(file.data)
    const bnd = readBnd4(d.data)
    // The game's TAEs (of the project's own game version), to tell what the project changed.
    let gameBnd = bnd
    if (file.source === 'project') {
      try {
        gameBnd = readBnd4(dcxDecompress(this.host.baseAnibnd?.() ?? project.readGame(ANIBND)).data)
      } catch {
        gameBnd = { ...bnd, entries: [] }
      }
    }
    const game = new Map<number, Buffer>()
    for (const e of gameBnd.entries) {
      const c = entryCategory(e)
      if (c !== null) game.set(c, e.data)
    }
    this.anim = {
      binder: new AnimationBinder(bnd, this.sizes),
      dcx: d.info,
      dirty: false,
      game,
      gameSigs: new Map(),
      states: new Map(),
      own: file.source === 'project',
    }
    // Categories an earlier Spellforge wrote with another category's id in their header: written again on save.
    if (file.source === 'project') {
      this.headerFixes = this.anim.binder.fixHeaderIds()
      if (this.headerFixes.length) this.anim.dirty = true
    }
    return this.anim
  }

  /** Categories whose TAE headers were repaired when the project opened (see AnimationBinder.fixHeaderIds). */
  private headerFixes: number[] = []

  /** Loads the project's own animation binder (if it has one) and says which categories it repaired. */
  repairedCategories(): number[] {
    if (this.host.project.resolve(ANIBND)?.source !== 'project') return []
    this.load()
    return this.headerFixes
  }

  private loadBehavior(): Beh {
    if (this.beh) return this.beh
    const file = this.host.project.read(BEHBND)
    const d = dcxDecompress(file.data)
    const bnd = readBnd4(d.data)
    const entry = bnd.entries.find((e) => /[\\/]behaviors[\\/][^\\/]+\.hkx$/i.test(e.name))
    if (!entry) throw new Error('c0000.behbnd has no behaviour graph (Behaviors\\c0000.hkx)')
    const tf = readTagfile(entry.data)
    this.beh = { bnd, dcx: d.info, entry, tf, dirty: false, ...this.indexOf(tf) }
    return this.beh
  }

  private indexOf(tf: Tagfile): Pick<Beh, 'index' | 'played' | 'byId'> {
    const index = indexBehavior(tf)
    const byId = new Map<number, BehaviorSelector[]>()
    for (const s of index.selectors) {
      if (!s.clips.length) continue
      const l = byId.get(s.animId) ?? []
      l.push(s)
      byId.set(s.animId, l)
    }
    return { index, played: new Set(index.internalIds.keys()), byId }
  }

  /** Drops everything loaded (the project was reopened). */
  reset(): void {
    this.anim = null
    this.beh = null
    this.judges = null
    this.headerFixes = []
    this.motions.clear()
    this.undoStack = []
    this.redoStack = []
    if (!this.notesDirty) this.notesCache = null
  }

  /* ------------------------------ motion files ------------------------------ */

  /**
   * New animation files (.hkx) for the project, by binder: the binder as
   * read (the project's copy, else the game's), with the files added.
   * Written on save; kept afterwards so the viewport can still play them.
   */
  private motions = new Map<
    string,
    { bnd: Bnd4; dcx: DcxInfo; files: Map<string, { data: Buffer; compendium?: Compendium }>; dirty: boolean }
  >()

  /** The template data the TAE fields are read with. */
  templateData(): { template: TaeTemplate; sizes: ParamSizes } {
    return { template: this.template, sizes: this.sizes }
  }

  /**
   * Adds (or replaces) an animation file in one of the player's animation
   * binders, e.g. a640_040000.hkx in chr/c0000_a9x.anibnd.dcx, under the
   * folder and id scheme the binder's own files use.
   */
  putMotion(binderRel: string, hkxName: string, data: Buffer, compendium?: Compendium): void {
    let m = this.motions.get(binderRel)
    if (!m) {
      const d = dcxDecompress(this.host.project.read(binderRel).data)
      m = { bnd: readBnd4(d.data), dcx: d.info, files: new Map(), dirty: false }
      this.motions.set(binderRel, m)
    }
    const name = hkxName.toLowerCase()
    const p = parseAnimationName(name.replace(/\.hkx$/, ''))
    if (!p) throw new Error(`${hkxName} isn’t an animation file name`)
    const existing = findEntry(m.bnd, name)
    if (existing) {
      existing.data = data
      existing.sourceOffset = undefined
    } else {
      // Same folder as the binder's other animations; ids are 1,000,000,000 + category * 1,000,000 + id.
      const like = m.bnd.entries.find((e) => /\.hkx$/i.test(e.name))
      if (!like) throw new Error(`${binderRel} has no animation files to place a new one by`)
      const folder = like.name.slice(0, Math.max(like.name.lastIndexOf('\\'), like.name.lastIndexOf('/')) + 1)
      const entry: Bnd4Entry = {
        ...like,
        id: 1_000_000_000 + p.category * 1_000_000 + p.id,
        name: `${folder}${name}`,
        data,
        sourceOffset: undefined,
      }
      m.bnd.entries.push(entry)
      m.bnd.entries.sort((a, b) => a.id - b.id)
    }
    m.files.set(name, { data, compendium })
    m.dirty = true
  }

  /** A new animation file not yet in the project's binders' saved copies (or saved this session). */
  pendingMotion(hkxName: string): { data: Buffer; compendium?: Compendium } | null {
    const name = hkxName.toLowerCase()
    for (const m of this.motions.values()) {
      const hit = m.files.get(name)
      if (hit) return hit
    }
    return null
  }

  /** The animation ids a category has (none if there's no such category). */
  animationIds(category: number): number[] {
    const { binder } = this.load()
    return binder.has(category) ? binder.ids(category) : []
  }

  /** An animation's events as stored (read them only: edit through editAnimation). */
  storedEvents(name: string): readonly TaeFileEvent[] {
    return this.load().binder.require(name).anim.events
  }

  /**
   * Edits an animation's TAE entry in place (its motion reference, events),
   * undoable like event edits.
   */
  editAnimation(name: string, fn: (tae: TaeFile, anim: TaeFileAnimation) => void): void {
    const { binder } = this.load()
    const { category, tae, anim } = binder.require(name)
    this.snapshot(name)
    fn(tae, anim)
    this.edited(category)
  }

  /* --------------------------------- status --------------------------------- */

  dirtyFiles(): string[] {
    return [
      ...(this.anim?.dirty ? [ANIBND] : []),
      ...(this.beh?.dirty ? [BEHBND] : []),
      ...[...this.motions].filter(([, m]) => m.dirty).map(([rel]) => rel),
      ...(this.notesDirty ? [NOTES_RECORD] : []),
    ]
  }

  save(): string[] {
    const { project } = this.host
    const written: string[] = []
    const a = this.anim
    if (a?.dirty) {
      a.binder.commit()
      written.push(project.writeProjectFile(ANIBND, dcxCompress(writeBnd4(a.binder.bnd), packing(a.dcx))))
      a.dirty = false
    }
    const b = this.beh
    if (b?.dirty) {
      b.entry.data = writeTagfile(b.tf)
      written.push(project.writeProjectFile(BEHBND, dcxCompress(writeBnd4(b.bnd), packing(b.dcx))))
      b.dirty = false
    }
    let record: Record<string, string[]> | null = null
    for (const [rel, m] of this.motions) {
      if (!m.dirty) continue
      written.push(project.writeProjectFile(rel, dcxCompress(writeBnd4(m.bnd), packing(m.dcx))))
      m.dirty = false
      record ??= this.recordedMotions()
      record[rel] = [...new Set([...(record[rel] ?? []), ...m.files.keys()])].sort()
    }
    if (record) written.push(project.writeProjectFile(MOTIONS_RECORD, Buffer.from(JSON.stringify(record, null, 1))))
    if (this.notesDirty) {
      written.push(project.writeProjectFile(NOTES_RECORD, Buffer.from(JSON.stringify(this.notes(), null, 1))))
      this.notesDirty = false
    }
    return written
  }

  /**
   * The animation files Spellforge added to the project's copies of the
   * player's binders, by binder (`.spellforge/motions.json`). Everything
   * else in those copies is the game's own, from the version they were
   * saved with.
   */
  recordedMotions(): Record<string, string[]> {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.host.project.config.modDir, MOTIONS_RECORD), 'utf8'))
    } catch {
      return {}
    }
  }

  /**
   * After a game update: each binder Spellforge saved animation files into
   * is rebuilt as the new game's binder plus those files (the rest of the
   * old copy is the old game's). Binders it didn't write are left alone.
   */
  mergeMotionsFromGame(apply: boolean): { binders: number; files: number } {
    const { project } = this.host
    const out = { binders: 0, files: 0 }
    for (const [rel, names] of Object.entries(this.recordedMotions())) {
      if (project.resolve(rel)?.source !== 'project') continue
      let game: Bnd4
      let info: DcxInfo
      try {
        const d = dcxDecompress(project.readGame(rel))
        game = readBnd4(d.data)
        info = d.info
      } catch {
        continue
      }
      const mine = this.motions.get(rel)?.bnd ?? readBnd4(dcxDecompress(project.read(rel).data).data)
      const want = new Set(names)
      const carried = mine.entries.filter((e) => want.has(entryFileName(e)))
      out.binders++
      out.files += carried.length
      if (!apply) continue
      const have = new Set(carried.map((e) => e.name.toLowerCase()))
      game.entries = [
        ...game.entries.filter((e) => !have.has(e.name.toLowerCase())),
        ...carried.map((e) => ({ ...e, sourceOffset: undefined })),
      ].sort((a, b) => a.id - b.id)
      const compEntry = game.entries.find((e) => e.name.toLowerCase().endsWith('.compendium'))
      const compendium = compEntry ? readCompendium(compEntry.data) : undefined
      this.motions.set(rel, {
        bnd: game,
        dcx: info,
        files: new Map(carried.map((e) => [entryFileName(e), { data: e.data, compendium }])),
        dirty: true,
      })
    }
    return out
  }

  /** For behaviour links: every TAE as [file name, bytes], with edits applied. */
  taeFiles(): [string, Buffer][] | null {
    if (!this.anim) return null
    if (this.anim.binder.dirty.size) this.anim.binder.commit()
    return this.anim.binder.bnd.entries
      .filter((e) => e.name.toLowerCase().endsWith('.tae'))
      .map((e) => [e.name, e.data])
  }

  /* ------------------------------ game updates ----------------------------- */

  /**
   * What a game update brings to the project's animations, and (with
   * `apply`) brings it in. Compared with the animations of the game version
   * the project was made with (`baseAnibnd`), when kept:
   *   - categories and animations the update added are added;
   *   - animations the update changed that the project never touched (they
   *     still match the old version's) take the new version;
   *   - the project's own changes stay (counted as conflicts when the update
   *     changed the same animation).
   * Without the old version's animations, only additions can be told apart.
   */
  mergeFromGame(apply: boolean): { added: number; changed: number; conflicts: number; categories: number } {
    const out = { added: 0, changed: 0, conflicts: 0, categories: 0 }
    const a = this.load()
    if (!a.own && !a.dirty) return out
    const { project } = this.host
    let game: Bnd4
    try {
      game = readBnd4(dcxDecompress(project.readGame(ANIBND)).data)
    } catch {
      return out
    }
    const baseBuf = this.host.baseAnibnd?.() ?? null
    const base = baseBuf ? readBnd4(dcxDecompress(baseBuf).data) : null
    const baseEntry = (c: number) => base?.entries.find((e) => entryCategory(e) === c)
    for (const ge of game.entries) {
      const c = entryCategory(ge)
      if (c === null) continue
      const be = baseEntry(c)
      if (!a.binder.has(c)) {
        // In the old version but not the project's: the project removed it.
        if (be) continue
        out.categories++
        out.added += taeAnimationCount(ge.data)
        if (apply) {
          a.binder.addEntry(c, ge)
          a.states.delete(c)
          a.dirty = true
        }
        continue
      }
      const gTae = readTaeFile(ge.data, this.sizes)
      const bSigs = be
        ? new Map(readTaeFile(be.data, this.sizes).animations.map((x) => [x.id, animationSignature(x)]))
        : null
      const mine = a.binder.tae(c)
      const at = new Map(mine.animations.map((x, i) => [x.id, i]))
      let touched = false
      for (const ga of gTae.animations) {
        const was = bSigs?.get(ga.id)
        const i = at.get(ga.id)
        if (i === undefined) {
          if (was !== undefined) continue
          out.added++
          if (apply) {
            let to = mine.animations.findIndex((x) => x.id > ga.id)
            if (to < 0) to = mine.animations.length
            mine.animations.splice(to, 0, cloneAnimation(ga))
            at.clear()
            mine.animations.forEach((x, k) => at.set(x.id, k))
            touched = true
          }
          continue
        }
        if (was === undefined) continue
        const theirs = animationSignature(ga)
        const ours = animationSignature(mine.animations[i])
        if (theirs === was || ours === theirs) continue
        if (ours !== was) {
          out.conflicts++
          continue
        }
        out.changed++
        if (apply) {
          mine.animations[i] = cloneAnimation(ga)
          touched = true
        }
      }
      if (touched) this.edited(c)
    }
    return out
  }

  /* ------------------------------- registration ----------------------------- */

  private registration(name: string): A.AnimRegistration {
    const b = this.loadBehavior()
    if (b.played.has(name)) return 'registered'
    const p = parseAnimationName(name)
    return p && b.byId.has(p.id) ? 'missing' : 'unsupported'
  }

  register(names: string[]): A.AnimRegisterResult {
    const b = this.loadBehavior()
    const todo = [...new Set(names)].filter((n) => !b.played.has(n))
    const already = names.filter((n) => b.played.has(n))
    const r = registerAnimations(b.tf, todo)
    const per = new Map<string, number>()
    for (const x of r.added) per.set(x.animation, (per.get(x.animation) ?? 0) + 1)
    if (r.added.length) {
      b.dirty = true
      Object.assign(b, this.indexOf(b.tf))
    }
    return {
      added: [...per].map(([animation, selectors]) => ({ animation, selectors })),
      skipped: [
        ...r.skipped.map((s) => ({ animation: s.animation, reason: s.reason })),
        ...[...new Set(already)].map((animation) => ({ animation, reason: 'already playable' })),
      ],
    }
  }

  /** The behaviour graph's selectors (CMSGs): each state's name and the animation id it plays. */
  behaviourSelectors(): { name: string; animId: number }[] {
    return this.loadBehavior().index.selectors.map((s) => ({ name: s.name, animId: s.animId }))
  }

  /** Animations the project added that the behaviour graph could play but doesn't yet. */
  unregistered(): string[] {
    const a = this.load()
    const out: string[] = []
    for (const c of a.binder.categories()) {
      const gameIds = new Set(taeAnimationIds(a.game.get(c) ?? Buffer.alloc(0)))
      const ids = a.binder.dirty.has(c) || !a.game.has(c) || !this.sameAsGame(c) ? a.binder.ids(c) : []
      for (const id of ids) {
        if (gameIds.has(id)) continue
        const name = animationName(c, id)
        if (this.registration(name) === 'missing') out.push(name)
      }
    }
    return out
  }

  /* -------------------------------- listing --------------------------------- */

  private sameAsGame(category: number): boolean {
    const a = this.load()
    const g = a.game.get(category)
    if (!g) return false
    if (a.binder.dirty.has(category)) return false
    const e = a.binder.bnd.entries.find((x) => entryCategory(x) === category)
    return !!e && e.data.equals(g)
  }

  private animStates(category: number): Map<number, A.ProjectState> {
    const a = this.load()
    const hit = a.states.get(category)
    if (hit) return hit
    const out = new Map<number, A.ProjectState>()
    if (!this.sameAsGame(category)) {
      const g = a.game.get(category)
      let sigs = a.gameSigs.get(category)
      if (!sigs && g) {
        sigs = new Map(readTaeFile(g, this.sizes).animations.map((x) => [x.id, animationSignature(x)]))
        a.gameSigs.set(category, sigs)
      }
      for (const x of a.binder.tae(category).animations) {
        const s = sigs?.get(x.id)
        out.set(x.id, s === undefined ? 'added' : s === animationSignature(x) ? null : 'changed')
      }
    }
    a.states.set(category, out)
    return out
  }

  private edited(category: number): void {
    const a = this.load()
    a.binder.touch(category)
    a.states.delete(category)
    a.dirty = true
    this.onEventsChanged()
  }

  categories(): A.AnimCategoryView[] {
    const a = this.load()
    const hints = this.categoryHints()
    return a.binder.categories().map((c) => {
      let state: A.ProjectState = null
      if (!a.game.has(c)) state = 'added'
      else if (!this.sameAsGame(c)) state = [...this.animStates(c).values()].some((s) => s) ? 'changed' : null
      const entry = a.binder.bnd.entries.find((e) => entryCategory(e) === c)!
      const count = a.binder.dirty.has(c) ? a.binder.tae(c).animations.length : taeAnimationCount(entry.data)
      return { category: c, label: categoryLabel(c), animations: count, state, hint: hints.get(c) }
    })
  }

  /** Which weapons and skills use each category, from the params. */
  private categoryHints(): Map<number, string> {
    const { db } = this.host
    const names = new Map<number, string[]>()
    const add = (c: number, n: string) => {
      if (c < 0 || isPlaceholderName(n)) return
      const l = names.get(c) ?? []
      if (!l.includes(n)) l.push(n)
      names.set(c, l)
    }
    try {
      for (const r of db.get('EquipParamWeapon').param.rows) {
        if (r.id % 10000 !== 0) continue
        const n = db.rowName('EquipParamWeapon', r.id)
        const m = db.value('EquipParamWeapon', r.id, 'wepmotionCategory')
        const s = db.value('EquipParamWeapon', r.id, 'spAtkcategory')
        if (typeof m === 'number') add(m, n)
        if (typeof s === 'number' && s >= 50) add(s, n)
      }
      for (const r of db.get('SwordArtsParam').param.rows) {
        const t = db.value('SwordArtsParam', r.id, 'swordArtsTypeNew')
        if (typeof t === 'number' && t > 0) add(600 + t, db.rowName('SwordArtsParam', r.id))
      }
    } catch {
      /* hints are optional */
    }
    const out = new Map<number, string>()
    for (const [c, note] of Object.entries(CATEGORY_NOTES)) out.set(Number(c), note)
    for (const [c, l] of names)
      if (!out.has(c)) out.set(c, l.length > 2 ? `${l.slice(0, 2).join(', ')} +${l.length - 2}` : l.join(', '))
    return out
  }

  list(category: number, query: string): A.AnimListItem[] {
    const a = this.load()
    const tae = a.binder.tae(category)
    const states = this.animStates(category)
    const notes = this.notes()
    const q = query.trim().toLowerCase()
    const out: A.AnimListItem[] = []
    for (const x of tae.animations) {
      const name = animationName(category, x.id)
      const note = notes[name]
      if (
        q &&
        !name.includes(q) &&
        !String(x.id).includes(q) &&
        !(note?.title ?? '').toLowerCase().includes(q) &&
        !(note?.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
        continue
      const m = motionOf(category, x)
      out.push({
        name,
        id: x.id,
        events: x.events.length,
        motion: m.kind,
        source: m.source,
        registration: this.registration(name),
        state: states.get(x.id) ?? null,
        ...(note?.title ? { title: note.title } : {}),
        ...(note?.tags?.length ? { tags: note.tags } : {}),
      })
    }
    return out
  }

  /* --------------------------------- one view ------------------------------- */

  view(name: string): A.AnimationView {
    const { binder } = this.load()
    const { category, anim } = binder.require(name)
    const m = motionOf(category, anim)
    const b = this.loadBehavior()
    const p = parseAnimationName(name)!
    const sels = b.byId.get(p.id) ?? []
    const events = anim.events.map((ev, index): A.AnimEventView => {
      const t = this.template.events[ev.type]
      const decoded = decodeEvent(ev, this.template)
      const fields = decoded.map((f): A.AnimFieldView => ({
        ...f,
        linkLabel: this.linkLabel(f.link, f.value),
        about: this.fieldAbout(decoded, f),
      }))
      return {
        index,
        type: ev.type,
        typeName: t?.name ?? `Event ${ev.type}`,
        known: !!t,
        start: ev.start,
        end: ev.end,
        group: groupOf(anim, index),
        summary: eventSummary(fields),
        fields,
        raw: ev.params.toString('hex'),
      }
    })
    noteSlotClashes(events)
    return {
      name,
      category,
      id: anim.id,
      motion: m.kind,
      motionFile: m.file,
      source: m.source,
      events,
      length: Math.max(0, ...anim.events.flatMap((e) => [e.start, e.end < OPEN_EVENT_END ? e.end : 0])),
      registration: this.registration(name),
      selectors: sels.map((s) => ({ name: s.name, registered: s.clips.some((c) => c.animation === name) })),
      state: this.animStates(category).get(anim.id) ?? null,
      ...(this.notes()[name]?.title ? { title: this.notes()[name].title } : {}),
      ...(this.notes()[name]?.tags?.length ? { tags: this.notes()[name].tags } : {}),
      loop: anim.file.type === 0 && (anim.file.a & LOOPS_BY_DEFAULT) !== 0,
    }
  }

  /** One plain line on what an event field's number is, when it points at something without a link of its own. */
  private fieldAbout(
    fields: { name: string; value: number }[],
    f: { name: string; value: number; link?: A.AnimFieldView['link'] },
  ): string | undefined {
    if (/^DummyPoly/i.test(f.name) && !/Source/i.test(f.name))
      return describeDummy(
        f.value,
        fields.find((x) => x.name === 'DummyPolySource')?.value,
        (n) => this.host.bodyDummyBone?.(n) ?? null,
      )
    if (f.name === 'SoundID' && f.value > 0) {
      const type = fields.find((x) => x.name === 'SoundType')?.value
      const names = type !== undefined ? taeSoundNames(type, f.value) : []
      return names.length
        ? `Sound event ${names[0]}${names.length > 1 ? ` (or ${names.slice(1, 3).join(', ')}…)` : ''}`
        : undefined
    }
    if (f.link === 'speffect' && f.value > 0 && !this.host.db.hasRow('SpEffectParam', f.value))
      return `No SpEffect ${f.value} in the game or your mod: nothing is applied`
    if (f.link === 'effect' && f.value > 0 && !this.host.effectName(f.value))
      return `Effect ${f.value}: not one the common effects or your mod name`
    return undefined
  }

  private linkLabel(link: A.AnimFieldView['link'], value: number): string | undefined {
    if (!link || value < 0 || (value === 0 && link !== 'judge')) return undefined
    const { db } = this.host
    if (link === 'effect') return this.host.effectName(value) || undefined
    if (link === 'speffect') return db.rowName('SpEffectParam', value) || undefined
    const rows = this.judgeRowIds(value)
    return rows.length ? `${rows.length} behavior row${rows.length === 1 ? '' : 's'}` : undefined
  }

  private judgeRowIds(judge: number): number[] {
    let rows: { id: number }[] = []
    try {
      rows = this.host.db.get('BehaviorParam_PC').param.rows
    } catch {
      /* no behaviour params */
    }
    // Rebuilt when rows are added or removed.
    if (!this.judges || this.judgeRowCount !== rows.length) {
      this.judges = new Map()
      this.judgeRowCount = rows.length
      try {
        for (const r of rows) {
          const j = judgeOfBehaviorRow(r.id)
          const l = this.judges.get(j) ?? []
          l.push(r.id)
          this.judges.set(j, l)
        }
      } catch {
        /* no behaviour params */
      }
    }
    return this.judges.get(judge) ?? []
  }

  judgeRows(judge: number): A.BrowseRow[] {
    return this.judgeRowIds(judge).map((id) => ({
      param: 'BehaviorParam_PC',
      id,
      name: this.host.db.rowName('BehaviorParam_PC', id),
      state: null,
    }))
  }

  eventTypes(): A.AnimEventType[] {
    if (!this.eventUses) {
      const counts = new Map<number, number>()
      for (const buf of this.load().game.values()) countEventTypes(buf, counts)
      this.eventUses = counts
    }
    const uses = this.eventUses
    const types = new Set([...Object.keys(this.template.events).map(Number), ...uses.keys()])
    return [...types]
      .map((type) => ({
        type,
        name: this.template.events[type]?.name ?? `Event ${type}`,
        uses: uses.get(type) ?? 0,
        fields: flatFields(this.template.events[type]?.fields ?? [])
          .filter((f) => f.name && FIELD_SIZE[f.type])
          .map((f) => f.name!),
      }))
      .sort((x, y) => y.uses - x.uses || x.type - y.type)
  }

  /* --------------------------------- editing -------------------------------- */

  /** The animations as they are now, to put back later (with their clip settings, for an edit of those). */
  private capture(names: string[], clips = false): UndoStep {
    const { binder } = this.load()
    return names.map((name) => {
      const p = parseAnimationName(name)!
      const hit = binder.find(name)
      const clip = clips ? clipSettings(this.loadBehavior().tf, name)?.settings : undefined
      return { name, category: p.category, anim: hit ? cloneAnimation(hit.anim) : null, ...(clip ? { clip } : {}) }
    })
  }

  /** Remembers animations before an edit so it can be undone (a new edit can't be redone over). */
  private snapshot(...names: string[]): void {
    this.snapshotWith(false, names)
  }

  private snapshotWith(clips: boolean, names: string[]): void {
    this.undoStack.push(this.capture(names, clips))
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
  }

  /** Puts animations back as a step kept them; returns the first one's name. */
  private restore(step: UndoStep): string {
    const { binder } = this.load()
    for (const u of step) {
      if (!binder.has(u.category)) {
        if (!u.anim) continue
        binder.addCategory(u.category, binder.categories()[0])
      }
      const tae = binder.tae(u.category)
      const id = parseAnimationName(u.name)!.id
      if (u.anim) putAnimation(tae, cloneAnimation(u.anim))
      else tae.animations = tae.animations.filter((a) => a.id !== id)
      if (u.clip) {
        const b = this.loadBehavior()
        if (setClipSettings(b.tf, u.name, u.clip)) b.dirty = true
      }
      this.edited(u.category)
    }
    return step[0].name
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  history(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length }
  }

  /** Reverts the last event edit; returns the animation's name, or null if there was nothing to undo. */
  undo(): string | null {
    const u = this.undoStack.pop()
    if (!u) return null
    this.redoStack.push(
      this.capture(
        u.map((x) => x.name),
        u.some((x) => x.clip),
      ),
    )
    return this.restore(u)
  }

  /** Makes the last undone edit again; returns the animation's name, or null if there was nothing to redo. */
  redo(): string | null {
    const r = this.redoStack.pop()
    if (!r) return null
    this.undoStack.push(
      this.capture(
        r.map((x) => x.name),
        r.some((x) => x.clip),
      ),
    )
    return this.restore(r)
  }

  setEvent(req: A.AnimEventEdit): A.AnimationView {
    const { binder } = this.load()
    const { category, anim } = binder.require(req.name)
    const ev = anim.events[req.index]
    if (!ev) throw new Error('No such event')
    this.snapshot(req.name)
    // Stored as 32-bit floats: keep views identical before and after a save.
    setTimes(ev, req.start, req.end)
    if (req.field) writeField(ev, req.field.type, req.field.offset, req.field.value)
    if (req.raw !== undefined) {
      const hex = req.raw.replace(/[^0-9a-f]/gi, '')
      if (hex.length % 2) throw new Error('Hex needs an even number of digits')
      const bytes = Buffer.from(hex, 'hex')
      // Keep the stored length: the game reads a fixed size per event type.
      const params = Buffer.alloc(ev.params.length)
      bytes.copy(params, 0, 0, Math.min(bytes.length, params.length))
      ev.params = params
    }
    this.edited(category)
    return this.view(req.name)
  }

  addEvent(req: A.Req<'anim:addEvent'>): { view: A.AnimationView; index: number } {
    const { binder } = this.load()
    const { category, tae, anim } = binder.require(req.name)
    const from = req.copyFrom !== undefined ? anim.events[req.copyFrom] : undefined
    const type = from?.type ?? req.type
    if (type === undefined) throw new Error('Pick an event type')
    this.snapshot(req.name)
    const start = Math.fround(Math.max(0, Math.min(req.start, req.end)))
    const end = Math.fround(Math.max(0, req.start, req.end))
    const params = from ? Buffer.from(from.params) : newEventParams(type, this.template, this.sizes)
    const index = addEvent(tae, anim, { type, unk: from?.unk ?? 0, start, end, params })
    this.edited(category)
    return { view: this.view(req.name), index }
  }

  deleteEvent(name: string, index: number): A.AnimationView {
    const { binder } = this.load()
    const { category, anim } = binder.require(name)
    this.snapshot(name)
    deleteEvent(anim, index)
    this.edited(category)
    return this.view(name)
  }

  deleteAnimation(name: string): void {
    const { binder } = this.load()
    const { category, tae, anim } = binder.require(name)
    this.snapshot(name)
    tae.animations = tae.animations.filter((x) => x !== anim)
    this.edited(category)
  }

  duplicate(req: A.AnimDuplicateRequest): A.AnimDuplicateResult {
    const { binder } = this.load()
    const to = Math.trunc(req.toCategory)
    if (!(to >= 0 && to <= 999)) throw new Error('The new category must be a number from 0 to 999')
    let names = req.names ?? []
    if (req.fromCategory !== undefined)
      names = binder.ids(req.fromCategory).map((id) => animationName(req.fromCategory!, id))
    if (!names.length) throw new Error('Nothing to copy')
    if (req.toId !== undefined && names.length !== 1)
      throw new Error('A new animation id only applies when copying one animation')
    const first = binder.require(names[0])
    const result: A.AnimDuplicateResult = { created: [], replaced: [], skipped: [], registration: null }

    // Copy first, then add: copying a category onto itself must read the originals.
    const copies: { name: string; anim: TaeFileAnimation; exists: boolean }[] = []
    for (const src of names) {
      const p = parseAnimationName(src)
      if (!p) {
        result.skipped.push({ name: src, reason: 'not an animation name' })
        continue
      }
      const id = req.toId ?? p.id
      const target = animationName(to, id)
      if (target === src) {
        result.skipped.push({ name: src, reason: 'same as the original' })
        continue
      }
      const exists = binder.has(to) && !!binder.tae(to).animations.find((x) => x.id === id)
      if (exists && !req.overwrite) {
        result.skipped.push({ name: target, reason: 'already exists' })
        continue
      }
      copies.push({ name: target, anim: duplicateAnimation(binder, src, id), exists })
    }
    if (copies.length) {
      const tae = binder.addCategory(to, first.category)
      for (const c of copies) {
        putAnimation(tae, cloneAnimation(c.anim))
        ;(c.exists ? result.replaced : result.created).push(c.name)
      }
      this.edited(to)
    }
    if (req.register && copies.length) result.registration = this.register(copies.map((c) => c.name))
    return result
  }

  /* ---------------------------- several events ----------------------------- */

  /** Moves or resizes several events of one animation in one undoable step. */
  setEvents(name: string, edits: { index: number; start?: number; end?: number }[]): A.AnimationView {
    const { binder } = this.load()
    const { category, anim } = binder.require(name)
    for (const e of edits) if (!anim.events[e.index]) throw new Error('No such event')
    this.snapshot(name)
    for (const e of edits) setTimes(anim.events[e.index], e.start, e.end)
    this.edited(category)
    return this.view(name)
  }

  deleteEvents(name: string, indices: number[]): A.AnimationView {
    const { binder } = this.load()
    const { category, anim } = binder.require(name)
    const order = [...new Set(indices)].filter((i) => i >= 0 && i < anim.events.length).sort((a, b) => b - a)
    if (!order.length) return this.view(name)
    this.snapshot(name)
    for (const i of order) deleteEvent(anim, i)
    this.edited(category)
    return this.view(name)
  }

  /** Events as stored, for the clipboard (their bytes are pasted as they are). */
  copyEvents(name: string, indices: number[]): A.AnimClipboardEvent[] {
    const { anim } = this.load().binder.require(name)
    return [...new Set(indices)]
      .filter((i) => anim.events[i])
      .sort((a, b) => a - b)
      .map((i) => {
        const ev = anim.events[i]
        return {
          type: ev.type,
          unk: ev.unk,
          start: ev.start,
          end: ev.end,
          params: ev.params.toString('hex'),
          typeName: this.template.events[ev.type]?.name ?? `Event ${ev.type}`,
        }
      })
  }

  /**
   * Adds copied events (from this or any other animation), in the event
   * groups their types use here. With `at`, they keep their spacing and the
   * first starts there; events lasting to the end keep doing so.
   */
  pasteEvents(name: string, events: A.AnimClipboardEvent[], at?: number): { view: A.AnimationView; indices: number[] } {
    const { binder } = this.load()
    const { category, tae, anim } = binder.require(name)
    if (!events.length) return { view: this.view(name), indices: [] }
    const first = Math.min(...events.map((e) => e.start))
    const shift = at === undefined ? 0 : Math.max(0, at) - first
    this.snapshot(name)
    const indices: number[] = []
    for (const e of events) {
      const params = Buffer.from(e.params.replace(/[^0-9a-f]/gi, ''), 'hex')
      const ev = { type: e.type, unk: e.unk, start: 0, end: 0, params }
      const start = e.start + shift
      setTimes(ev, start, e.end >= OPEN_EVENT_END ? FLOAT_MAX : Math.max(start, e.end + shift))
      indices.push(addEvent(tae, anim, ev))
    }
    this.edited(category)
    return { view: this.view(name), indices }
  }

  /* ---------------------------------- find ---------------------------------- */

  /**
   * Events by type and field value, over one category or all of them (with
   * the project's edits). A field is asked for by name, or by what it points
   * at ('@effect', '@speffect', '@judge', '@sound', '@dummy'). One hit per event.
   */
  find(q: A.AnimFindQuery): A.AnimFindResult {
    const { binder } = this.load()
    const limit = Math.max(1, Math.min(5000, q.limit ?? 500))
    const role = q.field?.startsWith('@') ? q.field.slice(1) : null
    const wanted = !role && q.field ? q.field.trim().toLowerCase() : null
    const fieldWanted = (n: string) =>
      role === 'effect' || role === 'speffect' || role === 'judge'
        ? linkOf(n) === role
        : role === 'sound'
          ? n === 'SoundID'
          : role === 'dummy'
            ? /^DummyPoly/i.test(n) && !/Source/i.test(n)
            : wanted
              ? n.toLowerCase() === wanted
              : true
    const byType = new Map<number, { name: string; type: string; offset: number }[]>()
    const fieldsOf = (type: number) => {
      let f = byType.get(type)
      if (!f) {
        f = flatFields(this.template.events[type]?.fields ?? [])
          .filter((x) => FIELD_SIZE[x.type] && x.name && fieldWanted(x.name))
          .map((x) => ({ name: x.name!, type: x.type, offset: x.offset }))
        byType.set(type, f)
      }
      return f
    }
    const onlyType = q.value === null || q.value === undefined
    const close = (type: string, v: number, want: number) =>
      type.startsWith('f') ? Math.abs(v - want) < 1e-4 : v === want
    const hits: A.AnimFindHit[] = []
    let total = 0
    let animations = 0
    const cats = q.category !== null && q.category !== undefined ? [q.category] : binder.categories()
    for (const c of cats) {
      const tae = binder.peek(c)
      if (!tae) continue
      for (const anim of tae.animations) {
        animations++
        anim.events.forEach((ev, index) => {
          if (q.type !== null && q.type !== undefined && ev.type !== q.type) return
          let field: string | null = null
          let value: number | null = null
          if (!onlyType || q.field) {
            const f = fieldsOf(ev.type).find((x) => {
              const v = readField(ev, x.type, x.offset)
              return v !== null && (onlyType || close(x.type, v, q.value!))
            })
            if (!f) return
            field = f.name
            value = readField(ev, f.type, f.offset)
          }
          total++
          if (hits.length >= limit) return
          hits.push({
            animation: animationName(c, anim.id),
            index,
            type: ev.type,
            typeName: this.template.events[ev.type]?.name ?? `Event ${ev.type}`,
            field,
            value,
            start: ev.start,
            end: ev.end,
            summary: eventSummary(decodeEvent(ev, this.template)),
          })
        })
      }
    }
    return { hits, total, animations }
  }

  /** The same animation id in the next (or previous) category that has it. */
  sameIdIn(name: string, dir: 1 | -1): string | null {
    const p = parseAnimationName(name)
    if (!p) return null
    const { binder } = this.load()
    const cats = binder.categories()
    let i = cats.indexOf(p.category)
    if (i < 0) i = dir > 0 ? -1 : cats.length
    for (let k = i + dir; k >= 0 && k < cats.length; k += dir)
      if (binder.quickIds(cats[k]).includes(p.id)) return animationName(cats[k], p.id)
    return null
  }

  /* ------------------------------- properties ------------------------------- */

  /** Animations whose motion (or everything) comes from this one. */
  private referrers(name: string): string[] {
    const p = parseAnimationName(name)
    if (!p) return []
    const full = p.category * 1_000_000 + p.id
    return this.load()
      .binder.fileRefs()
      .filter((r) => refTarget(r) === full && !(r.category === p.category && r.id === p.id))
      .map((r) => animationName(r.category, r.id))
  }

  properties(name: string): A.AnimProperties & { usedBy: string[] } {
    const { category, anim } = this.load().binder.require(name)
    const m = motionOf(category, anim)
    const f = anim.file
    return {
      name,
      category,
      id: anim.id,
      motion: m.kind,
      source: m.source,
      file: m.file,
      loop: f.type === 0 && (f.a & LOOPS_BY_DEFAULT) !== 0,
      raw: { type: f.type, a: f.a, b: f.b, c: String(f.c), d: String(f.d) },
      events: anim.events.length,
      registration: this.registration(name),
      clip: this.clipView(name),
      usedBy: this.referrers(name),
    }
  }

  /** An animation's clips in the behaviour graph (null: none plays it). */
  private clipView(name: string): A.AnimClipView | null {
    const c = clipSettings(this.loadBehavior().tf, name)
    return c ? { ...c.settings, clips: c.clips, same: c.same, startBound: c.startBound } : null
  }

  /**
   * Changes an animation's id or category (it moves; its own motion is then
   * taken from its old name, whose motion file stays) and what motion it
   * plays: its own, another's (followed to the animation that has the
   * motion), or everything from another.
   */
  setProperties(edit: A.AnimPropertiesEdit): { name: string; view: A.AnimationView } {
    const { binder } = this.load()
    const cur = binder.require(edit.name)
    const toCategory = edit.category ?? cur.category
    const toId = edit.id ?? cur.anim.id
    if (!(Number.isInteger(toCategory) && toCategory >= 0 && toCategory <= 999))
      throw new Error('Categories run from 0 to 999')
    if (!(Number.isInteger(toId) && toId >= 0 && toId <= 999999)) throw new Error('Animation ids run from 0 to 999999')
    const to = animationName(toCategory, toId)
    const moving = to !== edit.name
    if (moving && binder.find(to)) throw new Error(`${to} already exists`)
    const anim = cur.anim
    const was = motionOf(cur.category, anim)
    let file = anim.file
    const loopNow = file.type === 0 && (file.a & LOOPS_BY_DEFAULT) !== 0
    if (edit.motion || edit.loop !== undefined) {
      const kind = edit.motion?.kind ?? was.kind
      const loop = edit.loop ?? loopNow
      let source: { name: string; file: string } | null = null
      if (kind !== 'own') {
        let s = edit.motion?.source ?? was.source
        if (!s) throw new Error('Pick the animation to take the motion from')
        // The animation that has the motion itself (a reference to a reference plays nothing).
        for (let k = 0; k < 8; k++) {
          const hit = binder.find(s)
          if (!hit) throw new Error(`${s} was not found`)
          const m = motionOf(hit.category, hit.anim)
          if (m.kind === 'own' || !m.source || (kind === 'full' && m.kind === 'motion')) {
            source = { name: s, file: m.kind === 'own' ? m.file : hit.anim.file.name }
            break
          }
          s = m.source
        }
        if (!source) throw new Error('That animation’s motion goes round in a circle of references')
        if (source.name === edit.name || source.name === to)
          throw new Error('An animation can’t take its motion from itself')
      }
      file = motionReference(kind, to, source, loop)
      // Its own motion as it was stays named as it was.
      if (kind === 'own' && was.kind === 'own' && was.file && !moving) file.name = was.file
    }
    // Its clips (registered under its name as it is): every selector's, as one.
    const beh = edit.clip ? this.loadBehavior() : null
    if (beh && !clipSettings(beh.tf, edit.name))
      throw new Error(`${edit.name} isn't in the behaviour graph yet: register it first`)
    this.snapshotWith(!!edit.clip, [edit.name, ...(moving ? [to] : [])])
    if (beh && edit.clip) {
      try {
        setClipSettings(beh.tf, edit.name, edit.clip)
      } catch (e) {
        this.undoStack.pop()
        throw e
      }
      beh.dirty = true
    }
    anim.file = file
    if (moving) {
      // Its own motion stays in the binders under its old name: play it from there
      // (unless its own motion was asked for: a motion file for the new name).
      const m = motionOf(cur.category, anim)
      if (m.kind === 'own' && edit.motion?.kind !== 'own')
        anim.file = {
          type: 0,
          name: m.file,
          a: (anim.file.a & LOOPS_BY_DEFAULT) | IMPORTS_MOTION,
          b: cur.category * 1_000_000 + anim.id,
          c: 0n,
          d: 0n,
        }
      cur.tae.animations = cur.tae.animations.filter((x) => x !== anim)
      const tae = binder.has(toCategory) ? binder.tae(toCategory) : binder.addCategory(toCategory, cur.category)
      anim.id = toId
      putAnimation(tae, anim)
      this.edited(cur.category)
      this.edited(toCategory)
    } else if (edit.motion || edit.loop !== undefined) this.edited(cur.category)
    return { name: to, view: this.view(to) }
  }

  /** A category's TAE: its id, file and header. */
  categoryProperties(category: number): A.AnimCategoryProperties {
    const { binder } = this.load()
    const tae = binder.peek(category)
    const entry = binder.entryOf(category)
    if (!tae || !entry) throw new Error(`There is no ${categoryLabel(category)} animation category`)
    return {
      category,
      label: categoryLabel(category),
      taeId: tae.id,
      entryId: entry.id,
      entryName: entry.name,
      animations: tae.animations.length,
      events: tae.animations.reduce((n, a) => n + a.events.length, 0),
      header: taeHeaderFields(tae.prefix),
    }
  }

  setCategoryProperties(category: number, taeId: number): A.AnimCategoryProperties {
    if (!Number.isInteger(taeId) || taeId < 0 || taeId > 0x7fffffff) throw new Error('A TAE id is a whole number')
    const { binder } = this.load()
    binder.tae(category).id = taeId
    this.edited(category)
    return this.categoryProperties(category)
  }

  /**
   * Moves a whole category to a new number: each animation is copied there
   * (own motions referenced by their old names, as Duplicate does) and the
   * old category's TAE removed. Animations elsewhere that took everything
   * from one of them follow it. Clears the undo history.
   */
  renumberCategory(category: number, to: number): { names: string[] } {
    const { binder } = this.load()
    if (!binder.has(category)) throw new Error(`There is no ${categoryLabel(category)} animation category`)
    if (!(Number.isInteger(to) && to >= 0 && to <= 999)) throw new Error('Categories run from 0 to 999')
    if (binder.has(to)) throw new Error(`${categoryLabel(to)} already exists`)
    const ids = binder.ids(category)
    const copies = ids.map((id) => duplicateAnimation(binder, animationName(category, id), id))
    // References from elsewhere that took everything from an animation of this category.
    const follow = binder
      .fileRefs()
      .filter((r) => r.category !== category && r.type === 1 && Math.floor(r.a / 1_000_000) === category)
    const tae = binder.addCategory(to, category)
    for (const c of copies) putAnimation(tae, c)
    binder.removeCategory(category)
    for (const r of follow) {
      const hit = binder.find(animationName(r.category, r.id))
      if (!hit) continue
      hit.anim.file = { ...hit.anim.file, a: to * 1_000_000 + (r.a % 1_000_000) }
      binder.touch(r.category)
      this.load().states.delete(r.category)
    }
    this.load().states.delete(category)
    this.edited(to)
    this.undoStack = []
    this.redoStack = []
    return { names: ids.map((id) => animationName(to, id)) }
  }

  /**
   * Copies another animation's events into this one: in place of its own,
   * or added to them. With `motion`, it plays that animation's motion too.
   * An animation that takes everything from another is followed to it.
   */
  importEvents(name: string, from: string, mode: 'replace' | 'add', motion: boolean): A.AnimationView {
    const { binder } = this.load()
    const { category, tae, anim } = binder.require(name)
    let src = binder.require(from)
    for (let k = 0; k < 8 && src.anim.file.type === 1 && src.anim.file.a > 0; k++) {
      const next = binder.find(fullName(src.anim.file.a))
      if (!next) break
      src = next
    }
    if (src.anim === anim) throw new Error('That’s this animation')
    this.snapshot(name)
    const copy = cloneAnimation(src.anim)
    if (mode === 'replace') {
      anim.events = copy.events
      anim.groups = copy.groups
      anim.times = copy.times
    } else for (const ev of copy.events) addEvent(tae, anim, ev)
    if (motion) {
      const m = motionOf(src.category, src.anim)
      const loop = anim.file.type === 0 && (anim.file.a & LOOPS_BY_DEFAULT) !== 0
      anim.file =
        m.kind === 'own'
          ? motionReference('motion', name, { name: animationName(src.category, src.anim.id), file: m.file }, loop)
          : { ...src.anim.file }
    }
    this.edited(category)
    return this.view(name)
  }

  /* ------------------------------ names, tags ------------------------------- */

  notes(): A.AnimNotes {
    if (!this.notesCache) {
      try {
        this.notesCache = JSON.parse(fs.readFileSync(path.join(this.host.project.config.modDir, NOTES_RECORD), 'utf8'))
      } catch {
        this.notesCache = {}
      }
    }
    return this.notesCache!
  }

  setNote(name: string, title?: string, tags?: string[]): A.AnimNotes {
    if (!parseAnimationName(name)) throw new Error(`${name} isn’t an animation name`)
    const notes = this.notes()
    const t = (title ?? notes[name]?.title ?? '').trim()
    const g = [...new Set((tags ?? notes[name]?.tags ?? []).map((x) => x.trim()).filter(Boolean))]
    if (!t && !g.length) delete notes[name]
    else notes[name] = { ...(t ? { title: t } : {}), ...(g.length ? { tags: g } : {}) }
    this.notesDirty = true
    return notes
  }

  /**
   * Notes from text: Spellforge's own export (JSON), or lines like
   * "a050_030000 = Heavy slam" / "a050_030000<tab>Heavy slam #tag".
   */
  importNotes(text: string, replace: boolean): { notes: A.AnimNotes; count: number } {
    const read: A.AnimNotes = {}
    const trimmed = text.trim()
    if (trimmed.startsWith('{')) {
      const j = JSON.parse(trimmed) as Record<string, unknown>
      for (const [k, v] of Object.entries(j)) {
        if (!parseAnimationName(k)) continue
        if (typeof v === 'string') read[k] = { title: v }
        else if (v && typeof v === 'object') {
          const o = v as { title?: unknown; tags?: unknown }
          read[k] = {
            ...(typeof o.title === 'string' && o.title ? { title: o.title } : {}),
            ...(Array.isArray(o.tags) ? { tags: o.tags.map(String) } : {}),
          }
        }
      }
    } else {
      for (const line of trimmed.split(/\r?\n/)) {
        const m = /^\s*(a\d{3}_\d{6})\s*(?:[=:\t,]|\s)\s*(.*)$/.exec(line)
        if (!m) continue
        const tags = [...m[2].matchAll(/#([\w-]+)/g)].map((x) => x[1])
        const title = m[2].replace(/#[\w-]+/g, '').trim()
        read[m[1]] = { ...(title ? { title } : {}), ...(tags.length ? { tags } : {}) }
      }
    }
    const notes = this.notes()
    if (replace) for (const k of Object.keys(notes)) delete notes[k]
    for (const [k, v] of Object.entries(read)) if (v.title || v.tags?.length) notes[k] = v
    this.notesDirty = true
    return { notes, count: Object.keys(read).length }
  }

  /* --------------------------------- export --------------------------------- */

  /** Animations' events as plain text: one line per animation, then its events by start frame. */
  exportText(req: { names?: string[]; category?: number }): string {
    const { binder } = this.load()
    const names = req.names?.length
      ? req.names
      : req.category !== undefined
        ? binder.quickIds(req.category).map((id) => animationName(req.category!, id))
        : []
    const notes = this.notes()
    const f = (t: number) => (t >= OPEN_EVENT_END ? 'end' : String(frameNumber(t)))
    const out: string[] = [`# Spellforge: ${plural(names.length, 'animation')}, times in frames at ${FPS} fps`]
    for (const name of names) {
      const hit = binder.find(name)
      if (!hit) continue
      const m = motionOf(hit.category, hit.anim)
      const what = describeAnimationId(hit.anim.id)
      const note = notes[name]
      const motionText =
        m.kind === 'own'
          ? `own motion ${m.file}`
          : m.kind === 'motion'
            ? `motion of ${m.source}`
            : `everything from ${m.source}`
      out.push(
        '',
        `${name}${what ? `  (${what})` : ''}${note?.title ? `  "${note.title}"` : ''}${note?.tags?.length ? `  ${note.tags.map((t) => '#' + t).join(' ')}` : ''}  · ${motionText} · ${hit.anim.events.length} events`,
      )
      const events = hit.anim.events.map((ev, i) => ({ ev, i })).sort((a, b) => a.ev.start - b.ev.start || a.i - b.i)
      for (const { ev } of events) {
        const t = this.template.events[ev.type]
        const fields = decodeEvent(ev, this.template)
          .filter((x) => !x.reserved)
          .map((x) => {
            const label = x.entries?.find((e) => e.value === x.value)?.name
            return `${x.name}=${x.type.startsWith('f') ? +x.value.toFixed(4) : x.value}${label ? ` (${label})` : ''}`
          })
        out.push(
          `  ${f(ev.start)}-${f(ev.end)}\t${t?.name ?? `Event ${ev.type}`} [${ev.type}]\t${fields.join(', ') || (t ? '' : ev.params.toString('hex'))}`,
        )
      }
    }
    return out.join('\n') + '\n'
  }
}

/** Sets an event's times as stored: 32-bit floats; huge ends mean "until the animation ends" (FLOAT_MAX). */
function setTimes(ev: TaeFileEvent, start?: number, end?: number): void {
  const t = (v: number) => (v >= OPEN_EVENT_END ? FLOAT_MAX : Math.fround(Math.max(0, Math.round(v * 1e5) / 1e5)))
  if (start !== undefined) ev.start = t(start)
  if (end !== undefined) ev.end = t(end)
  if (ev.end < ev.start) [ev.start, ev.end] = [ev.end, ev.start]
}

/**
 * The TAE header in words (the bytes before the animation table): format
 * version, the eight flag bytes, and the skeleton and SIB file names it
 * points at (e.g. skeleton.hkt, c9990.SIB in the player's).
 */
function taeHeaderFields(prefix: Buffer): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = []
  if (prefix.length < 0x60) return out
  out.push({ name: 'Format version', value: `0x${prefix.readUInt32LE(8).toString(16)}` })
  out.push({ name: 'Flags', value: [...prefix.subarray(0x40, 0x48)].join(' ') })
  const utf16 = (at: number) => {
    if (at <= 0 || at >= prefix.length) return null
    let e = at
    while (e + 1 < prefix.length && prefix.readUInt16LE(e) !== 0) e += 2
    return prefix.toString('utf16le', at, e)
  }
  if (prefix.length >= 0xb0) {
    const names = Number(prefix.readBigInt64LE(0xa8))
    if (names > 0 && names + 16 <= prefix.length) {
      const skeleton = utf16(Number(prefix.readBigInt64LE(names)))
      const sib = utf16(Number(prefix.readBigInt64LE(names + 8)))
      if (skeleton !== null) out.push({ name: 'Skeleton', value: skeleton })
      if (sib !== null) out.push({ name: 'SIB', value: sib })
    }
  }
  return out
}

/**
 * Compression for saving. The game ships these binders at Kraken level 6,
 * which takes about a minute for the 68 MB animation binder; level 4 takes a
 * second and is 7% larger. The game reads either.
 */
function packing(info: DcxInfo): DcxInfo {
  return info.format === 'KRAK' ? { format: 'KRAK', level: Math.min(info.level, 4) } : info
}

/** Well-known points on the player's body (Spellforge's own labels, from the bones they ride), when the model can't be read. */
const BODY_POINTS: Record<number, string> = {
  1: 'right hand',
  2: 'left hand',
  5: 'right foot',
  6: 'left foot',
  7: 'head',
  8: 'chest',
  9: 'hips',
  220: 'chest',
}

/** The player's bones in words, for the body points that ride them. */
const BONE_WORDS: Record<string, string> = {
  R_Hand: 'the right hand',
  L_Hand: 'the left hand',
  R_Weapon: 'the right hand’s weapon bone (it moves with the right hand, weapon or not)',
  L_Weapon: 'the left hand’s weapon bone (it moves with the left hand, weapon or not)',
  R_Shield: 'the right hand’s shield bone',
  L_Shield: 'the left hand’s shield bone',
  R_Forearm: 'the right forearm',
  L_Forearm: 'the left forearm',
  R_UpperArm: 'the right upper arm',
  L_UpperArm: 'the left upper arm',
  R_Foot: 'the right foot',
  L_Foot: 'the left foot',
  R_Calf: 'the right calf',
  L_Calf: 'the left calf',
  R_Thigh: 'the right thigh',
  L_Thigh: 'the left thigh',
  Head: 'the head',
  Neck: 'the neck',
  Spine2: 'the chest',
  Spine1: 'the upper back',
  Spine: 'the lower back',
  Pelvis: 'the hips',
  RootRotY: 'the character’s root (it turns with them)',
}

/** Points every weapon model has: the hit line, a staff's casting point, the buff line. */
function weaponPoint(n: number): string | undefined {
  if (n === 100) return 'its tip (hits start here)'
  if (n === 110) return 'its middle'
  if (n === 120) return 'its grip'
  if (n === 122 || n === 130) return 'along the blade (a hit point)'
  if (n === 181) return 'a staff’s casting point (other weapons cast from their tip)'
  if (n >= 300 && n < 400) return 'the buff line (where coatings run, 300 → 301 → …)'
  return undefined
}

/**
 * A dummy poly id in words (see core/animation/dummies.ts for the numbering),
 * or a plain number on the weapon the event's DummyPolySource names (1 left,
 * 2 right).
 */
function describeDummy(id: number, source?: number, bodyBone?: (n: number) => string | null): string | undefined {
  if (id < 0) return 'No dummy poly: the character’s own position'
  const ref: DummyRef =
    source === 1 || source === 2 ? { on: source === 1 ? 'left' : 'right', model: 0, point: id } : parseDummyId(id)
  const n = ref.point
  if (ref.on === 'body') {
    const bone = bodyBone?.(n)
    if (bone) return `Point ${n} on the body: ${BONE_WORDS[bone] ?? `on its ${bone} bone`}`
    return `Point ${n} on the body${BODY_POINTS[n] ? `: the ${BODY_POINTS[n]}` : ''}`
  }
  const what = weaponPoint(n)
  const model = ref.model > 0 ? ' (its second model: the other blade of a pair, or its scabbard)' : ''
  return `Point ${n} on the ${ref.on}-hand weapon${model}${what ? `: ${what}` : ''}`
}
