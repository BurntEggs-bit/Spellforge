/**
 * Behaviour recipes as data: what each kind changes in the behaviour script,
 * the labels the editor shows, and the checks a recipe must pass before it is
 * written (shared by the editor and the generator in core/behavior/recipes.ts).
 */

/** An attack input as ExecAttack receives it: R1/R2 one-handed, L1/L2, and both hands (b1, b2). */
export type HksInput = 'r1' | 'r2' | 'l1' | 'l2' | 'b1' | 'b2'

export const INPUT_LABELS: Record<HksInput, string> = {
  r1: 'R1 (one-handed)',
  r2: 'R2 (one-handed)',
  l1: 'L1',
  l2: 'L2',
  b1: 'R1 (two-handed)',
  b2: 'R2 (two-handed)',
}

/** The animation window that turns a recipe on: a SpEffect event Spellforge adds to it. */
export interface RecipeWindow {
  animation: string
  /** Seconds. */
  start: number
  end: number
}

interface Base {
  /** Stable id (for editing and the record). */
  id: string
  /** Off: kept, not written. */
  off?: boolean
  /** The user's own note. */
  note?: string
}

export type Recipe =
  | (Base & {
      /** While a SpEffect is on (applied by an event in an animation), an input plays another event. */
      kind: 'jump'
      speffect: number
      input: HksInput
      /** The behaviour event to play, e.g. W_AttackRightLight3 (030020). */
      event: string
      window?: RecipeWindow
    })
  | (Base & {
      /** While a SpEffect is on, go straight into another event (no input): animations chained. */
      kind: 'chain'
      speffect: number
      event: string
      window?: RecipeWindow
    })
  | (Base & {
      /** A weapon's two-hand button plays an event instead of changing grip (a "trick weapon" transform). */
      kind: 'handChange'
      /** The weapon's special category (spAtkcategory). */
      weapon: number
      /** Event when held one-handed / two-handed (null: the normal grip change). */
      oneHanded: string | null
      twoHanded: string | null
      /**
       * Other events while a SpEffect is on: a second form (a SpEffect that
       * lasts, applied by the transform), or a follow-up (a window Spellforge
       * adds to an animation: the button plays a finisher right after it).
       */
      forms?: { speffect: number; oneHanded: string | null; twoHanded: string | null; window?: RecipeWindow }[]
    })
  | (Base & {
      /**
       * A weapon gets the special attacks curved swords and thrusting swords
       * have: charging R2, holding the dodge button inside the window its
       * heavy attack marks with SpEffect 100290 plays 030950 (030955 from the
       * second charged R2; 032950 / 032955 two-handed).
       */
      kind: 'specialAttack'
      weapon: number
      /** The 100290 windows Spellforge added to the weapon's charged R2 animations (030500, 030510…). */
      windows?: RecipeWindow[]
    })
  | (Base & {
      /**
       * While a SpEffect is on, the heavy attacks (R2) are the second set
       * Barbaric Roar and War Cry give: 030600, 030601 and 030610 (032600…
       * two-handed) in the weapon's category. The game turns them on for
       * those skills' own SpEffects (1681 and 1811…); this does it for yours,
       * with the set the behaviour graph plays (AttackRightHeavySpecialType).
       */
      kind: 'heavySet'
      speffect: number
      set: HeavySet
    })
  | (Base & {
      /**
       * How many attacks a weapon's R1 combo has (one weapon, or powerstanced).
       * The game asks per weapon whatever the grip (IsEnableNextAttack): `grip`
       * makes it the one-handed or the two-handed combo's only (Sacred Arsenal:
       * two dagger slashes one-handed, Margit's sword combo in three steps two-handed).
       */
      kind: 'comboLength'
      weapon: number
      dual: boolean
      count: number
      grip?: 'one' | 'two'
    })
  | (Base & {
      /** A skill (swordArtsTypeNew, its a6xx category - 600) behaves like a stance, a quickstep… */
      kind: 'skillType'
      skill: number
      as: SkillType
    })
  | (Base & {
      /**
       * A weapon's dodge: the roll of another equip load (the script's
       * EVASION_WEIGHT_INDEX_… constants), or a number for rolls of your own
       * in the behaviour graph (EvasionWeightIndex).
       */
      kind: 'dodge'
      weapon: number
      roll: DodgeRoll | number
    })
  | (Base & {
      /** A weapon can't guard (two-handed, or always): L1 is left to its attacks. */
      kind: 'noGuard'
      weapon: number
      twoHandedOnly: boolean
    })
  | (Base & {
      /** Your own code, appended as it is (syntax-checked). */
      kind: 'code'
      title: string
      code: string
    })

