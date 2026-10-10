/** IPC contract: settings, first-run setup, the app window, crash recovery and the link to the running game. */

/**
 * The contract between the main process (which owns all files and data) and
 * the UI. Everything crossing IPC is plain JSON described here.
 */

export interface ThemeSettings {
  /** Preset id: glintstone (default), ember, erdtree, frost, blood, rot, night, grace. */
  preset: string
  /** Theme settings version (2: Glintstone is the default preset). */
  v?: number
  /** Per-color overrides on top of the preset, keyed by color token. */
  overrides: Record<string, string>
  fontSize: number
  density: 'comfortable' | 'compact'
}

export interface Settings {
  gameDir: string
  smithboxDir: string
  recentProjects: string[]
  /** First id tried when allocating copied effects. */
  effectIdStart: number
  /** Optional CSV of effect names (e.g. exported from the community FXR ID sheet). */
  effectNamesCsv: string
  theme: ThemeSettings
}

export interface SetupStatus {
  settings: Settings
  gameOk: boolean
  /** What the game folder is: a normal (packed) install, an unpacked copy, or not a game folder. */
  gameKind: 'install' | 'unpacked' | null
  smithboxOk: boolean
  /** Where param definitions and names come from. */
  dataSource: { kind: 'bundled' | 'smithbox'; path: string; version: string }
  oodleOk: boolean
  problems: string[]
}

/** A project made with one game version, opened with another installed. */
export interface VersionInfo {
  /** "1.16.1" */
  project: string
  game: string
  projectVersion: number
  gameVersion: number
  /** The project is from an older version than the installed game. */
  older: boolean
  /**
   * Spellforge has the vanilla files of the project's version, so the
   * project's edits are told apart from what the game update changed.
   */
  known: boolean
  /** Rows the newer game changed, and rows it added, that the project's regulation doesn't have yet. */
  updateChanged: number
  updateAdded: number
}

/** A project's unsaved changes kept from a session that ended before they were saved. */
export interface RecoveryInfo {
  modDir: string
  /** How many changes, and when the first and the last were made (ms). */
  changes: number
  started: number
  last: number
  /** The project's own files (or the game) changed since: they're made again on them as they are now. */
  filesChanged: boolean
  gameChanged: boolean
}

export interface RecoveryResult {
  applied: number
  failed: { channel: string; error: string }[]
}

/** The running game, for reloading the character in it (F5). */
export interface GameLinkStatus {
  /** eldenring.exe is running. */
  running: boolean
  pid?: number
  /** The exe's path, when it could be read. */
  exe?: string
  /** A character is loaded (on the title screen and loading screens there's none). */
  inGame?: boolean
  /** What stops a reload, in words. */
  problem?: string
}

/** The setup channels: request and response of each. */
export interface SetupChannels {
  'setup:status': [void, SetupStatus]
  'setup:save': [Partial<Settings>, SetupStatus]
  /** Elden Ring installs found on this PC (Steam libraries). */
  'setup:findGame': [void, string[]]
  'dialog:pickFolder': [{ title: string; defaultPath?: string }, string | null]
  /** Opens (or brings forward) the walkthrough video's window; false if this build has no video. */
  'app:openTutorial': [void, boolean]
  /** The walkthrough window: kept above other windows or not (left out: as it is). */
  'app:walkthroughWindow': [{ onTop?: boolean }, { onTop: boolean }]
  'dialog:pickFile': [{ title: string; extensions: string[] }, string | null]
  /** Loads effect names from a CSV; returns how many were read. */
  'setup:effectNames': [{ file: string }, number]
  /** Projects with unsaved changes kept from last time; the open project's; bring them back; drop them. */
  'recovery:list': [void, RecoveryInfo[]]
  'recovery:status': [void, RecoveryInfo | null]
  'recovery:restore': [void, RecoveryResult]
  'recovery:discard': [{ modDir?: string }, void]
  /** Whether Elden Ring is running with a character loaded (for reloading in game). */
  'game:status': [void, GameLinkStatus]
  /** Asks the running game to reload a character model from disk (default the player, c0000): F5. */
  'game:reload': [{ model?: string } | void, { ms: number }]
  /** Starts the game with the open project through me3, offline, on Spellforge's own save file. */
  'game:play': [void, { me3: string; savefile: string }]
}
