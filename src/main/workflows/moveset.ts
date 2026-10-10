/**
 * A weapon's own moveset: some of its moves taken from other weapons (a
 * katana with a hammer's heavy attacks and a thrusting sword's light
 * attacks) or made a spell's casts (light attacks that cast a pebble), and
 * any skill, without changing any other weapon. Used from the Animations
 * page's Moveset panel.
 *
 * How the game picks a weapon's moves: every attack has an animation id
 * (030505: the first one-handed heavy attack). The behaviour graph plays it
 * from the weapon's own special category (EquipParamWeapon spAtkcategory:
 * a145 holds the Estoc's own heavy attacks) when that has the id, else from
 * its class's (wepmotionCategory: a027, thrusting swords). So:
 *   - the weapon gets a special category of its own holding the moves it
 *     takes: copies of the other weapons' animations (their events; the
 *     motion is referenced, not copied), registered in the behaviour graph;
 *     the rest still comes from its class;
 *   - how a move hits comes from its behavior row: BehaviorParam_PC
 *     100,000,000 + variation x 1000 + judge, looked up in the weapon's
 *     variation, then its class's hundred (Mace 1102 -> 1100), then 0. The
 *     weapon gets a variation of its own in its class's hundred whose rows
 *     for the moves it took are the other weapon's (motion values, damage
 *     type, stagger); every weapon model has the same hit points (100 tip,
 *     110 middle, 120 grip, 130), so they land along this weapon;
 *   - its skill can be any skill (stances: hold, then R1 or R2);
 *   - all its affinity rows (Heavy, Keen… its id + 100…1200) change together.
 * What was changed is kept in .spellforge/movesets.json, so changing it
 * again reuses its category and variation, and a move can go back.
 */
import type { Session } from '../session.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import {
  addEvent,
  decodeEvent,
  deleteEvent,
  newEventParams,
  writeField,
  type TaeTemplate,
} from '../../core/animation/animations.ts'
import { parseDummyId, weaponDummyId } from '../../core/animation/dummies.ts'
import type { TaeFileEvent } from '../../core/formats/taeFile.ts'
import type * as A from '../../shared/api.ts'
import { FLOAT_MAX, OPEN_EVENT_END } from '../../shared/api.ts'
import {
  behaviorCategoryOf,
  behaviorRowFor,
  behaviorRowId,
  behaviorVariationOf,
  judgeCategory,
} from '../../core/params/behaviorIds.ts'
import { isPlaceholderName } from '../../core/project/text.ts'
import { animationName, categoryLabel } from '../../shared/animIds.ts'
import { FPS } from '../../shared/frames.ts'

export const MOVESETS_RECORD = '.spellforge/movesets.json'

/** What Spellforge gave each weapon (by its first row's id). */
export interface MovesetRecord {
  weapons: Record<
    string,
    {
      category: number
      variation: number
      /** The weapon's values before (to go back). */
      original: { special: number; variation: number; skill: number }
      /**
       * Slot -> the weapon its moves were taken from; "slot:one" / "slot:two"
       * when only that grip's moves were (the other grip's stay as they were).
       */
      slots: Record<string, number>
      /** Behavior row judges this made, and the slot (or "slot:grip") each is for. */
      rows: Record<string, string>
      /**
       * An effect event put on its attacks (type and params, to find them again), and on which moves;
       * `vanish`: the effect it goes with as it ends (its event, seconds before the end it starts, how long).
       */
      effect?: {
        type: number
        params: string
        effect: number
        slots: string[]
        vanish?: { type: number; params: string; effect: number; lead: number; length: number }
      }
      /** Its hide effect (SpEffectParam) and the passive field it's in, when hidden. */
      hide?: { spEffect: number; field: string }
      /** The stances it was held in before they changed (wepmotionOneHandId / wepmotionBothHandId). */
      stance?: { one: number; both: number }
      /** Slot -> the spell its moves cast (and the spell whose cast they look like, if another). */
      casts?: Record<string, { spell: number; like?: number }>
      /**
       * Animation id -> the enemy move made that attack (Enemies → Make it an
       * attack), and the behavior judges its hits and bullets use.
       */
      enemy?: Record<string, { chr: string; animation: string; label: string; judges: number[] }>
    }
  >
}

/** Where an enemy's move can go among a weapon's attacks: one-handed or two-handed (+2000). */
const ATTACK_TARGETS: { key: string; label: string; from: number; to: number; each?: boolean }[] = [
  { key: 'r1', label: 'R1', from: 30000, to: 30099, each: true },
  { key: 'r2', label: 'R2 and charged R2', from: 30500, to: 30599 },
  { key: 'run', label: 'Running attack', from: 30200, to: 30299 },
  { key: 'roll', label: 'Roll attack', from: 30300, to: 30399 },
  { key: 'back', label: 'Backstep attack', from: 30400, to: 30499 },
  { key: 'counter', label: 'Guard counter', from: 30700, to: 30799 },
]
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']

export const emptyMovesetRecord = (): MovesetRecord => ({ weapons: {} })

/**
 * The moves a weapon has, by animation id ranges (one- and two-handed).
 * 0306xx (class versions of some skills) and the classes' own extras are
 * left alone.
 */
const MOVESET_SLOTS: { key: string; label: string; hint: string; sample: number; ranges: [number, number][] }[] = [
  {
    key: 'light',
    label: 'Light attacks',
    hint: 'R1 and its chain, one- and two-handed',
    sample: 30000,
    ranges: [
      [30000, 30099],
      [32000, 32099],
    ],
  },
  {
    key: 'heavy',
    label: 'Heavy attacks',
    hint: 'R2 and charged R2, one- and two-handed',
    sample: 30505,
    ranges: [
      [30500, 30599],
      [32500, 32599],
    ],
  },
  {
    key: 'running',
    label: 'Running attacks',
    hint: 'R1 or R2 while running',
    sample: 30200,
    ranges: [
      [30200, 30299],
      [32200, 32299],
    ],
  },
  {
    key: 'rolling',
    label: 'Roll and backstep attacks',
    hint: 'R1 right after a roll or a backstep',
    sample: 30300,
    ranges: [
      [30300, 30499],
      [32300, 32499],
    ],
  },
  {
    key: 'jumping',
    label: 'Jumping attacks',
    hint: 'R1 or R2 in the air',
    sample: 31040,
    ranges: [
      [31000, 31999],
      [33000, 33999],
    ],
  },
  {
    key: 'counter',
    label: 'Guard counter',
    hint: 'R2 right after blocking a hit',
    sample: 30700,
    ranges: [
      [30700, 30799],
      [32700, 32799],
    ],
  },
  {
    key: 'left',
    label: 'Left-hand attacks',
    hint: 'L1 with it in the left hand',
    sample: 35000,
    ranges: [[35000, 35999]],
  },
  {
    key: 'dual',
    label: 'Dual-wield attacks',
    hint: 'L1 with two of its kind (power stance)',
    sample: 34000,
    ranges: [[34000, 34999]],
  },
  { key: 'mounted', label: 'Mounted attacks', hint: 'R1 or R2 on Torrent', sample: 38000, ranges: [[38000, 39999]] },
]

/** Unseen Blade's effect: hides the right-hand weapon (state 184), nothing else. */
const UNSEEN_BLADE_SPEFFECT = 1466000
const PASSIVE_FIELDS = ['residentSpEffectId', 'residentSpEffectId1', 'residentSpEffectId2']

/** Classes whose "attacks" are shots, spells or shield work: not moves to take or give. */
const NOT_MELEE = new Set([41, 44, 45, 46, 47, 48, 49, 51, 52, 53, 56])

/*
 * Spells as moves. A spell is cast from its own animations: category 400 +
 * its Magic refType (Glintstone Pebble a401, Lightning Spear a436), the
 * right hand's 045000-045099 (045010, then 045020, 045030 chained; a held
 * cast like Lightning Spear's charged throw is the slow one). Their
 * CastHighlightedMagic events fire whichever spell is highlighted (refId1,
 * 2… of its Magic row), and their SpawnFFX_GoodsAndMagic events show its
 * cast effects (castSfxId, fireSfxId, effectSfxId). Copied in as a weapon's
 * attacks, they fire one spell's bullet through a behavior row of the
 * weapon's own instead, and show that spell's effects: no FP, the cast's
 * stamina. Their R1 windows (ChrActionFlag 4) chain them like attacks.
 */