export type SkillType = 'stance' | 'rolling' | 'arrowStance' | 'attackStance' | 'halfBlend'

/** The game's second heavy attack sets, as its behaviour graph numbers them (AttackRightHeavySpecialType). */
export type HeavySet = 0 | 1

export const HEAVY_SET_LABELS: Record<HeavySet, string> = {
  0: 'Barbaric Roar’s',
  1: 'War Cry’s',
}

/**
 * The heavy attack events and the second set's in their place, as the
 * game's ExecAttack swaps them (one-handed, then two-handed).
 */
export const HEAVY_SET_EVENTS: [string, string][] = [
  ['W_AttackRightHeavy1Start', 'W_AttackRightHeavySpecial1Start'],
  ['W_AttackRightHeavy1SubStart', 'W_AttackRightHeavySpecial1SubStart'],
  ['W_AttackRightHeavy2Start', 'W_AttackRightHeavySpecial2Start'],
  ['W_AttackBothHeavy1Start', 'W_AttackBothHeavySpecial1Start'],
  ['W_AttackBothHeavy1SubStart', 'W_AttackBothHeavySpecial1SubStart'],
  ['W_AttackBothHeavy2Start', 'W_AttackBothHeavySpecial2Start'],
]

/** The game's dodges by equip load (the script's EVASION_WEIGHT_INDEX_ constants, defined by the game). */
export type DodgeRoll = 'SUPERLIGHT' | 'LIGHT' | 'MEDIUM' | 'HEAVY' | 'OVERWEIGHT'

export const DODGE_LABELS: Record<DodgeRoll, string> = {
  SUPERLIGHT: 'superlight (the quickest roll)',
  LIGHT: 'light',
  MEDIUM: 'medium',
  HEAVY: 'heavy (fat roll)',
  OVERWEIGHT: 'overweight (no roll)',
}

/** The script's function each skill type is decided by. */
export const SKILL_TYPE_FUNCTIONS: Record<SkillType, { fn: string; label: string }> = {
  stance: { fn: 'IsStanceArts', label: 'a stance (hold the skill, then R1 / R2)' },
  rolling: { fn: 'IsRollingArts', label: 'a quickstep (rolls, like Bloodhound’s Step)' },
  arrowStance: { fn: 'IsArrowStanceArts', label: 'a bow stance (Mighty Shot, Barrage)' },
  attackStance: { fn: 'IsAttackStanceArts', label: 'a spinning stance (Spinning Strikes)' },
  halfBlend: { fn: 'IsHalfBlendArts', label: 'usable while walking (upper body only)' },
}

/**
 * The game's own marker for special attacks: its charged-R2 animations
 * (030500, 030510, 032500, 032510) apply it (event 67, AddSpEffect) while
 * the dodge button may turn the charge into the special attack.
 */
export const SPECIAL_ATTACK_SPEFFECT = 100290

/** Ids a recipe tests must be exact in the script's 32-bit floats. */
const MAX_EXACT_ID = 16777216

function exactInScript(n: number): boolean {
  return Number.isInteger(n) && Math.abs(n) <= MAX_EXACT_ID
}

