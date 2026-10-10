/** IPC contract: other characters (enemies, bosses, NPCs): their moves, and making them the player's skills and spells. */
import type { AnimClipboardEvent, AnimationView } from './animations.ts'

/** A character model (chr/cXXXX): an enemy, boss, NPC or creature. */
export interface EnemyListItem {
  /** Model id, e.g. c2130. */
  chr: string
  /** Its in-game name (NpcName), else its NPC rows' name, else the model id. */
  name: string
  /** Other names its NPC rows go by (its variants). */
  aliases: string[]
  /** NpcParam rows using this model (by the id convention: 21300000 is c2130). */
  npcs: number
  /** Effects only it loads (sfx/sfxbnd_cXXXX). */
  bundle: boolean
}

/** One thing a move does, resolved through the character's behavior rows. */
export interface EnemyMoveAction {
  /** TAE event (index) and when it starts. */
  event: number
  start: number
  kind: 'attack' | 'bullet' | 'speffect'
  judge: number
  /** BehaviorParam row, or null when the character has none for that judge. */
  behavior: number | null
  /** AtkParam_Npc / Bullet / SpEffectParam id. */
  id: number | null
  name: string
}

export interface EnemyMove {
  /** Animation name, e.g. a002_003027. */
  name: string
  /** Latest event time (seconds). */
  length: number
  actions: EnemyMoveAction[]
  effects: { id: number; name: string; common: boolean }[]
  /** One line, e.g. "Hammer Jump, Holy Hammer Shockwave, 3 effects". */
  summary: string
  /** attack: hits; spell: fires bullets; other: neither (movement, reactions). */
  kind: 'attack' | 'spell' | 'other'
  /** The hand it's made with (where its effects and hits are), if it can be told. */
  hand: 'left' | 'right' | null
}

/** A bullet a character fires: a spell or projectile the player could have. */
export interface EnemySpell {
  bullet: number
  name: string
  /** Its attack (AtkParam_Npc), if any. */
  attack: number | null
  effect: number | null
  effectName: string
  /** Moves that fire it. */
  moves: string[]
}

export interface EnemyView {
  chr: string
  name: string
  npcs: { id: number; name: string; variation: number; masks: number[] }[]
  /** The behavior variation moves are resolved with. */
  variation: number
  moves: EnemyMove[]
  spells: EnemySpell[]
  /** Its own effect bundle, if it has one. */
  bundle: string | null
}

/** How a character's motion is fitted to the player. */
export interface RetargetOptionsView {
  /** Swap left and right (a move made with the left hand, done with the right). */
  mirror: boolean
  /** Keep the player's upright spine, neck and head instead of copying the character's stoop. */
  upright: boolean
  /** How far the move carries the player: 1 is in proportion to their size, 1/scale as far as the character goes. */
  travel: number
}

/** A character's animation played by the player (for the viewport). */
export interface RetargetRequest extends RetargetOptionsView {
  chr: string
}

export interface EnemySkillRequest {
  chr: string
  animation: string
  /** NpcParam behavior variation to resolve the move's behaviors with (default: the character's main one). */
  variation?: number
  /** The project's weapon that gets the skill. */
  weapon: number
  /** In-game name and description of the new skill. */
  name: string
  description: string
  /**
   * The player skill (SwordArtsParam) copied for the player's side of the
   * move: FP cost, recovery and cancel timing. Default: a one-animation skill.
   */
  baseSkill?: number
  motion: RetargetOptionsView
  /** Effects at the character's size, or scaled to the player's. */
  effectSize: 'enemy' | 'player'
  /** Where each of the character's dummy polys lands on the player (event values: body ids, 10000 + id on the right weapon). */
  dummies?: Record<string, number>
  /**
   * For a bullet event (by the character's judge), another of its bullets to
   * fire instead: the stab that drops one floating sword fires the sword
   * rain. Its whole chain comes along (the bullets it becomes and drops).
   */
  bullets?: Record<string, number>
  /**
   * Make it one of the weapon's attacks instead of its skill: a key from the
   * plan's `attackTargets` (e.g. "2h-r1-0": its first two-handed R1).
   */
  attack?: string
  /**
   * With an R1 `attack`: cut the move at these times (seconds into it), each
   * part one press of R1 (this R1, then the next ones). The plan's `cuts`
   * suggest them.
   */
  steps?: number[]
}

