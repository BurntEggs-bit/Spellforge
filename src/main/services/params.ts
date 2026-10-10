/**
 * Params of the open project: browsing them, the tree of what a row uses, a row's fields and
 * references, adding, deleting and naming rows, and the ids around one.
 */
import { ParamDatabase } from '../../core/params/paramDb.ts'
import { getField, setField, defaultRowData } from '../../core/params/param.ts'
import { fieldHint, isKeyField } from '../../core/params/hints.ts'
import { orderFields } from '../../core/params/fieldLayout.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxCompress, dcxDecompress } from '../../core/formats/dcx.ts'
import { diffParams } from '../../core/params/diff.ts'
import {
  captionTableFor,
  nameTableFor,
  paramsNamedBy,
  setNameInMsgBnd,
  setTextInMsgBnd,
  TEXT_ID_FIELD,
  isPlaceholderName,
} from '../../core/project/text.ts'
import { parseAnimationName } from '../../shared/animIds.ts'
import { DAMAGE, STATS, weaponLevels as levelsOf } from '../../core/params/weaponStats.ts'
import { putModelFiles, renameModelBinder } from '../../core/project/weaponModels.ts'
import { weaponPartName } from '../../core/animation/character.ts'
import { decodePng, isPng } from '../../core/formats/png.ts'
import { encodeDds } from '../../core/formats/bcEncode.ts'
import { nodeKey, behaviorRowsForVariation, insertRow, IdAvailability } from '../../core/params/clone.ts'
import { isIconKind } from './icons.ts'
import { fitAttackForPlayer } from '../workflows/enemyMoves.ts'
import type * as A from '../../shared/api.ts'
import {
  behaviorCategoryOf,
  behaviorRowFor,
  behaviorRowId,
  behaviorVariationOf,
  judgeCategory,
  judgeOfBehaviorRow,
} from '../../core/params/behaviorIds.ts'
import type { Open, Session } from '../session.ts'

export class ParamService {
  private readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  /** Whether the project added or changed a row (null: as the game has it). */
  rowState(param: string, id: number): A.ProjectState {
    const o = this.session.requireOpen()
    const row = o.db.row(param, id)
    if (!row) return null
    const before = o.base.row(param, id)
    if (!before) return 'added'
    return before.data.equals(row.data) ? null : 'changed'
  }

  browse(req: A.Req<'browse:list'>): A.BrowseRow[] {
    const o = this.session.requireOpen()
    const q = req.query.trim().toLowerCase()
    const match = (id: number, name: string) => !q || name.toLowerCase().includes(q) || String(id).includes(q)
    const out: A.BrowseRow[] = []

    const fromParam = (param: string, keep: (id: number, name: string) => boolean, detail?: (id: number) => string) => {
      for (const row of o.db.get(param).param.rows) {
        const name = o.db.rowName(param, row.id)
        const state = this.rowState(param, row.id)
        if (req.onlyProject && !state) continue
        if (!state && !keep(row.id, name)) continue
        if (!match(row.id, name)) continue
        out.push({ param, id: row.id, name, state, detail: detail?.(row.id) })
        if (out.length >= req.limit) break
      }
    }

    switch (req.kind) {
      case 'weapons':
        // Infusions are id + 100..1200 on the same base; list bases only.
        fromParam(
          'EquipParamWeapon',
          (id, name) => id % 10000 === 0 && !!name,
          (id) => {
            const v = o.db.value('EquipParamWeapon', id, 'behaviorVariationId')
            return `variation ${v}`
          },
        )
        break
      case 'goods':
        fromParam('EquipParamGoods', (_id, name) => !!name)
        break
      case 'spells':
        // Sorceries and incantations: the Magic rows (their item has the same id).
        fromParam(
          'Magic',
          (_id, name) => !!name,
          (id) => {
            const fp = o.db.value('Magic', id, 'mp')
            return typeof fp === 'number' && fp > 0 ? `${fp} FP` : ''
          },
        )
        break
      case 'skills':
        fromParam('SwordArtsParam', (_id, name) => !!name)
        break
      case 'bullets':
        fromParam(
          'Bullet',
          (_id, name) => !!name,
          (id) => {
            const sfx = o.db.value('Bullet', id, 'sfxId_Bullet')
            return typeof sfx === 'number' && sfx > 0 ? `effect ${sfx}` : ''
          },
        )
        break
      case 'effects': {
        const users = this.session.effects.effectUsers()
        for (const id of o.lib.allEffectIds()) {
          const u = users.get(id)?.[0]
          const name =
            this.session.effectName(id) || (u ? `${o.db.rowName(u.param, u.id) || `${u.param} ${u.id}`}` : '')
          const bundle = o.lib.findEffect(id)!
          const state = this.session.effects.effectState(id)
          if (req.onlyProject && !state) continue
          if (!match(id, name)) continue
          out.push({ param: 'fxr', id, name, state, detail: bundle.rel.replace(/^sfx\/sfxbnd_|\.ffxbnd\.dcx$/g, '') })
          if (out.length >= req.limit) break
        }
        // Searching: effects in the game's other bundles too (a character's own, a map's), marked as such.
        if (q && !req.onlyProject && out.length < req.limit) {
          for (const [id, rel] of this.session.effects.effectLocations()) {
            const name = this.session.effectName(id)
            if (o.lib.hasEffect(id) || !match(id, name)) continue
            out.push({
              param: 'fxr',
              id,
              name,
              state: null,
              detail: `only in ${rel.replace(/^sfx\/sfxbnd_|\.ffxbnd\.dcx$/g, '')}`,
            })
            if (out.length >= req.limit) break
          }
        }
        break
      }
    }
    return out
  }

