/**
 * Copies of the game's own regulation, text and player animations, one set
 * per game version Spellforge has seen. A project keeps the files of the game
 * version it was made with; after a game update its rows and animations differ
 * from the new game in every place FromSoftware changed, although the modder
 * changed none of them. Comparing the project against the vanilla files of its
 * own version tells the modder's edits apart from the update's.
 *
 *   <store>/<regulation version>/regulation.bin
 *   <store>/<regulation version>/msg/<lang>/item_dlc02.msgbnd.dcx  (...)
 *   <store>/<regulation version>/chr/c0000.anibnd.dcx
 *   <store>/<regulation version>/sfx/<bundle>.json   (sha1 of each entry, by name)
 *
 * Effect bundles are too big to copy, so a version keeps the hash of each
 * entry of the bundles a project has used: enough to tell which effects the
 * project changed, and which ones a later update changed.
 *
 * Snapshots are taken whenever a game folder is used (the installed game,
 * or an unpacked copy), so the version a project was built on is usually
 * already there when the game updates. They never leave the user's machine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { readRegulation } from '../formats/regulation.ts'
import { parseRegulationVersion } from '../params/paramDef.ts'
import { writeFileAtomic } from './files.ts'
import { CONTAINERS, LANGUAGES } from './textEdit.ts'

export interface GameFileSource {
  has(rel: string): boolean
  read(rel: string): Buffer
}

/** The regulation version number (e.g. 11611000) of a regulation.bin. */
function regulationVersion(regulation: Buffer): number {
  return parseRegulationVersion(readRegulation(regulation).bnd.version)
}

/** 11611000 -> "1.16.1" (the game's own numbering, as the title screen shows it). */
export function gameVersionLabel(version: number): string {
  const s = String(version)
  if (!/^\d{8}$/.test(s)) return String(version)
  return `${s[0]}.${Number(s.slice(1, 3))}.${s[3]}`
}

/** The player's animations (every TAE), compared to tell which animations a project changed. */
export const SNAPSHOT_ANIBND = 'chr/c0000.anibnd.dcx'

/** The files a snapshot holds: the regulation, the text binders the game reads, the player's animations. */
function snapshotFiles(game: GameFileSource): string[] {
  const out = ['regulation.bin']
  for (const l of LANGUAGES) {
    for (const c of CONTAINERS) {
      const file = c.files.find((f) => game.has(`msg/${l.code}/${f}`))
      if (file) out.push(`msg/${l.code}/${file}`)
    }
  }
  if (game.has(SNAPSHOT_ANIBND)) out.push(SNAPSHOT_ANIBND)
  return out
}

export class VanillaStore {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /** Versions with a complete snapshot, newest first. */
  versions(): number[] {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter((n) => /^\d+$/.test(n) && fs.existsSync(path.join(this.dir, n, 'regulation.bin')))
      .map(Number)
      .sort((a, b) => b - a)
  }

  has(version: number): boolean {
    return fs.existsSync(path.join(this.dir, String(version), 'regulation.bin'))
  }

  /** A file of one version's snapshot, or null if it wasn't kept. */
  read(version: number, rel: string): Buffer | null {
    const p = path.join(this.dir, String(version), ...rel.split(/[\\/]/))
    return fs.existsSync(p) ? fs.readFileSync(p) : null
  }

  /**
   * Keeps a copy of a game folder's regulation, text and animations under its
   * version. Returns the version, and whether anything new was written. A new
   * snapshot is written to a temporary folder and renamed, so it is never half
   * there; files an existing snapshot lacks (it was kept before Spellforge
   * kept them) are added one by one, the same way.
   */
  snapshot(game: GameFileSource): { version: number; added: boolean } {
    const regulation = game.read('regulation.bin')
    const version = regulationVersion(regulation)
    if (!version) return { version, added: false }
    if (this.has(version)) return { version, added: this.complete(version, game) }
    const final = path.join(this.dir, String(version))
    const tmp = `${final}.partial-${process.pid}`
    fs.rmSync(tmp, { recursive: true, force: true })
    try {
      fs.mkdirSync(tmp, { recursive: true })
      fs.writeFileSync(path.join(tmp, 'regulation.bin'), regulation)
      for (const rel of snapshotFiles(game)) {
        if (rel === 'regulation.bin') continue
        const target = path.join(tmp, ...rel.split('/'))
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, game.read(rel))
      }
      fs.rmSync(final, { recursive: true, force: true })
      fs.renameSync(tmp, final)
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true })
      throw e
    }
    return { version, added: true }
  }

  /** The hashes (sha1 by lower-case entry name) of a version's effect bundle, if kept. */
  effectIndex(version: number, rel: string): Map<string, string> | null {
    const p = path.join(this.dir, String(version), 'sfx', `${path.basename(rel)}.json`)
    try {
      return new Map(Object.entries(JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, string>))
    } catch {
      return null
    }
  }

  /** Keeps a version's effect bundle hashes (once; a version's files never change). */
  keepEffectIndex(version: number, rel: string, hashes: Map<string, string>): void {
    if (!version || !this.has(version)) return
    const p = path.join(this.dir, String(version), 'sfx', `${path.basename(rel)}.json`)
    if (fs.existsSync(p)) return
    try {
      writeFileAtomic(p, JSON.stringify(Object.fromEntries(hashes)))
    } catch {
      /* only a convenience for later updates */
    }
  }

  /** Which of a version's bundles holds each effect outside the common ones (id -> bundle), if kept. */
  effectLocations(version: number): Map<number, string> | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(this.dir, String(version), 'sfx', 'locations.json'), 'utf8'),
      ) as Record<string, string>
      return new Map(Object.entries(raw).map(([id, rel]) => [Number(id), rel]))
    } catch {
      return null
    }
  }

  keepEffectLocations(version: number, locations: Map<number, string>): void {
    if (!version || !this.has(version)) return
    const p = path.join(this.dir, String(version), 'sfx', 'locations.json')
    try {
      writeFileAtomic(p, JSON.stringify(Object.fromEntries(locations)))
    } catch {
      /* rebuilt next time */
    }
  }

  /** Adds the files an existing snapshot lacks, from a game folder of the same version. */
  private complete(version: number, game: GameFileSource): boolean {
    let added = false
    for (const rel of snapshotFiles(game)) {
      const target = path.join(this.dir, String(version), ...rel.split('/'))
      if (fs.existsSync(target)) continue
      try {
        writeFileAtomic(target, game.read(rel))
        added = true
      } catch {
        /* tried again by the next snapshot */
      }
    }
    return added
  }
}
