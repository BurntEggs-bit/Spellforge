/**
 * Enemy moves for the player: a character's animation made into a skill of
 * one of the project's weapons, and a character's bullet made into a spell,
 * with everything the game needs for them to work, in one step.
 *
 * A skill from a move:
 *   - motion: the move fitted to the player's skeleton (retarget.ts) and
 *     written as a new animation file in the player's skill binder
 *     (c0000_a9x), in the same format as the game's;
 *   - the player's side of it: a copy of a one-animation player skill's
 *     category (Lion's Claw by default) in a free skill category, keeping
 *     its bookkeeping events (FP use, poise, turning, recovery and cancel
 *     windows) stretched to the new motion's timing, and registered in the
 *     behaviour graph;
 *   - the move's own events: its attacks and bullets with new judge ids
 *     and behavior rows on the weapon, its effects copied into the common
 *     bundles (scaled to the player if asked), every dummy poly moved onto
 *     the player's body or weapon;
 *   - attacks: AtkParam_Npc rows copied to AtkParam_Pc, flat damage counted
 *     (isAddBaseAtk), their push a player's (fitAttackForPlayer), hit
 *     dummies moved; bullets: the chain duplicated with player attacks of
 *     their own;
 *   - sounds: the move's sound events (and its bullets' sounds) brought from
 *     the character's own sound bank into the player's (services/sounds.ts),
 *     so they play wherever the player is;
 *   - a new skill row (SwordArtsParam) in that category, named and
 *     described in game, set as the weapon's skill.
 * What can't come along stays behind and is listed: SpEffects tuned for the
 * character, its AI and movement flags, model parts, and sounds no bank has.
 */
import type { Session } from '../session.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import type { ParamDef } from '../../core/params/paramDef.ts'
import { getField, setField } from '../../core/params/param.ts'
import { effectsToCopy, remapEffectReferences } from '../../core/params/workflow.ts'
import {
  decodeEvent,
  writeField,
  addEvent,
  motionOf,
  type DecodedField,
  type TaeTemplate,
} from '../../core/animation/animations.ts'
import { gripInDummyFrame, parseDummyId, pointInDummyFrame, weaponDummyId } from '../../core/animation/dummies.ts'
import { qmul, qrot } from '../../core/math/quaternion.ts'
import type { TaeFile, TaeFileAnimation, TaeFileEvent } from '../../core/formats/taeFile.ts'
import { writeAnimationFile } from '../../core/formats/havok/animationFile.ts'
import { writeTagfile } from '../../core/formats/havok/tagfile.ts'
import { type Bone } from '../../core/formats/havok/skeleton.ts'
import { itemsOfType } from '../../core/formats/havok/objects.ts'
import { otherSide } from '../../core/animation/retarget.ts'
import { weaponPartName } from '../../core/animation/character.ts'
import { shiftEffect } from '../../core/effects/nodeTransforms.ts'
import { PLAYER_TRACKS } from '../services/character.ts'
import { taeSoundNames, bulletSoundNames, PLAYER_BANK } from '../services/sounds.ts'
import type * as A from '../../shared/api.ts'
import { FLOAT_MAX, OPEN_EVENT_END } from '../../shared/api.ts'
import { behaviorCategoryOf, behaviorRowId } from '../../core/params/behaviorIds.ts'
import { animationName } from '../../shared/animIds.ts'
import { snapToFrame } from '../../shared/frames.ts'

/** Lion's Claw: a one-animation skill (a600_040000) that works on any weapon. */
const DEFAULT_BASE_SKILL = 100
/** Skill categories no game skill uses (600 + swordArtsTypeNew). */
const FIRST_FREE_CATEGORY = 626
/** New skill judges: 3950-3999 (BehaviorParam_PC category 3, the skills'). */
const FIRST_JUDGE = 3950

type Ev = { index: number; ev: TaeFileEvent; type: number; name: string; fields: DecodedField[] }

/**
 * ChrActionFlag types that belong to a move's motion, not to its AI: a leap
 * needs gravity off while it rises, no fall animation, height correction,
 * jump i-frames. They come along with the motion.
 */
const MOTION_FLAGS = new Set([27, 28, 39, 51, 113, 132, 134])

/**
 * The furthest a player's attack pushes what it hits (m). An enemy's attacks
 * are tuned for hitting the player and push up to 20 m (a boss made the
 * player's would slide other bosses across an arena); the game's own skills
 * push 2 m or less in all but 26 of their 2,200 attacks.
 */
export const PLAYER_KNOCKBACK = 2

/**
 * An enemy's attack (a copy of its AtkParam_Npc row) made the player's: its
 * flat damage (atkPhys, atkDark...) counted, which player attacks do only
 * with isAddBaseAtk on, as the game's own skill projectiles have it; its push
 * (or pull) no further than a player's skill.
 */
export function fitAttackForPlayer(data: Buffer, def: ParamDef): void {
  const add = def.fieldsByName.get('isAddBaseAtk')
  if (add) setField(data, add, 1)
  const push = def.fieldsByName.get('knockbackDist')
  if (push) {
    const v = Number(getField(data, push))
    if (Math.abs(v) > PLAYER_KNOCKBACK) setField(data, push, Math.sign(v) * PLAYER_KNOCKBACK)
  }
}

/**
 * A character's voice: its own sounds (TAE sound type 1, c events) numbered
 * 08000-08999 within its id (c475008300, Godrick's battle cry). Every
 * character checked numbers its voice so; Margit's, Godrick's, c3000's and
 * c4800's banks send exactly those to a voice bus of their own. A move made
 * the player's leaves the voice behind (the player would speak with the
 * boss's voice): to keep one, paste its sound event in and bring it into the
 * player's bank from the event.
 */
const isVoiceSound = (soundType: number, id: number) =>
  soundType === 1 && id > 0 && Math.floor((id % 100000) / 1000) === 8

const isDummyField = (f: DecodedField) => /^DummyPoly(ID|Blade\w*ID)$/i.test(f.name)
const isSound = (name: string) => /sound|wwise/i.test(name)
const BULLET_SOUNDS = ['seId_Bullet1', 'seId_Bullet2', 'seId_Hit', 'seId_Flick']

/**
 * The Wwise events a TAE sound event posts: its sound (type, id), and for
 * Wwise_PlaySound_BySlot (129) a second one (type at 20, id at 24) when set.
 */
function taeEventSounds(type: number, params: Buffer): string[] {
  if (params.length < 8) return []
  const out = taeSoundNames(params.readInt32LE(0), params.readInt32LE(4))
  if (type === 129 && params.length >= 28 && params.readInt32LE(24) > 0)
    out.push(...taeSoundNames(params.readInt32LE(20), params.readInt32LE(24)))
  return out
}

/** What becomes of an enemy event on the player. */
type Fate = 'attack' | 'bullet' | 'effect' | 'sound' | 'keep' | { drop: string }

interface Analysis {
  req: A.EnemySkillRequest
  variation: number
  enemyName: string
  events: Ev[]
  fates: Map<number, Fate>
  /** Enemy judge -> its behavior target. */
  targets: Map<number, { kind: 'attack' | 'bullet'; id: number; name: string; newJudge: number }>
  effects: Map<number, { name: string; from: string | null }>
  /** Sound events to bring into the player's bank, and how many the player's banks already have. */
  sounds: { bring: string[]; present: number; events: number; bytes: number }
  dummies: Set<number>
  /** `handle`: for a dummy on something held (Margit's hammer), where the hand holds it, in the dummy's frame. */
  dummyMap: Map<number, { to: number; label: string; bone: string; handle?: number[] }>
  dummyOptions: { value: number; label: string }[]
  weapon: A.EnemySkillPlan['weapon']
  base: A.EnemySkillPlan['baseSkill'] & { ownMotions: string[]; all: string[] }
  /** Made one of the weapon's attacks: which, and what each of its animations is now (its bookkeeping stays). */
  attack: (A.EnemyAttackTarget & { bases: string[] }) | null
  /** Only this part of the move (seconds into it): one step of a combo split into R1 presses. */
  span?: { from: number; to: number }
  category: number
  scale: number
  mirrorSuggested: boolean
  dropped: { what: string; why: string }[]
  notes: string[]
}

export class EnemyMoves {
  private s: Session

  constructor(s: Session) {
    this.s = s
  }

  private get db(): ParamDatabase {
    return this.s.internals().db
  }

  private get template(): TaeTemplate {
    return this.s.animations.templateData().template
  }

  /* -------------------------------- analysis -------------------------------- */

  /** The base skill: a player skill whose category has one animation file of its own. */
  private baseSkill(id?: number): Analysis['base'] {
    const db = this.db
    const skill = id ?? DEFAULT_BASE_SKILL
    if (!db.hasRow('SwordArtsParam', skill)) throw new Error(`Skill ${skill} doesn't exist`)
    const category = 600 + this.db.num('SwordArtsParam', skill, 'swordArtsTypeNew')
    let list: A.AnimListItem[]
    try {
      list = this.s.animations.list(category, '')
    } catch {
      throw new Error(`Skill ${skill} has no animations (a${category})`)
    }
    const ownMotions = list.filter((a) => a.motion === 'own' && /_04\d{4}$/.test(a.name)).map((a) => a.name)
    if (!ownMotions.length)
      throw new Error(`Skill ${skill}'s animations (a${category}) have no motion of their own to replace`)
    const name =
      this.s.params.rowView('SwordArtsParam', skill).gameName ||
      this.db.rowName('SwordArtsParam', skill) ||
      `Skill ${skill}`
    return { id: skill, name, category, ownMotions, all: list.map((a) => a.name) }
  }

