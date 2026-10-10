/**
 * Effect (FXR) access across the game's sfxbnd bundles, through a Project.
 *
 * Bundles are read from the project if it has its own copy, else from the
 * game, and are written only back into the project. Effects are parsed with
 * @cccode/fxr; an effect is only re-serialised when it is edited, so
 * everything untouched keeps FromSoft's original bytes.
 *
 * Bundle layout (verified on commoneffects and _dlc02):
 *   effect\fNNNNNNNNN.fxr             the effect
 *   ResourceList\fNNNNNNNNN.ffxreslist  textures/models it needs, one per line
 *   tex\sNNNNN_<type>.tpf             textures
 *   model\sNNNNN.flver                models
 * Entry ids are banded by type (effects from 0, resource lists from 400000).
 *
 * Credit: @cccode/fxr (CCCode; Unlicense) reads and writes the effects.
 */
import crypto from 'node:crypto'
import { FXR, Game } from '@cccode/fxr'
import { dcxCompress, dcxDecompress, type DcxInfo } from '../formats/dcx.ts'
import { readBnd4, writeBnd4, type Bnd4, type Bnd4Entry } from '../formats/bnd4.ts'
import type { Project } from '../project/project.ts'
import { decodeDds, tpfFormatFor, writeTpf } from '../formats/textures.ts'
import { readFlver, textureBaseName } from '../formats/flver.ts'

const BACKSLASH = String.fromCharCode(92)
const ROOT = ['N:', 'GR', 'data', 'INTERROOT_win64', 'sfx'].join(BACKSLASH)

export const effectEntryPath = (id: number) => [ROOT, 'effect', `f${String(id).padStart(9, '0')}.fxr`].join(BACKSLASH)
export const resListEntryPath = (id: number) =>
  [ROOT, 'ResourceList', `f${String(id).padStart(9, '0')}.ffxreslist`].join(BACKSLASH)
export const textureEntryPath = (id: number, type: string) =>
  [ROOT, 'tex', `s${String(id).padStart(5, '0')}_${type}.tpf`].join(BACKSLASH)
export const modelEntryPath = (id: number) => [ROOT, 'model', `s${String(id).padStart(5, '0')}.flver`].join(BACKSLASH)
/** Animated effect models' skeleton and clips (RichModel/Model `anibnd`). */
export const anibndEntryPath = (id: number) => [ROOT, 'hkx', `s${String(id).padStart(5, '0')}.anibnd`].join(BACKSLASH)

/** The bundles bullets and most gameplay effects load from, in lookup order. */
export const COMMON_BUNDLES = [
  'sfx/sfxbnd_commoneffects.ffxbnd.dcx',
  'sfx/sfxbnd_commoneffects_dlc01.ffxbnd.dcx',
  'sfx/sfxbnd_commoneffects_dlc02.ffxbnd.dcx',
]

/** @cccode/fxr ignores a view's byteOffset, so always hand it its own buffer. */
function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer
}

export interface EffectBundle {
  rel: string
  source: 'project' | 'game'
  bnd: Bnd4
  dcx: DcxInfo
  dirty: boolean
  /** lower-cased entry name -> index into bnd.entries */
  byName: Map<string, number>
}

export interface EffectInfo {
  id: number
  bundle: string
  textures: { id: number; type: string }[]
  models: number[]
  childEffects: number[]
}

export class EffectLibrary {
  readonly project: Project
  readonly bundleRels: string[]
  private bundles = new Map<string, EffectBundle>()
  private parsed = new Map<number, FXR>()

  constructor(project: Project, bundleRels: string[] = COMMON_BUNDLES) {
    this.project = project
    this.bundleRels = bundleRels.filter((rel) => project.resolve(rel) !== null)
  }

  /* -------------------------------- bundles ------------------------------- */

  bundle(rel: string): EffectBundle {
    let b = this.bundles.get(rel)
    if (b) return b
    const { data, source } = this.project.read(rel)
    const { data: inner, info } = dcxDecompress(data)
    const bnd = readBnd4(inner)
    b = { rel, source, bnd, dcx: info, dirty: false, byName: new Map() }
    reindex(b)
    this.bundles.set(rel, b)
    return b
  }

  loadedBundles(): EffectBundle[] {
    return [...this.bundles.values()]
  }