  /**
   * A player's copy of an enemy attack. Bullets fired by the player look up
   * their attack in AtkParam_Pc; an enemy's bullet names a row that only
   * AtkParam_Npc has, so in the player's hands it does no damage. Both
   * tables share one layout: the copy is the same row, same id, its damage
   * counted and its push a player's (fitAttackForPlayer).
   */
  playerAttack(id: number): A.RowView {
    const o = this.session.requireOpen()
    if (o.db.hasRow('AtkParam_Pc', id)) throw new Error(`AtkParam_Pc ${id} already exists`)
    const npc = o.db.row('AtkParam_Npc', id)
    if (!npc) throw new Error(`AtkParam_Npc ${id} doesn't exist`)
    const pc = o.db.get('AtkParam_Pc')
    if (pc.def.rowSize !== o.db.get('AtkParam_Npc').def.rowSize)
      throw new Error('The two attack tables have different layouts in this game version')
    this.addRow('AtkParam_Pc', id)
    const row = o.db.row('AtkParam_Pc', id)!
    npc.data.copy(row.data)
    // Its flat damage counted for the player, its push a player's.
    fitAttackForPlayer(row.data, pc.def)
    pc.dirty = true
    const name = o.db.rowName('AtkParam_Npc', id)
    if (name) this.renameRow('AtkParam_Pc', id, name)
    return this.rowView('AtkParam_Pc', id)
  }

  private treeNode(param: string, id: number, via?: string): A.TreeNode {
    const o = this.session.requireOpen()
    const effects = o.db.sfxRefsFrom(param, id).map((s) => ({
      field: s.field,
      label: s.fieldLabel,
      id: s.sfxId,
      exists: o.lib.hasEffect(s.sfxId),
      name: this.session.effectName(s.sfxId),
    }))
    return {
      key: nodeKey(param, id),
      kind: 'row',
      param,
      id,
      name: o.db.rowName(param, id),
      state: this.rowState(param, id),
      via,
      effects,
      hasChildren: this.childRefs(param, id).length > 0,
      animationCount: param === 'BehaviorParam_PC' ? this.session.assets.behaviorAnimations(id).length : undefined,
    }
  }

  private childRefs(param: string, id: number): { param: string; id: number; via: string }[] {
    const o = this.session.requireOpen()
    const out = o.db
      .refsFrom(param, id)
      .filter((r) => TREE_PARAMS.has(r.targetParam) && !(r.targetParam === param && r.targetId === id))
      .map((r) => ({ param: r.targetParam, id: r.targetId, via: r.fieldLabel }))
    // A sorcery or incantation item: its spell (the Magic row with the same id).
    if (param === 'EquipParamGoods' && o.db.hasRow('Magic', id))
      out.unshift({ param: 'Magic', id, via: 'Spell (same id)' })
    if (param === 'Magic' && o.db.hasRow('EquipParamGoods', id))
      out.unshift({ param: 'EquipParamGoods', id, via: 'Item (same id)' })
    if (param === 'EquipParamWeapon') {
      const v = o.db.value(param, id, 'behaviorVariationId')
      if (typeof v === 'number') {
        for (const bid of behaviorRowsForVariation(o.db, v)) {
          out.push({
            param: 'BehaviorParam_PC',
            id: bid,
            via: bid >= 300_000_000 ? 'Skill behavior' : 'Moveset behavior',
          })
        }
      }
    }
    return out
  }

  /** A weapon's attack at each upgrade level, at the given stats (strength, dexterity, intelligence, faith, arcane). */
  weaponLevels(id: number, stats: number[]): A.WeaponLevelsView {
    const o = this.session.requireOpen()
    const at = Object.fromEntries(STATS.map((s, k) => [s, Math.max(1, Math.min(99, stats[k] ?? 40))])) as Record<
      (typeof STATS)[number],
      number
    >
    const r = levelsOf(o.db, id, at)
    return {
      levels: r.levels.map((l) => ({
        level: l.level,
        attack: DAMAGE.map((d) => l.attack[d]),
        base: DAMAGE.map((d) => Math.floor(l.base[d])),
        total: l.total,
        scaling: STATS.map((s) => Math.round(l.scaling[s])),
      })),
      requirements: STATS.map((s) => r.requirements[s]),
      feeds: STATS.map((s) => r.feeds[s].map((d) => DAMAGE.indexOf(d))),
    }
  }

  /**
   * An Ash of War item (EquipParamGem) for a skill: a copy of the gem whose
   * skill plays the same animations (its swordArtsTypeNew), else of Lion's
   * Claw's, pointed at this skill and named after it. A skill that already
   * has one gets that one.
   */
  makeAshOfWar(skill: number): number {
    const o = this.session.requireOpen()
    if (!o.db.hasRow('SwordArtsParam', skill)) throw new Error(`There's no skill ${skill}`)
    const gems = o.db.get('EquipParamGem').param.rows
    const has = gems.find((g) => o.db.num('EquipParamGem', g.id, 'swordArtsParamId') === skill)
    if (has) return has.id
    const type = o.db.num('SwordArtsParam', skill, 'swordArtsTypeNew')
    const like =
      gems.find((g) => {
        const s = o.db.num('EquipParamGem', g.id, 'swordArtsParamId')
        return s >= 0 && o.db.hasRow('SwordArtsParam', s) && o.db.num('SwordArtsParam', s, 'swordArtsTypeNew') === type
      }) ??
      gems.find((g) => g.id === 10000) ??
      gems[0]
    if (!like) throw new Error('The game has no Ash of War items to copy')
    let id = like.id + 100
    while (o.db.hasRow('EquipParamGem', id)) id += 100
    const skillName = this.rowView('SwordArtsParam', skill).gameName || o.db.rowName('SwordArtsParam', skill)
    this.addRow('EquipParamGem', id, like.id, `Ash of War: ${skillName || `skill ${skill}`}`)
    this.setRowField('EquipParamGem', id, 'swordArtsParamId', skill)
    if (skillName) this.setGameName('EquipParamGem', id, `Ash of War: ${skillName}`)
    return id
  }

