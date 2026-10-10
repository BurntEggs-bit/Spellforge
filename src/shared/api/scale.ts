/** IPC contract: scaling a move's effects and hits to the player's size. */

/** An effect a skill or spell uses, for scaling. */
export interface ScalePlanEffect {
  id: number
  name: string
  /** Its size now (1 = the original). */
  size: number
  /** The effects it proxies: they're scaled with it. */
  children: number[]
  /** Other rows and animations using it: it's copied first, and the copy scaled, so they keep it as it is. */
  sharedWith: string[]
  /** Scaling one effect on its own: how many rows and animations use it (they all see the change). */
  usedBy?: number
  /**
   * A skill's effect spawned at a point of its weapon: the grip (in the
   * effect's axes) and how far it is. `inHand`: its shapes reach the hands
   * (Margit's hammer on the katana), so it's scaled about the grip and stays
   * held; else about the point it appears at.
   */
  held?: {
    weapon: string
    grip: number[]
    distance: number
    inHand: boolean
    /** Where its owner holds it (Margit's grip on his hammer), in its own axes at its original size: put in your hand. */
    handle?: number[]
    /** It's been moved so that grip is in your hand already. */
    fitted?: boolean
    /** The size at which it reaches the weapon's point it appears at (its hammer head at the weapon's tip): your hits match what you see. */
    fitSize?: number
  }
}

/** What scaling a skill, spell, bullet or effect touches. */
export interface ScalePlan {
  /** "SwordArtsParam:9100", "Magic:13000", "effect:621308". */
  key: string
  root: { param: string; id: number; name: string }
  /** Its size now (1 = the original), and its hitboxes'. */
  size: number
  hitboxSize: number
  /** A skill's animations (its category's): their effects and attacks. */
  animations: string[]
  /** A skill: a weapon that has it (the project's own first), to watch it with. */
  weapon?: { id: number; name: string }
  effects: ScalePlanEffect[]
  /** Player attacks (AtkParam_Pc) and their hit radii. */
  attacks: { id: number; name: string; radii: number[]; sharedWith: string[] }[]
  bullets: { id: number; name: string; radius: number; radiusMax: number; sharedWith: string[] }[]
  notes: string[]
}

export interface ScaleRequest {
  param: string
  id: number
  /** The size to have, of the original (0.8 = 80%). */
  size: number
  /** Effects to scale (from the plan); the effects they proxy come along. */
  effects: number[]
  hitboxes: boolean
  /** Held effects: about the grip (stays in the hand) or the point it appears at; the plan's choice if not given. */
  pivots?: Record<number, 'grip' | 'point'>
}

export interface ScaleResult {
  size: number
  /** Effects scaled, and those copied first (shared with other content). */
  effects: number
  copied: { from: number; to: number }[]
  attacks: number
  bullets: number
  /** Animations whose events now spawn the copies. */
  animationsEdited: number
  /** The plan after scaling. */
  plan: ScalePlan
}

/** The scale channels: request and response of each. */
export interface ScaleChannels {
  'scale:plan': [{ param: string; id: number }, ScalePlan]
  'scale:apply': [ScaleRequest, ScaleResult]
}