  /** Which bundle holds an effect, searching in lookup order. */
  findEffect(id: number): EffectBundle | null {
    const name = effectEntryPath(id).toLowerCase()
    for (const rel of this.bundleRels) {
      const b = this.bundle(rel)
      if (b.byName.has(name)) return b
    }
    return null
  }

  hasEffect(id: number): boolean {
    return this.findEffect(id) !== null
  }

  /** Every effect id across the common bundles. */
  allEffectIds(): number[] {
    const ids = new Set<number>()
    for (const rel of this.bundleRels) {
      for (const e of this.bundle(rel).bnd.entries) {
        const m = /f(\d{9})\.fxr$/i.exec(e.name)
        if (m) ids.add(Number(m[1]))
      }
    }
    return [...ids].sort((a, b) => a - b)
  }

  /* -------------------------------- effects ------------------------------- */

  /** Parses an effect (cached). Edit the returned object, then `saveEffect`. */
  getEffect(id: number): FXR {
    const cached = this.parsed.get(id)
    if (cached) return cached
    const b = this.findEffect(id)
    if (!b) throw new Error(`Effect ${id} is not in ${this.bundleRels.join(', ')}`)
    const entry = b.bnd.entries[b.byName.get(effectEntryPath(id).toLowerCase())!]
    const fxr = FXR.read(toArrayBuffer(entry.data), Game.EldenRing)
    this.parsed.set(id, fxr)
    return fxr
  }

  info(id: number): EffectInfo {
    const fxr = this.getEffect(id)
    const res = fxr.getResources()
    return {
      id,
      bundle: this.findEffect(id)!.rel,
      textures: res.textures.map((t) => ({ id: t.resource, type: t.type })),
      models: res.models,
      childEffects: fxr.getReferences().sfx,
    }
  }

  /** Raw bytes of any entry (texture, model, ...) by in-archive path. */
  entryData(entryPath: string): Buffer | null {
    const name = entryPath.toLowerCase()
    for (const rel of this.bundleRels) {
      const b = this.bundle(rel)
      const i = b.byName.get(name)
      if (i !== undefined) return b.bnd.entries[i].data
    }
    return null
  }

  hasTexture(id: number, type: string): boolean {
    return this.entryData(textureEntryPath(id, type)) !== null
  }

  hasModel(id: number): boolean {
    return this.entryData(modelEntryPath(id)) !== null
  }

  /**
   * Writes an edited effect back into its bundle and refreshes its resource
   * list. Lines for resources the effect still uses are kept; new texture and
   * model lines are added. A model's own textures are borrowed from another
   * effect's resource list that already uses that model.
   */
  saveEffect(fxr: FXR, bundleRel?: string): void {
    const b = bundleRel ? this.bundle(bundleRel) : (this.findEffect(fxr.id) ?? this.bundle(this.bundleRels[0]))
    const data = Buffer.from(fxr.toArrayBuffer(Game.EldenRing))
    upsertEntry(b, effectEntryPath(fxr.id), data, 'fxr')

    const existing = this.readResList(fxr.id, b)
    upsertEntry(b, resListEntryPath(fxr.id), this.buildResList(fxr, existing), 'ffxreslist')

    this.parsed.set(fxr.id, fxr)
    b.dirty = true
  }

  /**
   * Copies an effect to a new id in the same bundle (so it loads wherever the
   * original did). Child effects are left pointing at the originals.
   */
  /** Called for every copy made (the session remembers what each copy is a copy of). */
  onClone?: (fromId: number, toId: number) => void

  cloneEffect(fromId: number, toId: number): FXR {
    if (this.hasEffect(toId)) throw new Error(`Effect ${toId} already exists`)
    if (toId < 1 || toId > 999_999_999) throw new Error(`Effect id ${toId} is out of range`)
    const source = this.findEffect(fromId)
    if (!source) throw new Error(`Effect ${fromId} not found`)
    const copy = this.getEffect(fromId).clone()
    copy.id = toId
    this.saveEffect(copy, source.rel)
    this.onClone?.(fromId, toId)
    return copy
  }