  /**
   * A weapon buff (a SpEffect on the right-hand weapon) cast on both hands:
   * a copy for the left hand (wepParamChange 2), with a copy of its look on
   * the left weapon (SpEffectVfx: effect type 2, its blade's dummy polys
   * moved from 1xxxx to 2xxxx), which the buff starts as it's cast
   * (cycleOccurrenceSpEffectId). The Souls Modding wiki's method.
   *
   * Credit: the Souls Modding wiki ("make buffs cast on both hands").
   */
  buffBothHands(id: number): number {
    const o = this.session.requireOpen()
    const S = 'SpEffectParam'
    if (!o.db.hasRow(S, id)) throw new Error(`There's no SpEffect ${id}`)
    if (o.db.num(S, id, 'wepParamChange') !== 1)
      throw new Error('Only a buff on the right-hand weapon (Weapon Param Change 1) gets a left-hand copy')
    if (o.db.num(S, id, 'cycleOccurrenceSpEffectId') > 0)
      throw new Error('It already starts another SpEffect as it runs (its cycle): it can’t start the copy too')
    const copy = this.freeId(S, 9_100_000)
    this.addRow(S, copy, id, `${o.db.rowName(S, id) || `SpEffect ${id}`} - left hand`)
    this.setRowFieldOnly(S, copy, 'wepParamChange', 2)
    const vfx = o.db.num(S, id, 'vfxId')
    if (vfx > 0 && o.db.hasRow('SpEffectVfxParam', vfx)) {
      const V = 'SpEffectVfxParam'
      const left = this.freeId(V, 9_100_000)
      this.addRow(V, left, vfx, `${o.db.rowName(V, vfx) || `look ${vfx}`} - left hand`)
      this.setRowFieldOnly(V, left, 'effectType', 2)
      for (let k = 0; k < 8; k++) {
        const d = o.db.num(V, left, `enchantStartDmyId_${k}`)
        if (d >= 10000 && d < 20000) this.setRowFieldOnly(V, left, `enchantStartDmyId_${k}`, d + 10000)
      }
      this.setRowFieldOnly(S, copy, 'vfxId', left)
    }
    this.setRowField(S, id, 'cycleOccurrenceSpEffectId', copy)
    return copy
  }

  /**
   * A weapon's own copy of its model under a free model id (8000 and up,
   * above the game's), its files renamed (core/project/weaponModels.ts); the
   * weapon and its affinities (the rows of its block with the same model)
   * use it. The files wait for Save.
   */
  weaponOwnModel(weapon: number): { model: number; rows: number } {
    const o = this.session.requireOpen()
    const W = 'EquipParamWeapon'
    if (!o.db.hasRow(W, weapon)) throw new Error(`There's no weapon ${weapon}`)
    const from = o.db.num(W, weapon, 'equipModelId')
    const main = `parts/${weaponPartName(from)}.partsbnd.dcx`
    if (!o.project.resolve(main))
      throw new Error(`The weapon's model (${weaponPartName(from)}) isn't in the game or the project`)
    const used = new Set(o.db.get(W).param.rows.map((r) => o.db.num(W, r.id, 'equipModelId')))
    let to = 8000
    while (
      to <= 9999 &&
      (used.has(to) ||
        o.project.resolve(`parts/${weaponPartName(to)}.partsbnd.dcx`) ||
        o.project.resolve(`parts/${weaponPartName(to)}_l.partsbnd.dcx`))
    )
      to++
    if (to > 9999) throw new Error('No free weapon model ids are left (8000 to 9999)')
    for (const suffix of ['', '_l']) {
      const rel = `parts/${weaponPartName(from)}${suffix}.partsbnd.dcx`
      if (!o.project.resolve(rel)) continue
      const d = dcxDecompress(o.project.read(rel).data)
      const dcx = d.info.format === 'KRAK' ? { format: 'KRAK' as const, level: 4 } : d.info
      o.project.stage(
        `parts/${weaponPartName(to)}${suffix}.partsbnd.dcx`,
        dcxCompress(renameModelBinder(d.data, from, to), dcx),
      )
    }
    const block = weapon - (weapon % 10_000)
    let rows = 0
    for (const r of o.db.get(W).param.rows) {
      if (r.id < block || r.id >= block + 10_000 || o.db.num(W, r.id, 'equipModelId') !== from) continue
      this.setRowFieldOnly(W, r.id, 'equipModelId', to)
      rows++
    }
    return { model: to, rows }
  }

  /**
   * A model (.flver) and textures (.png or .dds, named like the model's own,
   * e.g. WP_A_8000_a.png) into a weapon's own model: a weapon still on a
   * shared model gets its own copy first. PNGs are packed as the game packs
   * a weapon's: colour maps (_a) sRGB, the rest linear. The low-detail copy
   * gets the same.
   */
  importWeaponModel(
    weapon: number,
    files: { name: string; base64: string }[],
  ): { model: number; replaced: string[]; added: string[] } {
    const o = this.session.requireOpen()
    const W = 'EquipParamWeapon'
    if (!o.db.hasRow(W, weapon)) throw new Error(`There's no weapon ${weapon}`)
    let model = o.db.num(W, weapon, 'equipModelId')
    const shared = o.db
      .get(W)
      .param.rows.some(
        (r) => o.db.num(W, r.id, 'equipModelId') === model && r.id - (r.id % 10_000) !== weapon - (weapon % 10_000),
      )
    if (shared || o.project.resolve(`parts/${weaponPartName(model)}.partsbnd.dcx`)?.source !== 'project')
      model = this.weaponOwnModel(weapon).model
    const flverFile = files.find((f) => /\.flver$/i.test(f.name))
    const flver = flverFile ? Buffer.from(flverFile.base64, 'base64') : null
    const textures = files
      .filter((f) => /\.(dds|png)$/i.test(f.name))
      .map((f) => {
        const raw = Buffer.from(f.base64, 'base64')
        const name = f.name.replace(/\.(dds|png)$/i, '')
        return { name, dds: isPng(raw) ? encodeDds(decodePng(raw), 'BC7', /_a$/i.test(name)) : raw }
      })
    if (!flver && !textures.length) throw new Error('Pick a .flver model, or textures (.png or .dds)')
    let result = { replaced: [] as string[], added: [] as string[] }
    for (const suffix of ['', '_l']) {
      const rel = `parts/${weaponPartName(model)}${suffix}.partsbnd.dcx`
      if (!o.project.resolve(rel)) continue
      const d = dcxDecompress(o.project.read(rel).data)
      const dcx = d.info.format === 'KRAK' ? { format: 'KRAK' as const, level: 4 } : d.info
      // The low-detail copy names its textures with _l: the same images go there.
      const own = suffix ? textures.map((t) => ({ ...t, name: `${t.name}_l` })) : textures
      const r = putModelFiles(d.data, flver, own)
      if (!suffix) result = { replaced: r.replaced, added: r.added }
      o.project.stage(rel, dcxCompress(r.binder, dcx))
    }
    return { model, ...result }
  }