/** Slots whose moves can be a spell's cast: attacks on the ground (jumps and mounted moves are sequences). */
const CAST_SLOTS = new Set(['light', 'heavy', 'running', 'rolling', 'counter'])
/** A cast that lets go later than this (s) is a held one: Lightning Spear's charged throw. */
const SLOW_CAST = 1.0
/** Behavior judges for casts: from here up (weapons' own attacks use lower ones). */
const CAST_JUDGE = 800
const EV = { attack: 1, bullet: 2, cast: 64, oneShotFfx: 96, magicFfx: [114, 115], sound: 129 }
/** Events that hit: AttackBehavior, BulletBehavior, CommonBehavior, PCBehavior. */
const HIT_EVENTS = new Set([1, 2, 5, 307])
/** Sound type of spells' own sounds (s523000: Glintstone Pebble's cast). */
const SPELL_SOUND = 5
/** Effect ids of spells' own effects (Lightning Spear's spear in hand, 525500). */
const isSpellEffect = (id: number) => id >= 500000 && id < 600000
/** A staff's casting point; a weapon casts from its tip. */
const STAFF_POINT = 181
const TIP = 100

const inSlot = (slot: (typeof MOVESET_SLOTS)[number], id: number) => slot.ranges.some(([a, b]) => id >= a && id <= b)
/** One grip's moves of a slot (its first range is one-handed, its second two-handed); no grip: all of them. */
const inGrip = (slot: (typeof MOVESET_SLOTS)[number], grip: A.MovesetGrip | undefined, id: number) => {
  if (!grip || slot.ranges.length < 2) return inSlot(slot, id)
  const [a, b] = slot.ranges[grip === 'one' ? 0 : 1]
  return id >= a && id <= b
}
/** A weapon's own moves, in words: "Estoc’s own", "Rellana’s Twin Blades’ own". */
const ownMoves = (name: string) => (/s$/i.test(name) ? `${name}’ own` : `${name}’s own`)
const gripWords = (grip: A.MovesetGrip) => (grip === 'one' ? 'one-handed' : 'two-handed')

export class Movesets {
  private s: Session

  constructor(s: Session) {
    this.s = s
  }

  private get db(): ParamDatabase {
    return this.s.internals().db
  }

  /**
   * The effect an animation plays as one of its effects goes: an effect event
   * at the same point starting in the last second of it, or just after
   * (Golden Hammer Leap's hammer, 0.1-2.9 s, breaks into light at 2.67 s, at
   * the hammer's head): where it starts before the end, and for how long.
   */
  private vanishOf(
    stored: readonly TaeFileEvent[],
    index: number,
  ): { type: number; params: Buffer; effect: number; lead: number; length: number } | null {
    const held = stored[index]
    const fieldsOf = (ev: TaeFileEvent) => decodeEvent(ev, this.template)
    const dummyOf = (ev: TaeFileEvent) => fieldsOf(ev).find((f) => f.name === 'DummyPolyID')?.value
    const heldEffect = fieldsOf(held).find((f) => f.link === 'effect')?.value
    if (held.end >= OPEN_EVENT_END) return null
    let best: { ev: TaeFileEvent; effect: number } | null = null
    for (const ev of stored) {
      if (ev === held) continue
      const fx = fieldsOf(ev).find((f) => f.link === 'effect')?.value
      if (!fx || fx <= 0 || fx === heldEffect || dummyOf(ev) !== dummyOf(held)) continue
      if (ev.start < held.end - 1 || ev.start > held.end + 0.3 || ev.start < held.start + 0.3) continue
      if (!best || Math.abs(ev.start - held.end) < Math.abs(best.ev.start - held.end)) best = { ev, effect: fx }
    }
    if (!best) return null
    const length = best.ev.end >= OPEN_EVENT_END ? 0.5 : Math.max(1 / FPS, best.ev.end - best.ev.start)
    return {
      type: best.ev.type,
      params: Buffer.from(best.ev.params),
      effect: best.effect,
      lead: Math.max(0, held.end - best.ev.start),
      length,
    }
  }

  /** An animation's length: its motion's, else its events'. */
  private lengthOf(name: string): number {
    try {
      const d = this.s.character.clip(name).duration
      if (d > 0) return d
    } catch {
      /* no motion: the events' */
    }
    return this.s.animations.view(name).length
  }

  private get template(): TaeTemplate {
    return this.s.animations.templateData().template
  }

  /** Animation ids a category has (none if it doesn't exist). */
  private ids(category: number, cache: Map<number, Set<number>>): Set<number> {
    let hit = cache.get(category)
    if (hit) return hit
    hit = new Set(category > 0 ? this.s.animations.animationIds(category) : [])
    cache.set(category, hit)
    return hit
  }

  /** The weapon's affinity rows (the same weapon: its id's ten-thousand, same class). */
  private family(weapon: number): number[] {
    const base = weapon - (weapon % 10000)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    return this.db
      .get('EquipParamWeapon')
      .param.rows.filter(
        (r) =>
          r.id >= base &&
          r.id < base + 10000 &&
          r.id % 100 === 0 &&
          this.db.num('EquipParamWeapon', r.id, 'wepmotionCategory', -1) === motion,
      )
      .map((r) => r.id)
  }

  private recordFor(weapon: number) {
    const base = weapon - (weapon % 10000)
    return { base, rec: this.s.movesetRecord().weapons[String(base)] }
  }

  private className(category: number): string {
    return this.db.enums.get('WEPMOTION_CATEGORY')?.find((e) => e.value === category)?.label ?? categoryLabel(category)
  }

  private name(param: string, id: number): string {
    return this.s.displayName(param, id) || `${param} ${id}`
  }

  /** Where a weapon's animation for an id comes from: its special category, else its class's. */
  private resolve(weapon: number, id: number, cache: Map<number, Set<number>>): string | null {
    const special = this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
    if (special >= 50 && this.ids(special, cache).has(id)) return animationName(special, id)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    return this.ids(motion, cache).has(id) ? animationName(motion, id) : null
  }

  /** Whether a weapon has moves of its own for a slot (in its special category). */
  private hasOwn(weapon: number, slot: (typeof MOVESET_SLOTS)[number], cache: Map<number, Set<number>>): boolean {
    const special = this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
    return special >= 50 && [...this.ids(special, cache)].some((id) => inSlot(slot, id))
  }

  /** Where a slot's moves come from, in words: "Estoc's own", or a class's standard moves. */
  private sourceName(weapon: number, slot: (typeof MOVESET_SLOTS)[number], cache: Map<number, Set<number>>): string {
    return this.hasOwn(weapon, slot, cache)
      ? ownMoves(this.name('EquipParamWeapon', weapon))
      : `${this.className(this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1))} (standard)`
  }

  /** A weapon's moves for a slot: animation id -> the animation it plays. */
  private slotAnimations(
    weapon: number,
    slot: (typeof MOVESET_SLOTS)[number],
    cache: Map<number, Set<number>>,
  ): Map<number, string> {
    const out = new Map<number, string>()
    const special = this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    const ids = new Set([...this.ids(motion, cache), ...(special >= 50 ? this.ids(special, cache) : [])])
    for (const id of [...ids].sort((a, b) => a - b)) {
      if (!inSlot(slot, id)) continue
      const n = this.resolve(weapon, id, cache)
      if (n) out.set(id, n)
    }
    return out
  }

  /** The behaviour judges an animation's events fire. */
  private judgesOf(name: string): number[] {
    const out = new Set<number>()
    for (const ev of this.s.animations.storedEvents(name)) {
      for (const f of decodeEvent(ev, this.template)) if (f.link === 'judge' && f.value >= 0) out.add(f.value)
    }
    return [...out]
  }

  /** A field of an event by name (template order), or undefined. */
  private field(ev: { type: number; params: Buffer }, name: string): number | undefined {
    return decodeEvent(ev as Parameters<typeof decodeEvent>[0], this.template).find((f) => f.name === name)?.value
  }

  /** Whether a move hits or fires something (an attack to replace), and when it first does. */
  private firstHit(name: string): number | null {
    const t = this.s.animations
      .storedEvents(name)
      .filter((e) => e.type === EV.attack || e.type === EV.bullet)
      .map((e) => e.start)
    return t.length ? Math.min(...t) : null
  }