  /**
   * Adds a DDS texture to a bundle as tex/sNNNNN_<type>.tpf and returns its id.
   * The id is the first unused one at or above `preferredId` (90000 by
   * default, above every id the game uses), so imports never replace game
   * textures. Throws for formats Elden Ring's effects don't use.
   */
  importTexture(dds: Buffer, textureType: string, bundleRel?: string, preferredId = 90_000): number {
    if (dds.toString('ascii', 0, 4) !== 'DDS ') throw new Error('That file isn’t a DDS texture.')
    const format = tpfFormatFor(dds)
    decodeDds(dds, 16) // fails loudly on a truncated or broken file
    if (!/^[a-z0-9]+$/i.test(textureType)) throw new Error(`Bad texture type "${textureType}"`)

    let id = preferredId
    while (id <= 99_999 && this.hasTexture(id, textureType)) id++
    if (id > 99_999) throw new Error('No free texture ids left below 100000')

    const name = `s${String(id).padStart(5, '0')}_${textureType}`
    const tpf = writeTpf([{ name, format, dds }])
    const b = bundleRel ? this.bundle(bundleRel) : this.bundle(this.bundleRels[0])
    upsertEntry(b, textureEntryPath(id, textureType), tpf, 'tpf')
    b.dirty = true
    return id
  }

  /**
   * Adds a FLVER model as model/sNNNNN.flver (fresh id from `preferredId`),
   * plus any of its textures supplied as DDS files. A texture is matched to
   * the model by name: the file name (without extension) must equal the name
   * the model's material refers to, e.g. my_blade_a.dds for my_blade_a.tif.
   * Returns the new id and the textures the model still lacks.
   */
  importModel(
    flver: Buffer,
    textures: { fileName: string; dds: Buffer }[],
    bundleRel?: string,
    preferredId = 90_000,
  ): { id: number; textures: string[]; missing: string[] } {
    const model = readFlver(flver) // throws if it isn't a readable model
    if (!model.meshes.length) throw new Error('That model has no meshes Spellforge can read.')

    let id = preferredId
    while (id <= 99_999 && this.hasModel(id)) id++
    if (id > 99_999) throw new Error('No free model ids left below 100000')

    const b = bundleRel ? this.bundle(bundleRel) : this.bundle(this.bundleRels[0])
    const needed = new Set<string>()
    for (const m of model.meshes)
      for (const t of m.material.textures) {
        const base = textureBaseName(t.path)
        if (base) needed.add(base.toLowerCase())
      }

    const imported: string[] = []
    for (const t of textures) {
      const base = t.fileName.replace(/\.[^.]+$/, '')
      if (!needed.has(base.toLowerCase())) continue
      const tpf = writeTpf([{ name: base, format: tpfFormatFor(t.dds), dds: t.dds }])
      decodeDds(t.dds, 16)
      upsertEntry(b, [ROOT, 'tex', `${base}.tpf`].join(BACKSLASH), tpf, 'tpf')
      imported.push(base)
    }

    upsertEntry(b, modelEntryPath(id), flver, 'flver')
    b.dirty = true

    const missing = [...needed].filter(
      (n) =>
        !imported.some((i) => i.toLowerCase() === n) &&
        this.entryData([ROOT, 'tex', `${n}.tpf`].join(BACKSLASH)) === null,
    )
    return { id, textures: imported, missing }
  }

  /** First free effect id at or above `start`, across all common bundles. */
  freeEffectId(start: number): number {
    let id = start
    while (this.hasEffect(id)) id++
    return id
  }

  private readResList(id: number, b: EffectBundle): string[] {
    const i = b.byName.get(resListEntryPath(id).toLowerCase())
    if (i === undefined) return []
    return b.bnd.entries[i].data
      .toString('latin1')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
  }

  private buildResList(fxr: FXR, existing: string[]): Buffer {
    const res = fxr.getResources()
    const lines = new Set<string>()
    const wanted = new Set<string>()
    for (const t of res.textures) wanted.add(`s${String(t.resource).padStart(5, '0')}_${t.type}.tif`.toLowerCase())
    for (const m of res.models) wanted.add(`s${String(m).padStart(5, '0')}.sib`.toLowerCase())

    // A model's own textures (s88072_a.tif next to s88072.sib) belong too.
    for (const m of res.models)
      for (const t of this.modelTextureLines(String(m).padStart(5, '0'))) wanted.add(t.toLowerCase())

    // Keep existing lines (with their original casing) for what's still used,
    // then add anything new.
    for (const line of existing) if (wanted.has(line.toLowerCase())) lines.add(line)
    for (const w of wanted) if (![...lines].some((l) => l.toLowerCase() === w)) lines.add(w)
    return Buffer.from([...lines].join('\r\n') + '\r\n', 'latin1')
  }