  /** What a behavior row does, in words: "Bullet 10400000: Glintstone Pebble". */
  private behaviorSummary(id: number): string {
    const o = this.session.requireOpen()
    const refType = o.db.num('BehaviorParam_PC', id, 'refType')
    const refId = o.db.num('BehaviorParam_PC', id, 'refId')
    const target = refType === 0 ? 'AtkParam_Pc' : refType === 1 ? 'Bullet' : 'SpEffectParam'
    const label = refType === 0 ? 'Attack' : refType === 1 ? 'Bullet' : 'SpEffect'
    const name = o.db.hasRow(target, refId) ? o.db.rowName(target, refId) : ''
    return `${label} ${refId}${name ? `: ${name}` : ''}`
  }

  /**
   * The behavior row an animation's judge id means for a weapon: its own
   * (category × 100,000,000 + variation × 1000 + judge), and the one the game
   * plays, which falls back to its base variation's and then every weapon's.
   */
  judgeRowFor(judge: number, weapon: number): A.JudgeRowView {
    const o = this.session.requireOpen()
    if (!o.db.hasRow('EquipParamWeapon', weapon)) throw new Error(`Weapon ${weapon} does not exist`)
    const variation = o.db.num('EquipParamWeapon', weapon, 'behaviorVariationId')
    const id = behaviorRowId(judgeCategory(judge, 'BehaviorParam_PC'), variation, judge % 1000)
    const plays = behaviorRowFor(o.db, 'BehaviorParam_PC', judge, variation)
    return {
      id,
      variation,
      weapon,
      weaponName: o.db.rowName('EquipParamWeapon', weapon),
      exists: o.db.hasRow('BehaviorParam_PC', id),
      plays,
      borrowed: plays === null || plays === id ? undefined : behaviorVariationOf(plays) === 0 ? 'every' : 'base',
      summary: plays === null ? undefined : this.behaviorSummary(plays),
    }
  }

  /**
   * Every variation's row for a judge, with the weapons that have each
   * variation: what an event pasted from another weapon's animation did
   * there, to copy for a weapon that has nothing for it. The weapons whose
   * animation it is come first (when asked about one), then by name.
   */
  judgeSources(judge: number, animation?: string): A.JudgeSourceView[] {
    const o = this.session.requireOpen()
    const category = judgeCategory(judge, 'BehaviorParam_PC')
    const animCategory = animation ? parseAnimationName(animation)?.category : undefined
    // A skill's animations are in category 600 + its type; the weapons it's the skill of own them.
    const skills = new Set<number>()
    if (animCategory !== undefined && animCategory >= 600)
      for (const r of o.db.get('SwordArtsParam').param.rows)
        if (600 + o.db.num('SwordArtsParam', r.id, 'swordArtsTypeNew', -1) === animCategory) skills.add(r.id)
    const names = new Map<number, string[]>()
    const owners = new Set<number>()
    for (const w of o.db.get('EquipParamWeapon').param.rows) {
      const v = o.db.num('EquipParamWeapon', w.id, 'behaviorVariationId', -1)
      const name = o.db.rowName('EquipParamWeapon', w.id)
      // Its base weapon's name, not each infusion's (Heavy Moonveil, Keen Moonveil…), and no test rows.
      if (v < 0 || w.id % 10_000 !== 0 || isPlaceholderName(name)) continue
      const list = names.get(v) ?? []
      if (!list.includes(name)) list.push(name)
      names.set(v, list)
      if (
        animCategory !== undefined &&
        (o.db.num('EquipParamWeapon', w.id, 'wepmotionCategory', -1) === animCategory ||
          o.db.num('EquipParamWeapon', w.id, 'spAtkcategory', -1) === animCategory ||
          skills.has(o.db.num('EquipParamWeapon', w.id, 'swordArtsParamId', -1)))
      )
        owners.add(v)
    }
    const out: A.JudgeSourceView[] = []
    for (const r of o.db.get('BehaviorParam_PC').param.rows) {
      if (behaviorCategoryOf(r.id) !== category || r.id % 1000 !== judge % 1000) continue
      const variation = behaviorVariationOf(r.id)
      const weapons = names.get(variation) ?? []
      out.push({
        id: r.id,
        variation,
        weapons: weapons.slice(0, 3).join(', ') + (weapons.length > 3 ? ` and ${weapons.length - 3} more` : ''),
        owner: owners.has(variation),
        summary: this.behaviorSummary(r.id),
      })
    }
    return out.sort(
      (a, b) =>
        Number(b.owner) - Number(a.owner) ||
        Number(!a.weapons) - Number(!b.weapons) ||
        a.weapons.localeCompare(b.weapons) ||
        a.variation - b.variation,
    )
  }

