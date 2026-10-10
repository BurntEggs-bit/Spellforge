/**
 * The open project's effects (FXR): their node tree and details, recolouring and resources,
 * field edits, the live preview, who uses each, and effects that live outside the common
 * bundles (a character's or a map's own).
 */
import crypto from 'node:crypto'
import { Recolor, type FXR } from '@cccode/fxr'
import { getField } from '../../core/params/param.ts'
import {
  EffectLibrary,
  textureEntryPath,
  effectEntryPath,
  COMMON_BUNDLES,
  type EffectBundle,
} from '../../core/effects/effects.ts'
import { describeParts, applyFieldEdits } from '../../core/effects/fxEdit.ts'
import {
  ACTION_SPECS,
  actionsOf,
  allActions,
  childNodes,
  constantOf,
  flatNodes,
  isFields,
  keyframesOf,
  proxyTarget,
} from '../../core/effects/fxrFields.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { buildPreviewSpec } from '../../core/effects/preview.ts'
import type { PreviewSpec } from '../../shared/api/preview.ts'
import { isPlaceholderName } from '../../core/project/text.ts'
import { childEffectIds, ENCHANT_SIZES } from '../../core/params/workflow.ts'
import { shiftEffect, transformEffect } from '../../core/effects/nodeTransforms.ts'
import { decodePng, isPng } from '../../core/formats/png.ts'
import { encodeDds, isGreyscaleMask } from '../../core/formats/bcEncode.ts'
import { indexEffectSpawns } from '../../core/animation/animations.ts'
import type * as A from '../../shared/api.ts'
import { BoundedMap } from '../../shared/collections.ts'
import type { Session } from '../session.ts'

