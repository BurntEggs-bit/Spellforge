/**
 * The game's files, wherever they are: loose in the game folder (an unpacked
 * copy, or the few loose files of a normal install such as regulation.bin),
 * else inside the packed archives of a normal Steam install (Data0-3, DLC;
 * sound banks, sd/..., in sd/sd and sd/sd_dlc02, whose own paths start
 * below sd/). Read-only: nothing here writes to the game folder.
 *
 * Archive headers are decrypted once and cached (keyed by the .bhd's size and
 * date, so a game update refreshes the cache). Files inside archives are
 * found by their path hash; listing a folder uses the bundled file dictionary
 * (data/er/file-dictionary.txt), since archives only store hashes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { decryptBhd, erPathHash, isBhd5, parseBhd5, readBdtEntry, type Bhd5Entry } from '../formats/bhd5.ts'
import { ER_ARCHIVE_KEYS } from '../formats/archiveKeys.ts'

/** Archives with game data, in lookup order. */
const ARCHIVES = ['Data0', 'Data1', 'Data2', 'Data3', 'DLC']
/** Archives with the sound banks and streamed sounds (sd/...). */
const SOUND_ARCHIVES = ['sd/sd', 'sd/sd_dlc02']

export interface GameFilesOptions {
  /** Where decrypted archive headers are cached (e.g. the app's user data folder). */
  cacheDir?: string
  /** Path of the file dictionary (one game path per line). */
  dictionaryFile?: string
}

export interface GameFolderInfo {
  /** regulation.bin is present (loose in both installs and unpacked copies). */
  regulation: boolean
  /** Packed archives (a normal install) are present. */
  archives: boolean
  /** Looks unpacked (loose sfx/ and chr/ folders). */
  unpacked: boolean
}

export function inspectGameFolder(dir: string): GameFolderInfo {
  const has = (rel: string) => !!dir && fs.existsSync(path.join(dir, rel))
  return {
    regulation: has('regulation.bin'),
    archives: has('Data0.bhd') && has('Data0.bdt'),
    unpacked: has('sfx') && has('chr'),
  }
}

const isGameFolder = (dir: string) => {
  const i = inspectGameFolder(dir)
  return i.regulation && (i.archives || i.unpacked)
}

/**
 * A picked folder, corrected to the game folder when the user picked its
 * parent (…\ELDEN RING instead of …\ELDEN RING\Game).
 */
export function normalizeGameFolder(dir: string): string {
  if (!dir || isGameFolder(dir)) return dir
  const game = path.join(dir, 'Game')
  return isGameFolder(game) ? game : dir
}

/**
 * Elden Ring installs on this PC, from Steam's library list and the usual
 * library places on every drive. Reads files only (no registry, no programs).
 */
export function findEldenRingInstalls(): string[] {
  const roots = new Set<string>()
  const env = process.env
  for (const p of [env['ProgramFiles(x86)'], env.ProgramFiles, env.ProgramW6432])
    if (p) roots.add(path.join(p, 'Steam'))
  for (let c = 67; c <= 90; c++) {
    const drive = `${String.fromCharCode(c)}:\\`
    if (!fs.existsSync(drive)) continue
    for (const sub of [
      'SteamLibrary',
      'Steam',
      'Games\\Steam',
      'Games\\SteamLibrary',
      'Program Files (x86)\\Steam',
      'Program Files\\Steam',
    ])
      roots.add(path.join(drive, sub))
  }
  // Steam's own list of library folders adds any custom ones.
  const libraries = new Set<string>()
  for (const root of roots) {
    if (!fs.existsSync(path.join(root, 'steamapps'))) continue
    libraries.add(root)
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g, '\\'))
    } catch {
      /* no library list here */
    }
  }
  const found: string[] = []
  for (const lib of libraries) {
    const game = path.join(lib, 'steamapps', 'common', 'ELDEN RING', 'Game')
    if (isGameFolder(game) && !found.some((f) => path.resolve(f).toLowerCase() === path.resolve(game).toLowerCase()))
      found.push(game)
  }
  return found
}

interface OpenArchive {
  name: string
  entries: Map<bigint, Bhd5Entry>
  fd: number
}

export class GameFiles {
  readonly dir: string
  private options: GameFilesOptions
  private archives: OpenArchive[] | null = null
  private soundArchives: OpenArchive[] | null = null
  private dictionary: string[] | null = null

  constructor(dir: string, options: GameFilesOptions = {}) {
    this.dir = path.resolve(dir)
    this.options = options
  }

  get info(): GameFolderInfo {
    return inspectGameFolder(this.dir)
  }

  private loose(rel: string): string {
    return path.join(this.dir, rel)
  }

  /** Opens the archives on first use (headers from the cache when it's current). */
  private open(): OpenArchive[] {
    this.archives ??= this.openAll(ARCHIVES)
    return this.archives
  }

  private openSound(): OpenArchive[] {
    this.soundArchives ??= this.openAll(SOUND_ARCHIVES)
    return this.soundArchives
  }