  /**
   * Adds a weapon's own behavior row for a judge (or, with everyWeapon, the
   * one at variation 0 that every weapon without its own plays): a copy of
   * `from`, another weapon's row for it; else of the row the weapon plays
   * now; else of one of its own rows, then you pick what it does in the row.
   * With ownCopies its attack, bullets and their attacks are copied too, so
   * they can be balanced for this weapon alone (effects stay shared).
   *
   * Credit: Syyyke's moveset tutorial: a behaviour copied so any weapon can fire it.
   */
  createJudgeRow(req: A.JudgeRowCreate): A.JudgeRowView {
    const o = this.session.requireOpen()
    const { judge, weapon } = req
    const r = this.judgeRowFor(judge, weapon)
    const variation = req.everyWeapon ? 0 : r.variation
    const id = behaviorRowId(behaviorCategoryOf(r.id), variation, judge % 1000)
    if (o.db.hasRow('BehaviorParam_PC', id)) {
      if (req.from === undefined && !req.everyWeapon) return r
      throw new Error(`Behavior ${id} is there already`)
    }
    if (req.from !== undefined && !o.db.hasRow('BehaviorParam_PC', req.from))
      throw new Error(`Behavior ${req.from} does not exist`)
    const own = behaviorRowsForVariation(o.db, r.variation)
    const from = req.from ?? r.plays ?? own.find((b) => behaviorCategoryOf(b) === behaviorCategoryOf(id)) ?? own[0]
    const owner = req.everyWeapon ? 'Every weapon' : r.weaponName || `Weapon ${weapon}`
    const copied = from === undefined ? '' : o.db.rowName('BehaviorParam_PC', from)
    const name = `${owner} - ${req.from !== undefined && copied ? copied : `judge ${judge}`}`
    if (req.ownCopies && from !== undefined) {
      // The duplicate's walk of what the row fires, each bullet and attack copied (their SpEffects stay
      // shared; a row that applies a SpEffect gets its own copy of that).
      const fires = o.db.num('BehaviorParam_PC', from, 'refType')
      const base: A.ClonePlanRequest = {
        roots: [{ param: 'BehaviorParam_PC', id: from }],
        followParams: ['BehaviorParam_PC', 'Bullet', 'AtkParam_Pc', ...(fires === 2 ? ['SpEffectParam'] : [])],
        idOverrides: { [nodeKey('BehaviorParam_PC', from)]: id },
        nameSuffix: ` (${req.everyWeapon ? 'every weapon' : owner})`,
      }
      const plan = this.session.clone.plan(base)
      if (plan.errors.length) throw new Error(plan.errors.join('\n'))
      this.session.clone.apply({
        ...base,
        forceClone: plan.nodes.filter((n) => n.status !== 'root').map((n) => n.key),
        cloneEffects: false,
        includeChildEffects: false,
      })
      this.renameRow('BehaviorParam_PC', id, name)
    } else this.addRow('BehaviorParam_PC', id, from, name)
    this.setRowField('BehaviorParam_PC', id, 'variationId', variation)
    this.setRowField('BehaviorParam_PC', id, 'behaviorJudgeId', judge % 1000)
    return this.judgeRowFor(judge, weapon)
  }

  treeRoot(param: string, id: number): A.TreeNode {
    return this.treeNode(param, id)
  }

  treeChildren(param: string, id: number): A.TreeNode[] {
    return this.childRefs(param, id).map((c) => this.treeNode(c.param, c.id, c.via))
  }

  /** Whether the installed game itself has this value in this field of some row. */
  private gameUses(o: Open, param: string, field: string, value: number): boolean {
    const key = `${param}.${field}`
    let values = this.session.assets.gameValues.get(key)
    if (!values) {
      values = new Set()
      try {
        for (const r of o.gameDb.get(param).param.rows) {
          const v = o.gameDb.value(param, r.id, field)
          if (typeof v === 'number') values.add(v)
        }
      } catch {
        /* a param the game doesn't have */
      }
      this.session.assets.gameValues.set(key, values)
    }
    return values.has(value)
  }

  /** A reference field's value no row has: which param(s) it would be in, in words ("No Bullet 12345"). */
  private missingRef(o: Open, param: string, id: number, field: string, value: number): string | undefined {
    const targets = o.db.refTargets(param, id, field)
    if (!targets.length) return undefined
    const names = targets.map((t) => PARAM_WORDS[t] ?? t)
    return `No ${[...new Set(names)].join(' or ')} ${value} in the game or your mod: it points at nothing`
  }

  rowView(param: string, id: number): A.RowView {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    const row = o.db.row(param, id)
    if (!row) throw new Error(`${param} ${id} does not exist`)
    const fields: A.FieldView[] = []
    // In Smithbox's groups where it has a layout for the param, else in the game's own order (SortID).
    for (const { field: f, group } of orderFields(
      p.def.fields.filter((x) => x.type !== 'dummy8'),
      p.layout,
    )) {
      const fm = p.meta.get(f.name)
      const value = getField(row.data, f)
      const refs: A.FieldView['refs'] = []
      const key = isKeyField(p.def.paramType, f.name)
      if (fm?.refs.length && typeof value === 'number' && value > 0) {
        for (const r of o.db.refsFrom(param, id)) {
          if (r.field === f.name)
            refs.push({ param: r.targetParam, id: r.targetId, name: o.db.rowName(r.targetParam, r.targetId) })
        }
      } else if (fm?.refs.length && value === 0 && key) {
        // Where 0 is a row like any other (curve 0 of a Correction Type), it links like any other.
        for (const r of fm.refs)
          if (!r.conditionField && o.db.hasRow(r.param, 0))
            refs.push({ param: r.param, id: 0, name: o.db.rowName(r.param, 0) })
      }
      const isSfx = fm?.extRefs.some((e) => e.pathTemplate.toLowerCase().endsWith('.fxr'))
      const iconKind = fm?.icon && isIconKind(fm.icon) ? fm.icon : null
      const enumOptions = o.db.enums.get(fm?.enumName ?? f.enumName ?? '')
      const iconExists = iconKind && typeof value === 'number' && value >= 0 ? !!o.icons.sprite(iconKind, value) : false
      fields.push({
        name: f.name,
        label: f.displayName ?? f.name,
        group,
        description: f.description,
        hint: fieldHint(p.def.paramType, f.name),
        key: key || undefined,
        type: f.bitSize !== -1 ? `${f.type}:${f.bitSize}` : f.type,
        value,
        min: f.minimum,
        max: f.maximum,
        isBool: !!fm?.isBool || f.bitSize === 1,
        refs,
        effect:
          isSfx && typeof value === 'number' && value > 0
            ? { id: value, exists: o.lib.hasEffect(value), name: this.session.effectName(value) || undefined }
            : undefined,
        refMissing:
          fm?.refs.length && typeof value === 'number' && value > 0 && !refs.length
            ? this.missingRef(o, param, id, f.name, value)
            : undefined,
        icon:
          iconKind && typeof value === 'number' && value >= 0
            ? {
                kind: iconKind,
                id: value,
                exists: iconExists,
                known:
                  iconExists || !!enumOptions?.some((e) => e.value === value) || this.gameUses(o, param, f.name, value),
              }
            : undefined,
        about: refs.length ? undefined : o.ids.fieldAbout(param, id, f.name, fm, value),
        enumOptions,
      })
    }
    // The row's own icon: an item's (or a status effect's) first icon field that shows one.
    const own = fields.find((f) => f.icon?.exists && (f.icon.kind === 'Item' || f.icon.kind === 'Status'))
    return {
      param,
      id,
      icon: own?.icon ? { kind: own.icon.kind, id: own.icon.id } : undefined,
      name: o.db.rowName(param, id),
      state: this.rowState(param, id),
      paramDescription: p.def.description,
      fields,
      animations: param === 'BehaviorParam_PC' ? this.session.assets.behaviorAnimations(id) : undefined,
      animationJudge: param === 'BehaviorParam_PC' ? judgeOfBehaviorRow(id) : undefined,
      gameName: nameTableFor(param) ? (o.gameNames[param]?.[String(id)] ?? '') : undefined,
      enemyAttack: param === 'Bullet' ? this.enemyAttackOf(id) : undefined,
      scalable:
        param === 'SwordArtsParam' ||
        param === 'Magic' ||
        param === 'Bullet' ||
        (param === 'EquipParamGoods' && o.db.hasRow('Magic', id)) ||
        undefined,
      shops: param === 'ShopLineupParam' ? o.ids.shopsOf(id) : undefined,
      warnings: this.rowWarnings(param, id),
    }
  }

