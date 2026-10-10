/**
 * A Spellforge project: a ModEngine2 `mod` folder layered over the game.
 *
 *   read:  the project's copy of a file if it has one, else the game's.
 *   write: always into the project, never anywhere else.
 *
 * The game directory is read-only source data. Every write goes through
 * `writeProjectFile`, which refuses any path outside the project folder or
 * inside the game folder, and backs up what it replaces. This is the one
 * place files are written, so the guard cannot be bypassed by accident.
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './files.ts'
import { GameFiles, type GameFilesOptions } from './gameFiles.ts'

export interface ProjectConfig {
  /**
   * The game folder: a normal install (…\ELDEN RING\Game, files packed in its
   * archives) or an unpacked copy. Read-only.
   */
  gameDir: string
  /** The project's ModEngine2 `mod` folder. All writes land here. */
  modDir: string
  /** Smithbox install, for paramdefs, metadata and row names. */
  smithboxDir: string
  /** Archive header cache and file dictionary, for packed installs. */
  gameFiles?: GameFilesOptions
  /** An already-open GameFiles for gameDir (shares its decrypted archive headers). */
  game?: GameFiles
}

export class WriteGuardError extends Error {}

function normalise(p: string): string {
  return path
    .resolve(p)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function isInside(child: string, parent: string): boolean {
  const c = normalise(child)
  const p = normalise(parent)
  return c === p || c.startsWith(p + path.sep.toLowerCase()) || c.startsWith(p + '/')
}

/** A game-relative path as staged files are keyed: lower case, forward slashes. */
function stageKey(rel: string): string {
  return path.normalize(rel).replace(/[\\]/g, '/').toLowerCase()
}

export class Project {
  readonly config: ProjectConfig
  /** The game's files: loose, or inside its packed archives. */
  readonly game: GameFiles
  /** One backup folder per session, so a session's writes can be undone together. */
  private readonly backupDir: string
  /**
   * Files made in memory (a weapon's own model…), read as the project's own
   * until Save writes them (writeStaged): nothing reaches the mod folder
   * before the user saves. Keyed by their lower-case path.
   */
  private readonly staged = new Map<string, { rel: string; data: Buffer }>()

  constructor(config: ProjectConfig) {
    const gameDir = path.resolve(config.gameDir)
    const modDir = path.resolve(config.modDir)
    if (isInside(modDir, gameDir) || isInside(gameDir, modDir)) {
      throw new WriteGuardError(
        `The project folder and the game folder overlap:\n  project: ${modDir}\n  game:    ${gameDir}\n` +
          'Pick a separate mod folder so the game files can never be overwritten.',
      )
    }
    this.config = { ...config, gameDir, modDir }
    this.game = config.game && config.game.dir === gameDir ? config.game : new GameFiles(gameDir, config.gameFiles)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.backupDir = path.join(modDir, '..', '.spellforge-backups', stamp)
  }

  /** Path of a game-relative file (e.g. `sfx/sfxbnd_commoneffects.ffxbnd.dcx`) in the project. */
  projectPath(rel: string): string {
    return path.join(this.config.modDir, rel)
  }

  /** Where a file would be read from, or null if neither has it. */
  resolve(rel: string): { source: 'project' | 'game' } | null {
    if (this.staged.has(stageKey(rel)) || fs.existsSync(this.projectPath(rel))) return { source: 'project' }
    return this.game.has(rel) ? { source: 'game' } : null
  }

  read(rel: string): { data: Buffer; source: 'project' | 'game' } {
    const staged = this.staged.get(stageKey(rel))
    if (staged) return { data: staged.data, source: 'project' }
    const p = this.projectPath(rel)
    if (fs.existsSync(p)) return { data: fs.readFileSync(p), source: 'project' }
    if (!this.game.has(rel)) throw new Error(`${rel} is in neither the project nor the game`)
    return { data: this.game.read(rel), source: 'game' }
  }

  /** The game's own copy of a file, ignoring the project's. */
  readGame(rel: string): Buffer {
    return this.game.read(rel)
  }

  /** Lists files matching a pattern in one game-relative folder, merged across project and game. */
  list(relDir: string, pattern: RegExp): string[] {
    const names = new Map<string, string>()
    for (const { rel } of this.staged.values()) {
      const n = path.basename(rel)
      if (stageKey(path.dirname(rel)) === stageKey(relDir) && pattern.test(n)) names.set(n.toLowerCase(), n)
    }
    const dir = path.join(this.config.modDir, relDir)
    if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (pattern.test(n)) names.set(n.toLowerCase(), n)
    for (const n of this.game.list(relDir, pattern)) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n)
    return [...names.values()].sort().map((n) => path.join(relDir, n))
  }

  /** Keeps a file to write on Save; until then it reads as the project's own. */
  stage(rel: string, data: Buffer): void {
    this.staged.set(stageKey(rel), { rel, data })
  }

  /** The files waiting for Save. */
  stagedFiles(): string[] {
    return [...this.staged.values()].map((s) => s.rel)
  }

  /** Writes the files waiting for Save; returns where they went. */
  writeStaged(): string[] {
    const written = [...this.staged.values()].map((s) => this.writeProjectFile(s.rel, s.data))
    this.staged.clear()
    return written
  }

  /** Releases the game archives' open files. */
  close(): void {
    this.game.close()
  }

  /**
   * The only way Spellforge writes a file. Refuses anything outside the
   * project or inside the game folder, backs up an existing file first, and
   * writes atomically (temp file + rename) so a crash can't leave half a file.
   */
  writeProjectFile(rel: string, data: Buffer): string {
    const target = path.resolve(this.projectPath(rel))
    if (!isInside(target, this.config.modDir)) {
      throw new WriteGuardError(`Refusing to write outside the project: ${target}`)
    }
    if (isInside(target, this.config.gameDir)) {
      throw new WriteGuardError(`Refusing to write into the game folder: ${target}`)
    }

    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (fs.existsSync(target)) {
      const backup = path.join(this.backupDir, rel)
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      if (!fs.existsSync(backup)) fs.copyFileSync(target, backup)
    }
    writeFileAtomic(target, data)
    return target
  }

  get backupsFolder(): string {
    return this.backupDir
  }
}
