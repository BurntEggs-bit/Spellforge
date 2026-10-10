/**
 * The character viewer's preferences: its helper overlays and simulation,
 * its lighting and the outfit it shows. They are kept per machine and
 * shared by the Animations and Enemies pages (and by every project).
 */
import { PREF_KEYS, readPref, writePref } from '../lib/storage.ts'

export interface HelperPrefs {
  all: boolean
  text: boolean
  xray: boolean
  models: boolean
  grid: boolean
  dummyIds: boolean
  dummyAxes: boolean
  partDummies: boolean
  flverBones: boolean
  flverNames: boolean
  hkxBones: boolean
  hkxNames: boolean
  glue: boolean
  rootTrail: boolean
  rootMotion: boolean
  followCamera: boolean
  /** Simulation: act out events during playback. */
  simHits: boolean
  simBullets: boolean
  simEffects: boolean
  /** Play the real effects (FXR) of effect events and bullets. */
  simFx: boolean
  /** Bloom, for glowing effects. */
  bloom: boolean
  /** A stand-in enemy this far in front (m) for homing bullets; 0 = none. */
  targetDistance: number
  /** The list of events active at the playhead. */
  simList: boolean
  /** The axis legend. */
  legend: boolean
  /** Helper line thickness in pixels ("boost transform visibility"). */
  thickness: number
  /** Size of dummy poly / bone axes, as a multiple of the default. */
  axisScale: number
  /** Size of bone axes (HKX and FLVER), as a multiple of the default. */
  boneAxisScale?: number
  /** Size of text labels, as a multiple of the default. */
  textScale?: number
  /** Root motion scaled: along the ground, up and down, and its turning (DS Anim Studio's multipliers). */
  rootScaleXZ?: number
  rootScaleY?: number
  rootRotation?: number
  /** The camera turns with the character as root motion turns it. */
  followRotation?: boolean
  /** Weapon dummy polys labelled as events name them: 10000 + n right, 20000 + n left. */
  dummyEventIds?: boolean
  /** FLVER bone transforms (axes) and bounding boxes. */
  flverAxes?: boolean
  flverBoxes?: boolean
  /** The character's hit capsule, now and where the animation started. */
  hitCapsule?: boolean
  /** Each attack hit shape's name (attack id and hit number). */
  hitNames?: boolean
  /** How far the attack hitboxes reach from where the character stands: a line and its length. */
  attackReach?: boolean
  /** Sound events: a marker and the sound's name where it plays. */
  soundMarkers?: boolean
  /** Sound events play their sounds (from the game's banks) during playback, at this volume (0-1). */
  sound?: boolean
  soundVolume?: number
  colors: { dummy: string; flver: string; hkx: string; glue: string; root: string }
}

const DEFAULT_HELPERS: HelperPrefs = {
  all: true,
  text: true,
  xray: true,
  models: true,
  grid: true,
  dummyIds: false,
  dummyAxes: false,
  partDummies: true,
  flverBones: false,
  flverNames: false,
  hkxBones: false,
  hkxNames: false,
  glue: false,
  rootTrail: true,
  rootMotion: true,
  followCamera: true,
  simHits: true,
  simBullets: true,
  simEffects: true,
  simFx: true,
  bloom: true,
  targetDistance: 6,
  simList: true,
  legend: true,
  thickness: 2.5,
  axisScale: 1,
  boneAxisScale: 1,
  textScale: 1,
  rootScaleXZ: 1,
  rootScaleY: 1,
  rootRotation: 1,
  followRotation: false,
  dummyEventIds: false,
  flverAxes: false,
  flverBoxes: false,
  hitCapsule: false,
  hitNames: true,
  attackReach: false,
  soundMarkers: true,
  sound: true,
  soundVolume: 0.6,
  colors: { dummy: '#ff6a3d', flver: '#f2d14b', hkx: '#e04848', glue: '#ff9f2e', root: '#5ad16e' },
}

export interface LightingPrefs {
  /** Light probe area (env:list ids), its time of day and probe spot. */
  area: string
  time: number
  probe: number
  /** Exposure in stops. */
  ev: number
  /** Sun strength (0 = probe light only). */
  sun: number
  shadows: boolean
  /** Show the probe, blurred, behind the character. */
  backdrop: boolean
}

export const DEFAULT_LIGHTING: LightingPrefs = {
  area: 'limgrave',
  time: 1,
  probe: 0,
  ev: 0.5,
  sun: 1.2,
  shadows: true,
  backdrop: true,
}

/** How the weapons are held: one-handed, the right or left weapon in both hands, or as the animation id says (032xxx, 033xxx two-handed). */
export type WeaponStyle = 'auto' | 'one' | 'right' | 'left'

export interface EquipPrefs {
  female: boolean
  head: string | null
  body: string | null
  arms: string | null
  legs: string | null
  right: string | null
  left: string | null
  /** A grease or other weapon buff shown on the held weapons (EquipParamGoods id). */
  buff?: number | null
  /** Or a spell that buffs the weapon (Magic id): Electrify Armament, Bloodflame Blade… */
  buffSpell?: number | null
  /** Show a weapon's second model (its scabbard, or the other of a pair) where the game puts it. Default on. */
  sheaths?: boolean
  /** How the weapons are held (default: as the animation id says). */
  style?: WeaponStyle
  /** The bare head's parts by kind (face, fg01 eyes and mouth, hair, fg20 eyebrows…): part names, or none. */
  faceParts?: Record<string, string | null>
}

/* -------------------------------- storage --------------------------------- */

/** The saved lighting over the defaults (a setting added since keeps its default). */
export function loadLighting(): LightingPrefs {
  return { ...DEFAULT_LIGHTING, ...readPref<Partial<LightingPrefs> | null>(PREF_KEYS.viewportLighting, {}) }
}
export function saveLighting(l: LightingPrefs): void {
  writePref(PREF_KEYS.viewportLighting, l)
}

/** The saved helpers over the defaults, colours too. */
export function loadHelpers(): HelperPrefs {
  const saved = readPref<Partial<HelperPrefs> | null>(PREF_KEYS.viewportHelpers, null)
  if (!saved) return DEFAULT_HELPERS
  return { ...DEFAULT_HELPERS, ...saved, colors: { ...DEFAULT_HELPERS.colors, ...(saved.colors ?? {}) } }
}
export function saveHelpers(h: HelperPrefs): void {
  writePref(PREF_KEYS.viewportHelpers, h)
}

/** The saved outfit, or null on the first run (see defaultEquipment). */
export function loadEquipment(): EquipPrefs | null {
  return readPref<EquipPrefs | null>(PREF_KEYS.viewportEquipment, null)
}
export function saveEquipment(e: EquipPrefs): void {
  writePref(PREF_KEYS.viewportEquipment, e)
}
