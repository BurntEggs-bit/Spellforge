/**
 * Scaling a skill or a spell (or a bullet, or one effect) to a chosen size:
 * its effects (FXR: sizes, offsets, lengths and radii, by @cccode/fxr's
 * scale) and its hitboxes (its player attacks' hit radii, its bullets' hit
 * radius and the radius they grow to) together, so what you see and what
 * hits stay matched: Margit's hammer made a skill, at 80%, is a smaller
 * hammer hitting a smaller area.
 *
 * What a skill or spell owns:
 *   - a skill (SwordArtsParam): the animations of its category (600 +
 *     swordArtsTypeNew), the effects their events spawn, and the skill
 *     behaviors (judges 3000-3999) their attack and bullet events fire, as
 *     the weapons that have it look them up (their behavior variation, as
 *     the game does; every variation's for a skill an Ash of War gives, or
 *     one no weapon has): another skill's rows with the same judges, on
 *     another weapon, aren't its; the moveset's and common behaviors those
 *     animations may also fire belong to the weapons, and stay;
 *   - a spell (Magic, or its item), a bullet, a behavior: what its rows
 *     reference: bullets and the bullets they spawn, player attacks
 *     (AtkParam_Pc; an enemy's own AtkParam_Npc rows are never changed),
 *     and their effects;
 *   - every effect brings the effects it proxies.
 * An effect held on a weapon (Margit's hammer, spawned at the katana's tip,
 * its shaft through the hands) is scaled about the weapon's grip, not the
 * point it's spawned at, so it gets smaller in the hands instead of
 * shrinking toward the tip and floating free of them. Held means its shapes
 * reach most of the way from that point to the grip; a spark at the tip
 * just reaches the tip, and is scaled where it is.
 * An effect other content also uses (another row or animation) is copied
 * first: the copy is scaled and the skill's rows and animations point at it,
 * so the rest of the game keeps the original (an effect scaled on its own is
 * scaled where it is: that's the point). Rows other content shares are
 * scaled where they are, and listed.
 *
 * Sizes are kept in .spellforge/scales.json (1 = as the game, or the enemy,
 * made it): each skill's or spell's, its hitboxes', each effect's. So 80%
 * always means 80% of the original, however many times it was scaled.
 */
import { shiftEffect } from '../../core/effects/nodeTransforms.ts'
import type { Session } from '../session.ts'
import { childEffectIds, remapEffectReferences } from '../../core/params/workflow.ts'
import { weaponPartName } from '../../core/animation/character.ts'
import { decodeEvent, writeField } from '../../core/animation/animations.ts'
import { gripInDummyFrame, parseDummyId } from '../../core/animation/dummies.ts'
import type { TaeFileEvent } from '../../core/formats/taeFile.ts'
import type * as A from '../../shared/api.ts'

export const SCALES_RECORD = '.spellforge/scales.json'

export interface ScaleRecord {
  /** Skills, spells, bullets ("SwordArtsParam:9100"): their size, and their hitboxes'. */
  items: Record<string, { size: number; hitboxes?: number }>
  /** Each effect's size. */
  effects: Record<string, number>
  /** Effects copied to be scaled (shared with other content): copy id -> the original's. */
  copies: Record<string, number>
  /**
   * Effects held by their owner: where its hand holds them, in their own
   * frame at their original size (Margit's grip on his hammer's shaft, from
   * the point it appears at). Set when a boss's move is made a skill.
   */
  handles?: Record<string, number[]>
  /** Held effects (copies) moved so their owner's grip is in the player's: the grip they were fitted to. */
  fitted?: Record<string, number[]>
}

export const emptyScaleRecord = (): ScaleRecord => ({ items: {}, effects: {}, copies: {} })

const MIN_SIZE = 0.1
const MAX_SIZE = 5

