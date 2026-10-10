/**
 * Event recipes as data: what a modder usually adds to the game's event
 * scripts (give an item, set a flag, react to a SpEffect, bring an enemy
 * in, set up a boss fight), the labels the Events page shows, and the
 * checks a recipe must pass before it's written. Shared by the editor and
 * the writer in core/events/recipes.ts.
 */

/** When an event acts. */
export type EventWhen =
  /** As soon as the script loads (the map loads; for the common script, as you load in anywhere). */
  | { kind: 'load' }
  /** When a flag turns on. */
  | { kind: 'flag'; flag: number }
  /** When the player walks into an area (an MSB region's entity id). */
  | { kind: 'area'; area: number }

/** What an event does when its SpEffect is on. */
export type EventDo =
  { kind: 'speffect'; speffect: number } | { kind: 'flag'; flag: number } | { kind: 'itemLot'; lot: number }

interface Base {
  /** Stable id (for editing and the record). */
  id: string
  /** The script it goes in: "common" or a map's, like "m60_42_36_00". */
  file: string
  /** The event ids it was written as (Spellforge picks them). */
  events: number[]
  /** Off: kept, not written. */
  off?: boolean
  /** The user's own note. */
  note?: string
  /** Gives a Rowa Fruit (item lot 997200) when it starts: proof that it runs. */
  test?: boolean
}

export type EventRecipe =
  | (Base & {
      /** Gives an item lot when the script loads; once per save through a flag of its own (`flag`). */
      kind: 'giveItems'
      lot: number
      /** 0: every time it loads. */
      flag: number
    })
  | (Base & {
      /** Sets a flag on or off. */
      kind: 'setFlag'
      flag: number
      state: boolean
      when: EventWhen
    })
  | (Base & {
      /** While a character (the player: 10000) has a SpEffect, do something; undone when it ends (a SpEffect given is taken). */
      kind: 'whileSpEffect'
      entity: number
      speffect: number
      do: EventDo
    })
  | (Base & {
      /** An enemy placed in the map stays away until a flag turns on. */
      kind: 'enableEnemy'
      entity: number
      flag: number
    })
  | (Base & {
      /**
       * A boss fight as the game sets one up: gone once defeated, idle until
       * the player is in its arena, then its health bar; when it dies, the
       * banner and its defeat flag.
       */
      kind: 'boss'
      entity: number
      defeatFlag: number
      arena: number
      /** NpcName text id for its health bar. */
      name: number
      /** 15 Legend felled, 16 Demigod felled, 17 Great enemy felled, 18 Enemy felled. */
      banner: number
    })

export type EventRecipeKind = EventRecipe['kind']

/** Item lot the game repeats freely (a Rowa Fruit, no flag): the community's marker for "this event runs". */
export const TEST_ITEM_LOT = 997200

/** How many events each recipe writes. */
export function eventCount(r: EventRecipe): number {
  return r.kind === 'boss' ? 2 : 1
}

/** What's wrong with a recipe before it's written (empty: nothing). */
export function eventRecipeProblems(r: EventRecipe): string[] {
  const out: string[] = []
  const id = (n: number, what: string, zeroOk = false) => {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) out.push(`${what} must be a whole number`)
    else if (n === 0 && !zeroOk) out.push(`Pick the ${what.toLowerCase()}`)
  }
  if (!/^(common|m\d\d_\d\d_\d\d_\d\d)$/.test(r.file)) out.push('Pick the script it goes in')
  switch (r.kind) {
    case 'giveItems':
      id(r.lot, 'Item lot')
      id(r.flag, 'Flag', true)
      break
    case 'setFlag':
      id(r.flag, 'Flag')
      if (r.when.kind === 'flag') id(r.when.flag, 'Flag it waits for')
      if (r.when.kind === 'area') id(r.when.area, 'Area')
      break
    case 'whileSpEffect':
      id(r.entity, 'Character')
      id(r.speffect, 'SpEffect')
      if (r.do.kind === 'speffect') id(r.do.speffect, 'SpEffect it gives')
      if (r.do.kind === 'flag') id(r.do.flag, 'Flag it sets')
      if (r.do.kind === 'itemLot') id(r.do.lot, 'Item lot it gives')
      break
    case 'enableEnemy':
      id(r.entity, 'Enemy')
      id(r.flag, 'Flag')
      break
    case 'boss':
      id(r.entity, 'Boss')
      id(r.defeatFlag, 'Defeat flag')
      id(r.arena, 'Arena')
      id(r.name, 'Name text', true)
      break
  }
  return out
}
