/**
 * The open project's game text (FMG files in msgbnd binders): its languages and files, their
 * entries against the game's, editing and searching them.
 */
import { CONTAINERS, LANGUAGES, textFileInfo } from '../../core/project/textEdit.ts'
import { gameVersionLabel } from '../../core/project/vanilla.ts'
import { readFmg, writeFmg, type FmgEntries } from '../../core/formats/fmg.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { nameTableFor, type OpenMsgBnd } from '../../core/project/text.ts'
import type * as A from '../../shared/api.ts'
import type { Session } from '../session.ts'

export class TextService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  /** Parsed text binders that haven't been edited (edited ones live in o.msgs). */
  msgCache = new Map<string, OpenMsgBnd>()

  /** A text binder: the edited copy, else the project's, else the game's. */
  private openMsg(rel: string): OpenMsgBnd {
    const o = this.session.requireOpen()
    const edited = o.msgs.get(rel)
    if (edited) return edited
    let msg = this.msgCache.get(rel)
    if (!msg) {
      const raw = dcxDecompress(o.project.read(rel).data)
      msg = { rel, bnd: readBnd4(raw.data), dcx: raw.info }
      this.msgCache.set(rel, msg)
    }
    return msg
  }

  textLanguages(): A.TextLanguageView[] {
    const o = this.session.requireOpen()
    return LANGUAGES.filter((l) => CONTAINERS.some((c) => c.files.some((f) => o.project.resolve(`msg/${l.code}/${f}`))))
  }

  /** The binders the game reads for a language: the newest of each kind it has. */
  textBinders(lang: string): { kind: 'item' | 'menu'; rel: string }[] {
    const o = this.session.requireOpen()
    if (!/^[a-z]{4,5}$/.test(lang)) throw new Error(`Unknown language ${lang}`)
    const out: { kind: 'item' | 'menu'; rel: string }[] = []
    for (const c of CONTAINERS) {
      const file = c.files.find((f) => o.project.resolve(`msg/${lang}/${f}`))
      if (file) out.push({ kind: c.kind, rel: `msg/${lang}/${file}` })
    }
    return out
  }

  /**
   * The vanilla text a binder is compared with, table by table: of the game
   * versions Spellforge has (the installed game and kept snapshots), the one
   * the project's copy is closest to, i.e. the version it was made with. The
   * installed game's text comes along, for what an update changed since.
   */
  textBases = new Map<string, TextBase>()

  private textBase(rel: string): TextBase {
    const cached = this.textBases.get(rel)
    if (cached) return cached
    const o = this.session.requireOpen()
    const parse = (buf: Buffer | null): Map<string, FmgEntries> | null => {
      if (!buf) return null
      try {
        const m = new Map<string, FmgEntries>()
        for (const e of readBnd4(dcxDecompress(buf).data).entries)
          if (/\.fmg$/i.test(e.name)) m.set(textFileInfo(e.name).file, readFmg(e.data))
        return m
      } catch {
        return null
      }
    }
    let game: Map<string, FmgEntries> | null = null
    try {
      game = parse(o.project.readGame(rel))
    } catch {
      /* the game has no such binder: everything in it is the project's */
    }
    const gameVersion = o.gameDb.version
    let best: TextBase = {
      version: gameVersion,
      label: gameVersionLabel(gameVersion),
      tables: game ?? new Map(),
      game: game ?? new Map(),
      installed: true,
    }
    const own = o.project.resolve(rel)?.source === 'project'
    if (own && game) {
      const mine = this.openMsg(rel)
      const score = (tables: Map<string, FmgEntries>) => {
        let n = 0
        for (const e of mine.bnd.entries) {
          if (!/\.fmg$/i.test(e.name)) continue
          const t = tables.get(textFileInfo(e.name).file)
          if (!t) continue
          const m = readFmg(e.data)
          for (const [id, text] of m) if ((t.get(id) ?? null) !== text) n++
          for (const id of t.keys()) if (!m.has(id)) n++
        }
        return n
      }
      let bestScore = score(game)
      for (const v of this.session.vanilla
        .versions()
        .filter((v) => v !== gameVersion)
        .slice(0, 4)) {
        if (bestScore === 0) break
        const tables = parse(this.session.vanilla.read(v, rel))
        if (!tables) continue
        const sc = score(tables)
        if (sc < bestScore) {
          bestScore = sc
          best = { version: v, label: gameVersionLabel(v), tables, game, installed: false }
        }
      }
    }
    this.textBases.set(rel, best)
    return best
  }

  /**
   * Each entry of a project's table against its vanilla text: added,
   * changed or removed by the modder; or outdated, where the installed game
   * has newer text (or a newer entry) the project's copy doesn't.
   */
  private classifyTable(
    rel: string,
    file: string,
    mine: FmgEntries,
  ): Map<number, { state: A.TextEntryState; original: string | null }> {
    const out = new Map<number, { state: A.TextEntryState; original: string | null }>()
    const o = this.session.requireOpen()
    if (o.project.resolve(rel)?.source !== 'project' && !o.msgs.has(rel)) return out
    const b = this.textBase(rel)
    const base = b.tables.get(file)
    const game = b.game.get(file)
    if (!base) {
      for (const [id, text] of mine) if (text !== null) out.set(id, { state: 'added', original: null })
      return out
    }
    for (const [id, text] of mine) {
      // Text the installed game has too is nobody's edit (e.g. brought in by "Update from game").
      if (game?.has(id) && (game.get(id) ?? '') === (text ?? '')) continue
      const was = base.has(id) ? (base.get(id) ?? null) : game?.has(id) ? (game.get(id) ?? null) : undefined
      if (was === undefined) {
        if (text !== null) out.set(id, { state: 'added', original: null })
      } else if ((was ?? '') !== (text ?? '')) out.set(id, { state: 'changed', original: was })
      else if (game && game.has(id)) out.set(id, { state: 'outdated', original: game.get(id) ?? null })
    }
    for (const [id, was] of base) {
      if (mine.has(id) || was === null) continue
      // Gone from the project's copy: the modder removed it, unless this is
      // the installed game itself (then it may simply be newer than the copy).
      if (!b.installed) out.set(id, { state: 'removed', original: was })
    }
    if (game) {
      for (const [id, text] of game) {
        if (mine.has(id) || text === null || out.has(id)) continue
        if (!base.has(id) || b.installed) out.set(id, { state: 'outdated', original: text })
      }
    }
    return out
  }

  textFiles(lang: string): A.TextFileView[] {
    const o = this.session.requireOpen()
    const out: A.TextFileView[] = []
    for (const { kind, rel } of this.textBinders(lang)) {
      const msg = this.openMsg(rel)
      const ownCopy = o.msgs.has(rel) || o.project.resolve(rel)?.source === 'project'
      const base = ownCopy ? this.textBase(rel) : null
      for (const e of msg.bnd.entries) {
        if (!/\.fmg$/i.test(e.name)) continue
        const info = textFileInfo(e.name)
        let fmg: FmgEntries
        try {
          fmg = readFmg(e.data)
        } catch {
          continue
        }
        const count = [...fmg.values()].filter((t) => t !== null).length
        // Edited means changed by the modder: compared with the vanilla text
        // of the version the copy was made with, not with a newer game's.
        let edited = 0
        let outdated = 0
        if (ownCopy) {
          for (const c of this.classifyTable(rel, info.file, fmg).values()) {
            if (c.state === 'outdated') outdated++
            else edited++
          }
        }
        out.push({
          rel,
          container: kind,
          file: info.file,
          title: info.title,
          group: info.group,
          param: info.param,
          count,
          ownCopy,
          edited,
          outdated,
          base: base ? { version: base.label, installed: base.installed } : undefined,
        })
      }
    }
    return out
  }

  /**
   * Brings the installed game's newer text into the project's copy: entries
   * the game added since, and newer text for entries the modder didn't edit.
   * The modder's own entries stay as they are. One table, or every table.
   */
  textUpdateFromGame(rel: string, file: string | null): { updated: number } {
    const o = this.session.requireOpen()
    const msg = this.openMsg(rel)
    let updated = 0
    for (const e of msg.bnd.entries) {
      if (!/\.fmg$/i.test(e.name)) continue
      const info = textFileInfo(e.name)
      if (file !== null && info.file !== file) continue
      const fmg = readFmg(e.data)
      let n = 0
      for (const [id, c] of this.classifyTable(rel, info.file, fmg)) {
        if (c.state !== 'outdated') continue
        fmg.set(id, c.original)
        n++
      }
      if (!n) continue
      e.data = writeFmg(fmg)
      e.sourceOffset = undefined
      updated += n
    }
    if (updated) {
      o.msgs.set(rel, msg)
      this.msgCache.delete(rel)
    }
    return { updated }
  }

  private fmgEntry(rel: string, file: string) {
    const msg = this.openMsg(rel)
    const entry = msg.bnd.entries.find((e) => textFileInfo(e.name).file === file)
    if (!entry) throw new Error(`${file} isn’t in ${rel}`)
    return { msg, entry }
  }

  textEntries(
    rel: string,
    file: string,
    query: string,
    limit: number,
    filter: A.TextEntryFilter = 'all',
  ): { entries: A.TextEntryView[]; total: number } {
    const o = this.session.requireOpen()
    const { entry } = this.fmgEntry(rel, file)
    const param = textFileInfo(entry.name).param
    const fmg = readFmg(entry.data)
    const states = this.classifyTable(rel, file, fmg)
    const q = query.trim().toLowerCase()
    // Entries the project's copy lacks (removed, or newer in the game) are
    // listed under the filters that are about them.
    let rows: [number, string | null][] =
      filter === 'all'
        ? [...fmg]
        : [...states]
            .filter(([, c]) => (filter === 'edited' ? c.state !== 'outdated' : c.state === 'outdated'))
            .map(([id]) => [id, fmg.has(id) ? (fmg.get(id) ?? null) : null])
    if (filter !== 'all') rows.sort((a, b) => a[0] - b[0])
    rows = rows.filter(
      ([id, text]) =>
        !q || String(id).includes(q) || (text ?? states.get(id)?.original ?? '').toLowerCase().includes(q),
    )
    const entries = rows.slice(0, Math.max(1, limit)).map(([id, text]) => {
      const c = states.get(id)
      return {
        id,
        text,
        rowName: param && o.db.hasRow(param, id) ? o.db.rowName(param, id) : undefined,
        state: c?.state,
        original: c ? c.original : undefined,
      }
    })
    return { entries, total: rows.length }
  }

  /** Sets (or deletes, with null) one entry; the binder is written on save. */
  setText(rel: string, file: string, id: number, text: string | null): A.TextEntryView {
    const o = this.session.requireOpen()
    if (!Number.isInteger(id) || id < 0) throw new Error(`${id} is not a valid text id`)
    const { msg, entry } = this.fmgEntry(rel, file)
    const fmg = readFmg(entry.data)
    if (text === null) fmg.delete(id)
    else fmg.set(id, text)
    entry.data = writeFmg(fmg)
    entry.sourceOffset = undefined
    o.msgs.set(rel, msg)
    this.msgCache.delete(rel)
    // Names shown elsewhere in the app follow edits to name tables.
    const info = textFileInfo(entry.name)
    if (info.param && nameTableFor(info.param) === info.table && rel.includes('/engus/') && text && text.trim())
      this.session.params.gameNameChanged(info.param, id, text.trim())
    return { id, text, rowName: info.param && o.db.hasRow(info.param, id) ? o.db.rowName(info.param, id) : undefined }
  }

  textSearch(lang: string, query: string, limit: number): A.TextSearchHit[] {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: A.TextSearchHit[] = []
    for (const { rel } of this.textBinders(lang)) {
      for (const e of this.openMsg(rel).bnd.entries) {
        if (!/\.fmg$/i.test(e.name)) continue
        const info = textFileInfo(e.name)
        let fmg
        try {
          fmg = readFmg(e.data)
        } catch {
          continue
        }
        for (const [id, text] of fmg) {
          if (!text) continue
          if (String(id) === q || text.toLowerCase().includes(q)) {
            out.push({ rel, file: info.file, title: info.title, id, text })
            if (out.length >= limit) return out
          }
        }
      }
    }
    return out
  }
}

/** The vanilla text a project's binder is compared with (see Session.textBase). */
interface TextBase {
  version: number
  label: string
  /** Table file name -> entries, of that version. */
  tables: Map<string, FmgEntries>
  /** The installed game's tables. */
  game: Map<string, FmgEntries>
  /** The base is the installed game itself (no older version fits better). */
  installed: boolean
}