  /** The first skill category no animation and no skill uses. */
  private freeCategory(): number {
    const used = new Set(this.s.animations.categories().map((c) => c.category))
    const types = new Set(
      this.db.get('SwordArtsParam').param.rows.map((r) => this.db.num('SwordArtsParam', r.id, 'swordArtsTypeNew')),
    )
    for (let c = FIRST_FREE_CATEGORY; c < 900; c++) if (!used.has(c) && !types.has(c - 600)) return c
    throw new Error('No free skill animation category is left (a626 to a899 are all used)')
  }

  /** Judge ids free on this weapon (and the variations the game falls back to). */
  private freeJudges(variation: number, count: number): number[] {
    const out: number[] = []
    for (let j = FIRST_JUDGE; j < 4000 && out.length < count; j++) {
      const taken = [variation, Math.floor(variation / 100) * 100, 0].some((v) =>
        this.db.hasRow('BehaviorParam_PC', 300_000_000 + v * 1000 + (j % 1000)),
      )
      if (!taken) out.push(j)
    }
    if (out.length < count) throw new Error('This weapon has no free skill judge ids left (3950-3999)')
    return out
  }

  private analyze(req: A.EnemySkillRequest): Analysis {
    const db = this.db
    const enemies = this.s.enemies
    if (!db.hasRow('EquipParamWeapon', req.weapon)) throw new Error(`Weapon ${req.weapon} doesn't exist`)
    const variation = req.variation ?? enemies.defaultVariation(req.chr)
    const enemyName = enemies.list().find((e) => e.chr === req.chr)?.name ?? req.chr
    const anim = enemies.animation(req.chr, req.animation)
    const t = this.template
    const events: Ev[] = anim.events.map((ev, index) => ({
      index,
      ev,
      type: ev.type,
      name: t.events[ev.type]?.name ?? `Event ${ev.type}`,
      fields: decodeEvent(ev, t),
    }))

    // Which events come along.
    const playerUses = new Set(
      this.s.animations
        .eventTypes()
        .filter((e) => e.uses > 0)
        .map((e) => e.type),
    )
    const fates = new Map<number, Fate>()
    const targets: Analysis['targets'] = new Map()
    const effects = new Map<number, { name: string; from: string | null }>()
    const dummies = new Set<number>()
    /** Sound events (by TAE event) and the bullets' sounds, resolved below. */
    const soundEvents = new Map<number, string[]>()
    const bulletSounds: string[] = []
    const addEffect = (id: number) => {
      if (id <= 0 || effects.has(id)) return
      const where = this.s.internals().lib.hasEffect(id) ? null : this.s.effects.locateEffect(id)
      effects.set(id, { name: this.s.effectName(id), from: where ? where.owner : null })
    }
    for (const e of events) {
      const judge = e.fields.find((f) => f.name === 'BehaviorJudgeID')?.value
      if ((e.type === 1 || e.type === 2) && judge !== undefined && judge >= 0) {
        const row = enemies.behaviorRow(judge, variation)
        let target = row !== null ? enemies.behaviorTarget(row) : null
        // Another of its bullets, if asked: the event fires that instead.
        const swap = target?.kind === 'bullet' ? req.bullets?.[String(judge)] : undefined
        if (swap && swap > 0 && db.hasRow('Bullet', swap)) target = { kind: 'bullet', id: swap }
        if (!target) {
          fates.set(e.index, { drop: `${enemyName} has no behavior for judge ${judge}` })
          continue
        }
        if (target.kind === 'speffect') {
          fates.set(e.index, { drop: 'a SpEffect behavior tuned for the character' })
          continue
        }
        const param = target.kind === 'attack' ? 'AtkParam_Npc' : 'Bullet'
        if (!db.hasRow(param, target.id)) {
          fates.set(e.index, { drop: `${param} ${target.id} doesn't exist` })
          continue
        }
        fates.set(e.index, target.kind)
        if (!targets.has(judge))
          targets.set(judge, { kind: target.kind, id: target.id, name: db.rowName(param, target.id), newJudge: 0 })
        if (target.kind === 'attack') {
          for (let k = 0; k < 16; k++)
            for (const f of [`hit${k}_DmyPoly1`, `hit${k}_DmyPoly2`]) {
              const d = this.db.num('AtkParam_Npc', target.id, f)
              if (d > 0 && this.db.num('AtkParam_Npc', target.id, `hit${k}_Radius`) > 0) dummies.add(d)
            }
        } else {
          const chain = this.bulletChain(target.id)
          for (const b of chain) for (const fx of this.sfxOf('Bullet', b)) addEffect(fx)
          bulletSounds.push(...this.bulletSounds(chain))
        }
        for (const f of e.fields) if (isDummyField(f) && f.value > 0) dummies.add(f.value)
        continue
      }
      const fx = e.fields.find((f) => f.link === 'effect')
      if (fx) {
        fates.set(e.index, 'effect')
        if (fx.value > 0) addEffect(fx.value)
        for (const f of e.fields) if (isDummyField(f) && f.value > 0) dummies.add(f.value)
        continue
      }
      const flag = e.type === 0 ? e.fields.find((f) => f.name === 'FlagType')?.value : undefined
      if (
        e.type === 144 ||
        e.type === 145 ||
        e.type === 608 ||
        (e.type === 760 && playerUses.has(760)) ||
        (flag !== undefined && MOTION_FLAGS.has(flag))
      ) {
        fates.set(e.index, 'keep')
        for (const f of e.fields) if (isDummyField(f) && f.value > 0) dummies.add(f.value)
        continue
      }
      if (isSound(e.name)) {
        if (e.ev.params.length >= 8 && isVoiceSound(e.ev.params.readInt32LE(0), e.ev.params.readInt32LE(4))) {
          fates.set(e.index, { drop: `it's ${enemyName}'s voice (grunts and shouts): you have your own` })
          continue
        }
        soundEvents.set(e.index, taeEventSounds(e.type, e.ev.params))
        for (const f of e.fields) if (isDummyField(f) && f.value > 0) dummies.add(f.value)
      } else if (e.type === 66 || e.type === 67)
        fates.set(e.index, { drop: `its SpEffects are made for ${enemyName} (stance, AI, resistances)` })
      else if (/ModelMask/i.test(e.name))
        fates.set(e.index, { drop: `it shows and hides parts of ${enemyName}'s own model` })
      else
        fates.set(e.index, {
          drop: `${enemyName}'s own movement, AI and timing flags (the player's come from the base skill)`,
        })
    }

    // Sounds: those in the character's banks are brought into the player's; the player may have some already.
    const sounds = this.s.sounds
    const located = sounds.locate(req.chr, [...new Set([...[...soundEvents.values()].flat(), ...bulletSounds])])
    const bring = new Set<string>()
    let present = 0
    for (const [index, names] of soundEvents) {
      const found = names.filter((n) => located.get(n))
      if (!found.length) {
        fates.set(index, { drop: `its sound isn't in ${enemyName}'s sound banks or the player's` })
        continue
      }
      fates.set(index, 'sound')
      for (const n of found) {
        if (located.get(n)!.where === 'character') bring.add(n)
        else present++
      }
    }
    for (const n of bulletSounds) if (located.get(n)?.where === 'character') bring.add(n)
    const soundInfo = {
      bring: [...bring].sort(),
      present,
      events: soundEvents.size,
      bytes: bring.size ? sounds.size(req.chr, [...bring]) : 0,
    }

    // A skill, or one of the weapon's attacks (in its own category, hitting by its own variation).
    const weaponVariation = this.db.num('EquipParamWeapon', req.weapon, 'behaviorVariationId')
    let attack: Analysis['attack'] = null
    let own: { category: number; variation: number } | null = null
    if (req.attack) {
      const t = this.s.movesets.attackTargets(req.weapon).find((x) => x.key === req.attack)
      if (!t) throw new Error(`The weapon has no such attack to make it (${req.attack})`)
      const bases = t.ids.map((id) => this.s.movesets.baseAnimation(req.weapon, id))
      if (bases.some((b) => !b)) throw new Error(`The weapon has nothing for ${t.label} to start from`)
      attack = { ...t, bases: bases as string[] }
      own = this.s.movesets.ownFor(req.weapon)
    }

    // New judges: the skill's (3950 up) or the weapon's moves' (700 up).
    const judges = own
      ? this.s.movesets.freeAttackJudges(req.weapon, own.variation, own.category, targets.size)
      : this.freeJudges(weaponVariation, targets.size)
    ;[...targets.values()].forEach((x, i) => (x.newJudge = judges[i]))

    const base = this.baseSkill(req.baseSkill)
    const category = own ? own.category : this.freeCategory()
    const motion = this.s.character.retargetedMotion(req.animation, { chr: req.chr, ...req.motion })

    // Is it made with the left hand? (Its effects and hits ride the left hand's bones.)
    const { dummies: ed, bones: eb } = enemies.dummies(req.chr)
    let left = 0
    let right = 0
    for (const id of dummies) {
      const d = ed.find((x) => x.id === id)
      if (!d) continue
      for (let b = d.attachBone, n = 0; b >= 0 && n < 64; b = eb[b].parent, n++) {
        if (/^L_Hand$/.test(eb[b].name)) left++
        if (/^R_Hand$/.test(eb[b].name)) right++
        if (/_Hand$/.test(eb[b].name)) break
      }
    }
    const mirrorSuggested = left > right

    const weaponSkill = this.db.num('EquipParamWeapon', req.weapon, 'swordArtsParamId')
    const weapon = {
      id: req.weapon,
      name:
        this.s.params.rowView('EquipParamWeapon', req.weapon).gameName || db.rowName('EquipParamWeapon', req.weapon),
      variation: weaponVariation,
      skill: weaponSkill,
      skillName:
        weaponSkill >= 0 && db.hasRow('SwordArtsParam', weaponSkill)
          ? this.s.params.rowView('SwordArtsParam', weaponSkill).gameName || db.rowName('SwordArtsParam', weaponSkill)
          : '',
    }

    const { map: dummyMap, options: dummyOptions } = this.mapDummies(req, dummies, motion.scale)
    for (const [k, v] of Object.entries(req.dummies ?? {})) {
      const id = Number(k)
      const opt = dummyOptions.find((o) => o.value === v)
      const cur = dummyMap.get(id)
      if (cur) dummyMap.set(id, { ...cur, to: v, label: opt?.label ?? `dummy ${v}` })
    }

    // What stays behind, grouped.
    const why = new Map<string, number>()
    for (const f of fates.values()) if (typeof f === 'object') why.set(f.drop, (why.get(f.drop) ?? 0) + 1)
    const dropped = [...why].map(([w, n]) => ({ what: `${n} event${n === 1 ? '' : 's'}`, why: w }))
    const notes: string[] = []
    const missing = [...effects].filter(([id, e]) => !e.from && !this.s.internals().lib.hasEffect(id)).map(([id]) => id)
    if (missing.length)
      notes.push(
        `Effects ${missing.join(', ')} aren't in any of the game's effect bundles; their events are kept but show nothing.`,
      )
    // Only the body itself matters here: armor and weapon helper bones keep their usual place anyway.
    const missing2 = motion.unmatched.filter((n) =>
      /^(Pelvis|Spine\d?|Neck|Head|[LR]_(Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot))$/.test(n),
    )
    if (missing2.length)
      notes.push(`${enemyName} has nothing for your ${missing2.join(', ')}: those keep your usual pose.`)
    return {
      req,
      variation,
      enemyName,
      events,
      fates,
      targets,
      effects,
      sounds: soundInfo,
      dummies,
      dummyMap,
      dummyOptions,
      weapon,
      base,
      attack,
      category,
      scale: motion.scale,
      mirrorSuggested,
      dropped,
      notes,
    }
  }

