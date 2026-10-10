/**
 * Deep clone of a param tree — the "copy a weapon and all its bullets" job.
 *
 * Two phases so the UI can show exactly what will happen first:
 *
 *   planClone(db, request)  -> ClonePlan   pure, no mutation
 *   applyClone(db, plan)    -> CloneResult writes new rows into the db
 *
 * Planning:
 *  1. Walk outgoing refs from the roots, restricted to `followParams`. A
 *     weapon additionally owns the BehaviorParam_PC rows of its behavior
 *     variation (id = 100000000 + variation * 1000 + judgeId) — there is no
 *     direct field ref for that link.
 *  2. Decide clone vs share for each node. A node is cloned only if every
 *     row that references it is itself being cloned; anything also used from
 *     outside (a retail SpEffect shared by hundreds of rows) stays shared and
 *     the clones keep pointing at it. This repeats until stable, because
 *     sharing a node can orphan its children. `forceClone` / `forceShare`
 *     override per node.
 *  3. Allocate new ids per param by a fixed offset, so ids keep their
 *     structure (judge ids, upgrade levels), choosing the smallest
 *     round-number offset that collides with nothing.
 */
import { getField, setField, type ParamRow } from './param.ts'
import { ParamDatabase, type RowRef } from './paramDb.ts'
import { WEAPON_BEHAVIOR_CATEGORIES, behaviorRowId, behaviorVariationOf } from './behaviorIds.ts'

export type NodeKey = string // `${param}:${id}`

export function nodeKey(param: string, id: number): NodeKey {
  return `${param}:${id}`
}

export function parseNodeKey(key: NodeKey): { param: string; id: number } {
  const i = key.lastIndexOf(':')
  return { param: key.slice(0, i), id: Number(key.slice(i + 1)) }
}

const DEFAULT_FOLLOW_PARAMS = [
  'BehaviorParam_PC',
  'BehaviorParam',
  'Bullet',
  'AtkParam_Pc',
  'AtkParam_Npc',
  'SpEffectParam',
  'SpEffectVfxParam',
]

export interface CloneRequest {
  roots: { param: string; id: number }[]
  /** Params the walk may enter. Refs into other params are left as-is. */
  followParams?: string[]
  /** Nodes to clone even though they are shared. */
  forceClone?: NodeKey[]
  /** Nodes to keep shared even though they are exclusive. */
  forceShare?: NodeKey[]
  /** Per-param id offsets; omitted params get one chosen automatically. */
  offsets?: Record<string, number>
  /** New ids picked by hand, per node; they replace the automatic ones and are checked the same way. */
  idOverrides?: Record<NodeKey, number>
  /** New behaviorVariationId for cloned weapons; chosen automatically if omitted. */
  behaviorVariation?: number
  /** Suffix appended to row names of clones. */
  nameSuffix?: string
}

export type NodeStatus = 'root' | 'clone' | 'shared'

export interface PlanNode {
  key: NodeKey
  param: string
  id: number
  name: string
  status: NodeStatus
  /** Why a node is shared, for the preview. */
  sharedReason?: string
  /** Rows outside the clone set that also reference this node. */
  externalReferrers: number
  newId?: number
  /** Outgoing refs as found during the walk (within followParams). */
  children: { field: string; fieldLabel: string; key: NodeKey }[]
  /** Effect ids this row references. */
  sfxIds: { field: string; sfxId: number }[]
}

export interface ClonePlan {
  request: CloneRequest
  nodes: Map<NodeKey, PlanNode>
  /** param -> offset applied to cloned ids */
  offsets: Record<string, number>
  /** old variation -> new variation, for cloned weapons */
  behaviorVariations: Map<number, number>
  /** Problems that block applying the plan. */
  errors: string[]
  /** Effect ids used by cloned rows (candidates for effect cloning). */
  sfxIds: Set<number>
}

export interface CloneResult {
  /** old key -> new id */
  mapping: Map<NodeKey, number>
  rowsAdded: Record<string, number>
  fieldsRelinked: number
}

/* -------------------------------- walk ---------------------------------- */