  /**
   * A spell's casts: its right-hand cast animations, quick ones that fire its
   * main bullet first in chain order (Glintstone Pebble's 045010, 045020,
   * 045030), and held ones (Lightning Spear's charged throw); null if it has none.
   */
  private castsOf(
    spell: number,
    cache: Map<number, Set<number>>,
  ): { category: number; quick: string[]; slow: string[] } | null {
    const refType = this.db.num('Magic', spell, 'refType', -1)
    if (refType < 0) return null
    const category = 400 + refType
    const quick: string[] = []
    const quickOther: string[] = []
    const slow: string[] = []
    for (const id of [...this.ids(category, cache)].filter((x) => x >= 45000 && x < 45100).sort((a, b) => a - b)) {
      const name = animationName(category, id)
      const casts = this.s.animations.storedEvents(name).filter((e) => e.type === EV.cast)
      if (!casts.length) continue
      const at = Math.min(...casts.map((e) => e.start))
      if (at >= SLOW_CAST) slow.push(name)
      else if (casts.every((e) => (this.field(e, 'RefType') ?? 0) === 0)) quick.push(name)
      else quickOther.push(name)
    }
    const fast = quick.length ? quick : quickOther.length ? quickOther : slow
    if (!fast.length) return null
    return { category, quick: fast, slow: slow.length ? slow : fast }
  }

  /** What a spell's refId n (1-10) fires: a bullet or a SpEffect, or null. */
  private spellRef(spell: number, n: number): { refType: 1 | 2; id: number } | null {
    const cat = this.db.num('Magic', spell, `refCategory${n}`, -1)
    const id = this.db.num('Magic', spell, `refId${n}`, -1)
    if (id <= 0) return null
    if (cat === 1 && this.db.hasRow('Bullet', id)) return { refType: 1, id }
    if (cat === 2 && this.db.hasRow('SpEffectParam', id)) return { refType: 2, id }
    return null
  }

  private spellName(spell: number): string {
    return this.s.displayName('Magic', spell) || this.s.displayName('EquipParamGoods', spell) || `Spell ${spell}`
  }

  /** "Frost Pebble", or "Margit's Holy Spear (Lightning Spear's cast)". */
  private castName(cast: { spell: number; like?: number }): string {
    return `${this.spellName(cast.spell)}${cast.like !== undefined && cast.like !== cast.spell ? ` (${this.spellName(cast.like)}’s cast)` : ''}`
  }

  /** Spells a slot's moves can cast: named ones that fire something and have casts of their own. */
  private spellList(cache: Map<number, Set<number>>): A.MovesetSpell[] {
    const out: A.MovesetSpell[] = []
    for (const r of this.db.get('Magic').param.rows) {
      const name = this.spellName(r.id)
      if (isPlaceholderName(name) || /^Spell \d+$/i.test(name)) continue
      if (!this.spellRef(r.id, 1)) continue
      const casts = this.castsOf(r.id, cache)
      if (!casts) continue
      const mine = this.s.params.rowState('Magic', r.id) === 'added'
      const kind = this.db.num('Magic', r.id, 'ezStateBehaviorType', -1)
      out.push({
        id: r.id,
        name,
        group: mine ? 'This project' : kind === 1 ? 'Incantations' : 'Sorceries',
        animation: casts.quick[0],
        castCategory: casts.category,
      })
    }
    const order = ['This project', 'Sorceries', 'Incantations']
    return out.sort(
      (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name) || a.id - b.id,
    )
  }

  /** A behavior row to copy for a weapon's bullet: one of the game's (Carian Knight's Sword's glintblade). */
  private bulletRowTemplate(): number {
    for (const r of this.db.get('BehaviorParam_PC').param.rows)
      if (
        behaviorCategoryOf(r.id) >= 1 &&
        r.id < 200_000_000 &&
        this.db.num('BehaviorParam_PC', r.id, 'refType', -1) === 1 &&
        this.s.params.rowState('BehaviorParam_PC', r.id) !== 'added'
      )
        return r.id
    throw new Error('This game has no weapon behavior row firing a bullet to copy')
  }

  /** New event parameters of a type with these fields set (the rest the template's defaults). */
  private eventParams(type: number, values: Record<string, number>): Buffer {
    const { template, sizes } = this.s.animations.templateData()
    const params = newEventParams(type, template, sizes)
    const ev = { type, unk: 0, start: 0, end: 0, params }
    const fields = decodeEvent(ev, template)
    for (const [name, v] of Object.entries(values)) {
      const f = fields.find((x) => x.name === name)
      if (!f) throw new Error(`Event type ${type} has no field ${name}`)
      writeField(ev, f.type, f.offset, v)
    }
    return params
  }

  /**
   * Turns a copied cast into an attack firing one spell: its cast events fire
   * the spell's bullet through a judge of the weapon's, its cast effects are
   * the spell's own. Cast like another spell, that spell's own effects and
   * sounds (Lightning Spear's spear in hand) come off. Returns the judges used.
   */
  private castAsAttack(
    name: string,
    cast: { spell: number; like?: number },
    judgeFor: (ref: { refType: 1 | 2; id: number }) => number,
  ): number[] {
    const anims = this.s.animations
    const like = cast.like !== undefined && cast.like !== cast.spell
    const used = new Set<number>()
    const add: { type: number; start: number; end: number; params: Buffer }[] = []
    const drop: number[] = []
    anims.storedEvents(name).forEach((ev, i) => {
      if (ev.type === EV.cast) {
        drop.push(i)
        // Its own cast: the ref slot it fires (charged versions); cast like another: the spell's main bullet.
        const n = like ? 1 : (this.field(ev, 'RefType') ?? 0) + 1
        const ref = this.spellRef(cast.spell, n) ?? this.spellRef(cast.spell, 1)
        if (!ref) return
        const judge = judgeFor(ref)
        used.add(judge)
        let dummy = this.field(ev, 'DummyPolyID') ?? TIP
        const at = parseDummyId(dummy)
        if (at.on !== 'body' && at.point === STAFF_POINT) dummy = weaponDummyId(at.on, TIP, at.model)
        const params = this.eventParams(EV.bullet, { DummyPolyID: dummy, BehaviorJudgeID: judge })
        // As the game's own (Unknown @18 is 255 on every BulletBehavior it has).
        if (params.length > 18) params.writeUInt8(255, 18)
        add.push({ type: EV.bullet, start: ev.start, end: ev.end, params })
      } else if (EV.magicFfx.includes(ev.type)) {
        drop.push(i)
        const index = this.field(ev, 'SFXIndexID') ?? 0
        const fx = this.db.num('Magic', cast.spell, ['castSfxId', 'fireSfxId', 'effectSfxId'][index] ?? 'castSfxId', -1)
        if (fx <= 0) return
        const source = this.field(ev, 'DummyPolySource') ?? 0
        let dummy = this.field(ev, 'DummyPolyID') ?? 0
        if (source > 0 && dummy === STAFF_POINT) dummy = TIP
        // DummyPolySource: 1 the left weapon, 2 the right.
        const at = source > 0 ? weaponDummyId(source === 1 ? 'left' : 'right', dummy) : dummy
        add.push({
          type: EV.oneShotFfx,
          start: ev.start,
          end: ev.end,
          params: this.eventParams(EV.oneShotFfx, {
            FFXID: fx,
            DummyPolyID: at,
            SlotID: this.field(ev, 'SlotID') ?? 0,
            IsIgnoreDummyPolyAngle: this.field(ev, 'IsIgnoreDummyPolyAngle') ?? 0,
            IsFollowDummyPoly: this.field(ev, 'IsFollowDummyPoly') ?? 0,
            IsRestrictToDummyPoly: this.field(ev, 'IsRestrictToDummyPoly') ?? 0,
          }),
        })
      } else if (like && ev.type === EV.oneShotFfx && isSpellEffect(this.field(ev, 'FFXID') ?? 0)) drop.push(i)
      else if (like && ev.type === EV.sound && this.field(ev, 'SoundType') === SPELL_SOUND) drop.push(i)
    })
    anims.editAnimation(name, (tae, anim) => {
      for (const i of [...drop].sort((a, b) => b - a)) deleteEvent(anim, i)
      for (const e of add) addEvent(tae, anim, { type: e.type, unk: 0, start: e.start, end: e.end, params: e.params })
    })
    return [...used]
  }