  /** A bullet and everything it spawns (hit and interval bullets), by id. */
  private bulletChain(id: number): number[] {
    const out: number[] = []
    const stack = [id]
    while (stack.length && out.length < 32) {
      const b = stack.pop()!
      if (b <= 0 || out.includes(b) || !this.db.hasRow('Bullet', b)) continue
      out.push(b)
      stack.push(this.db.num('Bullet', b, 'HitBulletID'), this.db.num('Bullet', b, 'intervalCreateBulletId'))
    }
    return out
  }

  /** The effect ids a row's effect fields name. */
  private sfxOf(param: string, id: number): number[] {
    return this.db
      .sfxRefsFrom(param, id)
      .map((r) => r.sfxId)
      .filter((x) => x > 0)
  }

  /* ---------------------------------- dummies --------------------------------- */

  /**
   * Where each of the character's dummy polys goes on the player. A dummy on
   * a bone the player has (a hand, a foot, the chest) goes to the player's
   * dummy on that bone nearest the same spot (scaled, mirrored). A dummy on
   * something the player doesn't have but holds in a hand (Margit's hammer)
   * goes to the weapon in that hand, at the same fraction of its length:
   * the hammer's head becomes the weapon's tip.
   */
  private mapDummies(
    req: A.EnemySkillRequest,
    ids: Set<number>,
    scale: number,
  ): { map: Analysis['dummyMap']; options: Analysis['dummyOptions'] } {
    const character = this.s.character
    const { dummies: ed, bones: eb } = this.s.enemies.dummies(req.chr)
    const eSkel = character.filesOf(req.chr).skeleton()
    const pSkel = character.filesOf().skeleton()
    const ePos = restPositions(eSkel)
    const pPos = restPositions(pSkel)
    const eIndex = new Map(eSkel.map((b, i) => [b.name, i]))
    const pIndex = new Map(pSkel.map((b, i) => [b.name, i]))
    const side = (n: string) => (req.motion.mirror ? otherSide(n) : n)
    const body = character.body()
    // The weapon's dummies, in its own space (the grip at the origin), by how far along the blade
    // each is (toward its farthest dummy, the tip): those behind the grip (the pommel's, like a
    // dagger's 122) aren't points along it.
    let weaponDummies: { id: number; dist: number }[] = []
    try {
      const model = this.db.num('EquipParamWeapon', req.weapon, 'equipModelId')
      const part = character.part(weaponPartName(model), 'R_Weapon')
      const all = part.dummies.filter((d) => d.id > 0 && d.id < 1000)
      const tip = all.reduce<(typeof all)[number] | null>(
        (a, d) => (!a || Math.hypot(...d.position) > Math.hypot(...a.position) ? d : a),
        null,
      )
      const axis = tip ? tip.position.map((v) => v / (Math.hypot(...tip.position) || 1)) : [0, 0, 1]
      weaponDummies = all
        .map((d) => ({ id: d.id, dist: d.position[0] * axis[0] + d.position[1] * axis[1] + d.position[2] * axis[2] }))
        .filter((d) => d.dist > 0.01)
    } catch {
      /* no model: hand dummies instead */
    }
    const maxWeapon = Math.max(1e-6, ...weaponDummies.map((d) => d.dist))
    const bonesOfId = new Map<number, Set<number>>()
    for (const d of body.dummies) {
      const set = bonesOfId.get(d.id) ?? new Set<number>()
      set.add(d.bone)
      bonesOfId.set(d.id, set)
    }
    const BONE_LABEL: Record<string, string> = {
      R_Hand: 'right hand',
      L_Hand: 'left hand',
      R_Foot: 'right foot',
      L_Foot: 'left foot',
      Head: 'head',
      Spine2: 'chest',
      Spine1: 'belly',
      Pelvis: 'hips',
      Neck: 'neck',
    }
    const boneLabel = (i: number) => BONE_LABEL[pSkel[i]?.name] ?? pSkel[i]?.name ?? 'body'
    const options: { value: number; label: string }[] = [
      ...[...weaponDummies]
        .sort((a, b) => b.dist - a.dist)
        .map((d) => ({
          value: weaponDummyId('right', d.id),
          label: `Weapon: dummy ${d.id} (${Math.round((d.dist / maxWeapon) * 100)}% to the tip)`,
        })),
      // The body's well-known points: hands, feet, head, chest, hips.
      ...[1, 2, 5, 6, 7, 8, 9, 220]
        .map((id) => body.dummies.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((d) => ({ value: d.id, label: `Body: ${boneLabel(d.bone)} (dummy ${d.id})` })),
    ]

    const map: Analysis['dummyMap'] = new Map()
    for (const id of ids) {
      const all = ed.filter((x) => x.id === id)
      const d = all.find((x) => !/^dmypoly/i.test(eb[x.attachBone]?.name ?? '')) ?? all[0]
      if (!d) {
        map.set(id, { to: 220, label: 'Body: chest (dummy 220)', bone: '?' })
        continue
      }
      // Up the model's bones to one the player has.
      let b = d.attachBone
      let steps = 0
      while (b >= 0 && !pIndex.has(side(eb[b].name)) && steps < 64) {
        b = eb[b].parent
        steps++
      }
      const own = eb[d.attachBone]?.name ?? '?'
      const matched = b >= 0 ? side(eb[b].name) : 'Master'
      const heldThing = steps > 0 && /^[LR]_Hand$/.test(matched)
      if (heldThing && weaponDummies.length && matched === 'R_Hand') {
        // Along the held thing: its dummies' distances from the hand (a hammer's head dummies spread
        // across the head, all at its end).
        const hand = eSkel[eIndex.get(eb[b].name) ?? -1] ? ePos[eIndex.get(eb[b].name)!] : null
        const along = (x: { position: number[] }) =>
          hand ? Math.hypot(x.position[0] - hand[0], x.position[1] - hand[1], x.position[2] - hand[2]) : 0
        const same = ed.filter((x) => x.attachBone === d.attachBone)
        const max = Math.max(1e-6, ...same.map(along))
        const f = along(d) / max
        const best = weaponDummies.reduce((a, c) =>
          Math.abs(c.dist / maxWeapon - f) < Math.abs(a.dist / maxWeapon - f) ? c : a,
        )
        // Where the hand holds the thing: its own bone's root (Margit's L_Hammer, on the
        // shaft), in this dummy's frame, so an effect held at it can be put in the player's hand.
        let held = d.attachBone
        for (let n = 0; held >= 0 && eb[held].parent !== b && n < 64; n++) held = eb[held].parent
        const grip = held >= 0 && eIndex.has(eb[held].name) ? ePos[eIndex.get(eb[held].name)!] : hand
        map.set(id, {
          to: weaponDummyId('right', best.id),
          label: `Weapon: dummy ${best.id} (${Math.round((best.dist / maxWeapon) * 100)}% to the tip)`,
          bone: own,
          ...(grip ? { handle: pointInDummyFrame(d, grip) } : {}),
        })
        continue
      }
      // On the body: the player's dummy on that bone (or a parent) nearest the same spot.
      const pb = pIndex.get(matched) ?? 0
      const eb0 = eIndex.get(b >= 0 ? eb[b].name : 'Master') ?? 0
      const off = [d.position[0] - ePos[eb0][0], d.position[1] - ePos[eb0][1], d.position[2] - ePos[eb0][2]].map(
        (v) => v * scale,
      )
      if (req.motion.mirror) off[0] = -off[0]
      // Ids on one bone only first (an id the body has on both feet would
      // spawn on both): up the bones until one has such a dummy; failing
      // that, any dummy on the nearest bone that has one.
      const nearest = (uniqueOnly: boolean): { id: number; bone: number } | null => {
        for (let at = pb, n = 0; n < 64 && at >= 0; n++, at = pSkel[at].parent) {
          let best: { id: number; err: number } | null = null
          for (const pd of body.dummies) {
            if (pd.bone !== at || pd.id <= 0 || pd.id >= 1000 || (uniqueOnly && bonesOfId.get(pd.id)!.size !== 1))
              continue
            const o = [pd.position[0] - pPos[at][0], pd.position[1] - pPos[at][1], pd.position[2] - pPos[at][2]]
            const err = Math.hypot(o[0] - off[0], o[1] - off[1], o[2] - off[2])
            if (!best || err < best.err) best = { id: pd.id, err }
          }
          if (best) return { id: best.id, bone: at }
        }
        return null
      }
      const hit = nearest(true) ?? nearest(false)
      if (hit) map.set(id, { to: hit.id, label: `Body: ${boneLabel(hit.bone)} (dummy ${hit.id})`, bone: own })
      else map.set(id, { to: 220, label: 'Body: chest (dummy 220)', bone: own })
    }
    return { map, options }
  }

  /* ----------------------------------- plan ----------------------------------- */

  plan(req: A.EnemySkillRequest): A.EnemySkillPlan {
    const a = this.analyze(req)
    let distance = 0
    try {
      const clip = this.s.character.clip(req.animation, req.chr)
      if (clip.root) {
        const b = Buffer.from(clip.root, 'base64')
        const r = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
        const n = r.length / 4
        distance = Math.hypot(r[(n - 1) * 4], r[(n - 1) * 4 + 2])
      }
    } catch {
      /* no motion: 0 */
    }
    // Its hits, and cuts between them (mid-way through each pause of half a second or more): where it
    // can be split into steps, one per R1 press.
    const hits = [
      ...new Set(
        a.events
          .filter((e) => a.fates.get(e.index) === 'attack' || a.fates.get(e.index) === 'bullet')
          .map((e) => +e.ev.start.toFixed(3)),
      ),
    ].sort((x, y) => x - y)
    const cuts: number[] = []
    for (let i = 1; i < hits.length; i++)
      if (hits[i] - hits[i - 1] >= 0.5) cuts.push(snapToFrame((hits[i] + hits[i - 1]) / 2))
    let length = 0
    try {
      length = this.s.character.clip(req.animation, req.chr).duration
    } catch {
      /* no motion */
    }
    const attackNames = a.attack ? a.attack.ids.map((id) => animationName(a.category, id)) : null
    return {
      category: a.category,
      animations: attackNames ?? a.base.all.map((n) => n.replace(/^a\d{3}/, `a${a.category}`)),
      attackTargets: this.attackTargetsOf(req.weapon),
      attack: a.attack
        ? {
            key: a.attack.key,
            label: a.attack.label,
            group: a.attack.group,
            ids: a.attack.ids,
            animations: attackNames!,
          }
        : null,
      scale: a.scale,
      distance,
      mirrorSuggested: a.mirrorSuggested,
      dummies: [...a.dummyMap].map(([id, m]) => ({
        id,
        bone: m.bone,
        to: m.to,
        toLabel: m.label,
        options: a.dummyOptions,
      })),
      attacks: [...a.targets]
        .filter(([, x]) => x.kind === 'attack')
        .map(([judge, x]) => ({ judge, atk: x.id, name: x.name, newJudge: x.newJudge })),
      bullets: [...a.targets]
        .filter(([, x]) => x.kind === 'bullet')
        .map(([judge, x]) => ({ judge, bullet: x.id, name: x.name, newJudge: x.newJudge })),
      effects: [...a.effects].map(([id, e]) => ({ id, name: e.name, from: e.from })),
      sounds: {
        events: a.sounds.events,
        bring: a.sounds.bring.length,
        present: a.sounds.present,
        bytes: a.sounds.bytes,
        bank: PLAYER_BANK,
      },
      dropped: a.dropped,
      baseSkill: { id: a.base.id, name: a.base.name, category: a.base.category },
      weapon: a.weapon,
      notes: a.notes,
      hits,
      cuts,
      length,
    }
  }

  /* ----------------------------------- make ----------------------------------- */

  make(req: A.EnemySkillRequest): A.EnemySkillResult {
    if (!req.attack && !req.name.trim()) throw new Error('Give the skill a name')
    const a = this.analyze(req)
    const s = this.s
    const { db } = s.internals()
    const rows: A.EnemySkillResult['rows'] = []
    const made = (param: string, id: number) => rows.push({ param, id, name: db.rowName(param, id) })

    // 1-3. Its effects, sounds, and the player's attacks and bullets.
    const { fx, newTarget, sound, playerSize } = this.bringAlong(a, made)
    if (a.attack) return this.makeAttack(a, rows, made, fx, newTarget, sound)

    // 4. Animations: the base skill's category copied, its motions replaced by the move.
    const anims = s.animations
    const dup = anims.duplicate({
      fromCategory: a.base.category,
      toCategory: a.category,
      register: true,
      overwrite: false,
    })
    const timing = this.timing(a)
    for (const own of a.base.ownMotions) this.writeMotion(a, own, own.replace(/^a\d{3}/, `a${a.category}`))
    // Every animation in the new category: own motion -> the new file; references -> the new copies; events rebuilt.
    const ownTargets = new Set(a.base.ownMotions.map((n) => n.replace(/^a\d{3}/, `a${a.category}`)))
    const created = [...dup.created, ...dup.replaced]
    for (const name of created) {
      anims.editAnimation(name, (tae, anim) => {
        const m = motionOf(a.category, anim)
        if (ownTargets.has(name)) {
          anim.file = { type: 0, name: `${name}.hkt`, a: 0, b: -1, c: 0n, d: 0n }
        } else if (m.source) {
          const target = m.source.replace(/^a\d{3}/, `a${a.category}`)
          if (ownTargets.has(target)) {
            const full = a.category * 1_000_000 + Number(target.slice(-6))
            anim.file =
              anim.file.type === 1
                ? { ...anim.file, a: full }
                : { ...anim.file, a: 256, b: full, name: `${target}.hkt` }
          }
        }
        // Events: the base skill's bookkeeping, retimed; then the move's own (in the no-FP twin, not what FP buys).
        this.rebuildEvents(tae, anim, a, timing, fx, this.isNoFpTwin(name, anim, created))
      })
    }

    // Effects held by him (his hammer): where his hand holds them, for Scale…'s "kept in the hand".
    this.recordHandles(a, fx, playerSize)

    // 5. Behavior rows on the weapon: each new judge -> the player's attack or bullet.
    const templateRow = this.skillBehaviorTemplate(a.base.category)
    for (const [judge, t] of a.targets) {
      const id = 300_000_000 + a.weapon.variation * 1000 + (t.newJudge % 1000)
      s.params.addRow(
        'BehaviorParam_PC',
        id,
        templateRow ?? undefined,
        `${req.name} - ${t.name.replace(/^\[[^\]]*\]\s*/, '') || t.kind}`,
      )
      s.params.setRowField('BehaviorParam_PC', id, 'variationId', a.weapon.variation)
      s.params.setRowField('BehaviorParam_PC', id, 'behaviorJudgeId', t.newJudge % 1000)
      s.params.setRowField('BehaviorParam_PC', id, 'refType', t.kind === 'attack' ? 0 : 1)
      s.params.setRowField('BehaviorParam_PC', id, 'refId', newTarget.get(judge)!)
      made('BehaviorParam_PC', id)
    }

    // 6. The skill: a copy of the base skill in the new category, named, and the weapon's.
    const skill = s.params.freeId('SwordArtsParam', 9100)
    s.params.addRow('SwordArtsParam', skill, a.base.id, req.name.trim())
    s.params.setRowField('SwordArtsParam', skill, 'swordArtsTypeNew', a.category - 600)
    s.params.setRowField('SwordArtsParam', skill, 'textId', skill)
    s.params.setGameName('SwordArtsParam', skill, req.name.trim())
    if (req.description.trim()) s.params.setCaption('SwordArtsParam', skill, req.description.trim())
    made('SwordArtsParam', skill)
    s.params.setRowField('EquipParamWeapon', req.weapon, 'swordArtsParamId', skill)

    const animations = created.sort()
    const soundCount = [...a.fates.values()].filter((f) => f === 'sound').length
    const summary =
      `${req.name.trim()} (skill ${skill}) for ${a.weapon.name}: ${a.enemyName}'s ${req.animation} fitted to the player as ${animations.join(', ')}` +
      `, ${a.targets.size} attack${a.targets.size === 1 ? '' : 's'} and bullet${a.targets.size === 1 ? '' : 's'}, ${a.effects.size} effect${a.effects.size === 1 ? '' : 's'}` +
      `${soundCount ? `, ${soundCount} sound${soundCount === 1 ? '' : 's'}` : ''}.`
    return {
      skill,
      category: a.category,
      animations,
      rows,
      effects: [...a.effects.keys()].map(fx),
      sounds: { events: soundCount, copied: sound?.copied ?? 0, bytes: sound?.mediaBytes ?? 0, bank: PLAYER_BANK },
      summary,
    }
  }

  /** 1-3 of making a move the player's: its effects (imported; scaled copies if asked), its sounds, its attacks and bullets as the player's. */
  private bringAlong(
    a: Analysis,
    made: (param: string, id: number) => void,
  ): {
    fx: (id: number, at?: number) => number
    newTarget: Map<number, number>
    sound: { copied: number; mediaBytes: number } | null
    playerSize: boolean
  } {
    const s = this.s
    const req = a.req
    const { lib, effectIdStart } = s.internals()
    const playerSize = req.effectSize === 'player'
    // 1. Effects: into the common bundles, then (if asked) copies at the player's size.
    for (const [id, e] of a.effects) if (e.from && !lib.hasEffect(id)) s.effects.importEffect(id)
    const effectMap = new Map<number, number>()
    if (playerSize) {
      let next = effectIdStart
      for (const id of effectsToCopy(lib, a.effects.keys(), true)) {
        const to = lib.freeEffectId(next)
        lib.cloneEffect(id, to)
        effectMap.set(id, to)
        next = to + 1
      }
      for (const to of effectMap.values()) {
        const fxr = lib.getEffect(to)
        remapEffectReferences(fxr, effectMap)
        fxr.root.scale(a.scale)
        lib.saveEffect(fxr)
      }
    }
    const sized = (id: number) => effectMap.get(id) ?? id
    // Held in his hand (his hammer, at a dummy on its bone) and spawned on the weapon: a copy moved so
    // his grip is in the player's hand (fitHeld), for each weapon point it appears at.
    const held = this.fitHeld(a, sized, playerSize)
    const fx = (id: number, at?: number) => (at !== undefined ? held.get(`${id}@${at}`) : undefined) ?? sized(id)
    // 2. Sounds: the move's and its bullets', into the player's sound bank.
    const sound = a.sounds.bring.length ? s.sounds.bring(req.chr, a.sounds.bring) : null
    // 3. Attacks and bullets for the player.
    const newTarget = new Map<number, number>()
    for (const [judge, t] of a.targets) {
      if (t.kind === 'attack') newTarget.set(judge, this.playerAttack(t.id, a, playerSize, made))
      else newTarget.set(judge, this.playerBullet(t.id, a, playerSize, fx, made))
    }
    return { fx, newTarget, sound, playerSize }
  }

  /**
   * The effects the character holds (spawned at a dummy on something in its
   * hand, Margit's hammer, dagger, spear) and that land on the weapon: for
   * each weapon point one appears at, a copy moved so his grip on it is in
   * the player's hand. Without it the effect sat where his dummy was relative
   * to his grip: his spear 2.6 m behind the player's hand, his dagger 0.3 m.
   * His grip (the held thing's own bone, in the dummy's frame) and the
   * weapon's grip (its model's origin) are the dummies' handle and
   * gripInDummyFrame; the copy is at its size `sized` made it (scaled about
   * its own origin), so it moves by grip - size x handle. It isn't turned:
   * his dagger runs 12 degrees off the blade, his hammer 22 (as the hammer on
   * the katana and the club always has). Recorded as fitted, so Scale keeps
   * it in the hand. Key: "effect@weapon dummy" (TAE id), value: the copy.
   */
  private fitHeld(a: Analysis, sized: (id: number) => number, playerSize: boolean): Map<string, number> {
    const out = new Map<string, number>()
    const s = this.s
    const { lib, effectIdStart } = s.internals()
    let dummies: { id: number; position: number[]; forward: number[]; up: number[] }[] = []
    try {
      dummies = s.character.part(
        weaponPartName(this.db.num('EquipParamWeapon', a.req.weapon, 'equipModelId')),
        'R_Weapon',
      ).dummies
    } catch {
      return out
    }
    const size = playerSize ? a.scale : 1
    const record = s.scaleRecord()
    // Each held effect's weapon points, with his grip on it.
    const points = new Map<number, Map<number, number[]>>()
    for (const e of a.events) {
      if (a.fates.get(e.index) !== 'effect') continue
      const effect = e.fields.find((f) => f.link === 'effect')?.value ?? 0
      const m = a.dummyMap.get(e.fields.find((f) => isDummyField(f))?.value ?? -1)
      const weaponPoint = m ? parseDummyId(m.to) : null
      if (effect <= 0 || !m?.handle || weaponPoint?.on !== 'right' || !dummies.some((x) => x.id === weaponPoint.point))
        continue
      const at = points.get(effect) ?? new Map<number, number[]>()
      if (!at.has(m.to)) at.set(m.to, m.handle)
      points.set(effect, at)
    }
    let next = effectIdStart
    for (const [effect, at] of points) {
      const base = sized(effect)
      if (!lib.hasEffect(base)) continue
      // Copies from the unmoved effect first; the size copy is ours alone, so the last point moves it
      // itself. The game's own effect (his size) is never moved: every point gets a copy.
      const list = [...at]
      list.forEach(([to, h], i) => {
        let id = base
        if (!(playerSize && base !== effect && i === list.length - 1)) {
          id = lib.freeEffectId(next)
          lib.cloneEffect(base, id)
          next = id + 1
        }
        const g = gripInDummyFrame(dummies.find((x) => x.id === parseDummyId(to).point)!)
        const fxr = lib.getEffect(id)
        shiftEffect(
          fxr,
          g.map((v, k) => v - size * h[k]),
        )
        lib.saveEffect(fxr)
        record.effects[id] = size
        record.copies[id] = effect
        ;(record.handles ??= {})[String(id)] = h
        ;(record.fitted ??= {})[String(id)] = g
        out.set(`${effect}@${to}`, id)
      })
      s.scaleRecordChanged()
    }
    return out
  }

  /** The move fitted to the player, written as a new animation file (named `target`) in the binder `template`'s file is in. */
  private writeMotion(a: Analysis, template: string, target: string): void {
    const s = this.s
    const req = a.req
    const character = s.character
    const tpl = character.filesOf().tagfile(`${template}.hkx`)
    const binding = itemsOfType(tpl.tf, 'hkaAnimationBinding')[0]?.value
    const pSkel = character.filesOf().skeleton()
    const trackNames = binding
      ? Array.from(binding.transformTrackToBoneIndices as Int16Array)
          .map((b) => pSkel[b]?.name)
          .filter((n): n is string => !!n && PLAYER_TRACKS.includes(n))
      : PLAYER_TRACKS
    const full = character.retargetedMotion(
      req.animation,
      { chr: req.chr, ...req.motion },
      trackNames.length ? trackNames : PLAYER_TRACKS,
    )
    const motion = a.span ? sliceMotion(full, a.span.from, a.span.to) : full
    const file = writeTagfile(writeAnimationFile(tpl.tf, motion))
    s.animations.putMotion(tpl.binder, `${target}.hkx`, file, tpl.compendium)
    character.forgetClip(`${target}.hkx`)
  }

  /** An animation's events: its base's bookkeeping (retimed to the move), then the move's own, judges, effects and dummy polys remapped. */
  private rebuildEvents(
    tae: TaeFile,
    anim: TaeFileAnimation,
    a: Analysis,
    timing: (t: number) => number,
    fx: (id: number, at?: number) => number,
    noFp = false,
  ): void {
    const kept = anim.events.filter((ev) => this.keepBaseEvent(ev))
    anim.events = []
    anim.groups = []
    for (const ev of kept) {
      const start = timing(ev.start)
      const end = ev.end >= OPEN_EVENT_END ? FLOAT_MAX : Math.max(start, timing(ev.end))
      addEvent(tae, anim, { ...ev, params: Buffer.from(ev.params), start: Math.fround(start), end: Math.fround(end) })
    }
    const span = a.span
    // The no-FP twin is the move without what FP buys, as the game's own twins are: no attacks, bullets or
    // effects, nor the sounds that come with them (a sound whose id starts within 3 frames of one, anywhere in
    // the move: the conjure and the impact), only the motion with its steps and cloth, and the bookkeeping.
    const bought = (f: Fate | undefined) => f === 'attack' || f === 'bullet' || f === 'effect'
    const soundOf = (e: Ev) => e.fields.find((f) => f.name === 'SoundID')?.value ?? 0
    const withBought = new Set<number>()
    if (noFp) {
      const starts = a.events.filter((e) => bought(a.fates.get(e.index))).map((e) => e.ev.start)
      for (const e of a.events)
        if (a.fates.get(e.index) === 'sound' && starts.some((t) => Math.abs(t - e.ev.start) <= 3 / 30 + 1e-4))
          withBought.add(soundOf(e))
    }
    for (const e of a.events) {
      const fate = a.fates.get(e.index)
      if (!fate || typeof fate === 'object') continue
      if (noFp && (bought(fate) || (fate === 'sound' && withBought.has(soundOf(e))))) continue
      let start = e.ev.start
      let end = e.ev.end
      // A step of a split move: what happens in its part, from its start (held through a cut: again in the next).
      if (span) {
        const open = end >= OPEN_EVENT_END
        if (start >= span.to || (!open && end <= span.from)) continue
        start = Math.max(start, span.from) - span.from
        end = open ? end : Math.min(end, span.to) - span.from
      }
      const ev: TaeFileEvent = {
        type: e.type,
        unk: e.ev.unk,
        start: Math.fround(start),
        end: end >= OPEN_EVENT_END ? end : Math.fround(end),
        params: Buffer.from(e.ev.params),
      }
      const at = a.dummyMap.get(e.fields.find((f) => isDummyField(f))?.value ?? -1)?.to
      for (const f of e.fields) {
        if (f.name === 'BehaviorJudgeID') {
          const t = a.targets.get(f.value)
          if (t) writeField(ev, f.type, f.offset, t.newJudge)
        } else if (f.link === 'effect' && f.value > 0) writeField(ev, f.type, f.offset, fx(f.value, at))
        else if (isDummyField(f) && f.value > 0) {
          const m = a.dummyMap.get(f.value)
          if (m) writeField(ev, f.type, f.offset, m.to)
        } else if (f.name === 'Source' && (e.type === 1 || e.type === 2)) writeField(ev, f.type, f.offset, 0)
      }
      addEvent(tae, anim, ev)
    }
  }

  /** Effects held by the character (Margit's hammer): where his hand holds them, for Scale…'s "kept in the hand". */
  private recordHandles(a: Analysis, fx: (id: number, at?: number) => number, playerSize: boolean): void {
    const s = this.s
    const record = s.scaleRecord()
    for (const e of a.events) {
      if (a.fates.get(e.index) !== 'effect') continue
      const fxId = e.fields.find((f) => f.link === 'effect')?.value ?? 0
      const dummy = e.fields.find((f) => isDummyField(f))?.value ?? -1
      const handle = a.dummyMap.get(dummy)?.handle
      if (fxId <= 0 || !handle) continue
      const id = fx(fxId, a.dummyMap.get(dummy)?.to)
      if (record.fitted?.[id]) continue
      const at = playerSize ? handle.map((v) => v * a.scale) : handle
      ;(record.handles ??= {})[String(id)] ??= at
      s.scaleRecordChanged()
    }
  }

  /**
   * The move made one of the weapon's attacks: in the weapon's own category
   * (made the first time), each animation the attack has starts as the
   * weapon's own (its combo, cancel and recovery windows, retimed to the
   * move) and plays the move fitted to the player; its hits and bullets go
   * through behavior rows of the weapon's own variation (judges 700 up).
   */
  private makeAttack(
    a: Analysis,
    rows: A.EnemySkillResult['rows'],
    made: (param: string, id: number) => void,
    fx: (id: number) => number,
    newTarget: Map<number, number>,
    sound: { copied: number; mediaBytes: number } | null,
  ): A.EnemySkillResult {
    const s = this.s
    const req = a.req
    const target = a.attack!
    const own = s.movesets.ensureOwn(req.weapon)
    for (const id of own.rows) made('BehaviorParam_PC', id)
    const rec = own.rec
    const cat = rec.category
    const pad = (n: number, w: number) => String(n).padStart(w, '0')
    const anims = s.animations
    // Split into steps: each part of the move one press of R1, from this one on (R1 1st, 2nd, 3rd...).
    const parts = req.steps?.length ? this.stepParts(a) : [{ target, span: undefined as Analysis['span'] }]
    const names: string[] = []
    for (const part of parts) {
      const pa: Analysis = { ...a, attack: part.target, ...(part.span ? { span: part.span } : {}) }
      const mine = part.target.ids.map((id) => `a${pad(cat, 3)}_${pad(id, 6)}`)
      // Each animation starts as the weapon's own for that attack, in its category.
      part.target.ids.forEach((id, i) =>
        anims.duplicate({ names: [part.target.bases[i]], toCategory: cat, toId: id, register: true, overwrite: true }),
      )
      // One motion file for all of them (R2's quick and charged versions play the same move).
      this.writeMotion(pa, a.base.ownMotions[0], mine[0])
      mine.forEach((name, i) => {
        const timing = this.timing(pa, part.target.bases[i])
        anims.editAnimation(name, (tae, anim) => {
          anim.file =
            i === 0
              ? { type: 0, name: `${name}.hkt`, a: 0, b: -1, c: 0n, d: 0n }
              : { type: 0, name: `${mine[0]}.hkt`, a: 256, b: cat * 1_000_000 + part.target.ids[0], c: 0n, d: 0n }
          this.rebuildEvents(tae, anim, pa, timing, fx)
        })
      })
      names.push(...mine)
    }
    this.recordHandles(a, fx, req.effectSize === 'player')

    // Behavior rows of the weapon's moves (category 1): each new judge -> the player's attack or bullet.
    const template = this.attackBehaviorTemplate(rec.variation)
    const what = this.moveName(a)
    const label = `${target.group} ${target.label}: ${a.enemyName}’s ${what} (${req.animation})`
    for (const [judge, t] of a.targets) {
      const id = behaviorRowId(1, rec.variation, t.newJudge % 1000)
      s.params.addRow(
        'BehaviorParam_PC',
        id,
        template ?? undefined,
        `${a.weapon.name} - ${a.enemyName}’s ${what}: ${t.name.replace(/^\[[^\]]*\]\s*/, '') || t.kind}`,
      )
      s.params.setRowField('BehaviorParam_PC', id, 'variationId', rec.variation)
      s.params.setRowField('BehaviorParam_PC', id, 'behaviorJudgeId', t.newJudge % 1000)
      s.params.setRowField('BehaviorParam_PC', id, 'refType', t.kind === 'attack' ? 0 : 1)
      s.params.setRowField('BehaviorParam_PC', id, 'refId', newTarget.get(judge)!)
      made('BehaviorParam_PC', id)
    }
    if (parts.length === 1)
      s.movesets.recordEnemyMove(req.weapon, target.ids, {
        chr: req.chr,
        animation: req.animation,
        label,
        judges: [...a.targets.values()].map((t) => t.newJudge),
      })
    else
      for (const part of parts) {
        // Each step with the judges its own events fire (Back to its own on one keeps the others' rows).
        const inPart = new Set(
          a.events
            .filter((e) => e.ev.start >= part.span!.from - 1e-4 && e.ev.start < part.span!.to)
            .map((e) => e.fields.find((f) => f.name === 'BehaviorJudgeID')?.value),
        )
        const judges = [...a.targets].filter(([j]) => inPart.has(j)).map(([, t]) => t.newJudge)
        const partLabel = `${part.target.group} ${part.target.label}: ${a.enemyName}’s ${what} (${req.animation}, ${part.span!.from.toFixed(2)}–${part.span!.to.toFixed(2)} s)`
        s.movesets.recordEnemyMove(req.weapon, part.target.ids, {
          chr: req.chr,
          animation: req.animation,
          label: partLabel,
          judges,
        })
      }

    const soundCount = [...a.fates.values()].filter((f) => f === 'sound').length
    const summary =
      (parts.length > 1
        ? `${a.weapon.name}’s ${target.group.toLowerCase()} ${parts.map((p) => p.target.label.replace(/^R1, /, '')).join(', ')} R1 are now ${a.enemyName}’s ${what} (${req.animation}) in ${parts.length} steps, fitted to the player (${names.join(', ')})`
        : `${a.weapon.name}’s ${target.group.toLowerCase()} ${target.label} is now ${a.enemyName}’s ${what} (${req.animation}), fitted to the player (${names.join(', ')})`) +
      `, ${a.targets.size} attack${a.targets.size === 1 ? '' : 's'} and bullet${a.targets.size === 1 ? '' : 's'}, ${a.effects.size} effect${a.effects.size === 1 ? '' : 's'}` +
      `${soundCount ? `, ${soundCount} sound${soundCount === 1 ? '' : 's'}` : ''}.`
    return {
      skill: -1,
      attack: { key: target.key, label: target.label, group: target.group, ids: parts.flatMap((p) => p.target.ids) },
      category: cat,
      animations: names,
      rows,
      effects: [...a.effects.keys()].map(fx),
      sounds: { events: soundCount, copied: sound?.copied ?? 0, bytes: sound?.mediaBytes ?? 0, bank: PLAYER_BANK },
      summary,
    }
  }

  /**
   * The parts of a move split at `req.steps` (seconds into it), each the
   * weapon's next R1 from the one asked for: Margit's sword combo, seven hits
   * in one 5.9 s animation, locked the player in until it ended; cut between
   * its hit groups, each press of R1 plays the next part.
   */
  private stepParts(
    a: Analysis,
  ): { target: A.EnemyAttackTarget & { bases: string[] }; span: { from: number; to: number } }[] {
    const req = a.req
    const first = a.attack!
    const m = /^(.*-r1)-(\d+)$/.exec(first.key)
    if (!m)
      throw new Error(
        `Only an R1 can be split into steps (one per press), not ${first.group.toLowerCase()} ${first.label}`,
      )
    let length = 0
    try {
      length = this.s.character.clip(req.animation, req.chr).duration
    } catch {
      throw new Error(`${req.animation} has no motion to split`)
    }
    const cuts = [...new Set(req.steps!.map(snapToFrame))]
      .filter((t) => t > 0.05 && t < length - 0.05)
      .sort((x, y) => x - y)
    if (!cuts.length) throw new Error(`No cut inside the move (0–${length.toFixed(2)} s)`)
    const edges = [0, ...cuts, length]
    const targets = this.s.movesets.attackTargets(req.weapon)
    return edges.slice(1).map((to, k) => {
      const key = `${m[1]}-${Number(m[2]) + k}`
      const t = k === 0 ? first : targets.find((x) => x.key === key)
      if (!t)
        throw new Error(
          `The weapon has no ${first.group.toLowerCase()} R1 for step ${k + 1} (it has ${targets.filter((x) => x.key.startsWith(m[1] + '-')).length})`,
        )
      const bases =
        'bases' in t
          ? (t as { bases: string[] }).bases
          : t.ids.map((id) => this.s.movesets.baseAnimation(req.weapon, id))
      if (bases.some((b) => !b)) throw new Error(`The weapon has nothing for ${t.label} to start from`)
      return { target: { ...t, bases: bases as string[] }, span: { from: edges[k], to } }
    })
  }

  /** A move in a word or two, from what it hits or fires with ("Hammer", "Sword", "Dagger"): else its animation's name. */
  private moveName(a: Analysis): string {
    try {
      const m = this.s.enemies.move(a.req.chr, a.req.animation, a.variation)
      const named = m.actions
        .map((x) => x.name.replace(/^\[[^\]]*\]\s*/, '').trim())
        .find((n) => n && !/^(Attack|Bullet)( judge)? \d+$/i.test(n))
      return named || a.req.animation
    } catch {
      return a.req.animation
    }
  }