export class EffectService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  /**
   * Which rows and player animations use an effect, and whose own effect
   * file (a character's, a map's) has one with the same id: an enemy's
   * effect brought into the common file keeps its id, and the game may play
   * either.
   */
  effectUses(id: number): {
    rows: { param: string; id: number; field: string }[]
    animations: string[]
    alsoIn?: string
  } {
    // Only if the game's effect files were indexed already (bringing an enemy's effect in does, and keeps it):
    // building it reads every one of them, about a minute, and only a brought-in effect can be in one.
    const rel = this.knownEffectLocations()?.get(id)
    return {
      rows: this.effectUsers().get(id) ?? [],
      animations: [...(this.effectSpawnIndex().get(id) ?? [])],
      alsoIn: rel ? this.bundleOwner(rel) : undefined,
    }
  }

  /** effect id -> the player's animations that spawn it (built on first use, dropped on event edits). */
  effectSpawns: Map<number, Set<string>> | null = null

  private effectSpawnIndex(): Map<number, Set<string>> {
    if (this.effectSpawns) return this.effectSpawns
    const o = this.session.requireOpen()
    this.effectSpawns = new Map()
    try {
      const files =
        o.anims.taeFiles() ??
        readBnd4(dcxDecompress(o.project.read('chr/c0000.anibnd.dcx').data).data)
          .entries.filter((e) => e.name.toLowerCase().endsWith('.tae'))
          .map((e) => [e.name, e.data] as [string, Buffer])
      this.effectSpawns = indexEffectSpawns(files, o.anims.templateData().template)
    } catch {
      /* no readable player animations: no animation uses known */
    }
    return this.effectSpawns
  }

  /**
   * Fingerprints of the installed game's effects, per bundle, for telling
   * which effects a project actually changed: a project's bundle is a copy
   * of the whole game bundle, so being in it says nothing on its own.
   */
  gameFxr = new Map<string, Map<string, string> | null>()

  private gameEffectHashes(rel: string): Map<string, string> | null {
    if (this.gameFxr.has(rel)) return this.gameFxr.get(rel)!
    let out: Map<string, string> | null
    try {
      const o = this.session.requireOpen()
      out = new Map()
      for (const e of readBnd4(dcxDecompress(o.project.readGame(rel)).data).entries)
        out.set(e.name.toLowerCase(), crypto.createHash('sha1').update(e.data).digest('hex'))
      // Kept with this version's vanilla files: after the next update they tell
      // the project's effect edits apart from the update's.
      this.session.vanilla.keepEffectIndex(o.gameDb.version, rel, out)
    } catch {
      out = null
    }
    this.gameFxr.set(rel, out)
    return out
  }

  /**
   * Which of the game's own bundles holds each effect that isn't in the
   * common ones: characters' (sfxbnd_c2130 is Margit's, loaded only with
   * him) and maps'. Built once per game version by reading every bundle's
   * table of contents, then kept with that version's files.
   */
  private effectIndex: Map<number, string> | null = null

  /** The game version whose kept index was last looked for (knownEffectLocations). */
  private effectIndexLooked: number | null = null

  /** The index if it's built (this session, or kept from one before), without building it. */
  private knownEffectLocations(): Map<number, string> | null {
    if (this.effectIndex) return this.effectIndex
    const version = this.session.requireOpen().gameDb.version
    if (this.effectIndexLooked !== version) {
      this.effectIndexLooked = version
      this.effectIndex = this.session.vanilla.effectLocations(version)
    }
    return this.effectIndex
  }

  effectLocations(): Map<number, string> {
    if (this.effectIndex) return this.effectIndex
    const o = this.session.requireOpen()
    const kept = this.session.vanilla.effectLocations(o.gameDb.version)
    if (kept) return (this.effectIndex = kept)
    const out = new Map<number, string>()
    const common = new Set(COMMON_BUNDLES.map((r) => r.toLowerCase()))
    for (const raw of o.project.list('sfx', /\.ffxbnd\.dcx$/i)) {
      const rel = raw.replace(/\\/g, '/')
      if (common.has(rel.toLowerCase())) continue
      try {
        for (const e of readBnd4(dcxDecompress(o.project.readGame(rel)).data).entries) {
          const m = /f(\d{9})\.fxr$/i.exec(e.name)
          if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), rel)
        }
      } catch {
        /* an unreadable bundle: its effects stay unfound */
      }
    }
    this.session.vanilla.keepEffectLocations(o.gameDb.version, out)
    return (this.effectIndex = out)
  }

  /** Whose a bundle is: sfxbnd_c2130 is character c2130 (its NPC rows' name: Margit), sfxbnd_m10_00 a map. */
  private bundleOwner(rel: string): string {
    const o = this.session.requireOpen()
    const base = rel.replace(/^.*[\\/]sfxbnd_|\.ffxbnd\.dcx$/gi, '')
    const chr = /^c(\d{4})/i.exec(base)
    if (chr) {
      const n = Number(chr[1])
      const npc = o.db
        .get('NpcParam')
        .param.rows.find((r) => Math.floor(r.id / 10000) === n && o.db.rowName('NpcParam', r.id))
      const name = npc ? o.db.rowName('NpcParam', npc.id).replace(/\s*\(.*\)$/, '') : ''
      return name ? `${name} (character c${chr[1]})` : `character c${chr[1]}`
    }
    const map = /^m(\d\d_\d\d)/i.exec(base)
    return map ? `map m${map[1]}` : base
  }

  /** Where an effect outside the common bundles is, or null (in the common ones, or nowhere). */
  locateEffect(id: number): A.EffectLocation | null {
    const o = this.session.requireOpen()
    if (o.lib.hasEffect(id)) return null
    const rel = this.effectLocations().get(id)
    return rel ? { bundle: rel, owner: this.bundleOwner(rel), name: this.session.effectName(id) } : null
  }

  /** Copies an effect from its own bundle into the common effects (with the effects and files it needs). */
  importEffect(id: number): { effects: number[]; files: string[]; from: A.EffectLocation } {
    const o = this.session.requireOpen()
    const from = this.locateEffect(id)
    if (!from)
      throw new Error(
        o.lib.hasEffect(id)
          ? `Effect ${id} is already in the common effects`
          : `Effect ${id} isn't in any of the game's effect bundles`,
      )
    const src = readBnd4(dcxDecompress(o.project.readGame(from.bundle)).data)
    const r = o.lib.importFrom(src, id)
    this.session.paramsEdited(o)
    return { ...r, from }
  }

  /**
   * An effect another character's or a map's bundle has, for an animation of the project's own: the
   * game's effect copied into the common effects as it is (with the effects and files it uses), and a
   * copy of it under a free id, the project's to turn, move or recolour without changing what the
   * character shows. The copy's id is returned.
   */
  bringEffect(id: number): { id: number; from: A.EffectLocation } {
    const o = this.session.requireOpen()
    const from = this.importEffect(id).from
    const copy = o.lib.freeEffectId(this.session.internals().effectIdStart)
    o.lib.cloneEffect(id, copy)
    return { id: copy, from }
  }

  /**
   * An effect turned and moved in its own axes (the viewer's move and rotate tool): `rotation` is a 3×3
   * matrix (row-major) and `offset` metres, both in the game's axes. The project's own effects change in
   * place. A game effect is copied under a free id first (brought from its bundle if it's another
   * character's), so whatever else uses it stays as it was; the copy's id is returned for the event.
   */
  transform(id: number, rotation: number[], offset: number[]): { id: number; copied: boolean } {
    const o = this.session.requireOpen()
    const target = this.effectState(id) !== 'added' ? this.copyEffect(id) : id
    const fxr = o.lib.getEffect(target)
    transformEffect(fxr, rotation, offset)
    o.lib.saveEffect(fxr)
    return { id: target, copied: target !== id }
  }

  /**
   * A copy of an effect under a free id (900000000 and up), named after it:
   * edits to the copy leave the game's own, and everything using it, alone.
   * An effect only another bundle has is brought into the common effects first.
   */
  copyEffect(id: number): number {
    const o = this.session.requireOpen()
    if (!o.lib.hasEffect(id)) this.importEffect(id)
    const target = o.lib.freeEffectId(this.session.internals().effectIdStart)
    o.lib.cloneEffect(id, target)
    return target
  }

  /** The effect hashes of the game version the project was made with: kept ones for an older version, else the installed game's. */
  private baseEffectHashes(rel: string): Map<string, string> | null {
    const o = this.session.requireOpen()
    if (o.base !== o.gameDb) {
      const kept = this.session.vanilla.effectIndex(o.db.version, rel)
      if (kept) return kept
    }
    return this.gameEffectHashes(rel)
  }

  /** Added (the game has no such effect), changed (differs from the game's), or untouched. */
  effectState(id: number): A.ProjectState {
    const o = this.session.requireOpen()
    const bundle: EffectBundle | null = o.lib.findEffect(id)
    if (!bundle || (bundle.source !== 'project' && !bundle.dirty)) return null
    const name = effectEntryPath(id).toLowerCase()
    const entry = bundle.bnd.entries[bundle.byName.get(name)!]
    if (!entry) return null
    let gameHash: string | undefined
    for (const rel of o.lib.bundleRels) {
      gameHash = this.baseEffectHashes(rel)?.get(name)
      if (gameHash) break
    }
    if (!gameHash) return 'added'
    return crypto.createHash('sha1').update(entry.data).digest('hex') === gameHash ? null : 'changed'
  }

  effectUsers(): Map<number, { param: string; id: number; field: string }[]> {
    const o = this.session.requireOpen()
    if (o.effectUsers) return o.effectUsers
    const map = new Map<number, { param: string; id: number; field: string }[]>()
    for (const p of o.db.params.values()) {
      const fields = [...p.meta]
        .filter(([, fm]) => fm.extRefs.some((e) => e.pathTemplate.toLowerCase().endsWith('.fxr')))
        .map(([name]) => p.def.fieldsByName.get(name))
        .filter((f): f is NonNullable<typeof f> => !!f)
      if (!fields.length) continue
      for (const row of p.param.rows) {
        for (const f of fields) {
          const v = getField(row.data, f)
          if (typeof v !== 'number' || v <= 0) continue
          const list = map.get(v) ?? []
          list.push({ param: p.name, id: row.id, field: f.name })
          map.set(v, list)
        }
      }
    }
    o.effectUsers = map
    return map
  }

  effectView(id: number): A.EffectView {
    const o = this.session.requireOpen()
    const fxr = o.lib.getEffect(id)
    const bundle = o.lib.findEffect(id)!
    const info = o.lib.info(id)
    const actions = allActions(fxr)
    const warnings: string[] = []
    if (fxr.id !== id)
      warnings.push(`Internal id ${fxr.id} doesn't match the file name ${id}; the effect may never stop.`)

    const nodes: A.EffectNodeView[] = flatNodes(fxr).map(({ node, depth }, index) => {
      const slots: A.ResourceSlot[] = []
      const blends: A.EffectNodeView['blends'] = []
      for (const action of actionsOf(node)) {
        const spec = ACTION_SPECS[String(action.type)]
        const actionIndex = actions.indexOf(action)
        // Blend modes are plain numbers or a constant ValueProperty.
        const bm = constantOf(action.blendMode)
        if (typeof bm === 'number')
          blends.push({ actionIndex, action: spec?.name ?? `Action ${action.type}`, value: bm })
        for (const [field, prop] of Object.entries(spec?.properties ?? {})) {
          if (prop.resource !== 'texture' && prop.resource !== 'model') continue
          const value = constantOf(action[field])
          if (typeof value !== 'number') continue
          const exists =
            value === 0 ||
            (prop.resource === 'texture' ? o.lib.hasTexture(value, prop.textureType ?? 'a') : o.lib.hasModel(value))
          slots.push({
            actionIndex,
            action: spec?.name ?? `Action ${action.type}`,
            field,
            resource: prop.resource,
            textureType: prop.textureType,
            value,
            exists,
          })
        }
      }
      const proxied = proxyTarget(node)
      const isProxy = proxied !== null
      let appearance: string | undefined
      for (const action of actionsOf(node)) {
        const spec = ACTION_SPECS[String(action.type)]
        if (spec?.meta?.isAppearance) {
          appearance = spec.name
          break
        }
      }
      const label = isProxy
        ? 'Child effect'
        : appearance
          ? (APPEARANCE_LABELS[appearance] ?? appearance)
          : index === 0
            ? 'Effect root'
            : childNodes(node).length > 0
              ? 'Group'
              : 'Emitter'
      return {
        index,
        depth,
        type: node.constructor.name,
        label,
        color: serializeColor(safe(() => node.getColor())),
        slots,
        blends,
        isProxy,
        proxyTarget: proxied ?? undefined,
      }
    })

    // Recolor tips (models keep their textures' colours; dark colours vanish on additive blending) show in the Color section.
    const users = this.effectUsers().get(id) ?? []
    // A bullet's own effect flies with it: the first bullet carrying it that moves.
    const flight = users
      .filter((u) => u.param === 'Bullet' && u.field === 'sfxId_Bullet')
      .map((u) => ({
        bullet: u.id,
        name: o.db.rowName('Bullet', u.id),
        speed: o.db.num('Bullet', u.id, 'initVellocity'),
        life: o.db.num('Bullet', u.id, 'life'),
      }))
      .find((b) => b.speed > 0)
    return {
      id,
      name: this.session.effectName(id),
      details: this.session.effectDetails(id),
      credit: this.session.effectSheet().credit,
      bundle: bundle.rel,
      source: bundle.source,
      state: this.effectState(id),
      sizeFamily: this.sizeFamilyOf(id) ?? undefined,
      textures: info.textures,
      models: info.models,
      children: info.childEffects,
      nodes,
      usedBy: users.slice(0, 50).map((u) => ({ ...u, name: o.db.rowName(u.param, u.id) })),
      flight,
      spells: this.effectSpells(users),
      warnings,
    }
  }

  /**
   * The spells an effect is part of: their own cast, fire or effect sfx, or
   * an effect of a bullet they fire (or of a bullet one of those spawns).
   */
  private effectSpells(users: { param: string; id: number; field: string }[]): { id: number; name: string }[] {
    const o = this.session.requireOpen()
    const found = new Set(users.filter((u) => u.param === 'Magic').map((u) => u.id))
    const bullets = new Set(users.filter((u) => u.param === 'Bullet').map((u) => u.id))
    if (bullets.size) {
      const num = (param: string, id: number, field: string) => o.db.num(param, id, field, -1)
      // One stage up a chain: bullets that spawn these.
      for (const r of o.db.get('Bullet').param.rows)
        if (
          bullets.has(num('Bullet', r.id, 'HitBulletID')) ||
          bullets.has(num('Bullet', r.id, 'intervalCreateBulletId'))
        )
          bullets.add(r.id)
      for (const r of o.db.get('Magic').param.rows)
        for (let k = 1; k <= 10; k++)
          if (num('Magic', r.id, `refCategory${k}`) === 1 && bullets.has(num('Magic', r.id, `refId${k}`)))
            found.add(r.id)
    }
    return [...found]
      .map((id) => ({ id, name: this.session.displayName('Magic', id) }))
      .filter((s) => !isPlaceholderName(s.name))
      .slice(0, 8)
  }

  recolor(req: A.RecolorRequest): A.EffectView {
    const o = this.session.requireOpen()
    const func = recolorFunction(req.recolor)
    const roots = req.includeSizes ? (this.sizeFamilyOf(req.effectId) ?? [req.effectId]) : [req.effectId]
    const ids = req.includeChildren ? [...new Set(roots.flatMap((r) => this.effectFamily(r)))] : roots
    for (const id of ids) {
      const fxr = o.lib.getEffect(id)
      if (id === req.effectId && req.nodeIndex !== undefined) {
        const target = flatNodes(fxr)[req.nodeIndex]?.node
        if (!target) throw new Error(`Node ${req.nodeIndex} not found`)
        target.recolor(func, false)
      } else {
        fxr.root.recolor(func)
      }
      o.lib.saveEffect(fxr)
    }
    return this.effectView(req.effectId)
  }

  /**
   * The blade-size versions of a weapon-buff effect: a VFX row marked "Use
   * Enchant SFX Size to Offset SFX ID" names the first, and the game adds
   * the weapon's size (0–8) to it. Null for ordinary effects.
   */
  private sizeFamilyOf(id: number): number[] | null {
    const o = this.session.requireOpen()
    const vfx = o.db.params.get('SpEffectVfxParam')
    if (!vfx) return null
    for (const r of vfx.param.rows) {
      if (o.db.value('SpEffectVfxParam', r.id, 'isUseOffsetEnchantSfxSize') !== 1) continue
      const base = o.db.num('SpEffectVfxParam', r.id, 'midstSfxId')
      if (!(base > 0) || id < base || id >= base + ENCHANT_SIZES) continue
      const members = Array.from({ length: ENCHANT_SIZES }, (_, k) => base + k).filter((e) => o.lib.hasEffect(e))
      if (members.length > 1 && members.includes(id)) return members
    }
    return null
  }

  private effectFamily(id: number): number[] {
    const o = this.session.requireOpen()
    const out = new Set<number>()
    const stack = [id]
    while (stack.length) {
      const e = stack.pop()!
      if (out.has(e) || !o.lib.hasEffect(e)) continue
      out.add(e)
      stack.push(...childEffectIds(o.lib.getEffect(e)))
    }
    return [...out]
  }

  setResource(req: A.ResourceEdit): A.EffectView {
    const o = this.session.requireOpen()
    const fxr = o.lib.getEffect(req.effectId)
    const action = allActions(fxr)[req.actionIndex]
    if (!action) throw new Error(`Action ${req.actionIndex} not found`)
    const current = action[req.field]
    if (isFields(current) && 'value' in current) current.value = req.value
    else action[req.field] = req.value
    o.lib.saveEffect(fxr)
    return this.effectView(req.effectId)
  }

  importTexture(req: A.Req<'texture:import'>): A.Res<'texture:import'> {
    const o = this.session.requireOpen()
    const bundle = o.lib.findEffect(req.effectId)
    const id = o.lib.importTexture(asDds(Buffer.from(req.base64, 'base64'), 'effect'), req.textureType, bundle?.rel)
    for (const k of [...this.session.assets.thumbs.keys()])
      if (k.startsWith(`texture:${id}:`)) this.session.assets.thumbs.delete(k)
    if (req.actionIndex !== undefined && req.field) {
      return {
        id,
        view: this.setResource({ effectId: req.effectId, actionIndex: req.actionIndex, field: req.field, value: id }),
      }
    }
    return { id, view: this.effectView(req.effectId) }
  }

  importModel(req: A.Req<'model:import'>): A.Res<'model:import'> {
    const o = this.session.requireOpen()
    const flverFile = req.files.find((f) => /\.flver$/i.test(f.name))
    if (!flverFile) throw new Error('Include the model’s .flver file.')
    // Its textures: DDS files as they are, PNG files packed (a colour map in sRGB, as the game's models have).
    const textures = req.files
      .filter((f) => /\.(dds|png)$/i.test(f.name))
      .map((f) => ({
        fileName: f.name.replace(/\.png$/i, '.dds'),
        dds: asDds(Buffer.from(f.base64, 'base64'), /_a\.png$/i.test(f.name) ? 'colour' : 'effect'),
      }))
    const bundle = o.lib.findEffect(req.effectId)
    const r = o.lib.importModel(Buffer.from(flverFile.base64, 'base64'), textures, bundle?.rel)
    this.session.assets.meshes.delete(r.id)
    for (const k of [...this.session.assets.thumbs.keys()])
      if (k.startsWith('model:')) this.session.assets.thumbs.delete(k)
    const view =
      req.actionIndex !== undefined && req.field
        ? this.setResource({ effectId: req.effectId, actionIndex: req.actionIndex, field: req.field, value: r.id })
        : this.effectView(req.effectId)
    return { ...r, view }
  }

  effectParts(id: number): A.FxPartView[] {
    return describeParts(this.session.requireOpen().lib.getEffect(id))
  }

  setEffectFields(effectId: number, edits: A.FxFieldEdit[]): A.EffectView {
    const o = this.session.requireOpen()
    const fxr = o.lib.getEffect(effectId)
    applyFieldEdits(fxr, edits)
    o.lib.saveEffect(fxr)
    return this.effectView(effectId)
  }

  setBlendMode(effectId: number, actionIndex: number, value: number): A.EffectView {
    const o = this.session.requireOpen()
    const fxr = o.lib.getEffect(effectId)
    const action = allActions(fxr)[actionIndex]
    if (!action || !('blendMode' in action)) throw new Error('That action has no blend mode')
    const current = action.blendMode
    if (isFields(current) && 'value' in current) current.value = value
    else action.blendMode = value
    o.lib.saveEffect(fxr)
    return this.effectView(effectId)
  }

  /**
   * An effect's preview; with `scale`, of the effect (and the effects it
   * proxies) scaled by that factor, as scaling it would make it, and moved
   * by `shift` (an effect scaled about a weapon's grip).
   */
  preview(id: number, scale?: number, shift?: number[]): PreviewSpec {
    const o = this.session.requireOpen()
    if (scale !== undefined && scale > 0 && Math.abs(scale - 1) > 1e-6 && o.lib.hasEffect(id)) {
      const scaled = new Map<number, FXR>()
      const lib = {
        hasEffect: (i: number) => o.lib.hasEffect(i),
        getEffect: (i: number) => {
          let f = scaled.get(i)
          if (!f) {
            f = o.lib.getEffect(i).clone()
            f.root.scale(scale)
            if (i === id && shift?.length === 3) shiftEffect(f, shift)
            scaled.set(i, f)
          }
          return f
        },
      } as unknown as EffectLibrary
      return buildPreviewSpec(lib, id)
    }
    if (o.lib.hasEffect(id)) return buildPreviewSpec(o.lib, id)
    // A character's own effect (Margit's hammer): played from its bundle, read only.
    const rel = this.effectLocations().get(id)
    if (!rel) return buildPreviewSpec(o.lib, id)
    const own = this.ownBundle(rel)
    const both = {
      hasEffect: (i: number) => own.hasEffect(i) || o.lib.hasEffect(i),
      getEffect: (i: number) => (own.hasEffect(i) ? own.getEffect(i) : o.lib.getEffect(i)),
    } as unknown as EffectLibrary
    return buildPreviewSpec(both, id)
  }

  /** Characters' own effect bundles, read only, for previewing their effects without copying them. */
  ownBundles = new BoundedMap<string, EffectLibrary>(3)

  private ownBundle(rel: string): EffectLibrary {
    let lib = this.ownBundles.get(rel)
    if (!lib) {
      lib = new EffectLibrary(this.session.requireOpen().project, [rel])
      this.ownBundles.set(rel, lib)
    }
    return lib
  }

  /** A file of the effect bundles (a model, a texture): the common ones', else a character's own being previewed. */
  effectEntry(path: string): Buffer | null {
    const hit = this.session.requireOpen().lib.entryData(path)
    if (hit) return hit
    for (const lib of this.ownBundles.values()) {
      const d = lib.entryData(path)
      if (d) return d
    }
    return null
  }

  hasEffectTexture(id: number, type: string): boolean {
    return this.session.requireOpen().lib.hasTexture(id, type) || !!this.effectEntry(textureEntryPath(id, type))
  }
}

