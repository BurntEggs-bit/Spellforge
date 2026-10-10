/** IPC contract: the behaviour script (c0000.hks): recipes, the script workspace and checks. */
import type { Recipe } from '../recipes.ts'

export type { Recipe, RecipeWindow, HksInput, SkillType } from '../recipes.ts'

/** A behaviour event a recipe can play: the state's event name and the animation id it plays. */
export interface BehaviourSlot {
  event: string
  /** e.g. 30020 for W_AttackRightLight3. */
  animId: number
  /** The behaviour graph's selector (CMSG) for it. */
  state: string
}

/** A weapon a recipe can name: its own special category (spAtkcategory), which the script reads. */
export interface BehaviourWeapon {
  id: number
  name: string
  category: number
  project: boolean
}

/** A skill a recipe can name: its type (swordArtsTypeNew; its animations are a6xx = 600 + type). */
export interface BehaviourSkill {
  id: number
  name: string
  type: number
  project: boolean
}

export interface BehaviourStatus {
  /**
   * What the script is made from: the project's own text (another mod's or
   * a hand edit), the community's text, the project's or the game's compiled
   * script (decompiled by Spellforge), or nothing found.
   */
  source: 'project' | 'community' | 'project-compiled' | 'game' | 'none'
  /** Functions and lines in that script. */
  functions: number
  lines: number
  recipes: { recipe: Recipe; problems: string[] }[]
  /** Recipes changed since the last save. */
  dirty: boolean
  /** The project has its own c0000.hks. */
  written: boolean
  /** Why the script couldn't be read, if it couldn't. */
  problem: string | null
}

/** A text script compared with the game's own, function by function. */
export interface BehaviourComparison {
  /** What its header says it is ("community v7, for ER 1.08.1"), if it says. */
  version: string | null
  same: number
  /** The same once the community's names for ids are read as numbers. */
  constants: number
  /** Changed: by FromSoftware since the script was made, or by a mod. */
  different: string[]
  /** In the game's script, not in this one (newer functions). */
  missing: string[]
  /** Only in this one (a mod's own, or ones the game dropped). */
  extra: string[]
  /** Names the script uses both for a function and for an id (one breaks the other). */
  clashes: string[]
}

export interface BehaviourPreview {
  /** The block appended to the script. */
  block: string
  /** Recipes left out (the script lacks the function they need). */
  skipped: { id: string; why: string }[]
  /** Why the whole script doesn't parse or compile (null: it does). */
  error: string | null
  lines: number
  /** The block's first line in the whole script. */
  blockStartsAt: number
}

/** A problem in a script being written (lines and columns from 1, in its own text). */
export interface HksProblem {
  line: number
  col: number
  /** Characters to underline from col. */
  length: number
  severity: 'error' | 'warning' | 'info'
  message: string
  /** The parser (syntax), the compiler, or one of Spellforge's checks of what the game's script expects. */
  source: 'syntax' | 'compile' | 'check'
}

/** A script checked in the editor. */
export interface HksCheck {
  problems: HksProblem[]
  /** It compiles, alone and with the whole script (the base, Spellforge's part and the project's other scripts). */
  compiles: boolean
  /** The whole script fails somewhere else (another script or behaviour), when it does. */
  whole: string | null
  /** This code compiled alone with Spellforge's compiler (as the game compiles a text script): its functions and instructions. */
  compiled: { functions: number; instructions: number; listing: string } | null
  /** How long the check took (ms). */
  ms: number
}

/** What the game's scripts define and use, for the script editor. */
export interface HksNames {
  /** The game's functions and their parameters (for wrapping one). */
  functions: { name: string; params: string[] }[]
  /** Its constants and tables (TRUE, HAND_RIGHT, Event_…). */
  constants: string[]
  /** Names the game's scripts use without defining: the engine's (env, act…) and Lua's. */
  engine: string[]
  /** Half-body events and the Event_… table each is played with. */
  halfBlend: Record<string, string>
}

/** The behavior channels: request and response of each. */
export interface BehaviorChannels {
  /** The behaviour script: where it comes from, its recipes and their problems. */
  'behaviour:status': [void, BehaviourStatus]
  /** Behaviour events recipes can play (with the animation id each plays). */
  'behaviour:slots': [void, BehaviourSlot[]]
  /** Weapons with a special category of their own, and skills, for recipes to name. */
  'behaviour:weapons': [void, BehaviourWeapon[]]
  'behaviour:skills': [void, BehaviourSkill[]]
  /** Adds or replaces a recipe (by id). */
  'behaviour:set': [{ recipe: Recipe }, BehaviourStatus]
  'behaviour:delete': [{ id: string }, BehaviourStatus]
  /** The block Spellforge appends, and whether the whole script compiles. */
  'behaviour:preview': [void, BehaviourPreview]
  /** The project's script compared with the installed game's own, function by function. */
  'behaviour:compare': [void, BehaviourComparison]
  /** The script's functions (names, in order), one function's text, a text search. */
  'behaviour:functions': [void, string[]]
  'behaviour:function': [{ name: string }, string | null]
  'behaviour:search': [{ query: string }, { line: number; text: string }[]]
  /** A script being written in the editor, checked: syntax, Spellforge's checks, compiled alone and with the whole script. */
  'behaviour:check': [{ code: string; id?: string }, HksCheck]
  /** Names the game's scripts define and use (for the editor's colours) and each function's parameters. */
  'behaviour:names': [void, HksNames]
  /**
   * A window in an animation that turns a recipe on: a marker SpEffect
   * (a copy of the game's own [HKS] flag SpEffect, id below 16,777,216) and
   * an AddSpEffect event for it from `start` to `end` (seconds).
   */
  'behaviour:window': [
    { animation: string; start: number; end: number; name: string; speffect?: number },
    { speffect: number },
  ]
}