  /** A behavior row of the weapon's moves (category 1, an attack) to copy for new judges. */
  private attackBehaviorTemplate(variation: number): number | null {
    for (const v of [variation, Math.floor(variation / 100) * 100, 0]) {
      const id = behaviorRowId(1, v, 0)
      if (this.db.hasRow('BehaviorParam_PC', id)) return id
    }
    const any = this.db
      .get('BehaviorParam_PC')
      .param.rows.find((r) => behaviorCategoryOf(r.id) === 1 && this.db.num('BehaviorParam_PC', r.id, 'refType') === 0)
    return any?.id ?? null
  }

  /** The weapon's attacks a move can become (for the dialog), none if it can't have any. */
  private attackTargetsOf(weapon: number): A.EnemyAttackTarget[] {
    try {
      return this.s.movesets.attackTargets(weapon)
    } catch {
      return []
    }
  }

  /** The base skill's events that are about the player, not the base's motion: they stay (retimed). */
  /**
   * Whether a skill animation is its no-FP twin. The game's skills pair each
   * animation …0 with a …5 that plays the same motion without the FP drain
   * (WeaponArtFPConsumption), and play the twin when FP runs short (all 211
   * pairs in the game, Lion's Claw's a600_040005 among them).
   */
  private isNoFpTwin(name: string, anim: TaeFileAnimation, names: string[]): boolean {
    const id = Number(name.slice(-6))
    const partner = `${name.slice(0, -6)}${String(id - 5).padStart(6, '0')}`
    return (
      id % 10 === 5 &&
      names.includes(partner) &&
      !anim.events.some((ev) => this.template.events[ev.type]?.name === 'WeaponArtFPConsumption')
    )
  }