/** Plain-language names for appearance actions, for node labels. */
const APPEARANCE_LABELS: Record<string, string> = {
  RichModel: '3D model',
  Model: '3D model',
  BillboardEx: 'Sprite',
  MultiTextureBillboardEx: 'Layered sprite',
  PointSprite: 'Point sprite',
  Tracer: 'Trail',
  LegacyTracer: 'Trail',
  Line: 'Line',
  QuadLine: 'Line',
  Distortion: 'Distortion',
  RadialBlur: 'Radial blur',
  PointLight: 'Light',
  SpotLight: 'Spot light',
  GPUStandardParticle: 'GPU particles',
  GPUStandardCorrectParticle: 'GPU particles',
  GPUSparkParticle: 'GPU sparks',
  GPUSparkCorrectParticle: 'GPU sparks',
  LightShaft: 'Light shaft',
  LensFlare: 'Lens flare',
  WaterInteraction: 'Water ripple',
}
function safe<T>(f: () => T): T | null {
  try {
    return f()
  } catch {
    return null
  }
}
function serializeColor(prop: unknown): A.ColorValue | null {
  if (Array.isArray(prop)) return { kind: 'static', rgba: prop }
  if (!isFields(prop)) return null
  if (Array.isArray(prop.value)) return { kind: 'static', rgba: prop.value }
  const keyframes = keyframesOf(prop)
  if (!keyframes.length) return null
  const end = Number(keyframes[keyframes.length - 1].position) || 1
  return {
    kind: 'gradient',
    stops: keyframes.flatMap((k) =>
      Array.isArray(k.value) ? [{ t: end ? Number(k.position) / end : 0, rgba: k.value }] : [],
    ),
  }
}
function recolorFunction(op: A.RecolorOp): Recolor.RecolorFunction {
  switch (op.op) {
    case 'hueShift':
      return Recolor.hueShift(op.degrees)
    case 'replaceHue':
      return Recolor.replaceHue(op.rgb as [number, number, number])
    case 'replace':
      return Recolor.replace(op.rgba as [number, number, number, number])
    case 'multiply':
      return Recolor.multiply(op.rgba as [number, number, number, number])
    case 'saturation':
      return Recolor.scaleSaturation(op.factor)
    case 'grayscale':
      return Recolor.grayscale
    case 'invert':
      return Recolor.invert
  }
}

/**
 * A texture file as the DDS the game takes: a DDS as it is; a PNG packed as
 * the game packs its own (BC4 for a greyscale mask, else BC7: linear for an
 * effect's sprites, sRGB for a model's colour map).
 */
function asDds(file: Buffer, use: 'effect' | 'colour'): Buffer {
  if (!isPng(file)) return file
  const img = decodePng(file)
  if (use === 'effect' && isGreyscaleMask(img)) return encodeDds(img, 'BC4')
  return encodeDds(img, 'BC7', use === 'colour')
}