  /**
   * Texture lines for a model: read from the model's own materials, falling
   * back to an existing resource list that already uses it.
   */
  private modelTextureLines(model5: string): string[] {
    const flver = this.entryData(modelEntryPath(Number(model5)))
    if (flver) {
      try {
        const names = new Set<string>()
        for (const m of readFlver(flver).meshes) {
          for (const t of m.material.textures) {
            const base = textureBaseName(t.path)
            if (base) names.add(`${base}.tif`)
          }
        }
        if (names.size) return [...names]
      } catch {
        /* fall back to existing lists */
      }
    }
    const sib = `s${model5}.sib`
    for (const rel of this.bundleRels) {
      const b = this.bundle(rel)
      for (const e of b.bnd.entries) {
        if (!e.name.toLowerCase().endsWith('.ffxreslist')) continue
        const text = e.data.toString('latin1')
        if (!text.toLowerCase().includes(sib)) continue
        return text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => new RegExp(`^s${model5}_[a-z0-9]+\\.tif$`, 'i').test(l))
      }
    }
    return []
  }

  /* ------------------------- effects from other bundles ------------------------ */

  /**
   * Copies an effect from another of the game's bundles (a character's own,
   * like Margit's sfxbnd_c2130, which the game loads only with him) into the
   * first common bundle, so a weapon, a bullet or a skill can use it: the
   * effect, its resource list, the effects it spawns, and the textures,
   * models and animations they need that the common bundles don't have. Ids
   * stay the same. Returns the effects and other files copied.
   */
  importFrom(src: Bnd4, id: number, toRel = this.bundleRels[0]): { effects: number[]; files: string[] } {
    const b = this.bundle(toRel)
    const byName = new Map(src.entries.map((e) => [e.name.toLowerCase(), e]))
    const out = { effects: [] as number[], files: [] as string[] }
    const todo = [id]
    const seen = new Set<number>()
    while (todo.length) {
      const fx = todo.pop()!
      if (seen.has(fx)) continue
      seen.add(fx)
      if (this.hasEffect(fx)) continue
      const entry = byName.get(effectEntryPath(fx).toLowerCase())
      if (!entry) continue
      upsertEntry(b, effectEntryPath(fx), Buffer.from(entry.data), 'fxr')
      const list = byName.get(resListEntryPath(fx).toLowerCase())
      if (list) upsertEntry(b, resListEntryPath(fx), Buffer.from(list.data), 'ffxreslist')
      out.effects.push(fx)
      let fxr: FXR
      try {
        fxr = FXR.read(toArrayBuffer(entry.data), Game.EldenRing)
      } catch {
        continue
      }
      for (const child of fxr.getReferences().sfx) if (child > 0) todo.push(child)
      const res = fxr.getResources()
      const files = [
        ...res.textures.map((t) => textureEntryPath(t.resource, t.type)),
        ...res.models.map((m) => modelEntryPath(m)),
        ...res.anibnds.map((a) => anibndEntryPath(a)),
      ]
      for (const f of files) {
        if (this.entryData(f)) continue
        const e = byName.get(f.toLowerCase())
        if (!e) continue
        upsertEntry(b, f, Buffer.from(e.data), entryKind(f.toLowerCase()))
        out.files.push(f.slice(f.lastIndexOf(BACKSLASH) + 1))
      }
    }
    if (out.effects.length) {
      b.dirty = true
      this.parsed.clear()
    }
    return out
  }

  /* ------------------------------ game updates ----------------------------- */

  /**
   * What a game update brings to the project's copy of a bundle, and (with
   * `apply`) brings it in. `game` is the installed game's copy; `base` the
   * entry hashes of the copy the project was made from, when kept.
   *   - entries the update added (in the game's copy, not in the project's
   *     and, when known, not in the old version's) are added;
   *   - entries the update changed that the project never touched (its copy
   *     still matches the old version's) take the game's data;
   *   - the project's own effects and edits stay. Without `base`, only new
   *     entries can be told apart.
   */
  mergeFromGame(
    rel: string,
    game: Bnd4,
    base: Map<string, string> | null,
    apply: boolean,
  ): { added: number; changed: number; conflicts: number } {
    const b = this.bundle(rel)
    const out = { added: 0, changed: 0, conflicts: 0 }
    if (b.source !== 'project' && !b.dirty) return out
    const sha = (d: Buffer) => crypto.createHash('sha1').update(d).digest('hex')
    // Counted in effects (.fxr); their textures, models and resource lists come along.
    const count = (name: string, k: 'added' | 'changed' | 'conflicts') => {
      if (name.endsWith('.fxr')) out[k]++
    }
    let moved = false
    for (const g of game.entries) {
      const name = g.name.toLowerCase()
      const at = b.byName.get(name)
      const was = base?.get(name)
      if (at === undefined) {
        // In the old version but not the project's: the project removed it.
        if (was !== undefined) continue
        count(name, 'added')
        moved = true
        if (apply) upsertEntry(b, g.name, Buffer.from(g.data), entryKind(name))
        continue
      }
      if (was === undefined) continue
      const mine = sha(b.bnd.entries[at].data)
      const theirs = sha(g.data)
      if (theirs === was || mine === theirs) continue
      if (mine !== was) {
        count(name, 'conflicts')
        continue
      }
      count(name, 'changed')
      moved = true
      if (apply) upsertEntry(b, g.name, Buffer.from(g.data), entryKind(name))
    }
    if (apply && moved) {
      b.dirty = true
      this.parsed.clear()
    }
    return out
  }

  /* --------------------------------- save --------------------------------- */

  /** Writes every edited bundle into the project folder. */
  saveToProject(): string[] {
    const written: string[] = []
    for (const b of this.bundles.values()) {
      if (!b.dirty) continue
      // Kraken level 4 packs the 357 MB common bundle in ~2 s with about the
      // same size as retail's level 6, which takes ~5 minutes. Any level
      // decompresses identically, so the game doesn't care.
      const dcx = b.dcx.format === 'KRAK' ? { format: 'KRAK' as const, level: 4 } : b.dcx
      const packed = dcxCompress(writeBnd4(b.bnd), dcx)
      written.push(this.project.writeProjectFile(b.rel, packed))
      b.dirty = false
      b.source = 'project'
    }
    return written
  }
}