export function behaviorRowsForVariation(db: ParamDatabase, variation: number): number[] {
  const beh = db.params.get('BehaviorParam_PC')
  if (!beh || variation <= 0) return []
  const out: number[] = []
  for (const category of WEAPON_BEHAVIOR_CATEGORIES) {
    const lo = behaviorRowId(category, variation, 0)
    for (let j = 0; j < 1000; j++) if (beh.index.has(lo + j)) out.push(lo + j)
  }
  return out
}

/**
 * A sorcery or incantation is two rows with one id: the item
 * (EquipParamGoods) and the spell (Magic). The game pairs them by id, so a
 * copy of one needs a copy of the other under the same new id.
 */
function spellCompanion(db: ParamDatabase, param: string, id: number): NodeKey | null {
  if (param === 'EquipParamGoods' && db.hasRow('Magic', id)) return nodeKey('Magic', id)
  if (param === 'Magic' && db.hasRow('EquipParamGoods', id)) return nodeKey('EquipParamGoods', id)
  return null
}

function childrenOf(
  db: ParamDatabase,
  param: string,
  id: number,
  follow: Set<string>,
): { field: string; fieldLabel: string; key: NodeKey }[] {
  const out = db
    .refsFrom(param, id)
    .filter((r: RowRef) => follow.has(r.targetParam))
    // A row pointing at itself (originEquipWep on a base weapon) is not a child.
    .filter((r) => !(r.targetParam === param && r.targetId === id))
    .map((r) => ({ field: r.field, fieldLabel: r.fieldLabel, key: nodeKey(r.targetParam, r.targetId) }))

  const companion = spellCompanion(db, param, id)
  if (companion)
    out.push({
      field: '(same id)',
      fieldLabel: param === 'EquipParamGoods' ? 'Spell (same id)' : 'Item (same id)',
      key: companion,
    })

  if (param === 'EquipParamWeapon' && follow.has('BehaviorParam_PC')) {
    const variation = db.value(param, id, 'behaviorVariationId')
    if (typeof variation === 'number') {
      for (const bid of behaviorRowsForVariation(db, variation)) {
        out.push({
          field: 'behaviorVariationId',
          fieldLabel: db.fieldLabel(param, 'behaviorVariationId'),
          key: nodeKey('BehaviorParam_PC', bid),
        })
      }
    }
  }
  return out
}

/* ------------------------------- planning -------------------------------- */

/** Root params that are always player-side: their trees never need NPC tables. */
const PLAYER_ROOT_PARAMS = new Set([
  'EquipParamWeapon',
  'EquipParamGoods',
  'BehaviorParam_PC',
  'Magic',
  'SwordArtsParam',
])

function defaultFollow(request: CloneRequest): string[] {
  const playerOnly = request.roots.every((r) => PLAYER_ROOT_PARAMS.has(r.param))
  return playerOnly
    ? DEFAULT_FOLLOW_PARAMS.filter((p) => p !== 'AtkParam_Npc' && p !== 'BehaviorParam')
    : DEFAULT_FOLLOW_PARAMS
}