/** Where a recipe's code goes: the function it wraps. */
export function hookOf(r: Recipe): string | null {
  switch (r.kind) {
    case 'jump':
    case 'chain':
    case 'heavySet':
      return 'ExecAttack'
    case 'handChange':
      return 'ExecHandChange'
    case 'specialAttack':
      return 'IsEnableSpecialAttack'
    case 'comboLength':
      return r.dual ? 'GetDualAttackMaxNumber' : 'GetAttackMaxNumber'
    case 'skillType':
      return SKILL_TYPE_FUNCTIONS[r.as].fn
    case 'dodge':
      return 'SetWeightIndex'
    case 'noGuard':
      return 'IsEnableGuard'
    case 'code':
      return null
  }
}

/**
 * What's wrong with a recipe before it's written (empty: nothing). `events`:
 * the behaviour events the graph has; `halfBlend`: events the game plays on
 * the upper and lower body separately (its Event_… tables).
 */
export function recipeProblems(r: Recipe, events?: Set<string>, halfBlend?: Map<string, string>): string[] {
  const out: string[] = []
  const id = (n: number, what: string) => {
    if (!Number.isInteger(n) || n < 0) out.push(`${what} must be a whole number`)
    else if (!exactInScript(n))
      out.push(
        `${what} ${n} is too big for the script’s numbers (above ${MAX_EXACT_ID.toLocaleString()} they aren’t exact): use a smaller id`,
      )
  }
  const ev = (e: string | null, what: string) => {
    if (e === null) return
    if (!/^W_[A-Za-z0-9_]+$/.test(e)) out.push(`${what}: “${e}” isn’t a behaviour event name (W_…)`)
    else if (events && !events.has(e))
      out.push(`${what}: the behaviour graph has no event ${e} (playing an unknown event can crash the game)`)
  }
  switch (r.kind) {
    case 'jump':
      id(r.speffect, 'SpEffect')
      ev(r.event, 'Plays')
      // An attack input plays its event on the whole body (ExecAttack's ExecEventAllBody).
      if (halfBlend?.has(r.event))
        out.push(
          `Plays: ${r.event} is a half-body event (upper and lower body apart, like a crossbow reload): an attack input can’t play it. Use a chain or the two-hand button for it.`,
        )
      break
    case 'chain':
      id(r.speffect, 'SpEffect')
      ev(r.event, 'Plays')
      break
    case 'heavySet':
      id(r.speffect, 'SpEffect')
      if (r.speffect === 0) out.push('Pick the SpEffect that turns them on (one your skill applies)')
      if (r.set !== 0 && r.set !== 1) out.push('Pick Barbaric Roar’s or War Cry’s set')
      for (const [, special] of HEAVY_SET_EVENTS) ev(special, 'Plays')
      break
    case 'handChange':
      id(r.weapon, 'Weapon category')
      ev(r.oneHanded, 'One-handed')
      ev(r.twoHanded, 'Two-handed')
      if (r.oneHanded === null && r.twoHanded === null && !r.forms?.length)
        out.push('Pick what the button plays one- or two-handed')
      for (const f of r.forms ?? []) {
        id(f.speffect, 'Form SpEffect')
        ev(f.oneHanded, 'Form, one-handed')
        ev(f.twoHanded, 'Form, two-handed')
      }
      break
    case 'specialAttack':
    case 'noGuard':
      id(r.weapon, 'Weapon category')
      break
    case 'comboLength':
      id(r.weapon, 'Weapon category')
      if (!(Number.isInteger(r.count) && r.count >= 1 && r.count <= 9)) out.push('A combo has 1 to 9 attacks')
      break
    case 'skillType':
      id(r.skill, 'Skill type')
      break
    case 'dodge':
      id(r.weapon, 'Weapon category')
      if (typeof r.roll === 'number' && !(Number.isInteger(r.roll) && r.roll >= 0 && r.roll <= 9))
        out.push('A dodge of your own is an EvasionWeightIndex from 0 to 9')
      break
    case 'code':
      if (!r.code.trim()) out.push('No code')
      break
  }
  return out
}
