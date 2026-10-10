/**
 * Elden Ring map layouts (MSB, version 73; 74 in the DLC's maps, same
 * layout for what's read here), read only as far as naming ids needs: what
 * is placed in a map (characters, assets, map pieces, regions…) with its
 * entity id and entity groups, and each character's NpcParam and talk
 * script. The offsets were read off the game's own maps: Godrick's part
 * c4750_9000 holds entity 10000800, Kale's part holds talk script 800006000;
 * every talk id in the maps' bytes but one (a DLC region's) is read.
 *
 *   header (0x10): "MSB ", 1, 0x10, flags
 *   six lists, chained: version i32, count i32 (entries + 1), name i64,
 *     entry offsets i64[count - 1], next list i64
 *     MODEL_PARAM_ST, EVENT_PARAM_ST, POINT_PARAM_ST (regions),
 *     ROUTE_PARAM_ST, LAYER_PARAM_ST, PARTS_PARAM_ST
 *   model:  name i64 @0
 *   part:   name i64 @0, type i32 @0xC, model index i32 @0x14,
 *           entity struct i64 @0x60 (entity id @0, groups i32[8] @0x1C),
 *           type data i64 @0x68 (characters: NpcThinkParam @8, NpcParam @0xC, talk @0x10)
 *   region: name i64 @0, type i32 @8, base struct i64 @0x50 (entity id @4)
 * Offsets inside an entry count from the entry's start.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the MSB layout.
 */

/** Part types (what the part is). */
export const PART_TYPES: Record<number, string> = {
  0: 'map piece',
  2: 'character',
  4: 'player start',
  5: 'collision',
  9: 'dummy asset',
  10: 'dummy character',
  11: 'connect collision',
  13: 'asset',
}

/** Region types; -1 is a plain area, what event scripts mostly test. */
export const REGION_TYPES: Record<number, string> = {
  [-1]: 'area',
  1: 'invasion point',
  2: 'environment map point',
  4: 'sound',
  5: 'effect',
  6: 'wind effect',
  8: 'spawn point',
  9: 'message',
  21: 'connection',
  26: 'spirit summon point',
  32: 'patrol route',
  33: 'map point',
  37: 'group defeat reward',
  41: 'fast travel restriction',
  43: 'play area',
}

export interface MsbEntry {
  list: 'part' | 'region'
  /** Its name in the map (c4750_9000, or a region's, often Japanese). */
  name: string
  type: number
  /** A part's model (c4750, AEG099_060, m10_00_00_00_000100). */
  model?: string
  entityId: number
  /** The entity groups it belongs to. */
  groups: number[]
  /** Characters: their NpcParam, NpcThinkParam and talk script. */
  npcParam?: number
  thinkParam?: number
  talkId?: number
}

const CHARACTER_TYPES = new Set([2, 10])

/** The entries of a map that have an entity id, an entity group or a talk script. */
export function readMsb(bytes: Uint8Array): MsbEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = bytes.byteLength
  if (size < 0x20 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== 'MSB ')
    throw new Error('Not an MSB map')
  const ok = (o: number, n = 4) => Number.isSafeInteger(o) && o >= 0 && o + n <= size
  const i32 = (o: number) => (ok(o) ? dv.getInt32(o, true) : 0)
  const i64 = (o: number) => (ok(o, 8) ? Number(dv.getBigInt64(o, true)) : 0)
  const wstr = (o: number) => {
    let s = ''
    for (let i = o; ok(i, 2) && s.length < 256; i += 2) {
      const c = dv.getUint16(i, true)
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s
  }

  const lists = new Map<string, number[]>()
  for (let at = 0x10, guard = 0; at > 0 && ok(at, 16) && guard < 16; guard++) {
    const count = i32(at + 4)
    if (count < 1 || !ok(at + 16, count * 8)) break
    const offsets: number[] = []
    for (let k = 0; k < count - 1; k++) offsets.push(i64(at + 16 + k * 8))
    lists.set(wstr(i64(at + 8)), offsets)
    at = i64(at + 16 + (count - 1) * 8)
  }

  const models = (lists.get('MODEL_PARAM_ST') ?? []).map((o) => wstr(o + i64(o)))
  const out: MsbEntry[] = []
  for (const o of lists.get('PARTS_PARAM_ST') ?? []) {
    if (!ok(o, 0x70)) continue
    const type = i32(o + 0xc)
    const ent = i64(o + 0x60)
    const entityId = ent > 0 ? i32(o + ent) : 0
    const groups: number[] = []
    if (ent > 0)
      for (let k = 0; k < 8; k++) if (i32(o + ent + 0x1c + k * 4) > 0) groups.push(i32(o + ent + 0x1c + k * 4))
    let npcParam: number | undefined
    let thinkParam: number | undefined
    let talkId: number | undefined
    if (CHARACTER_TYPES.has(type)) {
      const data = i64(o + 0x68)
      if (data > 0) {
        thinkParam = i32(o + data + 8)
        npcParam = i32(o + data + 0xc)
        talkId = i32(o + data + 0x10)
      }
    }
    if (entityId <= 0 && !groups.length && !(talkId && talkId > 0)) continue
    out.push({
      list: 'part',
      name: wstr(o + i64(o)),
      type,
      model: models[i32(o + 0x14)],
      entityId: Math.max(entityId, 0),
      groups,
      npcParam,
      thinkParam,
      talkId,
    })
  }
  for (const o of lists.get('POINT_PARAM_ST') ?? []) {
    if (!ok(o, 0x58)) continue
    const base = i64(o + 0x50)
    const entityId = base > 0 ? i32(o + base + 4) : 0
    if (entityId <= 0) continue
    out.push({ list: 'region', name: wstr(o + i64(o)), type: i32(o + 8), entityId, groups: [] })
  }
  return out
}
