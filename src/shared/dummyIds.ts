/**
 * Dummy poly ids: the numbered points events, attacks and effects are placed
 * at. Under 10000 a point is on the character's own model; above, on a held
 * weapon: `hand × 10000 + model × 1000 + point`, hand 1 the right and 2 the
 * left, model 1 the weapon's second model (the other blade of a pair, or its
 * scabbard). The game's own data shows the layout: right-hand greases name
 * 10xxx and 11xxx points, left-hand ones 20xxx and 21xxx; power-stance
 * attacks hit with 10xxx and 20xxx at once; guarding uses 20xxx.
 */
import type { DummySource } from './api.ts'

export type WeaponHand = 'right' | 'left'

/** A dummy poly id decoded: what it's on and its number there. */
export interface DummyRef {
  /** The character's own model, or the weapon in a hand. */
  on: 'body' | WeaponHand
  /** The weapon's model (0 its main one, 1 its second); 0 on the body. */
  model: number
  /** The point's number on that model. */
  point: number
}

export function parseDummyId(id: number): DummyRef {
  const hand = Math.floor(id / 10000)
  if (hand !== 1 && hand !== 2) return { on: 'body', model: 0, point: id }
  return { on: hand === 1 ? 'right' : 'left', model: Math.floor(id / 1000) % 10, point: id % 1000 }
}

/** The id of a point on a hand's weapon (its main model unless `model` says otherwise). */
export function weaponDummyId(hand: WeaponHand, point: number, model = 0): number {
  return (hand === 'right' ? 10000 : 20000) + model * 1000 + point
}

/** The viewer's part a decoded point is on ('right:1': the right weapon's second model). */
export function dummySourceOf(ref: DummyRef): DummySource {
  if (ref.on === 'body') return 'body'
  return ref.model > 0 ? `${ref.on}:1` : ref.on
}

/** The id an event names for a point on one of the viewer's parts: the inverse of dummySourceOf. */
export function dummyIdOn(source: DummySource, point: number): number {
  if (source === 'body') return point
  const [hand, model] = source.split(':')
  return weaponDummyId(hand as WeaponHand, point, model ? 1 : 0)
}

/**
 * Where the viewer finds a point: the part it's on and its number there. Ids
 * under 10000 are on `fallback` (the body, or the weapon an attack's hits are
 * relative to).
 */
export function dummyLocation(id: number, fallback: DummySource): { dummy: number; source: DummySource } {
  const ref = parseDummyId(id)
  return ref.on === 'body' ? { dummy: id, source: fallback } : { dummy: ref.point, source: dummySourceOf(ref) }
}