  private keepBaseEvent(ev: TaeFileEvent): boolean {
    const t = this.template.events[ev.type]
    const name = t?.name ?? ''
    if ([1, 2, 5, 144, 145, 304, 307, 608, 792].includes(ev.type)) return false
    if (isSound(name) || /ModelMask/i.test(name)) return false
    if (decodeEvent(ev, this.template).some((f) => f.link === 'effect')) return false
    return true
  }

  /**
   * Base skill time -> new motion time: its first and last hit land on the
   * move's first and last hit, its end on the move's end, straight lines in
   * between (FP is spent before the hit, recovery comes after the last).
   */
  private timing(a: Analysis, own = a.base.ownMotions[0]): (t: number) => number {
    const anims = this.s.animations
    const character = this.s.character
    const base = anims.view(own)
    const hits = (list: { type: number; start: number }[]) =>
      list.filter((e) => e.type === 1 || e.type === 2).map((e) => e.start)
    const bHits = hits(base.events)
    const span = a.span
    const eHits = a.events
      .filter(
        (e) =>
          (a.fates.get(e.index) === 'attack' || a.fates.get(e.index) === 'bullet') &&
          (!span || (e.ev.start >= span.from - 1e-4 && e.ev.start < span.to)),
      )
      .map((e) => e.ev.start - (span?.from ?? 0))
    let bEnd = base.length
    try {
      bEnd = character.clip(own).duration || bEnd
    } catch {
      /* the events' end */
    }
    let eEnd: number
    if (span) eEnd = span.to - span.from
    else
      try {
        eEnd = character.clip(a.req.animation, a.req.chr).duration
      } catch {
        eEnd = Math.max(...a.events.map((e) => (e.ev.end < OPEN_EVENT_END ? e.ev.end : e.ev.start)))
      }
    const pts: [number, number][] = [[0, 0]]
    if (bHits.length && eHits.length) {
      pts.push([Math.min(...bHits), Math.min(...eHits)])
      if (Math.max(...bHits) > Math.min(...bHits) + 1e-3) pts.push([Math.max(...bHits), Math.max(...eHits)])
      else if (Math.max(...eHits) > Math.min(...eHits) + 1e-3) pts.push([Math.min(...bHits) + 1e-3, Math.max(...eHits)])
    }
    pts.push([Math.max(bEnd, (pts.at(-1)?.[0] ?? 0) + 0.1), Math.max(eEnd, (pts.at(-1)?.[1] ?? 0) + 0.1)])
    return (t: number) => {
      for (let i = 1; i < pts.length; i++) {
        const [b0, e0] = pts[i - 1]
        const [b1, e1] = pts[i]
        if (t <= b1 || i === pts.length - 1) return Math.max(0, e0 + ((t - b0) * (e1 - e0)) / Math.max(1e-6, b1 - b0))
      }
      return t
    }
  }

