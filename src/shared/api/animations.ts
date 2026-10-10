/** IPC contract: animations (TAE): categories, events, the event templates, registration and notes. */
import type { BrowseRow } from './params.ts'
import type { ProjectState } from './project.ts'

/** Whether the behaviour graph (c0000.behbnd) can play an animation. */
export type AnimRegistration =
  /** Some clip in the graph plays it. */
  | 'registered'
  /** Selectors exist for its animation ID but none plays it: Register adds it. */
  | 'missing'
  /** No selector handles its animation ID: it can't be registered automatically. */
  | 'unsupported'

export interface AnimCategoryView {
  category: number
  /** e.g. "a053" */
  label: string
  animations: number
  state: ProjectState
  /** A plain-language guess at what the category is for. */
  hint?: string
}

export interface AnimListItem {
  name: string
  id: number
  events: number
  motion: 'own' | 'motion' | 'full'
  /** Animation whose motion it uses (motion/full). */
  source: string | null
  registration: AnimRegistration
  state: ProjectState
  /** The project's own name for it and its tags (F2), if any. */
  title?: string
  tags?: string[]
}

/** The project's own names and tags for animations (.spellforge/animation-notes.json). */
export type AnimNotes = Record<string, { title?: string; tags?: string[] }>

/** Events copied (Ctrl+C / Ctrl+X), to paste into any animation. */
export interface AnimClipboardEvent {
  type: number
  unk: number
  start: number
  end: number
  /** Parameter bytes, hex. */
  params: string
  typeName: string
}

/**
 * What to find in the animations' events (Ctrl+F): events of a type, and/or
 * a field holding a value. `field` is a field name, or what it points at:
 * '@effect', '@speffect', '@judge', '@sound', '@dummy'.
 */
export interface AnimFindQuery {
  type?: number | null
  field?: string
  value?: number | null
  /** One category, or every category (null). */
  category?: number | null
  limit?: number
}

export interface AnimFindHit {
  animation: string
  index: number
  type: number
  typeName: string
  /** The field that matched (null when only the type was asked for). */
  field: string | null
  value: number | null
  start: number
  end: number
  summary: string
}

export interface AnimFindResult {
  hits: AnimFindHit[]
  /** Matches in all (hits stops at the limit). */
  total: number
  /** Animations searched. */
  animations: number
}

/** An animation's entry in its TAE (F3): its id and what motion it plays. */
/** How an animation's clips in the behaviour graph play (one per selector it's in), as ERClipGeneratorTool sets them. */
export interface AnimClipView {
  /** 1 = as made, 2 = twice as fast. */
  playbackSpeed: number
  /** Seconds cut from the start and the end. */
  cropStart: number
  cropEnd: number
  /** Havok's play modes: 0 once, 1 looping, 2 user controlled, 3 ping-pong. */
  mode: number
  /** Played mirrored, left for right. */
  mirror: boolean
  /** How many clips play it, and whether they all agree (the first's settings are shown). */
  clips: number
  same: boolean
  /** Clips whose start follows the graph's TimeActEditor_10 (jump attack landings). */
  startBound: number
}

/** The clip settings an edit changes. */
export type AnimClipEdit = Partial<Pick<AnimClipView, 'playbackSpeed' | 'cropStart' | 'cropEnd' | 'mode' | 'mirror'>>

export interface AnimProperties {
  name: string
  category: number
  id: number
  motion: 'own' | 'motion' | 'full'
  source: string | null
  /** The .hkt name stored. */
  file: string
  /** Plays looped by default (flag in the motion reference). */
  loop: boolean
  /** The stored reference as it is: type, a, b, c, d. */
  raw: { type: number; a: number; b: number; c: string; d: string }
  events: number
  registration: AnimRegistration
  /** Its clips in the behaviour graph, when it's registered. */
  clip: AnimClipView | null
}

export interface AnimPropertiesEdit {
  name: string
  /** A new id and/or category: the animation moves (keeping its motion: its own becomes a reference to its old name). */
  id?: number
  category?: number
  /** What motion it plays. */
  motion?: { kind: 'own' | 'motion' | 'full'; source?: string }
  loop?: boolean
  /** Its clips' settings (every clip of it in the behaviour graph). */
  clip?: AnimClipEdit
}

/** A category's TAE (Shift+F3). */
export interface AnimCategoryProperties {
  category: number
  label: string
  /** The TAE's own id (2000 + category in the game's files). */
  taeId: number
  /** Its file in the binder. */
  entryId: number
  entryName: string
  animations: number
  events: number
  /** The TAE header as stored (read-only): format, flags, skeleton and SIB names. */
  header: { name: string; value: string }[]
}

