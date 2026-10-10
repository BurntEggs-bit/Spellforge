/**
 * Bringing a project made with an older game version up to the installed game's: what the
 * update changed that the project doesn't have yet (params, text, animations, effects, sounds),
 * and applying the parts chosen, keeping the project's own work.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ParamDatabase } from '../../core/params/paramDb.ts'
import { gameVersionLabel, SNAPSHOT_ANIBND } from '../../core/project/vanilla.ts'
import { mergeParams } from '../../core/params/upgrade.ts'
import { readBnd4, type Bnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import type * as A from '../../shared/api.ts'
import type { Session } from '../session.ts'

export class GameUpdateService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  /** The project's own files this can't merge with a newer game's (shown so nothing is a surprise). */
  private untouchedFiles(): string[] {
    const o = this.session.requireOpen()
    const motions = new Set(Object.keys(o.anims.recordedMotions()))
    const banks = new Set(o.sounds.recordedBanks())
    const handled = (rel: string) =>
      rel === 'regulation.bin' ||
      /^msg\//.test(rel) ||
      o.lib.bundleRels.includes(rel) ||
      rel === 'chr/c0000.anibnd.dcx' ||
      // A behaviour script made from the game's own is made again from the new game's.
      (rel === 'action/script/c0000.hks' && o.behaviour.followsGame()) ||
      motions.has(rel) ||
      banks.has(rel) ||
      /^\.spellforge/.test(rel) ||
      /\.(bak|prev|dsasbak|dsaproj|json)$/i.test(rel)
    const out: string[] = []
    const walk = (dir: string, rel: string) => {
      let names: fs.Dirent[]
      try {
        names = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const d of names) {
        if (d.name.startsWith('.')) continue
        const r = rel ? `${rel}/${d.name}` : d.name
        if (d.isDirectory()) walk(path.join(dir, d.name), r)
        else if (!handled(r) && /\.(dcx|bin|hks|lua|bnd|bnk)$/i.test(d.name)) out.push(r)
      }
    }
    walk(o.project.config.modDir, '')
    return out.sort()
  }

  /** What updating the project to the installed game's version would bring; null when it already matches. */
  updatePlan(): A.GameUpdatePlan | null {
    const o = this.session.requireOpen()
    if (!o.db.version || !o.gameDb.version || o.db.version === o.gameDb.version) return null
    const known = o.base !== o.gameDb
    let params: A.GameUpdatePlan['params'] = null
    if (known) {
      const merged = ParamDatabase.load(o.project.readGame('regulation.bin'), { root: this.session.dataRoot() })
      const r = mergeParams(o.db, o.base, merged)
      params = {
        added: r.added,
        changed: r.changed,
        removed: r.removed,
        conflicts: r.conflicts,
        fromUpdate: r.fromUpdate,
        conflictExamples: r.conflictExamples,
      }
    }
    let files = 0
    let entries = 0
    for (const lang of this.session.text.textLanguages()) {
      for (const f of this.session.text.textFiles(lang.code)) {
        if (!f.ownCopy || !f.outdated) continue
        files++
        entries += f.outdated
      }
    }
    let effects = null as A.GameUpdatePlan['effects']
    for (const rel of o.lib.bundleRels) {
      const b = o.lib.bundle(rel)
      if (b.source !== 'project' && !b.dirty) continue
      const base = this.session.vanilla.effectIndex(o.db.version, rel)
      const r = o.lib.mergeFromGame(rel, this.gameBundle(rel), base, false)
      effects = {
        added: (effects?.added ?? 0) + r.added,
        changed: (effects?.changed ?? 0) + r.changed,
        conflicts: (effects?.conflicts ?? 0) + r.conflicts,
        known: (effects?.known ?? true) && !!base,
      }
    }
    const a = o.anims.mergeFromGame(false)
    const m = o.anims.mergeMotionsFromGame(false)
    const snd = o.sounds.mergeFromGame(false)
    const animations =
      a.added || a.changed || a.conflicts || a.categories || m.files || snd.events
        ? {
            ...a,
            motionFiles: m.files,
            soundEvents: snd.events,
            known: !!this.session.vanilla.read(o.db.version, SNAPSHOT_ANIBND),
          }
        : null
    const d = this.session.dirty()
    return {
      from: gameVersionLabel(o.db.version),
      to: gameVersionLabel(o.gameDb.version),
      known,
      params,
      text: files ? { files, entries } : null,
      effects,
      animations,
      untouched: this.untouchedFiles(),
      unsaved: d.regulation || d.bundles.length > 0,
    }
  }

  /** The installed game's copy of an effect bundle (kept while an update is planned and applied). */
  gameBundles = new Map<string, Bnd4>()

  private gameBundle(rel: string): Bnd4 {
    let b = this.gameBundles.get(rel)
    if (!b)
      this.gameBundles.set(rel, (b = readBnd4(dcxDecompress(this.session.requireOpen().project.readGame(rel)).data)))
    return b
  }

  /**
   * Brings the chosen parts of the project up to the installed game's
   * version (see updatePlan), saves everything (the files it replaces are
   * backed up as usual) and reopens the project from the saved files.
   */
  updateFromGame(req: A.GameUpdateRequest): A.GameUpdateResult {
    const o = this.session.requireOpen()
    if (!o.db.version || o.db.version === o.gameDb.version)
      throw new Error('The project already matches the installed game')
    const known = o.base !== o.gameDb
    // Params first: the merged regulation includes unsaved edits, so the old one isn't written.
    let regulation: Buffer | null = null
    if (req.params) {
      if (!known)
        throw new Error(
          `Spellforge doesn't have the files of game version ${gameVersionLabel(o.db.version)}, so it can't tell your param changes from the update's`,
        )
      const merged = ParamDatabase.load(o.project.readGame('regulation.bin'), { root: this.session.dataRoot() })
      mergeParams(o.db, o.base, merged)
      regulation = merged.toRegulation()
      for (const p of o.db.params.values()) p.dirty = false
    }
    if (req.text) {
      for (const lang of this.session.text.textLanguages()) {
        for (const { rel } of this.session.text.textBinders(lang.code)) {
          if (o.project.resolve(rel)?.source === 'project' || o.msgs.has(rel))
            this.session.text.textUpdateFromGame(rel, null)
        }
      }
    }
    if (req.effects) {
      for (const rel of o.lib.bundleRels) {
        const b = o.lib.bundle(rel)
        if (b.source !== 'project' && !b.dirty) continue
        o.lib.mergeFromGame(rel, this.gameBundle(rel), this.session.vanilla.effectIndex(o.db.version, rel), true)
      }
    }
    this.gameBundles.clear()
    if (req.animations) {
      o.anims.mergeFromGame(true)
      o.anims.mergeMotionsFromGame(true)
      o.sounds.mergeFromGame(true)
      // A behaviour script made from the game's own: the new game's, with the same recipes.
      o.behaviour.updateFromGame()
    }
    const saved = this.session.save()
    const written = [...saved.written]
    if (regulation) written.push(o.project.writeProjectFile('regulation.bin', regulation))
    const summary = this.session.openProject(o.project.config.modDir)
    return { summary, written, backupsFolder: saved.backupsFolder }
  }
}