  /** A behavior row of the base skill's own (category 3), to copy for the new judges. */
  private skillBehaviorTemplate(baseCategory: number): number | null {
    const view = this.s.animations.view(`a${baseCategory}_040000`)
    for (const e of view.events) {
      const j = e.fields.find((f) => f.name === 'BehaviorJudgeID')?.value
      if ((e.type !== 1 && e.type !== 2) || j === undefined || j < 1000) continue
      const id = behaviorRowId(Math.floor(j / 1000), 0, j % 1000)
      if (this.db.hasRow('BehaviorParam_PC', id)) return id
    }
    const any = this.db.get('BehaviorParam_PC').param.rows.find((r) => behaviorCategoryOf(r.id) === 3)
    return any?.id ?? null
  }

  /**
   * The player's copy of an enemy attack (AtkParam_Npc -> AtkParam_Pc): its
   * flat damage counted for the player and its push a player's
   * (fitAttackForPlayer), its hits moved onto the player's weapon or body,
   * scaled with the effects when they are.
   */
  private playerAttack(npc: number, a: Analysis, playerSize: boolean, made: (p: string, id: number) => void): number {
    const s = this.s
    const db = this.db
    // Its own id if the player's table has none there (the enemy's attack and its copy, one id,
    // as the game pairs them), else one free in both tables: a bullet names its attack's id in
    // both, so a copy at an id an enemy attack has would be taken for that attack's when one of
    // its bullets is made the player's (a shockwave would hit with its hammer's attack).
    let id = npc
    if (db.hasRow('AtkParam_Pc', id)) {
      id++
      while (db.hasRow('AtkParam_Pc', id) || db.hasRow('AtkParam_Npc', id)) id++
    }
    s.params.addRow('AtkParam_Pc', id, undefined, `${db.rowName('AtkParam_Npc', npc) || `Attack ${npc}`} (yours)`)
    const pc = db.get('AtkParam_Pc')
    const row = db.row('AtkParam_Pc', id)!
    db.row('AtkParam_Npc', npc)!.data.copy(row.data)
    fitAttackForPlayer(row.data, pc.def)
    const f = (name: string) => pc.def.fieldsByName.get(name)
    const set = (name: string, v: number) => {
      const fd = f(name)
      if (fd) setField(row.data, fd, v)
    }
    const get = (name: string) => {
      const fd = f(name)
      return fd ? Number(getField(row.data, fd)) : 0
    }
    let weaponHits = 0
    let bodyHits = 0
    for (let k = 0; k < 16; k++) {
      if (get(`hit${k}_Radius`) <= 0) continue
      for (const name of [`hit${k}_DmyPoly1`, `hit${k}_DmyPoly2`]) {
        const d = get(name)
        if (d <= 0) continue
        const m = a.dummyMap.get(d)
        if (!m) continue
        const to = parseDummyId(m.to)
        if (to.on !== 'body') {
          set(name, to.point)
          weaponHits++
        } else {
          set(name, m.to)
          bodyHits++
        }
      }
      if (playerSize) set(`hit${k}_Radius`, get(`hit${k}_Radius`) * a.scale)
    }
    // Hits are on the weapon (hitSourceType 0) or the body (1).
    set('hitSourceType', weaponHits >= bodyHits && weaponHits > 0 ? 0 : 1)
    pc.dirty = true
    made('AtkParam_Pc', id)
    return id
  }

