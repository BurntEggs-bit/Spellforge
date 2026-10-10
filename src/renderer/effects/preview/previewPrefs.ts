/** The effect preview's lighting and scene options, remembered per machine. */
import { PREF_KEYS, readPref, writePref } from '../../lib/storage.ts'

/** Lighting choices, remembered per machine. */
export interface PreviewLighting {
  area: string
  time: number
  probe: number
  /** Exposure in stops, on top of the automatic eye adaptation. */
  ev: number
  /** Bloom strength multiplier; 0 turns bloom off. */
  bloom: number
  /** Turns the area around the effect (degrees). */
  turn: number
  backdrop: boolean
  ground: boolean
  figure: boolean
}

export const DEFAULT_PREVIEW_LIGHTING: PreviewLighting = {
  area: 'limgrave',
  time: 1,
  probe: 0,
  ev: 0,
  bloom: 1,
  turn: 0,
  backdrop: true,
  ground: true,
  figure: false,
}

/** The saved lighting over the defaults (a setting added since keeps its default). */
export function loadPreviewLighting(): PreviewLighting {
  return { ...DEFAULT_PREVIEW_LIGHTING, ...readPref<Partial<PreviewLighting> | null>(PREF_KEYS.previewLighting, {}) }
}

export function savePreviewLighting(p: PreviewLighting): void {
  writePref(PREF_KEYS.previewLighting, p)
}