  /**
   * A slot's attacks made a spell's casts. Each move of the slot that hits
   * (its copy in the weapon's category, its class's by now) becomes one of
   * the spell's casts: quick ones in chain order (R1, R1, R1: 045010,
   * 045020, 045030, then the follow-ups again), held ones for charged
   * attacks. Moves that don't hit (a heavy attack's charging loop) stay the
   * class's. The bullets fly through behavior rows of the weapon's own
   * variation, on judges nothing of it uses. Returns those rows.
   */
  private castInto(
    r: MovesetRecord['weapons'][string],
    slot: (typeof MOVESET_SLOTS)[number],
    cast: { spell: number; like?: number },
    copies: string[],
    classCategory: number,
    cache: Map<number, Set<number>>,
    weaponName: string,
  ): number[] {
    const anims = this.s.animations
    const casts = this.castsOf(cast.like ?? cast.spell, cache)
    if (!casts) throw new Error(`${this.spellName(cast.like ?? cast.spell)} has no cast of its own to copy`)

    // Which cast each attack becomes.
    const rank = new Map<string, number>()
    const plan: { name: string; id: number; from: string }[] = []
    for (const name of [...copies].sort()) {
      const at = this.firstHit(name)
      if (at === null) continue
      const id = Number(name.slice(5))
      const range = slot.ranges.findIndex(([a, b]) => id >= a && id <= b)
      const held = at >= SLOW_CAST
      const k = `${range}:${held}`
      const i = rank.get(k) ?? 0
      rank.set(k, i + 1)
      const list = held ? casts.slow : casts.quick
      const from = i < list.length ? list[i] : list.length > 1 ? list[1 + ((i - 1) % (list.length - 1))] : list[0]
      plan.push({ name, id, from })
    }

    // Judges free for the weapon: no row of its variation, no event of its moves.
    const used = new Set<number>()
    for (const row of this.db.get('BehaviorParam_PC').param.rows)
      if (behaviorVariationOf(row.id) === r.variation) used.add(row.id % 1000)
    for (const c of [r.category, classCategory])
      for (const id of anims.animationIds(c)) for (const j of this.judgesOf(animationName(c, id))) used.add(j % 1000)
    const judges = new Map<string, number>()
    const judgeFor = (ref: { refType: 1 | 2; id: number }) => {
      const key = `${ref.refType}:${ref.id}`
      let j = judges.get(key)
      if (j === undefined) {
        j = CAST_JUDGE
        while (used.has(j) && j < 999) j++
        if (used.has(j)) throw new Error(`${weaponName} has no free behavior judge left for a cast`)
        used.add(j)
        judges.set(key, j)
      }
      return j
    }

    for (const p of plan) {
      anims.duplicate({ names: [p.from], toCategory: r.category, toId: p.id, register: true, overwrite: true })
      this.castAsAttack(p.name, cast, judgeFor)
    }

    // Its behavior rows: a bullet (or SpEffect) of the spell's, with the cast's stamina.
    const template = this.bulletRowTemplate()
    const stamina = this.db.num('Magic', cast.spell, 'stamina', -1)
    const out: number[] = []
    for (const [key, j] of judges) {
      const [refType, refId] = key.split(':').map(Number)
      const id = behaviorRowId(1, r.variation, j)
      this.putBehaviorRow(id, template, `${weaponName} - casts ${this.spellName(cast.spell)}`, r.variation)
      this.s.params.setRowFieldOnly('BehaviorParam_PC', id, 'behaviorJudgeId', j)
      this.s.params.setRowFieldOnly('BehaviorParam_PC', id, 'refType', refType)
      this.s.params.setRowFieldOnly('BehaviorParam_PC', id, 'refId', refId)
      this.s.params.setRowFieldOnly('BehaviorParam_PC', id, 'stamina', Math.max(0, stamina))
      r.rows[String(j)] = slot.key
      out.push(id)
    }
    return out
  }

  /* --------------------------- enemy moves as attacks --------------------------- */

  /** What the weapon's own moves (not a copy made here) play for an animation id: its game special category's, else its class's. */
  baseAnimation(weapon: number, id: number): string | null {
    const cache = new Map<number, Set<number>>()
    const { rec } = this.recordFor(weapon)
    const special = rec ? rec.original.special : this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
    if (special >= 50 && this.ids(special, cache).has(id)) return animationName(special, id)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    return this.ids(motion, cache).has(id) ? animationName(motion, id) : null
  }

  /**
   * The weapon's attacks an enemy's move can become, one-handed and
   * two-handed: each R1 of its chain, its heavy attacks (quick and charged
   * together), running, roll and backstep attacks, guard counter.
   */
  attackTargets(weapon: number): A.EnemyAttackTarget[] {
    const cache = new Map<number, Set<number>>()
    const { rec } = this.recordFor(weapon)
    const special = rec ? rec.original.special : this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    const all = [...new Set([...this.ids(motion, cache), ...(special >= 50 ? this.ids(special, cache) : [])])].sort(
      (a, b) => a - b,
    )
    const hits = (id: number) => {
      const name = this.baseAnimation(weapon, id)
      return !!name && this.firstHit(name) !== null
    }
    const out: A.EnemyAttackTarget[] = []
    for (const grip of [
      { key: '1h', group: 'One-handed' as const, off: 0 },
      { key: '2h', group: 'Two-handed' as const, off: 2000 },
    ]) {
      for (const t of ATTACK_TARGETS) {
        const ids = all.filter((id) => id >= t.from + grip.off && id <= t.to + grip.off && hits(id))
        if (!ids.length) continue
        if (t.each)
          ids.forEach((id, i) =>
            out.push({
              key: `${grip.key}-${t.key}-${i}`,
              label: `${t.label}, ${ORDINAL[i] ?? `${i + 1}th`}`,
              group: grip.group,
              ids: [id],
            }),
          )
        else out.push({ key: `${grip.key}-${t.key}`, label: t.label, group: grip.group, ids })
      }
    }
    return out
  }

  /** The category and variation the weapon has (or would get) for moves of its own, without making them. */
  ownFor(weapon: number): { category: number; variation: number; exists: boolean } {
    const { rec } = this.recordFor(weapon)
    if (rec && rec.category >= 0) return { category: rec.category, variation: rec.variation, exists: true }
    const variation = rec?.original.variation ?? this.db.num('EquipParamWeapon', weapon, 'behaviorVariationId', -1)
    return { category: this.freeCategory(), variation: this.freeVariation(variation), exists: false }
  }