  /**
   * The player's copy of an enemy bullet and the bullets it spawns, with
   * player attacks of their own, its effects the imported (or scaled) ones.
   */
  private playerBullet(
    bullet: number,
    a: Analysis,
    playerSize: boolean,
    fx: (id: number) => number,
    made: (p: string, id: number) => void,
  ): number {
    const s = this.s
    const db = this.db
    const res = s.clone.apply({
      roots: [{ param: 'Bullet', id: bullet }],
      cloneEffects: false,
      includeChildEffects: false,
      nameSuffix: ' (yours)',
    })
    const root = res.newRoots[0].id
    for (const b of this.bulletChain(root)) {
      made('Bullet', b)
      const atk = this.db.num('Bullet', b, 'atkId_Bullet')
      if (atk > 0 && !db.hasRow('AtkParam_Pc', atk) && db.hasRow('AtkParam_Npc', atk)) {
        s.params.playerAttack(atk)
        made('AtkParam_Pc', atk)
        if (playerSize) {
          const pc = db.get('AtkParam_Pc')
          const row = db.row('AtkParam_Pc', atk)!
          for (let k = 0; k < 16; k++) {
            const fd = pc.def.fieldsByName.get(`hit${k}_Radius`)
            if (fd) setField(row.data, fd, Number(getField(row.data, fd)) * a.scale)
          }
          pc.dirty = true
        }
      }
      const p = db.get('Bullet')
      const row = db.row('Bullet', b)!
      for (const r of db.sfxRefsFrom('Bullet', b)) {
        const to = fx(r.sfxId)
        if (to !== r.sfxId) setField(row.data, p.def.fieldsByName.get(r.field)!, to)
      }
      if (playerSize)
        for (const name of ['hitRadius', 'hitRadiusMax']) {
          const fd = p.def.fieldsByName.get(name)
          if (fd) setField(row.data, fd, Number(getField(row.data, fd)) * a.scale)
        }
      p.dirty = true
    }
    return root
  }