/* -------------------------------- helpers -------------------------------- */

function reindex(b: EffectBundle): void {
  b.byName.clear()
  b.bnd.entries.forEach((e, i) => b.byName.set(e.name.toLowerCase(), i))
}

// Verified on retail commoneffects: .fxr 0.., .tpf 100000.., .flver 200000..,
// .anibnd 300000.., .ffxreslist 400000..
const ID_BAND_BY_KIND: Record<string, number> = {
  fxr: 0,
  tpf: 100_000,
  flver: 200_000,
  anibnd: 300_000,
  ffxreslist: 400_000,
}

function entryKind(name: string): 'fxr' | 'ffxreslist' | 'tpf' | 'flver' | 'anibnd' {
  const ext = name.slice(name.lastIndexOf('.') + 1)
  return ext === 'ffxreslist' || ext === 'tpf' || ext === 'flver' || ext === 'anibnd' ? ext : 'fxr'
}

/**
 * Replaces an entry's data, or adds a new entry right after the last entry of
 * the same kind with the next id in that kind's band.
 */
function upsertEntry(
  b: EffectBundle,
  name: string,
  data: Buffer,
  kind: 'fxr' | 'ffxreslist' | 'tpf' | 'flver' | 'anibnd',
): void {
  const existing = b.byName.get(name.toLowerCase())
  if (existing !== undefined) {
    const entry = b.bnd.entries[existing]
    entry.data = data
    entry.sourceOffset = undefined
    return
  }

  const suffix = '.' + kind
  let lastIndex = -1
  let maxId = ID_BAND_BY_KIND[kind] - 1
  b.bnd.entries.forEach((e, i) => {
    if (!e.name.toLowerCase().endsWith(suffix)) return
    lastIndex = i
    maxId = Math.max(maxId, e.id)
  })
  const template: Bnd4Entry | undefined = b.bnd.entries[lastIndex]
  const entry: Bnd4Entry = { id: maxId + 1, name, flags: template?.flags ?? 0x40, data }
  b.bnd.entries.splice(lastIndex + 1, 0, entry)

  // Ids after the insertion point must stay unique; later bands start higher,
  // so only collisions within this band can occur, and maxId + 1 avoids them.
  for (const e of b.bnd.entries) e.sourceOffset = undefined
  reindex(b)
}
