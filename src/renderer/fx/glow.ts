/**
 * The Glow multiplier for additive (glowing) effect parts: the user's call,
 * since no single value matches every effect against the game (see
 * FX_ADDITIVE_GAIN). Shared by the effect preview and the character viewer,
 * whose shaders read `fxAdditiveGain` as a uniform, and remembered per machine.
 */
import { PREF_KEYS, readText, writeText } from '../lib/storage.ts'
import { FX_ADDITIVE_GAIN } from './constants.ts'

/** The saved multiplier, or the default when none is saved. */
function loadGlow(): number {
  const v = Number(readText(PREF_KEYS.glow))
  return v > 0 ? v : FX_ADDITIVE_GAIN
}

/** The multiplier now; shader materials hold this object as a uniform, so a change shows at once. */
export const fxAdditiveGain = { value: loadGlow() }

export function setGlow(v: number): void {
  fxAdditiveGain.value = v
  writeText(PREF_KEYS.glow, String(v))
}