  /* ---------------------------------- spells ---------------------------------- */

  /**
   * A player spell casting a character's bullet: a copy of a player spell
   * (its Magic row and item: casting animation, FP, requirements), firing
   * the player's copy of the bullet instead of its own.
   */
  makeSpell(req: A.EnemySpellRequest): A.EnemySpellResult {
    if (!req.name.trim()) throw new Error('Give the spell a name')
    const s = this.s
    const db = this.db
    const { lib, effectIdStart } = s.internals()
    if (!db.hasRow('Magic', req.baseSpell)) throw new Error(`Spell ${req.baseSpell} doesn't exist`)
    if (!db.hasRow('Bullet', req.bullet)) throw new Error(`Bullet ${req.bullet} doesn't exist`)
    const rows: A.EnemySpellResult['rows'] = []
    const made = (param: string, id: number) => rows.push({ param, id, name: db.rowName(param, id) })

    // The bullet's effects, into the common bundles (and scaled copies if asked).
    const chain = this.bulletChain(req.bullet)
    const effects = new Set<number>()
    for (const b of chain) for (const id of this.sfxOf('Bullet', b)) effects.add(id)
    for (const id of effects) if (!lib.hasEffect(id) && s.effects.locateEffect(id)) s.effects.importEffect(id)
    const playerSize = req.effectSize === 'player'
    const scale = playerSize ? this.sizeOf(req.chr) : 1
    const effectMap = new Map<number, number>()
    if (playerSize) {
      let next = effectIdStart
      for (const id of effectsToCopy(lib, effects, true)) {
        const to = lib.freeEffectId(next)
        lib.cloneEffect(id, to)
        effectMap.set(id, to)
        next = to + 1
      }
      for (const to of effectMap.values()) {
        const fxr = lib.getEffect(to)
        remapEffectReferences(fxr, effectMap)
        fxr.root.scale(scale)
        lib.saveEffect(fxr)
      }
    }
    const a = { scale, dummyMap: new Map() } as unknown as Analysis
    const bullet = this.playerBullet(req.bullet, a, playerSize, (id) => effectMap.get(id) ?? id, made)

    // Its sounds (flight, impact), into the player's sound bank.
    const soundNames = this.bulletSounds(chain)
    const located = s.sounds.locate(req.chr, soundNames)
    const bring = soundNames.filter((n) => located.get(n)?.where === 'character')
    const sound = bring.length ? s.sounds.bring(req.chr, bring) : null
    const soundCount = soundNames.filter((n) => located.get(n)).length

    // The spell: a copy of the base (Magic + item), its own bullets left alone, firing ours.
    const plan = s.clone.plan({ roots: [{ param: 'Magic', id: req.baseSpell }] })
    const forceShare = plan.nodes
      .filter((n) => n.param === 'Bullet' || n.param.startsWith('AtkParam'))
      .map((n) => n.key)
    const dup = s.clone.apply({
      roots: [{ param: 'Magic', id: req.baseSpell }],
      forceShare,
      cloneEffects: false,
      includeChildEffects: false,
      nameSuffix: ` (${req.name.trim()})`,
    })
    const spell = dup.newRoots[0].id
    // refId1 fires; the base's other bullets (charged versions and the like) would fire the base's: off.
    for (let k = 1; k <= 10; k++) {
      const cat = this.db.num('Magic', spell, `refCategory${k}`)
      if (cat !== 1) continue
      s.params.setRowField('Magic', spell, `refId${k}`, k === 1 ? bullet : -1)
      if (k > 1) s.params.setRowField('Magic', spell, `refCategory${k}`, 0)
    }
    s.params.setGameName('EquipParamGoods', spell, req.name.trim())
    if (req.description.trim()) s.params.setCaption('EquipParamGoods', spell, req.description.trim())
    for (const param of ['Magic', 'EquipParamGoods'])
      if (db.hasRow(param, spell)) {
        s.params.renameRow(param, spell, req.name.trim())
        made(param, spell)
      }
    const summary =
      `${req.name.trim()} (spell ${spell}): casts like ${this.s.params.rowView('Magic', req.baseSpell).gameName || `spell ${req.baseSpell}`}, fires ${db.rowName('Bullet', bullet)} (${bullet})` +
      `${soundCount ? `, with its ${soundCount} sound${soundCount === 1 ? '' : 's'}` : ''}.`
    return {
      spell,
      bullet,
      rows,
      effects: [...effects].map((id) => effectMap.get(id) ?? id),
      sounds: { events: soundCount, copied: sound?.copied ?? 0, bytes: sound?.mediaBytes ?? 0, bank: PLAYER_BANK },
      summary,
    }
  }

  /** The sound events a bullet chain's sound ids name (seId_Bullet1/2, seId_Hit, seId_Flick). */
  private bulletSounds(chain: number[]): string[] {
    const out = new Set<string>()
    for (const b of chain)
      for (const f of BULLET_SOUNDS) for (const n of bulletSoundNames(this.db.num('Bullet', b, f))) out.add(n)
    return [...out]
  }

  /** Player size / character size (leg lengths). */
  private sizeOf(chr: string): number {
    const character = this.s.character
    const leg = (bones: Bone[]) => {
      const P = restPositions(bones)
      const at = (n: string) => bones.findIndex((b) => b.name === n)
      const t = at('L_Thigh')
      const c = at('L_Calf')
      const f = at('L_Foot')
      if (t < 0 || c < 0 || f < 0) return null
      const d = (i: number, j: number) => Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1], P[i][2] - P[j][2])
      return d(t, c) + d(c, f)
    }
    try {
      const e = leg(character.filesOf(chr).skeleton())
      const p = leg(character.filesOf().skeleton())
      return e && p ? p / e : 1
    } catch {
      return 1
    }
  }
}

/** A point in a dummy poly's frame (z its forward, x up × forward, y forward × x; as the viewer and the game place effects). */
/**
 * Frames `from`-`to` (seconds) of a motion, its root motion starting there:
 * where the character stood and faced then is its new start, as the game
 * carries on from where the step before ended (CharacterView's combo plays
 * them so too).
 */
function sliceMotion<
  M extends { frames: number; frameDuration: number; tracks: number[]; data: Float32Array; root: Float32Array | null },
>(m: M, from: number, to: number): M {
  const f0 = Math.max(0, Math.min(m.frames - 2, Math.round(from / m.frameDuration)))
  const f1 = Math.max(f0 + 1, Math.min(m.frames - 1, Math.round(to / m.frameDuration)))
  const per = m.tracks.length * 10
  const data = m.data.slice(f0 * per, (f1 + 1) * per)
  let root: Float32Array | null = null
  if (m.root) {
    root = new Float32Array((f1 - f0 + 1) * 4)
    const r = m.root
    const [x0, y0, z0, yaw0] = [r[f0 * 4], r[f0 * 4 + 1], r[f0 * 4 + 2], r[f0 * 4 + 3]]
    const cs = Math.cos(-yaw0)
    const sn = Math.sin(-yaw0)
    for (let f = f0; f <= f1; f++) {
      const dx = r[f * 4] - x0
      const dz = r[f * 4 + 2] - z0
      const o = (f - f0) * 4
      root[o] = dx * cs + dz * sn
      root[o + 1] = r[f * 4 + 1] - y0
      root[o + 2] = -dx * sn + dz * cs
      root[o + 3] = r[f * 4 + 3] - yaw0
    }
  }
  return { ...m, frames: f1 - f0 + 1, data, root }
}

/** Bone positions in the reference pose, model space. */
function restPositions(bones: Bone[]): number[][] {
  const P: number[][] = new Array(bones.length)
  const R: number[][] = new Array(bones.length)
  const visit = (i: number, depth = 0): void => {
    if (P[i] || depth > 256) return
    const b = bones[i]
    if (b.parent < 0) {
      P[i] = [...b.t]
      R[i] = [...b.r]
      return
    }
    visit(b.parent, depth + 1)
    const o = qrot(R[b.parent], b.t)
    P[i] = [P[b.parent][0] + o[0], P[b.parent][1] + o[1], P[b.parent][2] + o[2]]
    R[i] = qmul(R[b.parent], b.r)
  }
  bones.forEach((_, i) => visit(i))
  return P
}
