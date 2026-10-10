/**
 * Where points on the character are, in the scene: things bound to its
 * bones, the dummy polys on its body and held weapons, and the hands' weapon
 * roots (weapon models sit turned in the hand: weaponFlip).
 */
import * as THREE from 'three'
import type { DummySource } from '../../../shared/api.ts'
import type { LoadedPart, ViewerState } from './state.ts'

/**
 * Weapon models run their blade along -Y from a grip at the origin, while the
 * hand's R_Weapon / L_Weapon bones point the other way: the blade must
 * follow the body's weapon-hit dummy polys (100, 101…) away from the fist.
 * Turning about Z (not X) also keeps curved blades (scythes, katanas) facing
 * forward rather than behind the character.
 */
const WEAPON_FLIP = new THREE.Matrix4().makeRotationZ(Math.PI)

/**
 * The left hand's L_Weapon bone is the right one mirrored and then turned
 * half a turn about its X axis: every pair of the body's left/right dummy
 * polys on these bones differs by exactly that. So a weapon in the left hand
 * gets that extra half turn, or its blade points back into the arm.
 * (Rx(pi) * Rz(pi) is Ry(pi).)
 */
const WEAPON_FLIP_LEFT = new THREE.Matrix4().makeRotationY(Math.PI)

/** The turn from a hand's weapon bone to a weapon model held in it. */
export function weaponFlip(slot: string): THREE.Matrix4 {
  return slot === 'left' ? WEAPON_FLIP_LEFT : WEAPON_FLIP
}

const tmp2 = new THREE.Matrix4()

/** Current transform of something bound at `bind` (actor space) to skeleton bone `bone`. */
export function follow(s: ViewerState, bone: number, bind: THREE.Matrix4, out: THREE.Matrix4): THREE.Matrix4 {
  if (bone < 0 || !s.bones[bone]) return out.multiplyMatrices(s.actor.matrixWorld, bind)
  return out.multiplyMatrices(s.bones[bone].matrixWorld, tmp2.multiplyMatrices(s.invRef[bone], bind))
}

/** World transform of a part's dummy poly (index into its list). */
export function dummyWorld(s: ViewerState, p: LoadedPart, i: number): THREE.Matrix4 {
  const d = p.view.dummies[i]
  if (d.space === -2)
    return new THREE.Matrix4()
      .multiplyMatrices(s.bones[d.bone]?.matrixWorld ?? s.actor.matrixWorld, weaponFlip(p.slot))
      .multiply(p.dummyFrames[i])
  const bind = d.space >= 0 ? new THREE.Matrix4().multiplyMatrices(s.ref[d.space], p.dummyFrames[i]) : p.dummyFrames[i]
  return follow(s, d.bone, bind, new THREE.Matrix4())
}

/**
 * A dummy poly by ID on the body or a weapon. Weapon IDs the weapon model
 * lacks fall back to the body's own weapon dummies (100, 110… on R_Weapon).
 */
export function findDummy(s: ViewerState, id: number, source: DummySource): THREE.Matrix4 | null {
  if (id < 0) return null
  const order: (LoadedPart | null | undefined)[] = source === 'body' ? [s.body] : [s.parts.get(source), s.body]
  for (const p of order) {
    if (!p) continue
    const want = p === s.body && source !== 'body' ? (source === 'right' ? 'R_Weapon' : 'L_Weapon') : null
    let i = -1
    if (want && s.skel) {
      const bone = s.skel.bones.findIndex((b) => b.name === want)
      i = p.view.dummies.findIndex((d) => d.id === id && d.bone === bone)
    }
    if (i < 0) i = p.view.dummies.findIndex((d) => d.id === id)
    if (i >= 0) return dummyWorld(s, p, i)
  }
  return null
}

/** Where a held weapon's model sits: its hand bone, turned the way weapons hang in the hand. */
export function handRoot(s: ViewerState, hand: 'right' | 'left'): THREE.Matrix4 | null {
  const i = s.skel?.bones.findIndex((b) => b.name === (hand === 'right' ? 'R_Weapon' : 'L_Weapon')) ?? -1
  const bone = s.bones[i]
  if (!bone) return null
  bone.updateWorldMatrix(true, false)
  return new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, weaponFlip(hand))
}
