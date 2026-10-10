/**
 * Unsaved changes survive a crash or a close. Every change made through the
 * app (the IPC calls that edit the project: fields, rows, effects, text,
 * animations, skills and spells made from enemies, scaling…) is appended to
 * a journal as it's made, in Spellforge's settings folder (recovery/), never
 * in the mod folder. Saving empties it. Reopening a project that has one
 * offers to replay it: the same calls on the same files give back exactly
 * the same values, still unsaved, ready to save. If the project's files or
 * the game changed in between, that's said first.
 *
 * One folder per project (by its mod folder's path): journal.jsonl, a header
 * line then one line per change, each written and flushed to disk before the
 * call returns; requests too big for a line (imported textures and models)
 * in files of their own beside it. A line cut short by a crash is skipped.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export interface JournalHeader {
  v: 1
  modDir: string
  started: number
  /** The project's own files when the first change was made (fingerprint). */
  files: string
  /** The game's regulation version then. */
  game: string
}

export interface JournalEntry {
  t: number
  channel: string
  req: unknown
}

/** Requests above this go in a file of their own. */
const BLOB_LIMIT = 256 * 1024
/** The project folders whose files a change builds on. */
const PROJECT_PARTS = ['regulation.bin', 'sfx', 'msg', 'chr', 'sd', '.spellforge']

export class Recovery {
  private root: string

  constructor(userData: string) {
    this.root = path.join(userData, 'recovery')
  }

  private dirOf(modDir: string): string {
    return path.join(
      this.root,
      crypto.createHash('sha1').update(path.resolve(modDir).toLowerCase()).digest('hex').slice(0, 16),
    )
  }

  /** Records a change, starting the project's journal (with its header) if it's the first since a save. */
  record(modDir: string, game: string, channel: string, req: unknown): void {
    const dir = this.dirOf(modDir)
    const file = path.join(dir, 'journal.jsonl')
    fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(file)) {
      const header: JournalHeader = {
        v: 1,
        modDir: path.resolve(modDir),
        started: Date.now(),
        files: projectFingerprint(modDir),
        game,
      }
      appendLine(file, header)
    }
    const text = JSON.stringify(req ?? null)
    if (text.length > BLOB_LIMIT) {
      const blob = `blob-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`
      writeSynced(path.join(dir, blob), text)
      appendLine(file, { t: Date.now(), channel, blob })
    } else appendLine(file, { t: Date.now(), channel, req: req ?? null })
  }

  /** A project's journal: its header and changes (null if it has none). */
  read(modDir: string): { header: JournalHeader; entries: JournalEntry[] } | null {
    const dir = this.dirOf(modDir)
    const file = path.join(dir, 'journal.jsonl')
    if (!fs.existsSync(file)) return null
    let header: JournalHeader | null = null
    const entries: JournalEntry[] = []
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line)
      } catch {
        continue // cut short by a crash
      }
      if (!header) {
        if (obj.v === 1) header = obj as unknown as JournalHeader
        continue
      }
      if (typeof obj.channel !== 'string') continue
      let req = obj.req
      if (typeof obj.blob === 'string') {
        try {
          req = JSON.parse(fs.readFileSync(path.join(dir, path.basename(obj.blob)), 'utf8'))
        } catch {
          continue
        }
      }
      entries.push({ t: Number(obj.t) || 0, channel: obj.channel, req })
    }
    return header && entries.length ? { header, entries } : null
  }

  /** Saved, or dropped on purpose: the journal goes. */
  clear(modDir: string): void {
    fs.rmSync(this.dirOf(modDir), { recursive: true, force: true })
  }

  /** Every project with unsaved changes kept: its folder, how many, when. */
  pending(): { modDir: string; changes: number; started: number; last: number }[] {
    if (!fs.existsSync(this.root)) return []
    const out: { modDir: string; changes: number; started: number; last: number }[] = []
    for (const name of fs.readdirSync(this.root)) {
      const file = path.join(this.root, name, 'journal.jsonl')
      if (!fs.existsSync(file)) continue
      const lines = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
      let header: JournalHeader | null
      try {
        header = JSON.parse(lines[0])
      } catch {
        continue
      }
      if (!header || header.v !== 1) continue
      let last = header.started
      let changes = 0
      for (const l of lines.slice(1)) {
        try {
          last = Math.max(last, Number(JSON.parse(l).t) || 0)
          changes++
        } catch {
          /* cut short */
        }
      }
      if (changes) out.push({ modDir: header.modDir, changes, started: header.started, last })
    }
    return out.sort((a, b) => b.last - a.last)
  }
}

/** Sizes and dates of the project's own files (what changes build on), as one hash. */
export function projectFingerprint(modDir: string): string {
  const h = crypto.createHash('sha1')
  const walk = (rel: string) => {
    const abs = path.join(modDir, rel)
    let st: fs.Stats
    try {
      st = fs.statSync(abs)
    } catch {
      return
    }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(rel, name))
    } else h.update(`${rel.replace(/\\/g, '/').toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}\n`)
  }
  for (const part of PROJECT_PARTS) walk(part)
  return h.digest('hex').slice(0, 16)
}

function appendLine(file: string, obj: unknown): void {
  const fd = fs.openSync(file, 'a')
  try {
    fs.writeSync(fd, JSON.stringify(obj) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}

function writeSynced(file: string, text: string): void {
  const fd = fs.openSync(file, 'w')
  try {
    fs.writeSync(fd, text)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
}