  /**
   * The weapon's own category and variation, made the first time (its game
   * special category's moves and its own behavior rows come along) and
   * played by all its affinities.
   */
  ensureOwn(weapon: number): { rec: MovesetRecord['weapons'][string]; registered: number; rows: number[] } {
    const s = this.s
    const db = this.db
    const cache = new Map<number, Set<number>>()
    const { base, rec: existing } = this.recordFor(weapon)
    let rec = existing
    let registered = 0
    const rows: number[] = []
    if (!rec || rec.category < 0) {
      const original = rec?.original ?? {
        special: this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1),
        variation: this.db.num('EquipParamWeapon', weapon, 'behaviorVariationId', -1),
        skill: this.db.num('EquipParamWeapon', weapon, 'swordArtsParamId', -1),
      }
      rec = {
        ...rec,
        category: this.freeCategory(),
        variation: this.freeVariation(original.variation),
        original,
        slots: {},
        rows: {},
      }
      const firstTime = rec
      // The weapon's own game moves (its special category) come along.
      if (original.special >= 50 && this.ids(original.special, cache).size) {
        const names = [...this.ids(original.special, cache)].map((id) => animationName(original.special, id))
        const dup = s.animations.duplicate({ names, toCategory: firstTime.category, register: true, overwrite: true })
        registered += dup.registration?.added.length ?? 0
      }
      // Its own behavior rows too (Mace 1102's own heavy attacks), when its variation isn't its class's.
      const hundred = Math.floor(original.variation / 100) * 100
      if (original.variation !== hundred) {
        const weaponName = this.name('EquipParamWeapon', weapon)
        for (const r of [...db.get('BehaviorParam_PC').param.rows]) {
          if (behaviorVariationOf(r.id) !== original.variation) continue
          const cat = behaviorCategoryOf(r.id)
          const id = behaviorRowId(cat, firstTime.variation, r.id % 1000)
          this.putBehaviorRow(
            id,
            r.id,
            `${weaponName} - ${db.rowName('BehaviorParam_PC', r.id) || 'own move'}`,
            firstTime.variation,
          )
          rows.push(id)
        }
      }
    }
    for (const w of this.family(weapon)) {
      s.params.setRowFieldOnly('EquipParamWeapon', w, 'spAtkcategory', rec.category)
      s.params.setRowFieldOnly('EquipParamWeapon', w, 'behaviorVariationId', rec.variation)
    }
    s.movesetRecord().weapons[String(base)] = rec
    s.movesetRecordChanged()
    return { rec, registered, rows }
  }

  /** Behavior judges (< 1000) free for the weapon: no row of its variation, no event of its moves; from `from` up. */
  freeAttackJudges(weapon: number, variation: number, category: number, count: number, from = 700): number[] {
    const anims = this.s.animations
    const used = new Set<number>()
    for (const row of this.db.get('BehaviorParam_PC').param.rows)
      if (behaviorVariationOf(row.id) === variation) used.add(row.id % 1000)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    for (const c of [category, motion])
      for (const id of anims.animationIds(c)) for (const j of this.judgesOf(animationName(c, id))) used.add(j % 1000)
    const out: number[] = []
    for (let j = from; j < 1000 && out.length < count; j++) if (!used.has(j)) out.push(j)
    if (out.length < count)
      throw new Error(`${this.name('EquipParamWeapon', weapon)} has no free behavior judges left for these attacks`)
    return out
  }

  /** An enemy move made these attacks: remembered, so the Moveset tab says so and "back to its own" undoes it. */
  recordEnemyMove(
    weapon: number,
    ids: number[],
    entry: { chr: string; animation: string; label: string; judges: number[] },
  ): void {
    const { rec } = this.recordFor(weapon)
    if (!rec) return
    rec.enemy ??= {}
    for (const id of ids) rec.enemy[String(id)] = entry
    this.s.movesetRecordChanged()
  }

  /** Enemy moves on these animation ids come off: their behavior rows go (the animations are replaced by the caller). */
  private dropEnemyMoves(rec: MovesetRecord['weapons'][string], ids: (id: number) => boolean): void {
    if (!rec.enemy) return
    for (const [key, e] of Object.entries(rec.enemy)) {
      if (!ids(Number(key))) continue
      delete rec.enemy[key]
      // Rows still used by another of its animations stay.
      const still = new Set(Object.values(rec.enemy).flatMap((x) => x.judges))
      for (const j of e.judges) {
        const id = behaviorRowId(1, rec.variation, j % 1000)
        if (!still.has(j) && this.db.hasRow('BehaviorParam_PC', id)) this.s.params.deleteRow('BehaviorParam_PC', id)
      }
    }
  }

  /* ---------------------------------- view ---------------------------------- */

  view(weapon: number): A.MovesetView {
    const db = this.db
    if (!db.hasRow('EquipParamWeapon', weapon)) throw new Error(`Weapon ${weapon} doesn't exist`)
    const motion = this.db.num('EquipParamWeapon', weapon, 'wepmotionCategory', -1)
    if (NOT_MELEE.has(motion))
      throw new Error(
        `${this.name('EquipParamWeapon', weapon)} is a ${this.className(motion).toLowerCase()}: its attacks aren't moves to change here`,
      )
    const cache = new Map<number, Set<number>>()
    const { rec } = this.recordFor(weapon)
    const skill = this.db.num('EquipParamWeapon', weapon, 'swordArtsParamId', -1)
    const family = this.family(weapon)

    // Weapons to take moves from: each class's standard moves (one weapon
    // for it), and weapons with moves of their own in the slot.
    // A class's standard moves are taken from a weapon of it that hits with the
    // class's own rows (variation 500 for thrusting swords), when there is one.
    const bases = db
      .get('EquipParamWeapon')
      .param.rows.filter((r) => r.id % 10000 === 0)
      .map((r) => ({
        id: r.id,
        name: this.name('EquipParamWeapon', r.id),
        motion: this.db.num('EquipParamWeapon', r.id, 'wepmotionCategory', -1),
        special: this.db.num('EquipParamWeapon', r.id, 'spAtkcategory', -1),
        classRows: this.db.num('EquipParamWeapon', r.id, 'behaviorVariationId', -1) % 100 === 0,
      }))
      .filter(
        (w) =>
          w.name &&
          !isPlaceholderName(w.name) &&
          w.motion >= 20 &&
          !NOT_MELEE.has(w.motion) &&
          this.ids(w.motion, cache).size > 0,
      )
      .sort((a, b) => Number(b.classRows) - Number(a.classRows) || a.id - b.id)
    const slots: A.MovesetSlotView[] = MOVESET_SLOTS.map((slot) => {
      const sources: A.MovesetSource[] = []
      const standard = new Set<number>()
      for (const w of bases) {
        const own = w.special >= 50 && [...this.ids(w.special, cache)].some((id) => inSlot(slot, id))
        if (!own && standard.has(w.motion)) continue
        const anims = this.slotAnimations(w.id, slot, cache)
        if (!anims.size) continue
        if (!own) standard.add(w.motion)
        const two = slot.ranges.length > 1 ? [...anims].find(([id]) => inGrip(slot, 'two', id)) : undefined
        sources.push({
          id: w.id,
          name: own ? ownMoves(w.name) : `${this.className(w.motion)} (standard)`,
          className: this.className(w.motion),
          own,
          animation: anims.get(slot.sample) ?? [...anims.values()][0],
          animationTwo: anims.get(slot.sample + 2000) ?? two?.[1] ?? null,
        })
      }
      sources.sort(
        (a, b) =>
          a.className.localeCompare(b.className) || Number(a.own) - Number(b.own) || a.name.localeCompare(b.name),
      )
      const from = rec?.slots[slot.key]
      // Moves taken for one grip only: "Rellana's Twin Blades’ own (two-handed)".
      const byGrip = (['one', 'two'] as const).flatMap((g) => {
        const w = rec?.slots[`${slot.key}:${g}`]
        return w === undefined ? [] : [{ g, w }]
      })
      const cast = rec?.casts?.[slot.key]
      const nowSample =
        this.resolve(weapon, slot.sample, cache) ?? [...this.slotAnimations(weapon, slot, cache).values()][0] ?? null
      const originalSpecial = rec ? rec.original.special : this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1)
      const original =
        originalSpecial >= 50 && this.ids(originalSpecial, cache).has(slot.sample)
          ? animationName(originalSpecial, slot.sample)
          : this.ids(motion, cache).has(slot.sample)
            ? animationName(motion, slot.sample)
            : null
      return {
        key: slot.key,
        label: slot.label,
        hint: slot.hint,
        from: from ?? byGrip[0]?.w ?? null,
        fromName: cast
          ? `Casts ${this.castName(cast)}`
          : from
            ? this.sourceName(from, slot, cache)
            : byGrip.length
              ? byGrip.map(({ g, w }) => `${this.sourceName(w, slot, cache)} (${gripWords(g)})`).join(', ')
              : `${this.className(motion)} (its own)`,
        now: nowSample,
        original,
        sources,
        cast: cast ? { spell: cast.spell, like: cast.like ?? null, name: this.castName(cast) } : null,
        canCast: CAST_SLOTS.has(slot.key),
        grips: slot.ranges.length > 1,
        enemy: Object.entries(rec?.enemy ?? {})
          .filter(([id]) => inSlot(slot, Number(id)))
          .map(([, e]) => e.label)
          .filter((l, i, all) => all.indexOf(l) === i),
      }
    })

    // Skills: stances first (hold the skill, then R1 or R2): Unsheathe, Square Off…
    // all have the stance's start, hold and end (040050-040053) and both follow-ups (040060, 040070).
    const skills: A.MovesetView['skills'] = []
    for (const r of db.get('SwordArtsParam').param.rows) {
      const n = this.s.displayName('SwordArtsParam', r.id)
      if (isPlaceholderName(n)) continue
      const category = 600 + this.db.num('SwordArtsParam', r.id, 'swordArtsTypeNew', -1)
      const ids = this.ids(category, cache)
      if (!ids.size) continue
      const stance = [40050, 40051, 40052, 40053, 40060, 40070].every((x) => ids.has(x))
      const first = stance ? 40050 : [...ids].filter((x) => x >= 40000).sort((a, b) => a - b)[0]
      skills.push({ id: r.id, name: n, stance, animation: first !== undefined ? animationName(category, first) : null })
    }
    skills.sort((a, b) => Number(b.stance) - Number(a.stance) || a.name.localeCompare(b.name))

    // Effects to show on its attacks: those its skill's animations spawn, longest first.
    const effects: A.MovesetEffect[] = []
    if (skill >= 0 && db.hasRow('SwordArtsParam', skill)) {
      const category = 600 + this.db.num('SwordArtsParam', skill, 'swordArtsTypeNew', -1)
      for (const id of this.ids(category, cache)) {
        const name = animationName(category, id)
        this.s.animations.storedEvents(name).forEach((ev, event) => {
          const fields = decodeEvent(ev, this.template)
          const fx = fields.find((f) => f.link === 'effect')
          const dummy = fields.find((f) => /^DummyPoly(ID)?$/i.test(f.name))?.value ?? -1
          if (!fx || fx.value <= 0) return
          const end =
            ev.end >= OPEN_EVENT_END
              ? Math.max(
                  ev.start + 0.1,
                  ...this.s.animations.storedEvents(name).map((e) => (e.end < OPEN_EVENT_END ? e.end : e.start)),
                )
              : ev.end
          effects.push({
            animation: name,
            event,
            effect: fx.value,
            name: this.s.effectName(fx.value),
            dummy,
            length: Math.max(0, end - ev.start),
          })
        })
      }
    }
    effects.sort((a, b) => b.length - a.length || a.animation.localeCompare(b.animation) || a.event - b.event)

    const one = this.db.num('EquipParamWeapon', weapon, 'wepmotionOneHandId', -1)
    const both = this.db.num('EquipParamWeapon', weapon, 'wepmotionBothHandId', -1)
    return {
      effects,
      shown: rec?.effect
        ? { effect: rec.effect.effect, name: this.s.effectName(rec.effect.effect), slots: rec.effect.slots }
        : null,
      hidden:
        !!rec?.hide &&
        family.some((w) => this.db.num('EquipParamWeapon', w, rec.hide!.field, -1) === rec.hide!.spEffect),
      stance: { one, both, originalOne: rec?.stance?.one ?? one, originalBoth: rec?.stance?.both ?? both },
      stances: this.stances(cache),
      weapon: {
        id: weapon,
        name: this.name('EquipParamWeapon', weapon),
        className: this.className(motion),
        category: motion,
        special: this.db.num('EquipParamWeapon', weapon, 'spAtkcategory', -1),
        variation: this.db.num('EquipParamWeapon', weapon, 'behaviorVariationId', -1),
        skill,
        skillName: skill >= 0 && db.hasRow('SwordArtsParam', skill) ? this.name('SwordArtsParam', skill) : '',
        affinities: family.length,
      },
      own: rec && rec.category >= 0 ? { category: rec.category, variation: rec.variation } : null,
      slots,
      skills,
      spells: this.spellList(cache),
    }
  }

  /**
   * The stances the game's weapons are held in, one- and two-handed: each
   * value of wepmotionOneHandId / wepmotionBothHandId is an animation
   * category (a000, a002, a003; a010, a012-a016) of walking, guarding,
   * jumping, riding and the grip changes, named by the classes held that way.
   */
  private stances(cache: Map<number, Set<number>>): A.MovesetView['stances'] {
    const list = (field: 'wepmotionOneHandId' | 'wepmotionBothHandId'): A.MovesetStance[] => {
      // Stance -> weapon class (its attack category) -> how many weapons.
      const by = new Map<number, Map<number, number>>()
      for (const r of this.db.get('EquipParamWeapon').param.rows) {
        if (r.id % 10000 !== 0) continue
        const name = this.name('EquipParamWeapon', r.id)
        if (isPlaceholderName(name)) continue
        const motion = this.db.num('EquipParamWeapon', r.id, 'wepmotionCategory', -1)
        if (motion < 20) continue
        const v = this.db.num('EquipParamWeapon', r.id, field, -1)
        const m = by.get(v) ?? new Map<number, number>()
        m.set(motion, (m.get(motion) ?? 0) + 1)
        by.set(v, m)
      }
      // Stance categories no weapon is held in yet (a copy of one, made for a weapon of its own):
      // any category the field can name that has the stance's walking.
      for (const { category } of this.s.animations.categories())
        if (category <= 255 && !by.has(category) && [...this.ids(category, cache)].some((x) => x >= 20000 && x < 21000))
          by.set(category, new Map())
      return [...by]
        .filter(([id]) => id === 0 || this.ids(id, cache).size > 0)
        .map(([id, m]) => {
          // Named by its melee classes first (shields and staffs share the common stance too).
          const classes = [...m]
            .sort((a, b) => Number(NOT_MELEE.has(a[0])) - Number(NOT_MELEE.has(b[0])) || b[1] - a[1] || a[0] - b[0])
            .map(([motion, n]) => [this.className(motion), n] as const)
          const ids = this.ids(id, cache)
          const walk = [...ids].filter((x) => x >= 20000 && x < 21000).sort((a, b) => a - b)[0]
          const sample = field === 'wepmotionBothHandId' ? (ids.has(29070) ? 29070 : undefined) : walk
          return {
            id,
            label:
              classes
                .slice(0, 3)
                .map(([c]) => c)
                .join(', ') + (classes.length > 3 ? ` and ${classes.length - 3} more` : ''),
            weapons: classes.reduce((n, [, c]) => n + c, 0),
            animation: sample !== undefined ? animationName(id, sample) : null,
          }
        })
        .sort((a, b) => a.id - b.id)
    }
    return { one: list('wepmotionOneHandId'), both: list('wepmotionBothHandId') }
  }

  /* ---------------------------------- apply --------------------------------- */

  /** A special category no animation, weapon or skill uses yet. */
  private freeCategory(): number {
    const db = this.db
    const used = new Set(this.s.animations.categories().map((c) => c.category))
    for (const r of db.get('EquipParamWeapon').param.rows) {
      used.add(this.db.num('EquipParamWeapon', r.id, 'spAtkcategory', -1))
      used.add(this.db.num('EquipParamWeapon', r.id, 'wepmotionCategory', -1))
    }
    for (const r of db.get('SwordArtsParam').param.rows)
      used.add(600 + this.db.num('SwordArtsParam', r.id, 'swordArtsTypeNew', -1))
    for (const w of Object.values(this.s.movesetRecord().weapons)) used.add(w.category)
    for (const range of [
      [270, 299],
      [100, 269],
    ])
      for (let c = range[0]; c <= range[1]; c++) if (!used.has(c)) return c
    throw new Error('No free animation category is left for a weapon of its own (a100 to a299 are all used)')
  }

  /** A variation in the weapon's class's hundred that no behavior row or weapon uses. */
  private freeVariation(variation: number): number {
    const db = this.db
    const hundred = Math.floor(variation / 100) * 100
    const used = new Set<number>()
    for (const r of db.get('BehaviorParam_PC').param.rows) used.add(behaviorVariationOf(r.id))
    for (const r of db.get('EquipParamWeapon').param.rows)
      used.add(this.db.num('EquipParamWeapon', r.id, 'behaviorVariationId', -1))
    for (const w of Object.values(this.s.movesetRecord().weapons)) used.add(w.variation)
    for (let v = hundred + 99; v > hundred; v--) if (!used.has(v)) return v
    throw new Error(`No free behavior variation is left in ${hundred}-${hundred + 99}`)
  }

  /** Sets a behavior row to a copy of another (adding it if it isn't there). */
  private putBehaviorRow(id: number, from: number, name: string, variation: number): void {
    const db = this.db
    if (db.hasRow('BehaviorParam_PC', id)) {
      const p = db.get('BehaviorParam_PC')
      db.row('BehaviorParam_PC', from)!.data.copy(db.row('BehaviorParam_PC', id)!.data)
      p.dirty = true
      this.s.params.renameRow('BehaviorParam_PC', id, name)
    } else this.s.params.addRow('BehaviorParam_PC', id, from, name)
    if (this.db.get('BehaviorParam_PC').def.fieldsByName.has('variationId'))
      this.s.params.setRowFieldOnly('BehaviorParam_PC', id, 'variationId', variation)
  }

  apply(req: A.MovesetRequest): A.MovesetResult {
    const s = this.s
    const db = this.db
    const view = this.view(req.weapon)
    const cache = new Map<number, Set<number>>()
    const { base, rec: existing } = this.recordFor(req.weapon)
    const family = this.family(req.weapon)
    const weaponName = view.weapon.name
    const changes = Object.entries(req.slots).filter(([k]) => MOVESET_SLOTS.some((s) => s.key === k))
    for (const [k, v] of changes) {
      if (v === 'class') continue
      if (typeof v === 'object') {
        const label = MOVESET_SLOTS.find((x) => x.key === k)!.label.toLowerCase()
        if (!CAST_SLOTS.has(k)) throw new Error(`Its ${label} can't be a spell's cast (only attacks on the ground can)`)
        if (!db.hasRow('Magic', v.spell)) throw new Error(`Spell ${v.spell} (for ${label}) doesn't exist`)
        if (!this.spellRef(v.spell, 1))
          throw new Error(`${this.spellName(v.spell)} fires nothing (its refId1 is no bullet or SpEffect)`)
        const like = v.like ?? v.spell
        if (!db.hasRow('Magic', like)) throw new Error(`Spell ${like} doesn't exist`)
        if (!this.castsOf(like, cache)) throw new Error(`${this.spellName(like)} has no cast of its own to copy`)
        continue
      }
      if (!db.hasRow('EquipParamWeapon', v)) throw new Error(`Weapon ${v} (for ${k}) doesn't exist`)
      if (NOT_MELEE.has(this.db.num('EquipParamWeapon', v, 'wepmotionCategory', -1)))
        throw new Error(`${this.name('EquipParamWeapon', v)}'s attacks aren't moves to take`)
    }
    const grips = req.grips ?? {}
    for (const [k, g] of Object.entries(grips)) {
      const slot = MOVESET_SLOTS.find((x) => x.key === k)
      if (!slot) throw new Error(`No moves called ${k}`)
      const label = slot.label.toLowerCase()
      if (slot.ranges.length < 2) throw new Error(`Its ${label} aren't one- or two-handed`)
      if (g !== 'one' && g !== 'two') throw new Error(`Held ${String(g)}? One-handed or two-handed`)
      // A spell's cast replaces both grips' attacks (and is recorded for both).
      if (typeof req.slots[k] === 'object' || existing?.casts?.[k])
        throw new Error(`A spell’s cast changes its ${label} in both hands: change both grips`)
    }
    const skill = req.skill
    if (skill !== undefined && !db.hasRow('SwordArtsParam', skill)) throw new Error(`Skill ${skill} doesn't exist`)
    const effectReq = req.effect
    let effectEvent: {
      type: number
      params: Buffer
      effect: number
      vanish: { type: number; params: Buffer; effect: number; lead: number; length: number } | null
    } | null = null
    if (effectReq) {
      const stored = s.animations.storedEvents(effectReq.animation)
      const ev = stored[effectReq.event]
      const fx = ev ? decodeEvent(ev, this.template).find((f) => f.link === 'effect') : undefined
      if (!ev || !fx || fx.value <= 0) throw new Error(`${effectReq.animation} has no effect event ${effectReq.event}`)
      if (!effectReq.slots.length) throw new Error('Pick the moves to show the effect on')
      effectEvent = {
        type: ev.type,
        params: Buffer.from(ev.params),
        effect: fx.value,
        vanish: this.vanishOf(stored, effectReq.event),
      }
    }
    const stance = req.stance
    for (const [k, v] of [
      ['one', stance?.one],
      ['both', stance?.both],
    ] as const)
      if (v !== undefined && !view.stances[k].some((x) => x.id === v))
        throw new Error(`No ${k === 'one' ? 'one' : 'two'}-handed stance ${v} to hold it in (pick one of the game's)`)
    if (!changes.length && skill === undefined && effectReq === undefined && req.hide === undefined && !stance)
      throw new Error('Pick moves to take, a skill or an effect')

    const rows: A.MovesetResult['rows'] = []
    const made = (param: string, id: number) => rows.push({ param, id, name: db.rowName(param, id) })
    const anims = s.animations
    const created: string[] = []
    let registered = 0
    let rec = existing

    // An effect on its attacks needs those moves in its own category.
    const effectSlots = effectReq?.slots ?? []
    for (const key of effectSlots)
      if (
        !changes.some(([k]) => k === key) &&
        existing?.slots[key] === undefined &&
        existing?.slots[`${key}:one`] === undefined &&
        existing?.slots[`${key}:two`] === undefined &&
        existing?.casts?.[key] === undefined
      )
        changes.push([key, 'class'])

    if (changes.length || effectReq !== undefined) {
      // Its own category and variation (made once, reused after; a weapon only
      // hidden so far has a record without them).
      const own = this.ensureOwn(req.weapon)
      registered += own.registered
      for (const id of own.rows) made('BehaviorParam_PC', id)
      rec = own.rec
      const r = rec
      const hits = req.hits ?? 'source'
      for (const [key, value] of changes) {
        const slot = MOVESET_SLOTS.find((x) => x.key === key)!
        const grip = grips[key]
        const rowKey = grip ? `${key}:${grip}` : key
        // The record: one source for both grips, or one for each grip that has its own.
        const setSource = (w: number | null) => {
          if (!grip) {
            delete r.slots[`${key}:one`]
            delete r.slots[`${key}:two`]
          } else if (r.slots[key] !== undefined) {
            r.slots[`${key}:${grip === 'one' ? 'two' : 'one'}`] = r.slots[key]
            delete r.slots[key]
          }
          if (w === null) delete r.slots[rowKey]
          else r.slots[rowKey] = w
        }
        // Enemy moves made any of these attacks come off with them.
        this.dropEnemyMoves(r, (id) => inGrip(slot, grip, id))
        // Moves: the source's, or back to the class's (and its own game ones);
        // a spell's cast replaces the class's attacks after.
        const cast = typeof value === 'object' ? value : null
        const fromWeapon = typeof value === 'number' ? value : null
        let names: string[]
        if (fromWeapon !== null)
          names = [...this.slotAnimations(fromWeapon, slot, cache)]
            .filter(([id]) => inGrip(slot, grip, id))
            .map(([, n]) => n)
        else {
          const ids = new Set([
            ...this.ids(view.weapon.category, cache),
            ...(r.original.special >= 50 ? this.ids(r.original.special, cache) : []),
          ])
          names = [...ids]
            .filter((id) => inGrip(slot, grip, id))
            .map((id) =>
              r.original.special >= 50 && this.ids(r.original.special, cache).has(id)
                ? animationName(r.original.special, id)
                : animationName(view.weapon.category, id),
            )
        }
        // The copies' events are the real ones (a copy follows "full" references), so judges come from them.
        let copies: string[] = []
        if (names.length) {
          const dup = anims.duplicate({ names, toCategory: r.category, register: true, overwrite: true })
          copies = [...dup.created, ...dup.replaced]
          created.push(...copies)
          registered += dup.registration?.added.length ?? 0
        }
        // Hits: rows made for this slot (this grip's, for one grip) before go back first.
        for (const [judge, k] of Object.entries(r.rows)) {
          if (grip ? k !== rowKey : k !== key && !k.startsWith(`${key}:`)) continue
          const j = Number(judge)
          const cat = judgeCategory(j, 'BehaviorParam_PC')
          const id = behaviorRowId(cat, r.variation, j % 1000)
          const own = behaviorRowId(cat, r.original.variation, j % 1000)
          if (
            r.original.variation !== Math.floor(r.original.variation / 100) * 100 &&
            db.hasRow('BehaviorParam_PC', own)
          )
            this.putBehaviorRow(id, own, `${weaponName} - ${db.rowName('BehaviorParam_PC', own)}`, r.variation)
          else if (db.hasRow('BehaviorParam_PC', id)) s.params.deleteRow('BehaviorParam_PC', id)
          delete r.rows[judge]
        }
        if (r.casts) delete r.casts[key]
        if (cast) {
          setSource(null)
          for (const row of this.castInto(r, slot, cast, copies, view.weapon.category, cache, weaponName))
            made('BehaviorParam_PC', row)
          ;(r.casts ??= {})[key] =
            cast.like !== undefined && cast.like !== cast.spell
              ? { spell: cast.spell, like: cast.like }
              : { spell: cast.spell }
          continue
        }
        if (fromWeapon === null) {
          setSource(null)
          continue
        }
        setSource(fromWeapon)
        const srcVariation = this.db.num('EquipParamWeapon', fromWeapon, 'behaviorVariationId', -1)
        const srcName = this.name('EquipParamWeapon', fromWeapon)
        const judges = new Set((copies.length ? copies : names).flatMap((n) => this.judgesOf(n)))
        for (const j of [...judges].sort((a, b) => a - b)) {
          const src = behaviorRowFor(this.db, 'BehaviorParam_PC', j, srcVariation)
          if (src === null) continue
          if (hits === 'own') {
            // This weapon's own attack for the judge, unless it has none of its own (only the shared one).
            const mine = behaviorRowFor(this.db, 'BehaviorParam_PC', j, r.variation)
            if (mine !== null && (behaviorVariationOf(mine) !== 0 || behaviorVariationOf(src) === 0)) continue
          }
          const cat = judgeCategory(j, 'BehaviorParam_PC')
          const id = behaviorRowId(cat, r.variation, j % 1000)
          this.putBehaviorRow(id, src, `${weaponName} - ${srcName} ${slot.label.toLowerCase()}`, r.variation)
          r.rows[String(j)] = rowKey
          made('BehaviorParam_PC', id)
        }
      }
      // An effect on its attacks: the one shown before comes off every move first.
      if (effectReq !== undefined) {
        if (r.effect) {
          const old = r.effect
          const ours = [old, ...(old.vanish ? [old.vanish] : [])]
          for (const id of anims.animationIds(r.category)) {
            const name = animationName(r.category, id)
            const stored = anims.storedEvents(name)
            const mine = stored
              .map((ev, i) => (ours.some((o) => ev.type === o.type && ev.params.toString('hex') === o.params) ? i : -1))
              .filter((i) => i >= 0)
            if (mine.length)
              anims.editAnimation(name, (_tae, anim) => [...mine].reverse().forEach((i) => deleteEvent(anim, i)))
          }
          delete r.effect
        }
        if (effectReq && effectEvent) {
          const fx = effectEvent
          const vanish = fx.vanish
          for (const id of anims.animationIds(r.category)) {
            const slot = MOVESET_SLOTS.find((x) => inSlot(x, id))
            if (!slot || !effectReq.slots.includes(slot.key)) continue
            // Conjured as the move starts, and gone the way it goes where it came from (Margit's
            // hammer breaks into light): the vanish plays out before the move ends, since an effect
            // tied to a move ends with it, and the held effect ends `lead` after the vanish starts,
            // but not before the move's last hit.
            const name = animationName(r.category, id)
            const end = vanish ? this.lengthOf(name) : 0
            anims.editAnimation(name, (tae, anim) => {
              const lastHit = Math.max(
                0,
                ...anim.events.filter((ev) => HIT_EVENTS.has(ev.type) && ev.end < OPEN_EVENT_END).map((ev) => ev.end),
              )
              const heldEnd = vanish ? Math.max(end - vanish.length + vanish.lead, lastHit) : FLOAT_MAX
              addEvent(tae, anim, {
                type: fx.type,
                unk: 0,
                start: 0,
                end: vanish && heldEnd < end ? Math.fround(heldEnd) : FLOAT_MAX,
                params: Buffer.from(fx.params),
              })
              if (vanish && end > vanish.lead) {
                const start = Math.fround(Math.max(0, heldEnd - vanish.lead))
                addEvent(tae, anim, {
                  type: vanish.type,
                  unk: 0,
                  start,
                  end: Math.fround(start + vanish.length),
                  params: Buffer.from(vanish.params),
                })
              }
            })
          }
          r.effect = {
            type: fx.type,
            params: fx.params.toString('hex'),
            effect: fx.effect,
            slots: [...effectReq.slots],
            ...(vanish
              ? {
                  vanish: {
                    type: vanish.type,
                    params: vanish.params.toString('hex'),
                    effect: vanish.effect,
                    lead: vanish.lead,
                    length: vanish.length,
                  },
                }
              : {}),
          }
        }
      }
      // Every affinity of the weapon plays its own category, hits by its own variation.
      for (const w of family) {
        s.params.setRowFieldOnly('EquipParamWeapon', w, 'spAtkcategory', r.category)
        s.params.setRowFieldOnly('EquipParamWeapon', w, 'behaviorVariationId', r.variation)
      }
      s.movesetRecord().weapons[String(base)] = r
      s.movesetRecordChanged()
    }

    // Hidden: a copy of Unseen Blade's effect, always on, in a free passive slot of each affinity.
    if (req.hide !== undefined) {
      const holder =
        s.movesetRecord().weapons[String(base)] ??
        (s.movesetRecord().weapons[String(base)] = {
          category: -1,
          variation: view.weapon.variation,
          original: { special: view.weapon.special, variation: view.weapon.variation, skill: view.weapon.skill },
          slots: {},
          rows: {},
        })
      if (req.hide) {
        if (!holder.hide) {
          if (!db.hasRow('SpEffectParam', UNSEEN_BLADE_SPEFFECT))
            throw new Error('This game has no Unseen Blade effect to copy')
          const field = PASSIVE_FIELDS.find((f) => family.every((w) => this.db.num('EquipParamWeapon', w, f, -1) <= 0))
          if (!field)
            throw new Error(`${weaponName} has no free passive effect slot (residentSpEffectId, 1 and 2 are all used)`)
          const id = s.params.freeId('SpEffectParam', UNSEEN_BLADE_SPEFFECT + 1)
          s.params.addRow('SpEffectParam', id, UNSEEN_BLADE_SPEFFECT, `${weaponName} - hidden (like Unseen Blade)`)
          s.params.setRowFieldOnly('SpEffectParam', id, 'effectEndurance', -1)
          made('SpEffectParam', id)
          holder.hide = { spEffect: id, field }
        }
        for (const w of family) s.params.setRowFieldOnly('EquipParamWeapon', w, holder.hide.field, holder.hide.spEffect)
      } else if (holder.hide) {
        for (const w of family)
          if (this.db.num('EquipParamWeapon', w, holder.hide.field, -1) === holder.hide.spEffect)
            s.params.setRowFieldOnly('EquipParamWeapon', w, holder.hide.field, -1)
      }
      s.movesetRecordChanged()
    }
    // Stances: how it's held (and changes grip), one- and two-handed: another of the game's.
    if (stance && (stance.one !== undefined || stance.both !== undefined)) {
      const holder =
        s.movesetRecord().weapons[String(base)] ??
        (s.movesetRecord().weapons[String(base)] = {
          category: -1,
          variation: view.weapon.variation,
          original: { special: view.weapon.special, variation: view.weapon.variation, skill: view.weapon.skill },
          slots: {},
          rows: {},
        })
      holder.stance ??= { one: view.stance.one, both: view.stance.both }
      for (const w of family) {
        if (stance.one !== undefined) s.params.setRowFieldOnly('EquipParamWeapon', w, 'wepmotionOneHandId', stance.one)
        if (stance.both !== undefined)
          s.params.setRowFieldOnly('EquipParamWeapon', w, 'wepmotionBothHandId', stance.both)
      }
      s.movesetRecordChanged()
    }
    if (skill !== undefined)
      for (const w of family) s.params.setRowFieldOnly('EquipParamWeapon', w, 'swordArtsParamId', skill)
    for (const w of family) made('EquipParamWeapon', w)

    const held = (k: string) => (grips[k] ? `${gripWords(grips[k])} ` : '')
    const took = changes
      .filter(([, v]) => v !== 'class')
      .map(([k, v]) => {
        const slot = MOVESET_SLOTS.find((x) => x.key === k)!
        if (typeof v === 'object') return `${slot.label.toLowerCase()} that cast ${this.castName(v)}`
        return `${held(k)}${slot.label.toLowerCase()}: ${this.sourceName(v as number, slot, cache)}`
      })
    const back = changes
      .filter(([, v]) => v === 'class')
      .map(([k]) => `${held(k)}${MOVESET_SLOTS.find((x) => x.key === k)!.label.toLowerCase()}`)
    const parts = [
      ...(took.length ? [`now has ${took.join('; ')}`] : []),
      ...(back.length && !effectReq ? [`has its own ${back.join(', ')} again`] : []),
      ...(skill !== undefined ? [`skill: ${this.name('SwordArtsParam', skill)}`] : []),
      ...(effectReq && effectEvent
        ? [
            `shows ${this.s.effectName(effectEvent.effect) || `effect ${effectEvent.effect}`} on its ${effectReq.slots.map((k) => MOVESET_SLOTS.find((x) => x.key === k)?.label.toLowerCase() ?? k).join(' and ')}`,
          ]
        : []),
      ...(effectReq === null ? ['shows no effect on its attacks any more'] : []),
      ...(req.hide === true
        ? ['its own model is hidden (it still hits)']
        : req.hide === false
          ? ['its own model shows again']
          : []),
      ...(['one', 'both'] as const)
        .filter((k) => stance?.[k] !== undefined)
        .map((k) => {
          const v = stance![k]!
          const own = v === (k === 'one' ? view.stance.originalOne : view.stance.originalBoth)
          // A copied stance no weapon is held in yet goes by its category.
          const label = view.stances[k].find((x) => x.id === v)?.label
          const how = own ? 'its own way again' : label ? `like ${label}` : `in ${categoryLabel(v)}`
          return `held ${k === 'one' ? 'one' : 'two'}-handed ${how}`
        }),
    ]
    return {
      category: rec?.category ?? -1,
      variation: rec?.variation ?? view.weapon.variation,
      animations: [...new Set(created)].sort(),
      registered,
      rows,
      weapons: family,
      summary: `${weaponName} ${parts.join('; ')}${family.length > 1 ? ` (all ${family.length} of its affinities)` : ''}.`,
    }
  }
}
