/**
 * The viewer's colours, each defined once: the simulation's colour for each
 * kind of event (its lines in the scene, its labels and the active-events
 * list) and the axis colours its transforms and the legend share.
 */
import type { SimAction } from '../../shared/api.ts'
import { rgbToHex } from '../lib/color.ts'

/** Each kind of simulated event's colour (RGB, 0-1). */
export const SIM_COLORS: Record<SimAction['kind'], number[]> = {
  attack: [1, 0.25, 0.2],
  common: [1, 0.6, 0.15],
  pc: [0.95, 0.35, 0.9],
  throw: [1, 0.45, 0.45],
  bullet: [0.25, 0.85, 1],
  speffect: [0.75, 0.55, 1],
  ffx: [0.35, 0.65, 1],
  sound: [0.45, 0.9, 0.55],
}

/** The same colours for CSS (labels, the active-events list). */
export const SIM_CSS = Object.fromEntries(
  Object.entries(SIM_COLORS).map(([kind, rgb]) => [kind, rgbToHex(rgb)]),
) as Record<SimAction['kind'], string>

/** A transform's axes: X (its side) red, Y (up) green, Z (forward) blue. */
export const AXIS_COLORS = { x: '#ff4d4d', y: '#4de06a', z: '#4d9aff' } as const