export interface AnimFieldView {
  name: string
  type: string
  offset: number
  value: number
  entries?: { name: string; value: number }[]
  reserved: boolean
  link?: 'effect' | 'speffect' | 'judge'
  /** For links: what it points at, e.g. an effect or SpEffect name. */
  linkLabel?: string
  /**
   * What the number is, in words, for numbers that point at something
   * without a link: a dummy poly ("point 100 on the right-hand weapon: its
   * tip"), a sound ("sound s523000"), a SpEffect that doesn't exist.
   */
  about?: string
}

export interface AnimEventView {
  index: number
  type: number
  typeName: string
  /** Whether DSAS's template knows this event type. */
  known: boolean
  start: number
  end: number
  /** Event group (lane) it belongs to. */
  group: number
  summary: string
  fields: AnimFieldView[]
  /** Stored parameter bytes, hex. */
  raw: string
}

export interface AnimationView {
  name: string
  category: number
  id: number
  motion: 'own' | 'motion' | 'full'
  motionFile: string
  source: string | null
  events: AnimEventView[]
  /** Latest event time, in seconds (the motion's real length isn't read). Events
   *  ending at or beyond OPEN_EVENT_END last until the animation ends. */
  length: number
  registration: AnimRegistration
  /** Behaviour selectors for its animation ID, and whether each plays it. */
  selectors: { name: string; registered: boolean }[]
  state: ProjectState
  /** The project's own name for it and its tags (F2), if any. */
  title?: string
  tags?: string[]
  /** Plays looped by default (its motion reference's flag). */
  loop?: boolean
}

/** Event ends at or past this (the game uses FLT_MAX) mean "until the animation ends". */
export const OPEN_EVENT_END = 1e6

/** The largest 32-bit float: the end the game's files give an event that lasts until the animation ends. */
export const FLOAT_MAX = 3.4028234663852886e38

export interface AnimEventType {
  type: number
  name: string
  /** How often it appears in the game's player animations. */
  uses: number
  /** Its named fields (for finding events by a field's value). */
  fields?: string[]
}

export interface AnimEventEdit {
  name: string
  index: number
  start?: number
  end?: number
  /** A template field, by its type and byte offset. */
  field?: { type: string; offset: number; value: number }
  /** All parameter bytes, hex (for event types the template doesn't describe). */
  raw?: string
}

export interface AnimDuplicateRequest {
  /** Animations to copy, e.g. ["a053_030000"], or a whole category with `fromCategory`. */
  names?: string[]
  fromCategory?: number
  toCategory: number
  /** New animation id (single-animation copies only); default: the same id. */
  toId?: number
  /** Add the copies to the behaviour graph so the game can play them. */
  register: boolean
  /** Replace animations that already exist at the target. */
  overwrite: boolean
}

export interface AnimDuplicateResult {
  created: string[]
  replaced: string[]
  skipped: { name: string; reason: string }[]
  registration: AnimRegisterResult | null
}

export interface AnimRegisterResult {
  /** Animations newly playable, with how many selectors each was added to. */
  added: { animation: string; selectors: number }[]
  skipped: { animation: string; reason: string }[]
}

/** The behavior row an animation's judge id means for one weapon (its behavior variation). */
export interface JudgeRowView {
  /** The weapon's own row for it, BehaviorParam_PC id: category × 100,000,000 + variation × 1000 + judge. */
  id: number
  variation: number
  weapon: number
  weaponName: string
  /** Whether the weapon has its own row. */
  exists: boolean
  /**
   * The row the game plays: the weapon's own, else its base variation's (its
   * hundreds), else every weapon's (variation 0). Null: none, the event does nothing.
   */
  plays: number | null
  /** When the row played isn't the weapon's own: its base variation's (its hundreds) or every weapon's (variation 0). */
  borrowed?: 'base' | 'every'
  /** What that row does: "Bullet 10400000: Glintstone Pebble". */
  summary?: string
}

/** Another variation's row for a judge: one to copy for a weapon that has none. */
export interface JudgeSourceView {
  id: number
  variation: number
  /** Weapons with that variation ("Moonveil, Rivers of Blood"), or '' when no weapon has it. */
  weapons: string
  /** One of them owns the animation asked about (its moveset's or its skill's category). */
  owner: boolean
  /** What the row does: "Bullet 10400000: Glintstone Pebble". */
  summary: string
}

/** Adds the behavior row a judge means for a weapon. */
export interface JudgeRowCreate {
  judge: number
  weapon: number
  /** The row to copy (another variation's for the judge); default: the row the weapon plays now, else one of its own. */
  from?: number
  /** At variation 0, which every weapon without a row of its own for the judge plays. */
  everyWeapon?: boolean
  /** Copies of the attack, bullets and their attacks it fires too, to balance for this weapon alone. */
  ownCopies?: boolean
}

