/**
 * Everything placed in the game's maps, by entity id (and entity group id)
 * and by talk script: what an entity id names, and which characters speak
 * with a talk script. Built from msb.ts entries, one map at a time.
 */
import type { MsbEntry } from '../formats/msb.ts'

export interface Placement {
  /** The map's file name, m10_00_00_00. */
  map: string
  entry: MsbEntry
  /** It's here as a member of the entity group with the id looked up. */
  group?: boolean
}

export class MapIndex {
  readonly entities = new Map<number, Placement[]>()
  readonly talks = new Map<number, Placement[]>()
  maps = 0

  add(map: string, entries: MsbEntry[]): void {
    this.maps++
    for (const entry of entries) {
      if (entry.entityId > 0) push(this.entities, entry.entityId, { map, entry })
      for (const g of entry.groups) push(this.entities, g, { map, entry, group: true })
      if (entry.talkId && entry.talkId > 0) push(this.talks, entry.talkId, { map, entry })
    }
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}

/** m10_00_00_00 from map\mapstudio\m10_00_00_00.msb.dcx. */
export function mapOfFile(rel: string): string {
  return rel
    .split(/[\\/]/)
    .pop()!
    .replace(/\.msb(\.dcx)?$/i, '')
    .toLowerCase()
}
