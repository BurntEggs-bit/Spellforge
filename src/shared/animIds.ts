/**
 * What a player animation id is, in words: "R1, 1st (one-handed)",
 * "R2 (two-handed)", "skill", "grip change: taking it in both hands". The ids are the same in every category (a
 * weapon class's, a weapon's own, a skill's): 030000 is the first R1 of any
 * weapon, 032000 its two-handed one, 040000 a skill's first animation.
 * Ranges the game uses (see docs/reference/format-notes.md, "Weapons' own movesets"); null for
 * ids this doesn't know.
 */
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th']
/** Where a weapon put away goes, in the order of the game's grip-change selectors (HandChangeBothToBack, …ToWaist…). */
const SPOT = ['back', 'waist', 'shoulder', 'spear carry']

/** The grip changes, named after the game's own selectors (HandChangeBoth, HandChangeBothToWaist…). */
function describeGripChange(id: number): string | null {
  if (id === 29070) return 'grip change: taking it in both hands'
  if (id === 29090) return 'grip change: taking the left-hand weapon in both hands'
  if (id >= 29040 && id <= 29042) return `grip change: back to one hand (left weapon at the ${SPOT[id - 29040]})`
  if (id >= 29010 && id <= 29012)
    return `grip change: back to one hand from the left (right weapon at the ${SPOT[id - 29010]})`
  if (id >= 29050 && id <= 29053) return `grip change: left weapon taken from the ${SPOT[id - 29050]}`
  if (id >= 29060 && id <= 29063) return `grip change: left weapon put away (${SPOT[id - 29060]})`
  if (id >= 29020 && id <= 29023) return `grip change: right weapon taken from the ${SPOT[id - 29020]}`
  if (id >= 29080 && id <= 29083) return `grip change: right weapon put away (${SPOT[id - 29080]})`
  return null
}

export function describeAnimationId(id: number): string | null {
  const gripChange = describeGripChange(id)
  if (gripChange) return gripChange
  // Two-handed moves are the one-handed ids + 2000 (032000, 033000).
  const twoHanded = id >= 32000 && id < 34000
  const rel = twoHanded ? id - 2000 : id
  const grip = twoHanded ? 'two-handed' : 'one-handed'
  if (rel >= 30000 && rel <= 30089) {
    const n = Math.floor((rel - 30000) / 10)
    return `R1, ${ORDINAL[n] ?? `${n + 1}th`} (${grip})`
  }
  if (rel >= 30200 && rel <= 30299) return `running attack (${grip})`
  if (rel >= 30300 && rel <= 30399) return `roll attack (${grip})`
  if (rel >= 30400 && rel <= 30499) return `backstep attack (${grip})`
  if (rel === 30500 || rel === 30510) return `R2 held, charged${rel === 30510 ? ', 2nd' : ''} (${grip})`
  if (rel === 30501 || rel === 30511) return `R2 charging (${grip})`
  if (rel === 30505) return `R2 (${grip})`
  if (rel === 30515) return `R2, 2nd (${grip})`
  if (rel >= 30500 && rel <= 30599) return `heavy attack (${grip})`
  if (rel >= 30600 && rel <= 30699) return `a class’s version of a skill (${grip})`
  if (rel >= 30700 && rel <= 30799) return `guard counter (${grip})`
  if (rel >= 30900 && rel <= 30999) return `special attack (${grip})`
  if (rel >= 31000 && rel <= 31999) return `jumping attack (${grip})`
  if (id >= 34000 && id < 35000) return 'dual-wield attack (power stance)'
  if (id >= 35000 && id < 36000) return 'left-hand attack'
  if (id >= 37000 && id < 38000) return 'weapon action (reload, swap…)'
  if (id >= 38000 && id < 40000) return 'mounted attack (on Torrent)'
  if (id >= 40050 && id <= 40053) return 'skill: stance (start, hold, end)'
  if (id >= 40060 && id <= 40079) return 'skill: stance follow-up (R1 or R2)'
  if (id >= 40000 && id < 41000) return 'skill'
  if (id >= 45000 && id < 45100) return 'spell cast (right hand)'
  if (id >= 45100 && id < 46000) return 'spell cast (left hand)'
  if (id >= 145000 && id < 146000) return 'spell cast (on Torrent)'
  return null
}

/** A category's name: 30 -> "a030". */
export function categoryLabel(category: number): string {
  return `a${String(category).padStart(3, '0')}`
}

/** An animation id as the game writes it, six digits: 30000 -> "030000". */
export function animationIdText(id: number): string {
  return String(id).padStart(6, '0')
}

/** An animation's name: (30, 30000) -> "a030_030000". */
export function animationName(category: number, id: number): string {
  return `${categoryLabel(category)}_${animationIdText(id)}`
}

/** "a030_030000" -> { category: 30, id: 30000 }, or null for anything else. */
export function parseAnimationName(name: string): { category: number; id: number } | null {
  const m = /^a(\d{3})_(\d{6})$/.exec(name.trim())
  return m ? { category: Number(m[1]), id: Number(m[2]) } : null
}

/** The single number a character's TAE keeps an animation as: "a002_003027" <-> 2003027. */
export function fullAnimationId(category: number, id: number): number {
  return category * 1_000_000 + id
}

export function animationNameOfFullId(fullId: number): string {
  return animationName(Math.floor(fullId / 1_000_000), fullId % 1_000_000)
}
