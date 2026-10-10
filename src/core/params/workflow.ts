/**
 * "Duplicate into project": clone a weapon (or any rows) together with its
 * effects, so the copy can be recolored and reshaped without touching the
 * original.
 *
 * Param rows are cloned by clone.ts. This adds the effect side: every effect
 * a cloned row uses gets its own copy, the row's SFX fields are relinked to
 * the copies, and — optionally — proxied child effects are copied as well
 * and the parent's references remapped, since a recolor of the parent never
 * reaches its children (they are separate files).
 */
import { Action, GenericNode, NodeType, ProxyNode, SFXReference, type FXR } from '@cccode/fxr'
import { getField, setField } from './param.ts'
import { applyClone, planClone, parseNodeKey, type ClonePlan, type CloneRequest, type CloneResult } from './clone.ts'
import type { ParamDatabase } from './paramDb.ts'
import type { EffectLibrary } from '../effects/effects.ts'

export interface EffectCloneOptions {
  /** Give cloned rows their own copies of the effects they use. */
  cloneEffects: boolean
  /** Also copy proxied child effects and point the copies at each other. */
  includeChildEffects: boolean
  /** Lowest id to allocate new effects from. */
  effectIdStart?: number
}

export interface DuplicateResult extends CloneResult {
  /** old effect id -> new effect id */
  effectMapping: Map<number, number>
  sfxFieldsRelinked: number
}

/** Every effect id an effect proxies, in all three forms the format allows. */
export function childEffectIds(fxr: FXR): number[] {
  return fxr.getReferences().sfx
}

/** Rewrites an effect's references to other effects through `map`. */
export function remapEffectReferences(fxr: FXR, map: Map<number, number>): number {
  let changed = 0
  for (const node of fxr.root.walk()) {
    if (node instanceof ProxyNode) {
      const to = map.get(node.sfx)
      if (to !== undefined) {
        node.sfx = to
        changed++
      }
    } else if (node instanceof GenericNode && node.type === NodeType.Proxy) {
      const a = node.actions[0]
      if (a instanceof SFXReference) {
        const to = map.get(a.sfx)
        if (to !== undefined) {
          a.sfx = to
          changed++
        }
      } else if (a instanceof Action) {
        const field = a.fields1[0]
        const to = map.get(field.value as number)
        if (to !== undefined) {
          field.value = to
          changed++
        }
      }
    }
  }
  return changed
}

/**
 * Collects the effects to copy: the ones cloned rows use, plus (optionally)
 * everything they proxy, transitively. Effects that don't exist in any
 * bundle are skipped — a row can name an effect that only exists in a
 * per-character or per-map bundle.
 */
export function effectsToCopy(lib: EffectLibrary, roots: Iterable<number>, includeChildren: boolean): number[] {
  const out = new Set<number>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id) || !lib.hasEffect(id)) continue
    out.add(id)
    if (includeChildren) for (const c of childEffectIds(lib.getEffect(id))) stack.push(c)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Weapon-buff visuals (greases, buff spells) name one effect but the game
 * adds the weapon's "Enchantment SFX Size" (0–8) to it, so a short blade
 * and a greatsword each get a coating that fits: 303111, 303112, … 303119.
 * A copy has to keep that family together, in the same order.
 */
export const ENCHANT_SIZES = 9
const FAMILY_BLOCK = 10

/** Effect ids that are the base of a size family, from the VFX rows being copied. */
function familyBases(db: ParamDatabase, plan: ClonePlan): Set<number> {
  const out = new Set<number>()
  for (const n of plan.nodes.values()) {
    if (n.status === 'shared' || n.param !== 'SpEffectVfxParam') continue
    if (db.value('SpEffectVfxParam', n.id, 'isUseOffsetEnchantSfxSize') !== 1) continue
    for (const s of n.sfxIds) if (s.sfxId > 0) out.add(s.sfxId)
  }
  return out
}

/**
 * Which new id each copied effect gets: size families first, each into a
 * free block that keeps its members' spacing, then every other effect into
 * the next free id. Used both to preview a duplicate and to make it.
 */
export function planEffectCopies(
  db: ParamDatabase,
  lib: EffectLibrary,
  plan: ClonePlan,
  includeChildren: boolean,
  start: number,
): Map<number, number> {
  const map = new Map<number, number>()
  const taken = new Set<number>()
  const free = (id: number) => !lib.hasEffect(id) && !taken.has(id)
  let next = start
  for (const base of [...familyBases(db, plan)].sort((a, b) => a - b)) {
    const members = Array.from({ length: ENCHANT_SIZES }, (_, k) => base + k).filter((id) => lib.hasEffect(id))
    if (!members.length) continue
    let at = next
    while (!Array.from({ length: FAMILY_BLOCK }, (_, k) => at + k).every(free)) at++
    for (const id of members) {
      map.set(id, at + (id - base))
      taken.add(at + (id - base))
    }
    next = at + FAMILY_BLOCK
  }
  const roots = new Set([...plan.sfxIds, ...map.keys()])
  for (const id of effectsToCopy(lib, roots, includeChildren)) {
    if (map.has(id)) continue
    while (!free(next)) next++
    map.set(id, next)
    taken.add(next)
    next++
  }
  return map
}

/** Plans a duplicate. Same as planClone; exported for symmetry with `duplicate`. */
export function planDuplicate(
  db: ParamDatabase,
  request: CloneRequest,
  newerGame: ParamDatabase | null = null,
): ClonePlan {
  return planClone(db, request, newerGame)
}

export function duplicate(
  db: ParamDatabase,
  lib: EffectLibrary | null,
  plan: ClonePlan,
  options: EffectCloneOptions,
): DuplicateResult {
  const result = applyClone(db, plan)
  const effectMapping = new Map<number, number>()
  let sfxFieldsRelinked = 0

  if (!options.cloneEffects || !lib) return { ...result, effectMapping, sfxFieldsRelinked }

  // Effects used by the rows that were cloned (not by shared ones), with
  // weapon-buff size families kept together.
  for (const [id, to] of planEffectCopies(
    db,
    lib,
    plan,
    options.includeChildEffects,
    options.effectIdStart ?? 900_000_000,
  )) {
    effectMapping.set(id, to)
    lib.cloneEffect(id, to)
  }

  // Point copied parents at copied children.
  if (options.includeChildEffects) {
    for (const newId of effectMapping.values()) {
      const fxr = lib.getEffect(newId)
      if (remapEffectReferences(fxr, effectMapping) > 0) lib.saveEffect(fxr)
    }
  }

  // Relink the cloned rows' SFX fields to the copies.
  for (const [key, newId] of result.mapping) {
    const { param } = parseNodeKey(key)
    const row = db.row(param, newId)
    if (!row) continue
    const p = db.get(param)
    for (const s of db.sfxRefsFrom(param, newId)) {
      const to = effectMapping.get(s.sfxId)
      if (to === undefined) continue
      const f = p.def.fieldsByName.get(s.field)!
      if (getField(row.data, f) === to) continue
      setField(row.data, f, to)
      sfxFieldsRelinked++
    }
    p.dirty = true
  }

  return { ...result, effectMapping, sfxFieldsRelinked }
}