/** The animations channels: request and response of each. */
export interface AnimationsChannels {
  /** Animation categories in the player's animations (chr/c0000.anibnd). */
  'anim:categories': [void, AnimCategoryView[]]
  'anim:list': [{ category: number; query: string }, AnimListItem[]]
  'anim:get': [{ name: string }, AnimationView]
  'anim:eventTypes': [void, AnimEventType[]]
  'anim:setEvent': [AnimEventEdit, AnimationView]
  /** Adds an event (a copy of `copyFrom`, or a new one of `type`); returns the view and its index. */
  'anim:addEvent': [
    { name: string; type?: number; copyFrom?: number; start: number; end: number },
    { view: AnimationView; index: number },
  ]
  'anim:deleteEvent': [{ name: string; index: number }, AnimationView]
  'anim:duplicate': [AnimDuplicateRequest, AnimDuplicateResult]
  'anim:delete': [{ name: string }, void]
  'anim:register': [{ names: string[] }, AnimRegisterResult]
  /** Animations in the project that the behaviour graph can't play yet but could. */
  'anim:unregistered': [void, string[]]
  /** Reverts the last event edit; returns the animation it changed (null: nothing to undo). */
  'anim:undo': [void, string | null]
  /** Makes the last undone edit again (Ctrl+Y); the animation it changed, or null. */
  'anim:redo': [void, string | null]
  /** How many edits can be undone and redone. */
  'anim:history': [void, { undo: number; redo: number }]
  /** Moves or resizes several events at once (one undo step). */
  'anim:setEvents': [{ name: string; edits: { index: number; start?: number; end?: number }[] }, AnimationView]
  'anim:deleteEvents': [{ name: string; indices: number[] }, AnimationView]
  /** Events as they are, for the clipboard. */
  'anim:copyEvents': [{ name: string; indices: number[] }, AnimClipboardEvent[]]
  /** Adds copied events; with `at`, shifted so the first starts there. Returns the new events' indices. */
  'anim:pasteEvents': [
    { name: string; events: AnimClipboardEvent[]; at?: number },
    { view: AnimationView; indices: number[] },
  ]
  /** Events (of every animation, or one category's) by type and field value. */
  'anim:find': [AnimFindQuery, AnimFindResult]
  'anim:properties': [{ name: string }, AnimProperties]
  /** Changes an animation's id, category or motion (F3); returns its (new) name. */
  'anim:setProperties': [AnimPropertiesEdit, { name: string; view: AnimationView }]
  'anim:categoryProperties': [{ category: number }, AnimCategoryProperties]
  /** Sets a category's TAE id. */
  'anim:setCategoryProperties': [{ category: number; taeId: number }, AnimCategoryProperties]
  /**
   * Moves every animation of a category to a new category number; with
   * `params`, the weapons and skills using it follow (wepmotionCategory,
   * spAtkcategory, swordArtsTypeNew). Not undoable.
   */
  'anim:renumberCategory': [
    { category: number; to: number; register: boolean; params: boolean },
    { category: number; animations: number; rows: number; registration: AnimRegisterResult | null },
  ]
  /** Copies another animation's events into this one (Ctrl+I): replacing its own or added to them; optionally its motion too. */
  'anim:importEvents': [{ name: string; from: string; mode: 'replace' | 'add'; motion: boolean }, AnimationView]
  /** The same animation id in the next (dir 1) or previous (dir -1) category that has it. */
  'anim:sameIdIn': [{ name: string; dir: 1 | -1 }, string | null]
  'anim:notes': [void, AnimNotes]
  /** Names or tags an animation (an empty title and no tags removes its note). */
  'anim:setNote': [{ name: string; title?: string; tags?: string[] }, AnimNotes]
  /** Notes from a file (JSON from Export, or "a050_030000 = Name" lines). */
  'anim:importNotes': [{ text: string; replace: boolean }, { notes: AnimNotes; count: number }]
  /** Animations' events as readable text (some animations, or a whole category). */
  'anim:exportText': [{ names?: string[]; category?: number }, string]
  /** The behavior row a judge id means for a weapon, and the one the game plays. */
  'anim:judgeRowFor': [{ judge: number; weapon: number }, JudgeRowView]
  /** Every variation's row for a judge, with the weapons that have each (to copy one); the animation's own weapons first. */
  'anim:judgeSources': [{ judge: number; animation?: string }, JudgeSourceView[]]
  /** Adds the weapon's own row for a judge (or every weapon's), a copy of another; returns the weapon's view. */
  'anim:createJudgeRow': [JudgeRowCreate, JudgeRowView]
  /** BehaviorParam_PC rows an animation's judge id fires. */
  'anim:judgeRows': [{ judge: number }, BrowseRow[]]
}
