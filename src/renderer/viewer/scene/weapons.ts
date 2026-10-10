/**
 * The held weapons' models placed where the game puts them for the way they're
 * held (WepAbsorpPosParam), moved or hidden by the animation's events.
 */
import * as THREE from 'three'
import type { WeaponPlacement } from '../../../shared/api.ts'
import { handRoot, findDummy } from './dummies.ts'
import type { EventEffects } from '../eventEffects.ts'
import type { WeaponStyle } from '../prefs.ts'
import type { ViewerState } from './state.ts'

const hangInv = new THREE.Matrix4()
const hangK = new THREE.Matrix4()
const hangAt = new THREE.Matrix4()
const moveK = new THREE.Matrix4()

/** The way of holding: one-handed, or the right / left weapon in both hands (auto: two-handed animation ids, 032xxx–033xxx). */
export function resolveStyle(style: WeaponStyle, animation: string | null): 'one' | 'right' | 'left' {
  if (style !== 'auto') return style
  const id = animation ? Number(animation.slice(5)) : NaN
  return id >= 32000 && id < 34000 ? 'right' : 'one'
}

/**
 * The WepAbsorpPosParam field that says where a hand's weapon model goes
 * for a way of holding: one-handed right_n / left_n; the right weapon in
 * both hands both_n (the left one hung, leftHang_n); the left weapon in both
 * hands leftBoth_n (the right one hung, rightHang_n).
 */
function absorpField(hand: 'right' | 'left', style: 'one' | 'right' | 'left'): keyof WeaponPlacement['slots'][number] {
  if (style === 'right') return hand === 'right' ? 'both' : 'leftHang'
  if (style === 'left') return hand === 'right' ? 'rightHang' : 'leftBoth'
  return hand
}

/**
 * Puts each held weapon's models where the game does (WepAbsorpPosParam):
 * model 0 in the hand (right_0: dummy 20) or, held two-handed, at the
 * two-handed grip (both_0: 24) or hung on the body (leftHang_0: 2031, body
 * dummy 31); model 1 (a scabbard, the other of a pair) at its own point. A
 * model sits on a dummy the way the weapon sits on its one-handed grip
 * dummy, so that grip gives the turn from dummy to model: moved, a model's
 * meshes keep their own pose under K = bone⁻¹ · target · grip⁻¹ · bone.
 * Events hide them (HideEquippedWeapon), and so does a weapon's own
 * "hidden" passive (Unseen Blade's state).
 */
export function placeWeapons(
  s: ViewerState,
  placements: { right: WeaponPlacement | null; left: WeaponPlacement | null } | undefined,
  style: 'one' | 'right' | 'left',
  show: boolean,
  eff: EventEffects | null | undefined,
  time: number,
): void {
  const hidden = { right: false, left: false, rightCase: false, leftCase: false }
  for (const w of eff?.hideWeapons ?? []) {
    if (time < w.start || time > w.end) continue
    hidden.right ||= w.right
    hidden.left ||= w.left
    hidden.rightCase ||= w.rightCase
    hidden.leftCase ||= w.leftCase
  }
  // OverrideWeaponModelLocations: models moved to another of their places while it runs.
  const moved = { right: [-1, -1, -1, -1], left: [-1, -1, -1, -1] }
  for (const w of eff?.weaponLocations ?? []) {
    if (time < w.start || time > w.end || !(style === 'one' ? w.one : style === 'right' ? w.right : w.left)) continue
    for (const hand of ['right', 'left'] as const)
      w.models[hand].forEach((c, n) => c >= 0 && c <= 3 && (moved[hand][n] = c))
  }
  // A model's place: where this way of holding puts it, or where an override sends it (when the weapon has that place).
  const placeOf = (
    pl: WeaponPlacement | null,
    hand: 'right' | 'left',
    model: number,
    base: keyof WeaponPlacement['slots'][number],
  ) => {
    const c = moved[hand][model]
    const to =
      c < 0 ? base : c === 3 ? (hand === 'right' ? 'rightHang' : 'leftHang') : (['right', 'left', 'both'] as const)[c]
    return pl && to !== base && (pl.slots[model]?.[to] ?? -1) > 0 ? to : base
  }
  s.world.updateWorldMatrix(true, false)
  for (const hand of ['right', 'left'] as const) {
    const pl = placements?.[hand] ?? null
    const base = absorpField(hand, style)
    const field = placeOf(pl, hand, 0, base)
    const grip = pl ? pl.slots[0]?.[hand] : -1
    const hold = grip !== undefined && grip > 0 ? findDummy(s, grip % 1000, 'body') : null
    // Model 0: in the hand, unless this way of holding puts it elsewhere.
    const main = s.parts.get(hand)
    if (main) {
      const at = pl ? pl.slots[0]?.[field] : grip
      const off = !show || (pl?.hidden ?? false) || hidden[hand] || (style !== 'one' && at !== undefined && at < 0)
      const target = pl && at !== undefined && at > 0 && at !== grip ? findDummy(s, at % 1000, 'body') : null
      for (const o of main.objects) {
        const mesh = o as THREE.Mesh
        const natural = mesh.userData.natural as THREE.Matrix4 | undefined
        if (off) mesh.visible = false
        if (!natural) continue
        if (target && hold && mesh.parent) {
          mesh.parent.updateWorldMatrix(true, false)
          const bone = mesh.parent.matrixWorld
          moveK.copy(bone).invert().multiply(target).multiply(hangK.copy(hold).invert()).multiply(bone)
          mesh.matrix.multiplyMatrices(moveK, natural)
        } else mesh.matrix.copy(natural)
        mesh.matrixWorldNeedsUpdate = true
      }
    }
    // Model 1 (a scabbard, the other of a pair), hung at its point.
    const p = s.parts.get(`${hand}:1`)
    if (!p) continue
    const at = pl ? pl.slots[1]?.[placeOf(pl, hand, 1, base)] : -1
    const dummy = at !== undefined && at > 0 ? findDummy(s, at % 1000, 'body') : null
    const root = handRoot(s, hand)
    const ok = !!(dummy && hold && root) && show && !hidden[hand === 'right' ? 'rightCase' : 'leftCase']
    for (const o of p.objects) o.visible = ok
    if (!ok) continue
    hangK.copy(hold!).invert().multiply(root!)
    hangAt.multiplyMatrices(dummy!, hangK)
    hangInv.copy(s.world.matrixWorld).invert().multiply(hangAt)
    for (const o of p.objects) {
      o.matrix.copy(hangInv)
      o.matrixWorldNeedsUpdate = true
    }
  }
}