export function planClone(db: ParamDatabase, request: CloneRequest, newerGame: ParamDatabase | null = null): ClonePlan {
  const follow = new Set(request.followParams ?? defaultFollow(request))
  const rootKeys = new Set(request.roots.map((r) => nodeKey(r.param, r.id)))
  const forceClone = new Set(request.forceClone ?? [])
  const forceShare = new Set(request.forceShare ?? [])
  const errors: string[] = []

  // 1. Closure.
  const nodes = new Map<NodeKey, PlanNode>()
  const stack = [...rootKeys]
  while (stack.length) {
    const key = stack.pop()!
    if (nodes.has(key)) continue
    const { param, id } = parseNodeKey(key)
    if (!db.hasRow(param, id)) {
      errors.push(`${param} ${id} does not exist`)
      continue
    }
    const children = childrenOf(db, param, id, follow)
    nodes.set(key, {
      key,
      param,
      id,
      name: db.rowName(param, id),
      status: rootKeys.has(key) ? 'root' : 'clone',
      externalReferrers: 0,
      children,
      sfxIds: db.sfxRefsFrom(param, id).map((s) => ({ field: s.field, sfxId: s.sfxId })),
    })
    for (const c of children) stack.push(c.key)
  }

  // 2. Who references each node, across the whole regulation.
  const incoming = new Map<NodeKey, NodeKey[]>()
  const targetParams = new Set([...nodes.values()].map((n) => n.param))
  for (const target of targetParams) {
    const index = db.buildIncomingIndex(target)
    for (const n of nodes.values()) {
      if (n.param !== target) continue
      incoming.set(
        n.key,
        (index.get(n.id) ?? []).map((r) => nodeKey(r.param, r.id)),
      )
    }
  }
  // Behavior rows are owned through the variation id, which no field ref
  // expresses. Only weapons inside the clone count as owners: a cloned
  // weapon gets a new variation, so its behaviors must be cloned with it even
  // though the original's infusions (same variation) still use the originals.
  const weaponsByVariation = new Map<number, NodeKey[]>()
  for (const w of db.params.get('EquipParamWeapon')?.param.rows ?? []) {
    const v = db.value('EquipParamWeapon', w.id, 'behaviorVariationId')
    if (typeof v !== 'number' || v <= 0) continue
    const list = weaponsByVariation.get(v) ?? []
    list.push(nodeKey('EquipParamWeapon', w.id))
    weaponsByVariation.set(v, list)
  }
  for (const n of nodes.values()) {
    if (n.param !== 'BehaviorParam_PC') continue
    const v = behaviorVariationOf(n.id)
    const owners = (weaponsByVariation.get(v) ?? []).filter((k) => nodes.has(k))
    incoming.set(n.key, [...(incoming.get(n.key) ?? []), ...owners])
  }

  // Behaviors reached through a weapon's variation must always be cloned:
  // the clone gets a new variation, and the link is the id formula itself,
  // so a behavior left shared would simply vanish from the new weapon.
  const variationOwned = new Set<NodeKey>()
  for (const n of nodes.values()) {
    if (n.param !== 'EquipParamWeapon' || forceShare.has(n.key)) continue
    for (const c of n.children) if (c.field === 'behaviorVariationId') variationOwned.add(c.key)
  }

  // A spell's item and Magic row go together (see spellCompanion).
  const companions = new Map<NodeKey, NodeKey>()
  for (const n of nodes.values()) {
    const c = spellCompanion(db, n.param, n.id)
    if (c && nodes.has(c)) companions.set(n.key, c)
  }

  // 3. Clone vs share, iterated to a fixed point.
  const cloned = (k: NodeKey) => {
    const s = nodes.get(k)?.status
    return s === 'root' || s === 'clone'
  }
  const companionCloned = (k: NodeKey) => {
    const c = companions.get(k)
    return c !== undefined && cloned(c)
  }
  for (const n of nodes.values()) {
    if (n.status === 'root') continue
    if (forceShare.has(n.key)) {
      n.status = 'shared'
      n.sharedReason = 'kept shared by you'
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (const n of nodes.values()) {
      if (n.status !== 'clone' || forceClone.has(n.key) || variationOwned.has(n.key) || companionCloned(n.key)) continue

      // Must still be reachable from a root through cloned parents.
      const parents = (incoming.get(n.key) ?? []).filter((k) => nodes.has(k))
      if (!parents.some((p) => cloned(p))) {
        n.status = 'shared'
        n.sharedReason = 'only reached through shared rows'
        changed = true
        continue
      }

      const external = (incoming.get(n.key) ?? []).filter((k) => !cloned(k))
      if (external.length > 0) {
        n.status = 'shared'
        n.externalReferrers = external.length
        n.sharedReason = `also used by ${external.length} other row${external.length === 1 ? '' : 's'}`
        changed = true
      }
    }
  }
  for (const n of nodes.values()) {
    if (n.status !== 'shared' || n.externalReferrers) continue
    n.externalReferrers = (incoming.get(n.key) ?? []).filter((k) => !cloned(k)).length
  }

  // 4. Ids. A new id must be unused in its table AND unreferenced: an
  // existing row pointing at a missing id would silently pick up a new row
  // created there. Weapons also reserve their whole block of 10000, since
  // infusions live at +100..+1200 and upgrade levels count up from the base.
  const ids = new IdAvailability(db, newerGame)
  const offsets: Record<string, number> = {}
  const behaviorVariations = new Map<number, number>()
  const byParam = new Map<string, PlanNode[]>()
  for (const n of nodes.values()) {
    if (n.status === 'shared') continue
    const list = byParam.get(n.param) ?? []
    list.push(n)
    byParam.set(n.param, list)
  }

  // Weapons drive their behavior ids through the variation number.
  const weapons = byParam.get('EquipParamWeapon') ?? []
  if (weapons.length) {
    const used = new Set(weaponsByVariation.keys())
    for (const w of weapons) {
      const oldV = db.value('EquipParamWeapon', w.id, 'behaviorVariationId') as number
      if (behaviorVariations.has(oldV)) continue
      let newV = request.behaviorVariation ?? oldV + 1
      while (
        used.has(newV) ||
        behaviorRowsForVariation(db, newV).length > 0 ||
        ids.variationReferenced(newV) ||
        [...behaviorVariations.values()].includes(newV)
      ) {
        if (request.behaviorVariation !== undefined) {
          errors.push(`Behavior variation ${newV} is already in use`)
          break
        }
        newV++
      }
      behaviorVariations.set(oldV, newV)
    }
  }

  // A copied spell's Magic row takes its item's new id; the item's id must
  // be free in both tables.
  const followers = new Map<PlanNode, PlanNode>()
  for (const n of nodes.values()) {
    if (n.param !== 'Magic' || n.status === 'shared') continue
    const item = nodes.get(nodeKey('EquipParamGoods', n.id))
    if (item && item.status !== 'shared') followers.set(n, item)
  }
  const spellIds = new Set([...followers.keys()].map((m) => m.id))

  for (const [param, list] of byParam) {
    if (param === 'Magic') {
      const rest = list.filter((n) => !followers.has(n))
      if (rest.length) assignOffset(ids, param, rest, request.offsets?.[param], offsets, errors)
      continue
    }
    if (param === 'EquipParamGoods' && spellIds.size) {
      assignOffset(
        ids,
        param,
        list,
        request.offsets?.[param],
        offsets,
        errors,
        1_000,
        (src, next) => !spellIds.has(src) || ids.problem('Magic', next) === null,
      )
      continue
    }
    if (param === 'BehaviorParam_PC' && behaviorVariations.size) {
      for (const n of list) {
        const oldV = behaviorVariationOf(n.id)
        const newV = behaviorVariations.get(oldV)
        n.newId = newV === undefined ? undefined : n.id + (newV - oldV) * 1000
      }
      // Behaviors not owned by a cloned weapon fall through to offsetting.
      const rest = list.filter((n) => n.newId === undefined)
      if (rest.length === 0) continue
      assignOffset(ids, param, rest, request.offsets?.[param], offsets, errors)
      continue
    }
    const minStep = param === 'EquipParamWeapon' ? 10_000 : 1_000
    assignOffset(ids, param, list, request.offsets?.[param], offsets, errors, minStep)
  }

  // Ids picked by hand win over the automatic ones (and face the same checks below).
  const manual = new Set<NodeKey>()
  for (const [key, id] of Object.entries(request.idOverrides ?? {})) {
    const n = nodes.get(key as NodeKey)
    if (!n || n.status === 'shared' || !Number.isInteger(id) || followers.has(n)) continue
    n.newId = id
    manual.add(n.key)
  }
  for (const [magic, item] of followers) {
    magic.newId = item.newId
    if (manual.has(item.key)) manual.add(magic.key)
  }

  // Final collision sweep across everything assigned.
  const taken = new Map<string, Set<number>>()
  for (const n of nodes.values()) {
    if (n.newId === undefined) continue
    const set = taken.get(n.param) ?? new Set()
    if (set.has(n.newId)) errors.push(`${n.param}: two clones would both get id ${n.newId}`)
    // Behavior ids come from the variation formula and were vetted there.
    const problem =
      n.param === 'BehaviorParam_PC' && plan_behaviorOwned(n) && !manual.has(n.key)
        ? ids.rowOrRange(n.param, n.newId)
        : ids.problem(n.param, n.newId)
    if (problem) errors.push(`${n.param} ${n.newId}: ${problem}`)
    set.add(n.newId)
    taken.set(n.param, set)
  }

  function plan_behaviorOwned(n: PlanNode): boolean {
    return behaviorVariations.has(behaviorVariationOf(n.id))
  }

  const sfxIds = new Set<number>()
  for (const n of nodes.values()) {
    if (n.status !== 'shared') for (const s of n.sfxIds) sfxIds.add(s.sfxId)
  }

  return { request, nodes, offsets, behaviorVariations, errors, sfxIds }
}

/**
 * Answers "can a new row take this id?" — no existing row, no existing
 * reference to it, in range, and for weapons a free 10000-id block.
 */
export class IdAvailability {
  private dangling = new Map<string, Set<number>>()
  private weaponIds: number[] | null = null
  private db: ParamDatabase
  private newer: ParamDatabase | null

  /**
   * `newerGame`: the installed game's regulation when the project was made
   * with an older game version. Ids that version added are taken too: the
   * game may use them, and a mod updated later would collide with them.
   */
  constructor(db: ParamDatabase, newerGame: ParamDatabase | null = null) {
    this.db = db
    this.newer = newerGame
  }

  /** Ids some existing row points at although no row has them. */
  danglingRefs(param: string): Set<number> {
    let set = this.dangling.get(param)
    if (!set) {
      set = new Set()
      for (const id of this.db.buildIncomingIndex(param).keys()) {
        if (!this.db.hasRow(param, id)) set.add(id)
      }
      this.dangling.set(param, set)
    }
    return set
  }

  /** Existing-row and range checks only (no dangling-reference check). */
  rowOrRange(param: string, id: number): string | null {
    if (id <= 0 || id > 0x7fffffff) return 'out of range'
    if (this.db.hasRow(param, id)) return 'already exists'
    if (this.newer?.hasRow(param, id)) return 'the current game version uses this id'
    return null
  }

  problem(param: string, id: number): string | null {
    const basic = this.rowOrRange(param, id)
    if (basic) return basic
    if (this.danglingRefs(param).has(id)) return 'an existing row already points at this id'
    if (param === 'EquipParamWeapon') {
      this.weaponIds ??= [this.db, this.newer].flatMap(
        (d) => d?.get('EquipParamWeapon').param.rows.map((r) => r.id) ?? [],
      )
      const base = id - (id % 10000)
      if (this.weaponIds.some((w) => w >= base && w < base + 10000))
        return `weapon block ${base}–${base + 9999} is in use`
    }
    return null
  }

  /** Whether anything references a behavior id in this variation's ranges. */
  variationReferenced(variation: number): boolean {
    const refs = this.danglingRefs('BehaviorParam_PC')
    for (const category of WEAPON_BEHAVIOR_CATEGORIES) {
      const lo = behaviorRowId(category, variation, 0)
      for (const id of refs) if (id >= lo && id < lo + 1000) return true
    }
    return false
  }
}

/**
 * Picks the smallest offset that is a multiple of a round step and collides
 * with no existing row. The step is the power of ten above the span of the
 * ids being moved, so a block of ids lands in a fresh block of the same shape.
 */
function assignOffset(
  ids: IdAvailability,
  param: string,
  list: PlanNode[],
  requested: number | undefined,
  offsets: Record<string, number>,
  errors: string[],
  minStep = 1_000,
  /** Another table the new id must also be free in (a spell's Magic row). */
  alsoFree?: (sourceId: number, newId: number) => boolean,
): void {
  const sourceIds = list.map((n) => n.id)
  const fits = (offset: number) =>
    sourceIds.every((id) => ids.problem(param, id + offset) === null && (!alsoFree || alsoFree(id, id + offset)))

  let offset = requested
  if (offset === undefined) {
    const span = Math.max(...sourceIds) - Math.min(...sourceIds) + 1
    let step = minStep
    while (step < span) step *= 10
    offset = undefined
    for (let k = 1; k < 100_000; k++) {
      if (fits(k * step)) {
        offset = k * step
        break
      }
    }
    if (offset === undefined) {
      errors.push(`${param}: could not find free ids for ${sourceIds.length} clones`)
      return
    }
  } else if (!fits(offset)) {
    errors.push(`${param}: offset ${offset} collides with existing or referenced ids`)
  }

  offsets[param] = offset
  for (const n of list) n.newId = n.id + offset
}

/* -------------------------------- apply --------------------------------- */

export function applyClone(db: ParamDatabase, plan: ClonePlan): CloneResult {
  if (plan.errors.length) {
    throw new Error('Clone plan has errors:\n' + plan.errors.join('\n'))
  }

  const mapping = new Map<NodeKey, number>()
  for (const n of plan.nodes.values()) {
    if (n.newId !== undefined && n.status !== 'shared') mapping.set(n.key, n.newId)
  }

  const rowsAdded: Record<string, number> = {}
  let fieldsRelinked = 0
  const suffix = plan.request.nameSuffix ?? ' (clone)'

  for (const n of plan.nodes.values()) {
    const newId = mapping.get(n.key)
    if (newId === undefined) continue
    const p = db.get(n.param)
    const source = db.row(n.param, n.id)!
    const data = Buffer.from(source.data)

    // Relink every ref field whose target was cloned.
    for (const ref of db.refsFrom(n.param, n.id)) {
      const target = mapping.get(nodeKey(ref.targetParam, ref.targetId))
      if (target === undefined) continue
      const f = p.def.fieldsByName.get(ref.field)!
      if (getField(data, f) === target) continue
      setField(data, f, target)
      fieldsRelinked++
    }

    // A base weapon names itself in originEquipWep*; follow the move.
    if (n.param === 'EquipParamWeapon') {
      for (const f of p.def.fields) {
        if (f.name.startsWith('originEquipWep') && getField(data, f) === n.id) {
          setField(data, f, newId)
          fieldsRelinked++
        }
      }
      const vf = p.def.fieldsByName.get('behaviorVariationId')
      const oldV = vf ? (getField(data, vf) as number) : undefined
      const newV = oldV === undefined ? undefined : plan.behaviorVariations.get(oldV)
      if (vf && newV !== undefined) {
        setField(data, vf, newV)
        fieldsRelinked++
      }
    }

    // A skill names itself through textId (its ArtsName/ArtsCaption entry).
    // When the original used its own id, the copy uses its own, so naming the
    // copy doesn't rename the original (and the copy isn't called Gold
    // Breaker in game whatever its text says).
    if (n.param === 'SwordArtsParam') {
      const tf = p.def.fieldsByName.get('textId')
      if (tf && getField(data, tf) === n.id) {
        setField(data, tf, newId)
        fieldsRelinked++
      }
    }

    // Behavior rows repeat their variation in a field; keep it in step with
    // the row id, or the row and its field disagree.
    if (n.param === 'BehaviorParam_PC') {
      const vf = p.def.fieldsByName.get('variationId')
      const oldV = behaviorVariationOf(n.id)
      const newV = plan.behaviorVariations.get(oldV)
      if (vf && newV !== undefined && getField(data, vf) !== newV) {
        setField(data, vf, newV)
        fieldsRelinked++
      }
    }

    insertRow(db, n.param, { id: newId, name: '', data })
    const baseName = db.rowName(n.param, n.id)
    if (baseName) p.rowNames.set(newId, baseName + suffix)
    rowsAdded[n.param] = (rowsAdded[n.param] ?? 0) + 1
  }

  return { mapping, rowsAdded, fieldsRelinked }
}

/**
 * Inserts a row keeping rows sorted by id. The game binary-searches params,
 * so an out-of-order row can silently fail to load.
 */
export function insertRow(db: ParamDatabase, paramName: string, row: ParamRow): void {
  const p = db.get(paramName)
  if (p.index.has(row.id)) throw new Error(`${paramName} ${row.id} already exists`)
  const rows = p.param.rows
  let lo = 0
  let hi = rows.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (rows[mid].id < row.id) lo = mid + 1
    else hi = mid
  }
  rows.splice(lo, 0, row)
  ParamDatabase.reindex(p)
  p.dirty = true
}
