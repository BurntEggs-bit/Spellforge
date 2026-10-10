/**
 * A weapon's attack at each upgrade level, as the game works it out:
 *
 *   - each damage type's base: the weapon's attackBase × the level's rate
 *     (ReinforceParamWeapon at reinforceTypeId + level);
 *   - each stat's scaling: the weapon's correct value × the level's
 *     correction rate (or AttackElementCorrectParam's overwrite for that
 *     damage type), shown as the menu's letter;
 *   - which stats a damage type scales with: AttackElementCorrectParam's
 *     flags (attackElementCorrectId), each by its influence (100 = all);
 *   - how much a stat gives: the damage type's CalcCorrectGraph curve
 *     (correctType_…), between breakpoints shaped by their exponent;
 *   - a stat below its requirement: that damage type loses 40% of its base
 *     instead of scaling.
 *
 * The formula is the one the community's attack calculators use; the params
 * suite checks the parts that can be checked from the data (the levels a
 * weapon has, its base at +0, the curve at its breakpoints, the requirement
 * penalty). The numbers in the menu are the game's to confirm.
 */
import type { ParamDatabase } from './paramDb.ts'

export const STATS = ['Strength', 'Agility', 'Magic', 'Faith', 'Luck'] as const
export type Stat = (typeof STATS)[number]
export const DAMAGE = ['Physics', 'Magic', 'Fire', 'Thunder', 'Dark'] as const
export type Damage = (typeof DAMAGE)[number]

/** The weapon's base fields per damage type and the level's rate fields. */
const BASE_FIELD: Record<Damage, string> = {
  Physics: 'attackBasePhysics',
  Magic: 'attackBaseMagic',
  Fire: 'attackBaseFire',
  Thunder: 'attackBaseThunder',
  Dark: 'attackBaseDark',
}
const RATE_FIELD: Record<Damage, string> = {
  Physics: 'physicsAtkRate',
  Magic: 'magicAtkRate',
  Fire: 'fireAtkRate',
  Thunder: 'thunderAtkRate',
  Dark: 'darkAtkRate',
}
const CORRECT_FIELD: Record<Stat, string> = {
  Strength: 'correctStrength',
  Agility: 'correctAgility',
  Magic: 'correctMagic',
  Faith: 'correctFaith',
  Luck: 'correctLuck',
}
const CORRECT_RATE_FIELD: Record<Stat, string> = {
  Strength: 'correctStrengthRate',
  Agility: 'correctAgilityRate',
  Magic: 'correctMagicRate',
  Faith: 'correctFaithRate',
  Luck: 'correctLuckRate',
}
const PROPER_FIELD: Record<Stat, string> = {
  Strength: 'properStrength',
  Agility: 'properAgility',
  Magic: 'properMagic',
  Faith: 'properFaith',
  Luck: 'properLuck',
}
/** AttackElementCorrectParam spells the stats its own way. */
const AEC_STAT: Record<Stat, string> = {
  Strength: 'Strength',
  Agility: 'Dexterity',
  Magic: 'Magic',
  Faith: 'Faith',
  Luck: 'Luck',
}

/** A stat's scaling as the menu shows it. */
export function scalingLetter(percent: number): string {
  if (percent >= 175) return 'S'
  if (percent >= 140) return 'A'
  if (percent >= 90) return 'B'
  if (percent >= 60) return 'C'
  if (percent >= 25) return 'D'
  if (percent > 0) return 'E'
  return '-'
}

/**
 * How much of a stat's scaling a value gives (0 to about 1): CalcCorrectGraph's
 * curve, five breakpoints (stageMaxVal) with the growth at each
 * (stageMaxGrowVal, percent), shaped between them by adjPt_maxGrowVal (above
 * 0: x^adj; below: 1 - (1 - x)^-adj).
 */
