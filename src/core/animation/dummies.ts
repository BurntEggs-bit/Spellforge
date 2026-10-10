/**
 * Dummy poly ids: the numbered points events, attacks and effects are placed
 * at. Under 10000 a point is on the character's own model; above, on a held
 * weapon: `hand × 10000 + model × 1000 + point`, hand 1 the right and 2 the
 * left, model 1 the weapon's second model (the other blade of a pair, or its
 * scabbard). The game's own data shows the layout: right-hand greases name
 * 10xxx and 11xxx points, left-hand ones 20xxx and 21xxx; power-stance
 * attacks hit with 10xxx and 20xxx at once; guarding uses 20xxx.
 */
import { cross, dot, normalize } from '../math/vector.ts'

// The id layout itself is shared with the renderer (the viewer's move tool names dummies too).
export {
  dummyIdOn,
  dummyLocation,
  dummySourceOf,
  parseDummyId,
  weaponDummyId,
  type DummyRef,
  type WeaponHand,
} from '../../shared/dummyIds.ts'

/** A dummy poly's place: its position, and the directions it faces (forward) and has up. */
export interface DummyFrame {
  position: ArrayLike<number>
  forward: ArrayLike<number>
  up: ArrayLike<number>
}

/**
 * A point in a dummy's frame: the axes an effect spawned at the dummy uses,
 * +Z along its forward and +Y its up (x = up × forward), as the game and the
 * viewer place effects.
 */
export function pointInDummyFrame(dummy: DummyFrame, point: ArrayLike<number>): number[] {
  const z = normalize(dummy.forward) ?? [0, 0, 1]
  const x = normalize(cross(normalize(dummy.up) ?? [0, 1, 0], z)) ?? [1, 0, 0]
  const y = cross(z, x)
  const offset = [point[0] - dummy.position[0], point[1] - dummy.position[1], point[2] - dummy.position[2]]
  return [dot(x, offset), dot(y, offset), dot(z, offset)]
}

/** Where a weapon's grip (its model's origin, where the hand holds it) is in the frame of a dummy on it. */
export function gripInDummyFrame(dummy: DummyFrame): number[] {
  return pointInDummyFrame(dummy, [0, 0, 0])
}
