/** IPC contract: opening, saving and updating a mod project. */
import type { VersionInfo } from './setup.ts'

export type ProjectState = 'added' | 'changed' | null

/**
 * What a game update brings to a project made with an older version: for
 * each kind of file, what the update changed or added that the project
 * doesn't have yet, and where both changed the same thing (the project's
 * version is kept).
 */
export interface GameUpdatePlan {
  /** Game versions, e.g. "1.16.1" and "1.17.1". */
  from: string
  to: string
  /** Spellforge kept the files of the project's version, so the project's changes can be told apart from the update's. */
  known: boolean
  /** Null when the regulation can't be updated (the old version's files weren't kept). */
  params: {
    added: number
    changed: number
    removed: number
    conflicts: number
    fromUpdate: { added: number; changed: number }
    conflictExamples: string[]
  } | null
  /** Text entries the newer game has that the project's text files lack or have older. */
  text: { files: number; entries: number } | null
  effects: { added: number; changed: number; conflicts: number; known: boolean } | null
  /**
   * `motionFiles`: animation files Spellforge added (skills made from enemy moves), moved onto the new game's binders;
   * `soundEvents`: sound events it brought into the player's sound bank, brought into the new game's.
   */
  animations: {
    added: number
    changed: number
    conflicts: number
    categories: number
    motionFiles?: number
    soundEvents?: number
    known: boolean
  } | null
  /** Project files this can't bring up to date (behaviour graph, scripts, models…). */
  untouched: string[]
  /** Unsaved changes: they're kept, and saved with the update. */
  unsaved: boolean
}

export interface GameUpdateRequest {
  params: boolean
  text: boolean
  effects: boolean
  animations: boolean
}

export interface GameUpdateResult {
  /** The project, reopened. */
  summary: ProjectSummary
  written: string[]
  backupsFolder: string
}

export interface ProjectSummary {
  modDir: string
  regulationSource: 'project' | 'game'
  regulationVersion: number
  counts: { weapons: number; bullets: number; effects: number }
  /**
   * What the project changes, by param: compared with the vanilla rows of
   * the game version it was made with (when Spellforge has kept them).
   */
  changes: { param: string; added: number; changed: number; removed: number }[]
  /** Set when the project's regulation is from another game version than the installed game's. */
  version?: VersionInfo
  /** Problems in the project's files Spellforge fixed when opening it (written on the next save). */
  repaired?: string[]
}

export interface DirtyState {
  regulation: boolean
  bundles: string[]
}

export interface SaveResult {
  written: string[]
  backupsFolder: string
}

/** The project channels: request and response of each. */
export interface ProjectChannels {
  'project:open': [{ modDir: string }, ProjectSummary]
  'project:dirty': [void, DirtyState]
  'project:save': [void, SaveResult]
  /** What updating the project to the installed game's version would bring (null: it already matches). */
  'project:updatePlan': [void, GameUpdatePlan | null]
  /** Brings the chosen parts up to the installed game's version, saves (with backups) and reopens the project. */
  'project:updateFromGame': [GameUpdateRequest, GameUpdateResult]
  /** Where the user was in a project (a page and what's open on it), kept so it opens there again. */
  'place:get': [{ modDir: string }, unknown]
  'place:set': [{ modDir: string; place: unknown }, void]
}
