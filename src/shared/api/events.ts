/** IPC contract: the game's event scripts (EMEVD) on the Events page, and the project's event recipes. */
import type { EventRecipe } from '../eventRecipes.ts'

export type { EventRecipe, EventRecipeKind, EventWhen, EventDo } from '../eventRecipes.ts'

/** One event script: the common one, the shared events, or a map's. */
export interface EventFileView {
  /** "common", "common_func", "m18_00_00_00" */
  file: string
  /** What it is: "Always loaded", "Shared events", or the map's name. */
  title: string
  /** The project's recipes and test markers in it. */
  own: number
  /** The project has its own copy of the script. */
  edited: boolean
  /** Recipes can go in it (the shared events can't: the maps start them). */
  canAdd: boolean
}

/** A line that starts an event, and the arguments it hands it. */
export interface EventStart {
  /** The script it's in ('' for the same script). */
  file: string
  event: number
  slot: number
  args: number[]
}

/** An event in a script's list. */
export interface EventSummary {
  id: number
  /** Started again when the player rests at a grace. */
  restarts: boolean
  lines: number
  /** What it does, in a few words. */
  about: string
  /** Something starts it (event 0 and 50 run by themselves). */
  started: boolean
  /** The project's recipe it's made from. */
  recipe?: string
  /** It has the test marker. */
  marker: boolean
}

/** What an event line names, for links. */
export interface EventRefView {
  kind: 'flag' | 'entity' | 'area' | 'itemLot' | 'speffect' | 'event' | 'text' | 'sound' | string
  value: number
}

export interface EventLineView {
  index: number
  text: string
  refs: EventRefView[]
  /** Spellforge knows what it does (else its numbers are shown). */
  known: boolean
  /** bank[id] */
  code: string
  /** Some of its values come from the arguments the event is started with. */
  argument?: boolean
}

export interface EventView {
  file: string
  id: number
  restarts: boolean
  lines: EventLineView[]
  /** How many values it takes from the line that starts it. */
  parameters: number
  /** The lines that start it. */
  startedBy: EventStart[]
  /** Event 0 and 50: the game runs them whenever the script loads. */
  runsAlone: boolean
  recipe?: EventRecipe
  marker: boolean
}

/** The events channels: request and response of each. */
export interface EventsChannels {
  'events:files': [void, EventFileView[]]
  'events:list': [{ file: string }, EventSummary[]]
  'events:get': [{ file: string; id: number }, EventView]
  'events:recipes': [void, EventRecipe[]]
  /** Adds or changes a recipe (its events get ids in its script); returns it with them. */
  'events:setRecipe': [{ recipe: EventRecipe }, EventRecipe]
  'events:deleteRecipe': [{ id: string }, void]
  /** The test marker (a Rowa Fruit when the event starts) on an event, or off. */
  'events:setMarker': [{ file: string; event: number; on: boolean }, void]
  /** A flag nothing uses, kept across loads, for a script. */
  'events:newFlag': [{ file: string }, number]
  /** Makes an item lot (ItemLotParam_map) that gives one item: its id. */
  'events:itemLot': [{ category: number; item: number; count: number }, number]
}