const ATTACK_RADII = Array.from({ length: 16 }, (_, k) => `hit${k}_Radius`)
const BULLET_RADII = ['hitRadius', 'hitRadiusMax']
/** The rows a skill or spell owns, followed through references. */
const FOLLOW = new Set(['Bullet', 'AtkParam_Pc', 'BehaviorParam_PC'])
/** Roots it scales. */
const ROOTS = new Set(['SwordArtsParam', 'Magic', 'EquipParamGoods', 'Bullet', 'BehaviorParam_PC', 'effect'])
/** Behavior events (attack, bullet, PC behavior); their judge field links to the skill's behaviors. */
const BEHAVIOR_EVENT_TYPES = new Set([1, 2, 307])
/** Skill judges: BehaviorParam_PC category 3. */
const isSkillJudge = (j: number) => j >= 3000 && j < 4000
/** The point a TAE dummy id names on a held weapon's main model (10xxx right hand, 20xxx left), or null. */
function heldWeaponPoint(id: number): number | null {
  const ref = parseDummyId(id)
  return ref.on !== 'body' && ref.model === 0 ? ref.point : null
}
/** How far toward the grip an effect's shapes must reach for it to count as held. */
const HELD_REACH = 0.6

interface Owned {
  key: string
  root: { param: string; id: number; name: string }
  rows: Set<string>
  animations: string[]
  /** Effects its rows and animations use directly. */
  effects: Set<number>
  attacks: number[]
  bullets: number[]
  notes: string[]
  /** A skill: a weapon that has it (the project's own first), to watch it with. */
  weapon?: number
  /** A skill's effects spawned at a point of its right-hand weapon: that dummy (TAE id). */
  spawns: Map<number, number>
}

interface Held {
  /** The grip, in the effect's axes. */
  grip: number[]
  /** Its shapes reach the hands: scaled about the grip unless asked otherwise. */
  inHand: boolean
}

export class Scaler {
  private s: Session

  constructor(s: Session) {
    this.s = s
  }

  private get db() {
    return this.s.internals().db
  }

  private get lib() {
    return this.s.internals().lib
  }

  /** A spell's item is its spell. */
  private normalize(param: string, id: number): { param: string; id: number } {
    if (!ROOTS.has(param)) throw new Error('Spellforge scales skills, spells, bullets and effects')
    if (param === 'EquipParamGoods') {
      if (!this.db.hasRow('Magic', id)) throw new Error(`Item ${id} isn't a spell: there's nothing to scale`)
      return { param: 'Magic', id }
    }
    if (param === 'effect' ? !this.lib.hasEffect(id) : !this.db.hasRow(param, id))
      throw new Error(`${param === 'effect' ? 'Effect' : param} ${id} doesn't exist`)
    return { param, id }
  }