  /** What doesn't work as a row is set, in words (the traps the community's guides warn of). */
  private rowWarnings(param: string, id: number): string[] | undefined {
    const o = this.session.requireOpen()
    const out: string[] = []
    if (param === 'SpEffectParam') {
      const cycle = o.db.num(param, id, 'cycleOccurrenceSpEffectId')
      if (cycle > 0 && o.db.num(param, id, 'effectEndurance') === -1)
        out.push(
          `It lasts forever (Duration −1), so its cycle (SpEffect ${cycle}) never fires: give it a long duration instead, like 1000000 s.`,
        )
    }
    if (param === 'EquipParamWeapon') {
      // A status a weapon builds up shows on its status screen only through its text (Weapon_Effect). The game's
      // own affinities leave some out; only what the project set itself is warned of.
      for (let k = 0; k < 3; k++) {
        const sp = o.db.num(param, id, `spEffectBehaviorId${k}`)
        if (sp <= 0 || o.db.num(param, id, `spEffectMsgId${k}`) !== -1 || !o.db.hasRow('SpEffectParam', sp)) continue
        if (o.base.hasRow(param, id) && o.base.num(param, id, `spEffectBehaviorId${k}`) === sp) continue
        const status = BUILDUP_TEXTS.find(([field]) => o.db.num('SpEffectParam', sp, field) > 0)
        if (status)
          out.push(
            `Behavior SpEffect ${k + 1} builds up ${status[1]}, but SpEffect Message ID [${k}] is −1, so the weapon’s status screen doesn’t list it: ${status[2]} says “Causes ${status[1]} buildup (…)”, the number filled in by the game.`,
          )
      }
    }
    return out.length ? out : undefined
  }

  /** For copying a shop row: the first free id in the shop holding `id` (null: in no shop, or full). */
  shopFreeId(id: number): { id: number | null; shop: A.ShopRange | null } {
    return this.session.requireOpen().ids.shopFreeId(id)
  }

  /** A bullet's attack when only enemies have it (AtkParam_Npc but no AtkParam_Pc row). */
  private enemyAttackOf(bullet: number): { id: number; name: string } | undefined {
    const o = this.session.requireOpen()
    const atk = o.db.num('Bullet', bullet, 'atkId_Bullet', -1)
    if (atk <= 0 || o.db.hasRow('AtkParam_Pc', atk) || !o.db.hasRow('AtkParam_Npc', atk)) return undefined
    return { id: atk, name: o.db.rowName('AtkParam_Npc', atk) }
  }

  /** Sets several numeric fields of a row at once (for tools: no view built). */
  setFields(param: string, id: number, values: Record<string, number>): void {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    const row = o.db.row(param, id)
    if (!row) throw new Error(`${param} ${id} does not exist`)
    for (const [field, value] of Object.entries(values)) {
      const f = p.def.fieldsByName.get(field)
      if (!f) throw new Error(`${param}.${field} not found`)
      setField(row.data, f, value)
    }
    p.dirty = true
    this.session.paramsEdited(o)
  }

  /**
   * Moves an animation category to a new number (Shift+F2). With `params`,
   * the weapons that play it (wepmotionCategory, spAtkcategory, every
   * affinity) and the skills (swordArtsTypeNew, for a6xx) follow it.
   */
  renumberAnimationCategory(
    category: number,
    to: number,
    register: boolean,
    params: boolean,
  ): A.Res<'anim:renumberCategory'> {
    const o = this.session.requireOpen()
    const { names } = o.anims.renumberCategory(category, to)
    let rows = 0
    if (params) {
      const weapons = o.db.get('EquipParamWeapon').param.rows
      for (const r of weapons) {
        for (const field of ['wepmotionCategory', 'spAtkcategory']) {
          if (o.db.value('EquipParamWeapon', r.id, field) !== category) continue
          this.setRowFieldOnly('EquipParamWeapon', r.id, field, to)
          rows++
        }
      }
      if (category >= 600 && to >= 600) {
        for (const r of o.db.get('SwordArtsParam').param.rows) {
          if (o.db.value('SwordArtsParam', r.id, 'swordArtsTypeNew') !== category - 600) continue
          this.setRowFieldOnly('SwordArtsParam', r.id, 'swordArtsTypeNew', to - 600)
          rows++
        }
      }
    }
    const registration = register && names.length ? o.anims.register(names) : null
    return { category: to, animations: names.length, rows, registration }
  }