  private openAll(names: string[]): OpenArchive[] {
    const out: OpenArchive[] = []
    for (const name of names) {
      const bhd = path.join(this.dir, `${name}.bhd`)
      const bdt = path.join(this.dir, `${name}.bdt`)
      const key = ER_ARCHIVE_KEYS[name]
      if (!key || !fs.existsSync(bhd) || !fs.existsSync(bdt)) continue
      try {
        out.push({ name, entries: parseBhd5(this.header(name, bhd, key)), fd: fs.openSync(bdt, 'r') })
      } catch {
        /* an unreadable archive (wrong game version?) is skipped */
      }
    }
    return out
  }

  /** The decrypted .bhd, from the cache if it matches the file's size and date. */
  private header(archive: string, bhd: string, key: string): Buffer {
    const st = fs.statSync(bhd)
    const cacheDir = this.options.cacheDir
    const name = archive.replace(/[\\/]/g, '_')
    const cached = cacheDir ? path.join(cacheDir, `${name}-${st.size}-${Math.round(st.mtimeMs)}.bhd5`) : null
    if (cached && fs.existsSync(cached)) {
      const b = fs.readFileSync(cached)
      if (isBhd5(b)) return b
    }
    const plain = decryptBhd(fs.readFileSync(bhd), key)
    if (cached) {
      try {
        fs.mkdirSync(cacheDir!, { recursive: true })
        // Drop older caches of this archive (from before a game update).
        for (const f of fs.readdirSync(cacheDir!))
          if (f.startsWith(`${name}-`) && f.endsWith('.bhd5')) fs.rmSync(path.join(cacheDir!, f), { force: true })
        fs.writeFileSync(cached, plain)
      } catch {
        /* caching is only a speed-up */
      }
    }
    return plain
  }

  private find(rel: string): { archive: OpenArchive; entry: Bhd5Entry } | null {
    // Sound archives hold sd/'s contents, by paths below it (/enus/cs_main.bnk).
    const p = rel.replace(/\\/g, '/').replace(/^\/+/, '')
    const sound = /^sd\//i.test(p)
    const h = erPathHash(sound ? p.slice(2) : rel)
    for (const archive of sound ? this.openSound() : this.open()) {
      const entry = archive.entries.get(h)
      if (entry) return { archive, entry }
    }
    return null
  }

  /** Where a game file is: loose on disk, inside an archive, or nowhere. */
  where(rel: string): 'loose' | 'archive' | null {
    if (fs.existsSync(this.loose(rel))) return 'loose'
    return this.find(rel) ? 'archive' : null
  }

  has(rel: string): boolean {
    return this.where(rel) !== null
  }

  /**
   * Something that changes whenever a game file does (a loose file's size and
   * date, an archived file's place and size), for caches of what's read from it.
   */
  fingerprint(rel: string): string | null {
    const p = this.loose(rel)
    if (fs.existsSync(p)) {
      const st = fs.statSync(p)
      return `loose-${st.size}-${Math.round(st.mtimeMs)}`
    }
    const hit = this.find(rel)
    return hit ? `${hit.archive.name.replace(/[\\/]/g, '_')}-${hit.entry.offset}-${hit.entry.size}` : null
  }

  read(rel: string): Buffer {
    const p = this.loose(rel)
    if (fs.existsSync(p)) return fs.readFileSync(p)
    const hit = this.find(rel)
    if (!hit) throw new Error(`${rel} isn’t in the game folder or its archives`)
    return readBdtEntry(hit.archive.fd, hit.entry)
  }

  /** File names (not paths) in one game folder matching a pattern: loose ones and archived ones. */
  list(relDir: string, pattern: RegExp): string[] {
    // Keyed lower-case: archive paths are lower-case, loose names may not be.
    const names = new Map<string, string>()
    const dir = this.loose(relDir)
    if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) if (pattern.test(n)) names.set(n.toLowerCase(), n)
    if (this.open().length) {
      const prefix =
        '/' +
        relDir
          .replace(/\\/g, '/')
          .replace(/^\/+|\/+$/g, '')
          .toLowerCase() +
        '/'
      for (const p of this.paths()) {
        if (!p.startsWith(prefix)) continue
        const name = p.slice(prefix.length)
        if (name.includes('/') || names.has(name) || !pattern.test(name)) continue
        if (this.find(p)) names.set(name, name)
      }
    }
    return [...names.values()].sort()
  }

  private paths(): string[] {
    if (this.dictionary) return this.dictionary
    const file = this.options.dictionaryFile
    this.dictionary =
      file && fs.existsSync(file)
        ? fs
            .readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .filter((l) => l.startsWith('/'))
        : []
    return this.dictionary
  }

  close(): void {
    for (const a of [...(this.archives ?? []), ...(this.soundArchives ?? [])]) {
      try {
        fs.closeSync(a.fd)
      } catch {
        /* already closed */
      }
    }
    this.archives = null
    this.soundArchives = null
  }
}