  /** Everything a skill, spell, bullet or effect owns. */
  private gather(param: string, id: number): Owned {
    const db = this.db
    const root = this.normalize(param, id)
    const key = `${root.param}:${root.id}`
    const own: Owned = {
      key,
      root: {
        ...root,
        name:
          root.param === 'effect'
            ? this.s.effectName(root.id) || `Effect ${root.id}`
            : db.rowName(root.param, root.id) || `${root.param} ${root.id}`,
      },
      rows: new Set(),
      animations: [],
      effects: new Set(),
      attacks: [],
      bullets: [],
      notes: [],
      spawns: new Map(),
    }
    if (root.param === 'effect') {
      own.effects.add(root.id)
      return own
    }
    const stack: [string, number][] = []
    const visit = (p: string, i: number) => {
      const k = `${p}:${i}`
      if (own.rows.has(k) || !db.hasRow(p, i)) return
      own.rows.add(k)
      stack.push([p, i])
    }
    visit(root.param, root.id)
    if (root.param === 'SwordArtsParam') {
      const category = 600 + this.db.num('SwordArtsParam', root.id, 'swordArtsTypeNew')
      const anims = this.s.animations
      const template = anims.templateData().template
      const weapons = db
        .get('EquipParamWeapon')
        .param.rows.filter((r) => this.db.num('EquipParamWeapon', r.id, 'swordArtsParamId') === root.id)
        .map((r) => r.id)
      // Its behaviors are the rows its weapons look its judges up in: two skills made on two
      // weapons can share judge ids, each on its own weapon's variation. An Ash of War's skill
      // goes on any weapon it fits, so every variation's rows can be its own.
      const fromAsh =
        db.params.has('EquipParamGem') &&
        db
          .get('EquipParamGem')
          .param.rows.some((r) => this.db.num('EquipParamGem', r.id, 'swordArtsParamId') === root.id)
      const variations =
        fromAsh || !weapons.length
          ? null
          : [...new Set(weapons.map((w) => this.db.num('EquipParamWeapon', w, 'behaviorVariationId')))]
      const judgeRows = (judge: number): number[] =>
        variations
          ? variations.map((v) => this.s.character.behaviorRow(judge, v)).filter((r): r is number => r !== null)
          : anims.judgeRows(judge).map((r) => r.id)
      let list: A.AnimListItem[] = []
      try {
        list = anims.list(category, '')
      } catch {
        own.notes.push(`The player has no animation category a${category} for this skill.`)
      }
      let weaponBehaviors = 0
      for (const a of list) {
        own.animations.push(a.name)
        for (const ev of anims.storedEvents(a.name)) {
          const fields = decodeEvent(ev as TaeFileEvent, template)
          const dummy = fields.find((f) => /^DummyPolyID$/i.test(f.name))?.value
          for (const f of fields) {
            if (f.link === 'effect' && f.value > 0) {
              own.effects.add(f.value)
              if (dummy !== undefined && heldWeaponPoint(dummy) !== null && !own.spawns.has(f.value))
                own.spawns.set(f.value, dummy)
            } else if (f.link === 'judge' && BEHAVIOR_EVENT_TYPES.has(ev.type) && f.value >= 0) {
              if (!isSkillJudge(f.value)) {
                weaponBehaviors++
                continue
              }
              for (const r of judgeRows(f.value)) visit('BehaviorParam_PC', r)
            }
          }
        }
      }
      if (weaponBehaviors)
        own.notes.push(
          `Its animations also fire ${weaponBehaviors} of the weapons’ own moveset behaviors; those belong to the weapons and keep their size.`,
        )
      own.weapon = weapons.find((w) => this.s.params.rowState('EquipParamWeapon', w)) ?? weapons[0]
    }
    while (stack.length) {
      const [p, i] = stack.pop()!
      if (p === 'AtkParam_Pc') own.attacks.push(i)
      if (p === 'Bullet') own.bullets.push(i)
      for (const s of db.sfxRefsFrom(p, i)) if (s.sfxId > 0) own.effects.add(s.sfxId)
      if (p === 'BehaviorParam_PC') {
        const refType = this.db.num(p, i, 'refType')
        const refId = this.db.num(p, i, 'refId')
        if (refType === 0) visit('AtkParam_Pc', refId)
        else if (refType === 1) visit('Bullet', refId)
        continue
      }
      for (const r of db.refsFrom(p, i)) if (FOLLOW.has(r.targetParam)) visit(r.targetParam, r.targetId)
    }
    if (
      db.refsFrom(root.param, root.id).some((r) => r.targetParam === 'AtkParam_Npc') ||
      own.bullets.some((b) => db.refsFrom('Bullet', b).some((r) => r.targetParam === 'AtkParam_Npc'))
    )
      own.notes.push('Enemies’ own attacks (AtkParam_Npc) keep their size: only the player’s are scaled.')
    own.attacks.sort((a, b) => a - b)
    own.bullets.sort((a, b) => a - b)
    return own
  }

  /** The effects an effect proxies, transitively (only those that exist). */
  private family(ids: Iterable<number>): number[] {
    const out = new Set<number>()
    const stack = [...ids]
    while (stack.length) {
      const id = stack.pop()!
      if (out.has(id) || !this.lib.hasEffect(id)) continue
      out.add(id)
      for (const c of childEffectIds(this.lib.getEffect(id))) stack.push(c)
    }
    return [...out].sort((a, b) => a - b)
  }

