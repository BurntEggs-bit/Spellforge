/** IPC contract: the game text (FMG): languages, files, entries and search. */
import type { RowView } from './params.ts'

export interface TextLanguageView {
  code: string
  name: string
}

/** One text file (FMG) in a binder the game reads. */
export interface TextFileView {
  /** The binder, game-relative (msg/engus/item_dlc02.msgbnd.dcx). */
  rel: string
  container: 'item' | 'menu'
  file: string
  title: string
  group: 'Base game' | 'DLC 1' | 'DLC 2'
  /** Param whose row ids the entry ids are, if any. */
  param?: string
  count: number
  /** The project has its own copy of this binder (or it's edited). */
  ownCopy: boolean
  /**
   * Entries the modder added, changed or removed: compared with the vanilla
   * text of the game version the copy was made with.
   */
  edited: number
  /** Entries where the installed game has newer text, or entries it added, that the copy lacks. */
  outdated: number
  /** The game version the copy's text matches. */
  base?: { version: string; installed: boolean }
}

/** How an entry of a project's text differs from vanilla. */
export type TextEntryState = 'added' | 'changed' | 'removed' | 'outdated'

export type TextEntryFilter = 'all' | 'edited' | 'outdated'

export interface TextEntryView {
  id: number
  text: string | null
  /** Name of the param row with this id, for tables that name rows. */
  rowName?: string
  state?: TextEntryState
  /** changed / removed: the vanilla text; outdated: the installed game's newer text. */
  original?: string | null
}

export interface TextSearchHit {
  rel: string
  file: string
  title: string
  id: number
  text: string
}

/** The text channels: request and response of each. */
export interface TextChannels {
  /** Set an item's in-game name (written into the project's item text). */
  'text:setName': [{ param: string; id: number; text: string }, RowView]
  /** Text editor: languages the game has text for. */
  'text:languages': [void, TextLanguageView[]]
  /** The text files of one language (from the binders the game reads). */
  'text:files': [{ lang: string }, TextFileView[]]
  /** Entries of one text file, filtered by id or text. */
  'text:entries': [
    { rel: string; file: string; query: string; limit: number; filter?: TextEntryFilter },
    { entries: TextEntryView[]; total: number },
  ]
  /** Brings the installed game's newer text into the project's copy (one table, or all with file null). */
  'text:updateFromGame': [{ rel: string; file: string | null }, { updated: number }]
  /** Sets (or with text null, deletes) one entry. */
  'text:set': [{ rel: string; file: string; id: number; text: string | null }, TextEntryView]
  /** Every entry in a language matching the text or id. */
  'text:search': [{ lang: string; query: string; limit: number }, TextSearchHit[]]
}
