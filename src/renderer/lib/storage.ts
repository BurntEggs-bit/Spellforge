/**
 * Preferences kept in the page's localStorage: per machine, shared by every
 * project. Storage can be unavailable (a locked-down profile, a full disk),
 * so reads fall back to the default and writes are skipped: preferences are
 * only a convenience. Anything that must survive a crash goes through the
 * main process instead (localStorage isn't flushed when the app is killed).
 */
import { useCallback, useState } from 'react'

/**
 * Every key, in one place so none is reused by accident. The names are what
 * users' saved settings are stored under: never change one.
 */
export const PREF_KEYS = {
  /** The viewer's helper overlays and simulation switches (JSON HelperPrefs). */
  viewportHelpers: 'spellforge.viewportHelpers',
  /** The viewer's outfit (JSON EquipPrefs). */
  viewportEquipment: 'spellforge.viewportEquipment',
  /** The viewer's lighting (JSON LightingPrefs). */
  viewportLighting: 'spellforge.viewportLighting',
  /** Whether the viewer's axis legend is open ('open' / 'closed'). */
  axesLegend: 'spellforge.axesLegend',
  /** The effect preview's lighting (JSON). */
  previewLighting: 'spellforge.previewLighting',
  /** The effects' glow multiplier, shared by the preview and the viewer (a number). */
  glow: 'spellforge.glow',
  /** Event types muted in the viewer (JSON numbers). */
  mutedEventTypes: 'spellforge.mutedEventTypes',
  /** Timeline lane colours by event type (JSON). */
  eventColors: 'spellforge.eventColors',
  /** How the timeline orders its lanes (JSON string). */
  laneOrder: 'spellforge.laneOrder',
  /** The combo viewer's steps (JSON). */
  combo: 'spellforge.combo',
  /** Whether saving also reloads the character in the running game ('1' / '0'). */
  reloadOnSave: 'spellforge.reloadOnSave',
  /** Whether the Inspector shows field descriptions ('on' / 'off'). */
  fieldHints: 'spellforge.fieldHints',
  /** The Inspector's field groups folded shut, by param (JSON: param -> group names). */
  fieldGroups: 'spellforge.fieldGroups',
  /** Whether resting the pointer on something shows its note ('on' / 'off'). */
  hoverNotes: 'spellforge.hoverNotes',
  /** The Text page's language. */
  textLang: 'spellforge.textLang',
  /** Column widths (JSON numbers). */
  paramListWidth: 'spellforge.paramList',
  labelColumnWidth: 'spellforge.labelColumn',
  /** The walkthrough window: where the video was left, and which video. */
  walkthroughAt: 'spellforge.walkthrough.at',
  walkthroughVideo: 'spellforge.walkthrough.video',
} as const

/** A page's dock layout (JSON); every one starts with LAYOUT_KEY_PREFIX. */
export const LAYOUT_KEY_PREFIX = 'spellforge.layout.'
export const layoutKey = (page: string) => `${LAYOUT_KEY_PREFIX}${page}`

/** A stored string, or null when there's none (or storage is unavailable). */
export function readText(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeText(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable: kept for this session only */
  }
}

/** A stored JSON value, or `fallback` when there's none or it can't be read. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: kept for this session only */
  }
}

export function removePref(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* storage unavailable */
  }
}

/** Removes every key that starts with `prefix`. */
export function removePrefsStartingWith(prefix: string): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k)
  } catch {
    /* storage unavailable */
  }
}

/** State that is saved (as JSON) whenever it is set, and read back the next time. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, initial))
  const set = useCallback(
    (v: T) => {
      setValue(v)
      writePref(key, v)
    },
    [key],
  )
  return [value, set]
}
