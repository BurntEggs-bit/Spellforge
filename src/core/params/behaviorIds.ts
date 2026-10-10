/**
 * BehaviorParam ids: `category × 100,000,000 + variation × 1000 + judge`.
 * An animation's behaviour events name a judge; a judge of 1000 and up
 * carries its category in its thousands (3570: category 3, judge 570), a
 * smaller one is in its table's default category (1 for the player's weapon
 * moveset, 2 for other characters). Measured on the retail params: category
 * 1 is the player's weapon moveset (10,581 of 10,887 rows sit on a weapon's
 * variation) and category 3 its skills (1,652 of 2,108); every judge in the
 * 3000-7000s matches a row of its category, and 514 of the 528 judges below
 * 1000 match a category-1 row.
 */
import type { ParamDatabase } from './paramDb.ts'

const BEHAVIOR_CATEGORY_SIZE = 100_000_000

/** The categories a weapon's behaviour variation owns: its moveset (1) and its skill (3). */
export const WEAPON_BEHAVIOR_CATEGORIES = [1, 3]

export type BehaviorParamName = 'BehaviorParam_PC' | 'BehaviorParam'

export function behaviorRowId(category: number, variation: number, judge: number): number {
  return category * BEHAVIOR_CATEGORY_SIZE + variation * 1000 + judge
}

export function behaviorCategoryOf(rowId: number): number {
  return Math.floor(rowId / BEHAVIOR_CATEGORY_SIZE)
}

export function behaviorVariationOf(rowId: number): number {
  return Math.floor((rowId % BEHAVIOR_CATEGORY_SIZE) / 1000)
}

/** The TAE judge that fires a BehaviorParam_PC row (the category in its thousands, but for the moveset's). */
export function judgeOfBehaviorRow(rowId: number): number {
  const category = behaviorCategoryOf(rowId)
  const judge = rowId % 1000
  return category >= 2 ? category * 1000 + judge : judge
}

const DEFAULT_CATEGORY: Record<BehaviorParamName, number> = { BehaviorParam_PC: 1, BehaviorParam: 2 }

/** The category a TAE judge's rows are in (its thousands, or the table's default for judges under 1000). */
export function judgeCategory(judge: number, param: BehaviorParamName): number {
  return judge >= 1000 ? Math.floor(judge / 1000) : DEFAULT_CATEGORY[param]
}

/**
 * The row a judge plays for a behaviour variation: the variation's own, else
 * its base variation's (its hundreds), else, for the player, the shared one
 * (variation 0). Null when there is none.
 */
export function behaviorRowFor(
  db: ParamDatabase,
  param: BehaviorParamName,
  judge: number,
  variation: number,
): number | null {
  const category = judgeCategory(judge, param)
  const fallbacks = [variation, Math.floor(variation / 100) * 100, ...(param === 'BehaviorParam_PC' ? [0] : [])]
  for (const v of new Set(fallbacks)) {
    if (v < 0) continue
    const id = behaviorRowId(category, v, judge % 1000)
    if (db.hasRow(param, id)) return id
  }
  return null
}