/** One of a weapon's attacks an enemy's move can become (Enemies → Make it… → an attack). */
export interface EnemyAttackTarget {
  key: string
  /** "R1, 1st", "R2 (and charged R2)", "Running attack"… */
  label: string
  group: 'One-handed' | 'Two-handed'
  /** The animation ids it replaces (030000; or 030500, 030505… for R2). */
  ids: number[]
}

export interface EnemySkillPlan {
  /** The new skill animation category (a6xx) and the animations in it. */
  category: number
  animations: string[]
  /** Player size / character size. */
  scale: number
  /** How far the move carries the character (m, along the ground). */
  distance: number
  /** The move is made with the left hand: mirroring puts it in the weapon hand. */
  mirrorSuggested: boolean
  dummies: { id: number; bone: string; to: number; toLabel: string; options: { value: number; label: string }[] }[]
  attacks: { judge: number; atk: number; name: string; newJudge: number }[]
  bullets: { judge: number; bullet: number; name: string; newJudge: number }[]
  effects: { id: number; name: string; from: string | null }[]
  /**
   * The move's sounds: its sound events that come along; how many sound
   * events (its own and its bullets') are brought from the character's bank
   * into the player's (`bank`), with their embedded audio's size; how many
   * the player's banks already have.
   */
  sounds: { events: number; bring: number; present: number; bytes: number; bank: string }
  /** What stays behind, and why. */
  dropped: { what: string; why: string }[]
  baseSkill: { id: number; name: string; category: number }
  weapon: { id: number; name: string; variation: number; skill: number; skillName: string }
  notes: string[]
  /** The weapon's attacks the move could become instead of its skill. */
  attackTargets: EnemyAttackTarget[]
  /** When made an attack: which, and the animations it becomes (in the weapon's own category). */
  attack: (EnemyAttackTarget & { animations: string[] }) | null
  /** When its hits are (seconds into the move), and where it can be cut into steps (mid-way through each pause of half a second or more). */
  hits: number[]
  cuts: number[]
  /** The move's length (seconds). */
  length: number
}

/** Sounds a skill or spell made from a character's brought along: events, those newly copied into the player's bank, their audio's size. */
export interface EnemySoundsMade {
  events: number
  copied: number
  bytes: number
  bank: string
}

export interface EnemySkillResult {
  /** The new skill (-1 when the move became an attack). */
  skill: number
  /** When it became one of the weapon's attacks: which. */
  attack?: EnemyAttackTarget
  category: number
  animations: string[]
  rows: { param: string; id: number; name: string }[]
  effects: number[]
  sounds: EnemySoundsMade
  summary: string
}

export interface EnemySpellRequest {
  chr: string
  bullet: number
  /** The player spell copied (Magic id = its EquipParamGoods id): its cast animation, FP cost and item. */
  baseSpell: number
  name: string
  description: string
  effectSize: 'enemy' | 'player'
}

export interface EnemySpellResult {
  spell: number
  bullet: number
  rows: { param: string; id: number; name: string }[]
  effects: number[]
  sounds: EnemySoundsMade
  summary: string
}

/** The enemies channels: request and response of each. */
export interface EnemiesChannels {
  /** Every character model with animations: enemies, bosses, NPCs, creatures. */
  'enemy:list': [void, EnemyListItem[]]
  /** One character: its NPC rows, moves, spells and effects. */
  'enemy:get': [{ chr: string; variation?: number }, EnemyView]
  /** One of a character's animations, read only (for the timeline). */
  'enemy:anim': [{ chr: string; animation: string }, AnimationView]
  /** A move's events, for the clipboard (pasted into the player's animations as they are). */
  'enemy:copyEvents': [{ chr: string; animation: string; indices: number[] }, AnimClipboardEvent[]]
  /** What turning a character's move into a weapon skill would make (nothing is changed). */
  'enemy:skillPlan': [EnemySkillRequest, EnemySkillPlan]
  /** Turns a character's move into a skill of one of the project's weapons. */
  'enemy:makeSkill': [EnemySkillRequest, EnemySkillResult]
  /** Turns a character's bullet into a player spell (a copy of a player spell, casting it). */
  'enemy:makeSpell': [EnemySpellRequest, EnemySpellResult]
}