  /** Who else uses an effect: rows and animations outside what's being scaled. */
  private effectSharedWith(id: number, own: Owned): string[] {
    if (own.root.param === 'effect') return []
    const uses = this.s.effects.effectUses(id)
    const animations = new Set(own.animations)
    return [
      ...(uses.alsoIn ? [`${uses.alsoIn}’s own effect file (same id)`] : []),
      ...uses.rows
        .filter((u) => !own.rows.has(`${u.param}:${u.id}`))
        .map(
          (u) => `${u.param} ${u.id}${this.db.rowName(u.param, u.id) ? ` (${this.db.rowName(u.param, u.id)})` : ''}`,
        ),
      ...uses.animations.filter((a) => !animations.has(a)).map((a) => `animation ${a}`),
    ]
  }

  /** Rows naming each row of a param, built once per call (each refsTo would scan every param). */
  private incoming = new Map<string, Map<number, { param: string; id: number; field: string }[]>>()
  private refsTo(param: string, id: number): { param: string; id: number; field: string }[] {
    let index = this.incoming.get(param)
    if (!index) this.incoming.set(param, (index = this.db.buildIncomingIndex(param)))
    return index.get(id) ?? []
  }
  /** Bullets the player can fire, worked out once each. */
  private fired = new Map<number, boolean>()

  private rowSharedWith(param: string, id: number, own: Owned): string[] {
    return (
      this.refsTo(param, id)
        .filter((r) => !own.rows.has(`${r.param}:${r.id}`))
        // An enemy's bullet names the attack too, but enemies use AtkParam_Npc's row.
        .filter((r) => !(param === 'AtkParam_Pc' && r.param === 'Bullet' && !this.firedByPlayer(r.id, 0, new Set())))
        .map((r) => `${r.param} ${r.id}${this.db.rowName(r.param, r.id) ? ` (${this.db.rowName(r.param, r.id)})` : ''}`)
    )
  }

  /** Whether the player can fire a bullet: something of the player's (a behavior, a spell, another such bullet) names it. */
  private firedByPlayer(bullet: number, depth: number, seen: Set<number>): boolean {
    const known = this.fired.get(bullet)
    if (known !== undefined) return known
    if (depth > 4 || seen.has(bullet)) return false
    seen.add(bullet)
    const yes = this.refsTo('Bullet', bullet).some((r) =>
      r.param === 'Bullet' ? this.firedByPlayer(r.id, depth + 1, seen) : r.param !== 'BehaviorParam',
    )
    if (depth === 0) this.fired.set(bullet, yes)
    return yes
  }

  /**
   * The skill's effects held on its weapon: where the grip is from the point
   * each is spawned at, and whether its shapes reach the hands.
   */
  private held(own: Owned): Map<number, Held> {
    const out = new Map<number, Held>()
    if (own.weapon === undefined || !own.spawns.size) return out
    let dummies: { id: number; position: number[]; forward: number[]; up: number[] }[]
    try {
      dummies = this.s.character.part(
        weaponPartName(this.db.num('EquipParamWeapon', own.weapon, 'equipModelId')),
      ).dummies
    } catch {
      return out
    }
    const heldAt = new Set<number>()
    for (const [effect, tae] of own.spawns) {
      const d = dummies.find((x) => x.id === heldWeaponPoint(tae))
      if (!d) continue
      const grip = gripInDummyFrame(d)
      if (Math.hypot(grip[0], grip[1], grip[2]) < 0.05) continue
      const inHand = !!this.handleOf(effect) || this.reaches(effect, grip)
      if (inHand) heldAt.add(tae)
      out.set(effect, { grip, inHand })
    }
    // What appears at the same point as a held effect (the hammer's flash at its head) moves with it.
    for (const [effect, h] of out) if (heldAt.has(own.spawns.get(effect)!)) h.inHand = true
    return out
  }

