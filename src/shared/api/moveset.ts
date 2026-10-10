/** IPC contract: a weapon's own moveset: which animations and attacks each of its moves uses. */

/** A weapon to take a slot's moves from (Animations page, Moveset panel). */
export interface MovesetSource {
  /** EquipParamWeapon id. */
  id: number
  /** "Estoc's own", or "Hammer (standard)": a class's standard moves (taken from a weapon of it). */
  name: string
  /** Its class (WEPMOTION_CATEGORY): Hammer, Thrusting Sword… */
  className: string
  /** Moves of its own for this slot (its special category); else its class's standard ones. */
  own: boolean
  /** The animation that shows the slot best (its first one-handed one): for the ▶ preview. */
  animation: string
  /** Its first two-handed one, for a slot with both (null: none). */
  animationTwo: string | null
}

/** One kind of move a weapon has: light attacks, heavy attacks… */
export interface MovesetSlotView {
  key: string
  label: string
  hint: string
  /** The weapon its moves were taken from (null: its own, its class's). */
  from: number | null
  fromName: string
  /** What the weapon plays for it now (its first one-handed one), for the ▶ preview. */
  now: string | null
  /** What its own moves play for it (its class's, or its own in the game): what "back to its own" gives. */
  original: string | null
  /** Weapons to take the moves from, by class: each class's standard moves and weapons with moves of their own. */
  sources: MovesetSource[]
  /** The spell its attacks cast now (`like`: the spell whose cast they look like, if another). */
  cast: { spell: number; like: number | null; name: string } | null
  /** Whether its attacks can be a spell's cast (attacks on the ground; not jumps or mounted ones). */
  canCast: boolean
  /** Whether it has one- and two-handed moves (light, heavy, running…), each of which can change on its own. */
  grips: boolean
  /** Its attacks an enemy's move made (Enemies → Make it… → an attack), e.g. "Margit’s a000_003035 (two-handed R1, 1st)". */
  enemy: string[]
}

/**
 * A spell a weapon's attacks can cast (Moveset panel): its cast animations
 * become the attacks, its bullet flies from the weapon.
 */
export interface MovesetSpell {
  /** Magic id. */
  id: number
  name: string
  /** "This project" (its own spells), "Sorceries" or "Incantations". */
  group: string
  /** Its first cast (right hand), for the ▶ preview: a401_045010. */
  animation: string
  /** Its casts' category (400 + Magic refType): spells with the same one are cast alike. */
  castCategory: number
}

/** A slot's attacks as a spell's casts: `spell` fired, cast the way `like` is (default: its own way). */
export interface MovesetCast {
  spell: number
  like?: number
}

export interface MovesetView {
  weapon: {
    id: number
    name: string
    className: string
    /** wepmotionCategory: its class's animations. */
    category: number
    /** spAtkcategory: its own (special) animations, played first; 0: none. */
    special: number
    /** behaviorVariationId: whose behavior rows its moves hit with. */
    variation: number
    skill: number
    skillName: string
    /** Its affinity rows (Heavy, Keen…), changed together. */
    affinities: number
  }
  /** The category and variation Spellforge made it (reused when it changes again). */
  own: { category: number; variation: number } | null
  slots: MovesetSlotView[]
  /** Skills it can have; stances first (hold the skill, then R1 or R2). */
  skills: { id: number; name: string; stance: boolean; animation: string | null }[]
  /**
   * Effects it can show on its attacks: those its skill's animations spawn
   * (the golden hammer a skill made from Margit's leap conjures), longest first.
   */
  effects: MovesetEffect[]
  /** The effect it shows on its attacks now, and on which moves. */
  shown: { effect: number; name: string; slots: string[] } | null
  /** Its own model is hidden (a copy of Unseen Blade's effect, always on); it still hits. */
  hidden: boolean
  /**
   * How it's held one- and two-handed (EquipParamWeapon wepmotionOneHandId /
   * wepmotionBothHandId): stances, each an animation category of its own
   * (a000 + id) with the walking, guarding, jumping, riding and the grip
   * changes; now, and as the game has it.
   */
  stance: { one: number; both: number; originalOne: number; originalBoth: number }
  stances: { one: MovesetStance[]; both: MovesetStance[] }
  /** Spells its attacks can cast: the project's own first, then sorceries and incantations. */
  spells: MovesetSpell[]
}

/** An effect event to put on a weapon's attacks (copied with its placement: dummy poly, following it). */
/** A stance the game's weapons are held in. */
export interface MovesetStance {
  /** Its animation category (a000 + id; 0: the common animations). */
  id: number
  /** The classes of the weapons held that way, most first. */
  label: string
  weapons: number
  /** One to watch: two-handed, taking the weapon in both hands (029070); one-handed, walking. */
  animation: string | null
}

export interface MovesetEffect {
  /** The animation and event it's taken from. */
  animation: string
  event: number
  effect: number
  name: string
  /** Where it's spawned (10xxx: on the right-hand weapon). */
  dummy: number
  /** How long it lasts there, in seconds. */
  length: number
}

export interface MovesetRequest {
  weapon: number
  /**
   * Slot key -> a weapon to take those moves from, a spell for them to cast,
   * or 'class': its own again. Slots left out stay as they are.
   */
  slots: Record<string, number | 'class' | MovesetCast>
  /** Slot key -> only its one- or two-handed moves change (the others stay as they are); left out: both. */
  grips?: Record<string, MovesetGrip>
  /** How the moves taken hit: like on the weapon they come from (default), or like this weapon's own attacks. */
  hits?: 'source' | 'own'
  skill?: number
  /** An effect shown during the attacks of these moves (from start to end of each animation); null: none any more. */
  effect?: { animation: string; event: number; slots: string[] } | null
  /** Held one- or two-handed in another stance (MovesetView.stances); left out: as it is. */
  stance?: { one?: number; both?: number }
  /** Hide its own model (it still hits): true / false; left out: as it is. */
  hide?: boolean
}

/** Which of a slot's moves: those held in one hand, or in both. */
export type MovesetGrip = 'one' | 'two'

export interface MovesetResult {
  /** The weapon's own category (-1: only its skill changed). */
  category: number
  variation: number
  /** Animations copied into its category. */
  animations: string[]
  /** Clips added to the behaviour graph for them. */
  registered: number
  rows: { param: string; id: number; name: string }[]
  /** Its affinity rows that changed. */
  weapons: number[]
  summary: string
}

/** The moveset channels: request and response of each. */
export interface MovesetChannels {
  'moveset:get': [{ weapon: number }, MovesetView]
  'moveset:apply': [MovesetRequest, MovesetResult]
}