  setRowField(param: string, id: number, field: string, value: number | string | number[]): A.RowView {
    this.setRowFieldOnly(param, id, field, value)
    return this.rowView(param, id)
  }

  /** setRowField without building the row's view (making kept changes again, many at once). */
  setRowFieldOnly(param: string, id: number, field: string, value: number | string | number[]): void {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    const row = o.db.row(param, id)
    const f = p.def.fieldsByName.get(field)
    if (!row || !f) throw new Error(`${param} ${id}.${field} not found`)
    setField(row.data, f, value)
    p.dirty = true
    this.session.paramsEdited(o)
  }

  paramList(): A.ParamInfo[] {
    const o = this.session.requireOpen()
    const diffs = new Map(diffParams(o.base, o.db).map((d) => [d.param, d]))
    return [...o.db.params.values()]
      .map((p) => ({
        name: p.name,
        paramType: p.def.paramType,
        description: p.def.description,
        rows: p.param.rows.length,
        added: diffs.get(p.name)?.added.length ?? 0,
        changed: diffs.get(p.name)?.changed.length ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  paramRows(req: A.Req<'params:rows'>): A.BrowseRow[] {
    const o = this.session.requireOpen()
    const q = req.query.trim().toLowerCase()
    const out: A.BrowseRow[] = []
    for (const row of o.db.get(req.param).param.rows) {
      const name = o.db.rowName(req.param, row.id)
      const state = this.rowState(req.param, row.id)
      if (req.onlyProject && !state) continue
      if (q && !name.toLowerCase().includes(q) && !String(row.id).includes(q)) continue
      out.push({ param: req.param, id: row.id, name, state })
      if (out.length >= req.limit) break
    }
    return out
  }

  /**
   * Whether a new row can take `id`, the next id that can, and the ids in use
   * (with names) and referenced-but-missing around it, for the ID picker.
   */
  idNeighborhood(param: string, id: number, radius = 60, exclude: number[] = []): A.IdNeighborhood {
    const o = this.session.requireOpen()
    const ids = new IdAvailability(o.db, this.session.newerGame())
    const skip = new Set(exclude)
    const check = (n: number) => (skip.has(n) ? 'picked for another copy' : ids.problem(param, n))
    const problem = check(id)
    const name = o.db.hasRow(param, id) ? o.db.rowName(param, id) : ''
    const step = param === 'EquipParamWeapon' ? 10_000 : 1
    let nextFree = -1
    let start = Math.max(1, Math.floor(id))
    if (step > 1) start = Math.ceil(start / step) * step
    for (let n = start, k = 0; k < 200_000; n += step, k++) {
      if (check(n) === null) {
        nextFree = n
        break
      }
    }
    const lo = Math.max(0, Math.floor(id) - radius)
    const hi = Math.floor(id) + radius
    const rows = o.db
      .get(param)
      .param.rows.filter((r) => r.id >= lo && r.id <= hi)
      .map((r) => ({ id: r.id, name: o.db.rowName(param, r.id) }))
    const referenced = [...ids.danglingRefs(param)].filter((n) => n >= lo && n <= hi).sort((a, b) => a - b)
    return {
      param,
      id,
      free: problem === null,
      problem: problem ?? undefined,
      name,
      nextFree,
      from: lo,
      to: hi,
      rows,
      referenced,
    }
  }

  freeId(param: string, from: number): number {
    const o = this.session.requireOpen()
    let id = Math.max(0, Math.floor(from))
    while (o.db.hasRow(param, id)) id++
    return id
  }

  addRow(param: string, id: number, copyFrom?: number, name?: string): A.RowView {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    if (!Number.isInteger(id) || id < 0 || id > 0x7fffffff) throw new Error(`${id} is not a valid row id`)
    if (o.db.hasRow(param, id)) throw new Error(`${param} already has a row ${id}`)
    let data: Buffer
    if (copyFrom !== undefined) {
      const src = o.db.row(param, copyFrom)
      if (!src) throw new Error(`${param} ${copyFrom} does not exist`)
      data = Buffer.from(src.data)
    } else {
      data = defaultRowData(p.def)
    }
    insertRow(o.db, param, { id, name: '', data })
    const label = name ?? (copyFrom !== undefined ? `${o.db.rowName(param, copyFrom)} (copy)`.trim() : '')
    if (label) this.setName(param, id, label)
    this.session.paramsEdited(o)
    return this.rowView(param, id)
  }

  deleteRow(param: string, id: number): void {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    const i = p.index.get(id)
    if (i === undefined) throw new Error(`${param} ${id} does not exist`)
    p.param.rows.splice(i, 1)
    ParamDatabase.reindex(p)
    p.dirty = true
    if (o.spellforgeNames[param]?.[String(id)] !== undefined) {
      delete o.spellforgeNames[param][String(id)]
      o.namesDirty = true
    }
    this.session.paramsEdited(o)
  }

  renameRow(param: string, id: number, name: string): A.RowView {
    this.setName(param, id, name.trim())
    return this.rowView(param, id)
  }

  private setName(param: string, id: number, name: string): void {
    const o = this.session.requireOpen()
    const p = o.db.get(param)
    if (name) p.rowNames.set(id, name)
    else p.rowNames.delete(id)
    ;(o.spellforgeNames[param] ??= {})[String(id)] = name
    o.namesDirty = true
  }

  /**
   * Writes an item's in-game name into the project's item text: always
   * item_dlc02.msgbnd (what the game reads with the DLC), and item.msgbnd too
   * if the project already overrides it, so the two never disagree.
   */
  setGameName(param: string, id: number, text: string): A.RowView {
    const o = this.session.requireOpen()
    if (!nameTableFor(param)) throw new Error(`${param} rows have no in-game name`)
    const value = text.trim()
    if (!value) throw new Error('The name can’t be empty')
    const targets = ['msg/engus/item_dlc02.msgbnd.dcx']
    if (o.project.resolve('msg/engus/item.msgbnd.dcx')?.source === 'project') targets.push('msg/engus/item.msgbnd.dcx')
    const textKey = this.textKeyOf(param, id)
    let written = 0
    for (const rel of targets) {
      let msg = o.msgs.get(rel)
      if (!msg) {
        if (!o.project.resolve(rel)) continue
        const raw = dcxDecompress(o.project.read(rel).data)
        msg = { rel, bnd: readBnd4(raw.data), dcx: raw.info }
      }
      if (setNameInMsgBnd(msg, param, textKey, value)) {
        o.msgs.set(rel, msg)
        written++
      }
    }
    if (!written) throw new Error('No item text file to write the name into')
    this.gameNameChanged(param, textKey, value)
    return this.rowView(param, id)
  }

  /** Sets an item's in-game description (WeaponCaption, ArtsCaption...), where its name is kept. */
  setCaption(param: string, id: number, text: string): void {
    const o = this.session.requireOpen()
    const table = captionTableFor(param)
    if (!table) throw new Error(`${param} rows have no description`)
    const targets = ['msg/engus/item_dlc02.msgbnd.dcx']
    if (o.project.resolve('msg/engus/item.msgbnd.dcx')?.source === 'project') targets.push('msg/engus/item.msgbnd.dcx')
    const key = this.textKeyOf(param, id)
    let written = 0
    for (const rel of targets) {
      let msg = o.msgs.get(rel)
      if (!msg) {
        if (!o.project.resolve(rel)) continue
        const raw = dcxDecompress(o.project.read(rel).data)
        msg = { rel, bnd: readBnd4(raw.data), dcx: raw.info }
      }
      if (setTextInMsgBnd(msg, table, key, text)) {
        o.msgs.set(rel, msg)
        this.session.text.msgCache.delete(rel)
        written++
      }
    }
    if (!written) throw new Error('No item text file to write the description into')
  }

  /** The text entry a row's in-game name lives in: its own id, or its textId (skills). */
  private textKeyOf(param: string, id: number): number {
    const field = TEXT_ID_FIELD[param]
    if (!field) return id
    const v = this.session.requireOpen().db.num(param, id, field)
    return v > 0 ? v : id
  }

  /**
   * An in-game name changed: the names the app shows follow, for the row and
   * for rows named by the same text (a spell's item and its Magic row).
   */
  gameNameChanged(param: string, textKey: number, value: string): void {
    const o = this.session.requireOpen()
    for (const q of paramsNamedBy(param)) {
      const p = o.db.params.get(q)
      if (!p) continue
      const field = TEXT_ID_FIELD[q]
      const ids = field
        ? p.param.rows.filter((r) => o.db.num(q, r.id, field) === textKey).map((r) => r.id)
        : o.db.hasRow(q, textKey)
          ? [textKey]
          : []
      for (const id of ids) this.rowNameFollows(q, id, value)
    }
  }

  /** One row's shown names after its in-game name changed. */
  private rowNameFollows(q: string, id: number, value: string): void {
    const o = this.session.requireOpen()
    const p = o.db.get(q)
    const previous = o.gameNames[q]?.[String(id)]
    ;(o.gameNames[q] ??= {})[String(id)] = value
    // Show it as the row name unless the project names the row itself. A
    // duplicate's automatic name ("Uchigatana (copy)") gives way to it.
    const current = p.rowNames.get(id)
    const automatic = !!current && / \((copy|clone)\)$/.test(current)
    if (!p.rowNames.has(id) || current === previous || automatic) {
      p.rowNames.set(id, value)
      const ours = o.spellforgeNames[q]
      if (ours && String(id) in ours) {
        ours[String(id)] = value
        o.namesDirty = true
      }
    }
  }

  referrers(param: string, id: number): A.RowReferrer[] {
    const o = this.session.requireOpen()
    return o.db.refsTo(param, id).map((r) => ({ ...r, name: o.db.rowName(r.param, r.id) }))
  }
}

/**
 * A SpEffect's status buildup field, the status in words, and the game's Weapon_Effect text naming it with the
 * number the game fills in (<?freezeATKpwr?> and the like; "slight" and "heavy" versions sit beside each).
 */
const BUILDUP_TEXTS: [field: string, status: string, text: number][] = [
  ['poizonAttackPower', 'poison', 6401],
  ['diseaseAttackPower', 'scarlet rot', 6451],
  ['bloodAttackPower', 'blood loss', 6501],
  ['curseAttackPower', 'death', 6551],
  ['freezeAttackPower', 'frost', 6601],
  ['sleepAttackPower', 'sleep', 6651],
  ['madnessAttackPower', 'madness', 6701],
]
/** Params shown in reference trees. Others (upgrade tables, sounds) are noise there. */
const TREE_PARAMS = new Set([
  'BehaviorParam_PC',
  'BehaviorParam',
  'Bullet',
  'AtkParam_Pc',
  'AtkParam_Npc',
  'SpEffectParam',
  'SpEffectVfxParam',
  'SwordArtsParam',
  'Magic',
])
/** Param names in words, for "points at nothing" lines. */
const PARAM_WORDS: Record<string, string> = {
  Bullet: 'Bullet',
  AtkParam_Pc: 'player attack (AtkParam_Pc)',
  AtkParam_Npc: 'enemy attack (AtkParam_Npc)',
  SpEffectParam: 'SpEffect',
  EquipParamWeapon: 'weapon',
  EquipParamGoods: 'item (Goods)',
  EquipParamProtector: 'armor piece',
  EquipParamAccessory: 'talisman',
  EquipParamGem: 'Ash of War',
  Magic: 'spell',
  SwordArtsParam: 'skill',
  BehaviorParam_PC: 'player behavior',
  BehaviorParam: 'enemy behavior',
  SpEffectVfxParam: 'SpEffect visual (SpEffectVfxParam)',
  NpcParam: 'NPC',
  ItemLotParam_map: 'map item lot',
  ItemLotParam_enemy: 'enemy item lot',
}