  /** A held effect for the plan: its grip, and where its owner holds it and the size that fits the weapon, when known. */
  private heldView(id: number, h: Held, weapon: string): NonNullable<A.ScalePlanEffect['held']> {
    const grip = h.grip
    const distance = Math.hypot(grip[0], grip[1], grip[2])
    const handle = this.handleOf(id) ?? undefined
    // At size s with its owner's grip in the hand, the point it appears at is s·(handle · along) from the hand, along the weapon
    // (both its owner's grip and yours lie behind that point: Margit's hand is 1.96 m back down the shaft from the hammer's head).
    const along = handle ? (handle[0] * grip[0] + handle[1] * grip[1] + handle[2] * grip[2]) / distance : 0
    const fitSize = handle && along > 1e-3 ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, distance / along)) : undefined
    return {
      weapon,
      grip,
      distance,
      inHand: h.inHand,
      ...(handle ? { handle, fitted: !!this.s.scaleRecord().fitted?.[id] } : {}),
      ...(fitSize ? { fitSize } : {}),
    }
  }

  /** Where an effect's owner holds it (its own frame, original size), or its original's for a copy. */
  private handleOf(id: number): number[] | null {
    const record = this.s.scaleRecord()
    const h =
      record.handles?.[id] ?? (record.copies[id] !== undefined ? record.handles?.[record.copies[id]] : undefined)
    return h && h.length === 3 ? h : null
  }

  /** Whether an effect's shapes (its models, its emitters' volumes) reach most of the way to `grip`. */
  private reaches(effect: number, grip: number[]): boolean {
    let spec
    try {
      spec = this.s.effects.preview(effect)
    } catch {
      return false
    }
    const q = grip.map((v) => v * HELD_REACH)
    const pad = 0.1 * Math.hypot(grip[0], grip[1], grip[2])
    for (const e of spec.emitters) {
      let lo: number[]
      let hi: number[]
      if (e.appearance.kind === 'model' && e.appearance.model) {
        const meshes = this.s.assets.modelMesh(e.appearance.model)
        if (!meshes?.length) continue
        const scale = Math.max(0, ...e.size.samples.flat().map(Math.abs)) || 1
        lo = [Infinity, Infinity, Infinity]
        hi = [-Infinity, -Infinity, -Infinity]
        for (const m of meshes)
          for (let i = 0; i + 2 < m.positions.length; i += 3)
            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], m.positions[i + k] * scale)
              hi[k] = Math.max(hi[k], m.positions[i + k] * scale)
            }
      } else if (e.appearance.kind === 'light') continue
      else {
        const [a = 0, b = 0, c = 0] = e.shape.size.map(Math.abs)
        const half =
          e.shape.kind === 'box'
            ? [a / 2, b / 2, c / 2]
            : e.shape.kind === 'rect'
              ? [a / 2, b / 2, 0]
              : e.shape.kind === 'cylinder'
                ? [a, b / 2, a]
                : [a, a, a]
        if (half.every((h) => h === 0)) continue
        lo = half.map((h) => -h)
        hi = half
      }
      // The point, in the emitter's own axes (rotation row-major, relative to the effect).
      const d = [q[0] - e.offset[0], q[1] - e.offset[1], q[2] - e.offset[2]]
      const R = e.rotation
      const p = [0, 1, 2].map((col) => R[col] * d[0] + R[3 + col] * d[1] + R[6 + col] * d[2])
      if (p.every((v, k) => v >= lo[k] - pad && v <= hi[k] + pad)) return true
    }
    return false
  }

  private planOf(own: Owned): A.ScalePlan {
    const record = this.s.scaleRecord()
    const effects = [...own.effects].filter((id) => this.lib.hasEffect(id)).sort((a, b) => a - b)
    const missing = own.effects.size - effects.length
    const notes = [...own.notes]
    if (missing)
      notes.push(
        `${missing} of its effects aren’t in the common effect files (a character’s own, or missing): they can’t be scaled here.`,
      )
    const item = record.items[own.key]
    const size = own.root.param === 'effect' ? (record.effects[own.root.id] ?? 1) : (item?.size ?? 1)
    const held = this.held(own)
    const weaponName =
      own.weapon !== undefined ? this.db.rowName('EquipParamWeapon', own.weapon) || `weapon ${own.weapon}` : ''
    return {
      key: own.key,
      root: own.root,
      size,
      hitboxSize: item?.hitboxes ?? 1,
      animations: own.animations,
      weapon:
        own.weapon !== undefined
          ? { id: own.weapon, name: this.db.rowName('EquipParamWeapon', own.weapon) }
          : undefined,
      effects: effects.map((id) => {
        const children = this.family([id]).filter((c) => c !== id)
        return {
          id,
          name: this.s.effectName(id) || `Effect ${id}`,
          size: record.effects[id] ?? 1,
          children,
          sharedWith: this.effectSharedWith(id, own).slice(0, 12),
          usedBy:
            own.root.param === 'effect'
              ? this.s.effects.effectUses(id).rows.length + this.s.effects.effectUses(id).animations.length
              : undefined,
          held: held.has(id) ? this.heldView(id, held.get(id)!, weaponName) : undefined,
        }
      }),
      attacks: own.attacks.map((id) => ({
        id,
        name: this.db.rowName('AtkParam_Pc', id),
        radii: ATTACK_RADII.map((f) => this.db.num('AtkParam_Pc', id, f)).filter((r) => r > 0),
        sharedWith: this.rowSharedWith('AtkParam_Pc', id, own).slice(0, 8),
      })),
      bullets: own.bullets.map((id) => ({
        id,
        name: this.db.rowName('Bullet', id),
        radius: this.db.num('Bullet', id, 'hitRadius'),
        radiusMax: this.db.num('Bullet', id, 'hitRadiusMax'),
        sharedWith: this.rowSharedWith('Bullet', id, own).slice(0, 8),
      })),
      notes,
    }
  }

  plan(param: string, id: number): A.ScalePlan {
    return this.planOf(this.gather(param, id))
  }

  /**
   * Scales to `size` (of the original): the chosen effects (with the effects
   * they proxy; shared ones copied first) and, if asked, the hitboxes.
   */
  apply(req: A.ScaleRequest): A.ScaleResult {
    const own = this.gather(req.param, req.id)
    const before = this.planOf(own)
    const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, req.size))
    if (!Number.isFinite(size)) throw new Error('Pick a size')
    const lib = this.lib
    const record = this.s.scaleRecord()
    const out: A.ScaleResult = {
      size,
      effects: 0,
      copied: [],
      attacks: 0,
      bullets: 0,
      animationsEdited: 0,
      plan: before,
    }

    // 1. Effects: the chosen ones and everything they proxy.
    const chosen = before.effects.filter((e) => req.effects.includes(e.id)).map((e) => e.id)
    const family = this.family(chosen)
    // Held effects: scaled about the grip (as the plan says, or as asked).
    const pivots = new Map<number, number[]>()
    for (const e of before.effects)
      if (e.held && chosen.includes(e.id) && (req.pivots?.[e.id] ?? (e.held.inHand ? 'grip' : 'point')) === 'grip')
        pivots.set(e.id, e.held.grip)
    // Copy what other content uses (not when scaling one effect on its own), and below a copy, everything.
    const copy = new Set(
      own.root.param === 'effect' ? [] : family.filter((id) => this.effectSharedWith(id, own).length > 0),
    )
    for (let grew = true; grew;) {
      grew = false
      for (const id of [...copy])
        for (const c of childEffectIds(lib.getEffect(id)))
          if (family.includes(c) && !copy.has(c)) {
            copy.add(c)
            grew = true
          }
    }
    const map = new Map<number, number>()
    let next = this.s.internals().effectIdStart
    for (const id of [...copy].sort((a, b) => a - b)) {
      const to = lib.freeEffectId(next)
      lib.cloneEffect(id, to)
      map.set(id, to)
      record.effects[to] = record.effects[id] ?? 1
      record.copies[to] = record.copies[id] ?? id
      // A copy of an effect already fitted to the hand is fitted the same (it isn't moved again).
      if (record.handles?.[id]) record.handles[to] = record.handles[id]
      if (record.fitted?.[id]) (record.fitted ??= {})[to] = record.fitted[id]
      out.copied.push({ from: id, to })
      next = to + 1
    }
    for (const id of family) {
      const final = map.get(id) ?? id
      const fxr = lib.getEffect(final)
      // Copies and the skill's own effects point at the copies; the originals stay as they are.
      if (map.size) remapEffectReferences(fxr, map)
      const g = pivots.get(id)
      // Held by its owner at a known grip (Margit's hand on his hammer): moved
      // once so that grip is in the player's hand, on the weapon's line. Its
      // grip is at c·h + (1 - c)·g now (c: its size, scaled about g so far).
      const h = this.handleOf(id)
      if (g && h && !record.fitted?.[final]) {
        const c = record.effects[final] ?? 1
        shiftEffect(
          fxr,
          g.map((v, k) => c * (v - h[k])),
        )
        ;(record.fitted ??= {})[final] = g
      }
      const factor = size / (record.effects[final] ?? 1)
      if (Math.abs(factor - 1) > 1e-6) {
        fxr.root.scale(factor)
        // About the grip: x' = g + f(x - g) = f x + (1 - f) g.
        if (g)
          shiftEffect(
            fxr,
            g.map((v) => (1 - factor) * v),
          )
      }
      lib.saveEffect(fxr)
      record.effects[final] = size
      out.effects++
    }
    // The skill's rows and animations, at the copies.
    if (map.size) {
      for (const k of own.rows) {
        const [p, i] = [k.slice(0, k.lastIndexOf(':')), Number(k.slice(k.lastIndexOf(':') + 1))]
        const values: Record<string, number> = {}
        for (const s of this.db.sfxRefsFrom(p, i)) if (map.has(s.sfxId)) values[s.field] = map.get(s.sfxId)!
        if (Object.keys(values).length) this.s.params.setFields(p, i, values)
      }
      const template = this.s.animations.templateData().template
      for (const name of own.animations) {
        const uses = this.s.animations
          .storedEvents(name)
          .some((ev) => decodeEvent(ev as TaeFileEvent, template).some((f) => f.link === 'effect' && map.has(f.value)))
        if (!uses) continue
        this.s.animations.editAnimation(name, (_tae, anim) => {
          for (const ev of anim.events)
            for (const f of decodeEvent(ev, template))
              if (f.link === 'effect' && map.has(f.value)) writeField(ev, f.type, f.offset, map.get(f.value)!)
        })
        out.animationsEdited++
      }
    }

    // 2. Hitboxes.
    if (req.hitboxes && own.root.param !== 'effect') {
      const factor = size / (record.items[own.key]?.hitboxes ?? 1)
      if (Math.abs(factor - 1) > 1e-6) {
        for (const id of own.attacks) {
          const values: Record<string, number> = {}
          for (const f of ATTACK_RADII) {
            const r = this.db.num('AtkParam_Pc', id, f)
            if (r > 0) values[f] = r * factor
          }
          if (Object.keys(values).length) {
            this.s.params.setFields('AtkParam_Pc', id, values)
            out.attacks++
          }
        }
        for (const id of own.bullets) {
          const values: Record<string, number> = {}
          for (const f of BULLET_RADII) {
            const r = this.db.num('Bullet', id, f)
            if (r > 0) values[f] = r * factor
          }
          if (Object.keys(values).length) {
            this.s.params.setFields('Bullet', id, values)
            out.bullets++
          }
        }
      }
      record.items[own.key] = { ...record.items[own.key], size, hitboxes: size }
    } else if (own.root.param !== 'effect') record.items[own.key] = { ...record.items[own.key], size }
    this.s.scaleRecordChanged()
    out.plan = this.planOf(this.gather(req.param, req.id))
    return out
  }
}
