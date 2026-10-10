/** IPC contract: what an id is: event flags, placed entities, any id looked up, and free ids near one. */

/** Something a map places: a character, an asset, a region… */
export interface PlacedEntity {
  /** What it is: character, asset, map piece, spawn point (a region)… */
  kind: string
  region?: boolean
  /** A character's name (its NpcParam's), an asset's or map piece's; else its model or its name in the map. */
  name: string
  /** The map's file name (m10_00_00_00) and its name. */
  map: string
  mapName: string
  /** Its name in the map, and its model. */
  part: string
  model?: string
  entityId?: number
  /** A character's NpcParam row and talk script. */
  npcParam?: number
  talkId?: number
  /** Listed as a member of the entity group looked up. */
  group?: boolean
}

/** A param row whose field holds an event flag, and what that means ("Picked up: Smithing Stone [1]"). */
export interface FlagParamUse {
  param: string
  id: number
  name: string
  field: string
  role: string
}

/** An event script, or a talk script (NPC dialogue), that uses a flag. */
export interface FlagScriptUse {
  /** `event`: an event script's event; `talk`: a talk script, its talk id in `event`. */
  kind: 'event' | 'talk'
  /** A talk script's community name (its NPC or object), when it has one. */
  talkName?: string
  /** Script file (m10_00_00_00, common, common_func) and its map's name. */
  file: string
  mapName: string
  event: number
  /** The common (or other) event the flag was handed to. */
  via?: number
  what: 'set' | 'clear' | 'check' | 'wait' | 'random'
  /** When the script uses a whole range of flags. */
  range?: [number, number]
  /** What the event does besides: the boss it shows, the items it awards. */
  context?: string
}

export interface FlagInfo {
  flag: number
  /** One line: what it's for. */
  summary: string
  /** Its community name, when it has one. */
  name?: string
  /** The map its number belongs to, and its number there. */
  map?: { id: string; name: string; local: number }
  params: FlagParamUse[]
  scripts: FlagScriptUse[]
  /** Nothing in the game's params or scripts uses it. */
  unused: boolean
}

/** Everything a number is in the game. */
export interface IdLookup {
  id: number
  flag?: FlagInfo
  rows: { param: string; id: number; name: string }[]
  texts: { table: string; text: string }[]
  effect?: { id: number; name: string }
  icons: { kind: string; id: number }[]
  character?: { chr: string; name: string }
  /** What the maps place with this entity id, or in this entity group. */
  placed: PlacedEntity[]
  /** A talk script (dialogue): its name, its binder's map, the characters the maps give it. */
  talkScript?: { name?: string; file?: string; speakers: PlacedEntity[] }
}

/** The ID picker's view of one id and the ids around it. */
export interface IdNeighborhood {
  param: string
  id: number
  /** A new row can take this id. */
  free: boolean
  /** Why not, in plain words. */
  problem?: string
  /** Name of the row that has this id, if any. */
  name: string
  /** The first id at or after `id` a new row can take (-1 if none nearby). */
  nextFree: number
  from: number
  to: number
  /** Rows in [from, to]. */
  rows: { id: number; name: string }[]
  /** Ids in [from, to] something points at although no row has them yet. */
  referenced: number[]
}

/** The ids channels: request and response of each. */
export interface IdsChannels {
  /** What an event flag is for: its name, map, the params and event scripts that use it. */
  'ids:flag': [{ flag: number }, FlagInfo]
  /** Everything a number is in the game (rows, flag, text, effect, icons, character). */
  'ids:lookup': [{ id: number }, IdLookup]
  /** Whether a new row can take an id, the next one that can, and what's around it. */
  'ids:near': [{ param: string; id: number; radius?: number; exclude?: number[] }, IdNeighborhood]
}