export function correctCurve(db: ParamDatabase, graph: number, value: number): number {
  if (!db.hasRow('CalcCorrectGraph', graph)) return 0
  const f = (name: string) => Number(db.value('CalcCorrectGraph', graph, name) ?? 0)
  const stage = [0, 1, 2, 3, 4].map((k) => ({
    at: f(`stageMaxVal${k}`),
    grow: f(`stageMaxGrowVal${k}`),
    adj: f(`adjPt_maxGrowVal${k}`),
  }))
  if (value <= stage[0].at) return stage[0].grow / 100
  for (let k = 0; k < 4; k++) {
    const a = stage[k]
    const b = stage[k + 1]
    if (value > b.at) continue
    let x = b.at > a.at ? (value - a.at) / (b.at - a.at) : 1
    if (a.adj > 0) x = Math.pow(x, a.adj)
    else if (a.adj < 0) x = 1 - Math.pow(1 - x, -a.adj)
    return (a.grow + (b.grow - a.grow) * x) / 100
  }
  return stage[4].grow / 100
}

export interface WeaponLevel {
  level: number
  /** Each damage type's attack at the given stats (base + scaling), rounded down as the menu shows it. */
  attack: Record<Damage, number>
  /** Each damage type's base at this level, before scaling. */
  base: Record<Damage, number>
  total: number
  /** Each stat's scaling percent at this level (the menu's letter from it). */
  scaling: Record<Stat, number>
}

export interface WeaponLevels {
  levels: WeaponLevel[]
  requirements: Record<Stat, number>
  /** Damage types each stat feeds (AttackElementCorrectParam). */
  feeds: Record<Stat, Damage[]>
}

/** A weapon's attack at every upgrade level it has, for the given stats. */
export function weaponLevels(db: ParamDatabase, weapon: number, stats: Record<Stat, number>): WeaponLevels {
  const W = 'EquipParamWeapon'
  if (!db.hasRow(W, weapon)) throw new Error(`There's no weapon ${weapon}`)
  const w = (name: string) => Number(db.value(W, weapon, name) ?? 0)
  const reinforce = w('reinforceTypeId')
  const aec = w('attackElementCorrectId')
  const hasAec = db.hasRow('AttackElementCorrectParam', aec)
  const a = (name: string) => (hasAec ? Number(db.value('AttackElementCorrectParam', aec, name) ?? 0) : 0)
  const requirements = Object.fromEntries(STATS.map((s) => [s, w(PROPER_FIELD[s])])) as Record<Stat, number>
  const feeds = Object.fromEntries(
    STATS.map((s) => [s, DAMAGE.filter((d) => a(`is${AEC_STAT[s]}Correct_by${d}`) === 1)]),
  ) as Record<Stat, Damage[]>
  const levels: WeaponLevel[] = []
  for (let level = 0; level <= 25 && db.hasRow('ReinforceParamWeapon', reinforce + level); level++) {
    const r = (name: string) => Number(db.value('ReinforceParamWeapon', reinforce + level, name) ?? 1)
    const scaling = Object.fromEntries(STATS.map((s) => [s, w(CORRECT_FIELD[s]) * r(CORRECT_RATE_FIELD[s])])) as Record<
      Stat,
      number
    >
    const base = {} as Record<Damage, number>
    const attack = {} as Record<Damage, number>
    for (const d of DAMAGE) {
      const b = w(BASE_FIELD[d]) * r(RATE_FIELD[d])
      base[d] = b
      let bonus = 0
      let short = false
      for (const s of STATS) {
        if (!feeds[s].includes(d)) continue
        if (stats[s] < requirements[s]) short = true
        const over = a(`overwrite${AEC_STAT[s]}CorrectRate_by${d}`)
        const percent = over >= 0 && hasAec ? over * r(CORRECT_RATE_FIELD[s]) : scaling[s]
        const influence = hasAec ? a(`Influence${AEC_STAT[s]}CorrectRate_by${d}`) : 100
        bonus += ((b * percent) / 100) * correctCurve(db, w(`correctType_${d}`), stats[s]) * (influence / 100)
      }
      attack[d] = Math.floor(b + (short ? -0.4 * b : bonus))
    }
    levels.push({
      level,
      attack,
      base,
      total: DAMAGE.reduce((n, d) => n + attack[d], 0),
      scaling,
    })
  }
  return { levels, requirements, feeds }
}
