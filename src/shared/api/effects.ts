/** IPC contract: effects (FXR): their tree, recolouring, resources, models, textures, the preview and lighting environments. */
import type { SkeletonView } from './character.ts'
import type { ProjectState } from './project.ts'
import type { PreviewSpec } from './preview.ts'

export type ColorValue =
  { kind: 'static'; rgba: number[] } | { kind: 'gradient'; stops: { t: number; rgba: number[] }[] }

export interface EffectNodeView {
  index: number
  depth: number
  type: string
  /** What the node draws, e.g. "3D model", "Sprite", "Trail", "Group". */
  label: string
  color: ColorValue | null
  /** Appearance/resource actions within this node. */
  slots: ResourceSlot[]
  /** Appearance actions in this node that have a blend mode. */
  blends: { actionIndex: number; action: string; value: number }[]
  isProxy: boolean
  proxyTarget?: number
}

export interface ResourceSlot {
  /** Index of the action in fxr.root.walkActions() order. */
  actionIndex: number
  action: string
  field: string
  resource: 'texture' | 'model'
  textureType?: string
  value: number
  exists: boolean
}

export interface EffectDetails {
  origin?: string
  color?: string
  behaviour?: string
  info?: string
  /** From the ID numbering scheme, e.g. "Weapons" for 4XXXXX. */
  category?: string
}

/** An effect's own bundle, outside the common ones. */
export interface EffectLocation {
  /** e.g. sfx/sfxbnd_c2130.ffxbnd.dcx */
  bundle: string
  /** Whose it is: "Margit" (character c2130), "map m10_00"… */
  owner: string
  name: string
}

export interface EffectView {
  id: number
  /** From the bundled community sheet or an imported CSV. */
  name: string
  details: EffectDetails
  credit: string
  bundle: string
  source: 'project' | 'game'
  /** New in the project, changed from the game's, or untouched (null). */
  state: ProjectState
  /**
   * A weapon-buff effect (grease, buff spell) comes in one version per
   * blade size: the game adds the weapon's Enchantment SFX Size to the id.
   * All of them, this one included, when it's one of those.
   */
  sizeFamily?: number[]
  textures: { id: number; type: string }[]
  models: number[]
  children: number[]
  nodes: EffectNodeView[]
  /** Rows that use this effect, so a number has context. */
  usedBy: { param: string; id: number; name: string; field: string }[]
  /**
   * The moving bullet that carries it (its sfxId_Bullet), when one does: in
   * game the effect flies at that speed, and parts emitted per metre moved
   * only appear then, so the preview flies it the same way.
   */
  flight?: { bullet: number; name: string; speed: number; life: number }
  /** Spells it's part of (their cast, fire or effect sfx, or a bullet they fire): Entire spell shows the whole spell. */
  spells: { id: number; name: string }[]
  warnings: string[]
}

export type RecolorOp =
  | { op: 'hueShift'; degrees: number }
  | { op: 'replaceHue'; rgb: number[] }
  | { op: 'replace'; rgba: number[] }
  | { op: 'multiply'; rgba: number[] }
  | { op: 'saturation'; factor: number }
  | { op: 'grayscale' }
  | { op: 'invert' }

export interface RecolorRequest {
  effectId: number
  recolor: RecolorOp
  /** Limit to one node (index in walk order); whole effect when omitted. */
  nodeIndex?: number
  includeChildren: boolean
  /** Also every blade-size version of a weapon-buff effect (EffectView.sizeFamily). */
  includeSizes?: boolean
}

export interface ResourceEdit {
  effectId: number
  actionIndex: number
  field: string
  value: number
}

export interface AssetEntry {
  resource: 'texture' | 'model'
  id: number
  textureType?: string
  bundle: string
  /** Textures: the model they belong to (same id), if any. */
  owner?: number
}

/** A texture a model draws with, and where that link comes from. */
export interface ModelTextureView {
  id: number
  type: string
  /** 'model' = named in the model file, 'material' = its MATBIN, 'same id' = s{model}_{type}. */
  source: 'model' | 'material' | 'same id'
  /** The material's slot name, when known (e.g. ..._AlbedoMap). */
  slot: string
}

export interface ModelMeshView {
  positions: number[]
  uvs: number[] | null
  indices: number[]
  /** Albedo texture in the effect bundles, if the material names one. */
  texture: { id: number; type: string } | null
  /** Emissive texture (`_em`), if the material names one that the bundles hold. */
  emissive?: { id: number; type: string } | null
  /** Emissive (glowing) materials: their glow colour from the MATBIN, e.g. Glintstone crystals. */
  glow?: number[] | null
}

/** A lighting preset for the preview: an area of the game and its times of day. */
export interface EnvironmentAreaView {
  id: string
  name: string
  /** Available times of day; empty for areas with a single lighting set. */
  times: { index: number; label: string }[]
}

/** One light probe, unwrapped to an equirectangular HDR image. */
export interface EnvironmentView {
  area: string
  time: number
  width: number
  height: number
  /** Linear RGB float32 pixels, base64. */
  rgb: string
  probes: number
  probe: number
  probeName: string
  /** Mean luminance before exposure, for eye adaptation. */
  luminance: number
}

/**
 * An animated effect model (RichModel/Model with an anibnd): its skeleton,
 * one clip pre-sampled per frame, and per-mesh skinning. Arrays are base64.
 */
export interface ModelRigView {
  bones: SkeletonView['bones']
  frames: number
  frameDuration: number
  duration: number
  /** Skeleton bone per track. */
  tracks: number[]
  /** Float32 [frame][track][tx ty tz rx ry rz rw sx sy sz] */
  data: string
  /** Per mesh (same order as model:mesh): Uint16 skinIndex x4 and Float32 skinWeight x4, or null. */
  meshes: ({ skinIndex: string; skinWeight: string } | null)[]
}

/** A field of an effect action as the Parts editor shows it (built by core/effects/fxEdit.ts). */
export interface FxFieldView {
  name: string
  desc: string
  /** How to edit it. */
  kind: 'scalar' | 'vector' | 'int' | 'bool' | 'enum' | 'resource'
  components: number
  enumOptions?: { value: number; label: string; desc: string }[]
  resource?: 'texture' | 'model'
  textureType?: string
  /** The constant value, or the first keyframe's when animated. */
  value: number | number[] | boolean | null
  /** Set when the value changes over time: the curve type, keyframe count and range. */
  animated: { function: string; keys: number; over: string; min: number; max: number } | null
  /** Random or external modifiers in plain words, e.g. "random +0 to +360". */
  modifiers: string[]
  /** Reverse-engineered but unnamed (unk_*) fields. */
  unknown: boolean
}

/** One action of an effect node (its type, slot and fields). */
export interface FxActionView {
  actionIndex: number
  type: number
  name: string
  slot: string
  desc: string
  fields: FxFieldView[]
}

/** One node of an effect, with its actions. */
export interface FxPartView {
  /** Node index in pre-order (the same numbering as the effect view and preview). */
  index: number
  depth: number
  actions: FxActionView[]
}

/** An edit to one field: set it to a constant, or scale it. */
export interface FxFieldEdit {
  actionIndex: number
  field: string
  /** Set to this constant (animated values become constant). */
  value?: number | number[] | boolean
  /** Or multiply by this, keeping curves and random ranges. */
  scale?: number
}

/** The effects channels: request and response of each. */
export interface EffectsChannels {
  'effect:get': [{ id: number }, EffectView]
  /** Where an effect that isn't in the common bundles is (a character's or a map's own bundle), or null. */
  'effect:locate': [{ id: number }, EffectLocation | null]
  /** Copies an effect (and what it needs) from its own bundle into the common effects. */
  'effect:import': [{ id: number }, { effects: number[]; files: string[]; from: EffectLocation }]
  /** Another bundle's effect brought in for the project's own use: a copy under a free id. */
  'effect:bring': [{ id: number }, { id: number; from: EffectLocation }]
  /**
   * Turns and moves an effect in its own axes (`rotation` a row-major 3×3, `offset` metres); a game
   * effect is copied first and the copy's id returned.
   */
  'effect:transform': [{ id: number; rotation: number[]; offset: number[] }, { id: number; copied: boolean }]
  /** A copy of an effect under a free id, to change without changing the game's: its id. */
  'effect:copy': [{ id: number }, number]
  'effect:recolor': [RecolorRequest, EffectView]
  'effect:setResource': [ResourceEdit, EffectView]
  /**
   * Import a DDS into the effect's bundle; with `actionIndex`/`field`, also
   * point that slot at it. `base64` is the file's contents.
   */
  'texture:import': [
    { effectId: number; textureType: string; base64: string; actionIndex?: number; field?: string },
    { id: number; view: EffectView },
  ]
  /**
   * Import a .flver model (plus any of its .dds textures, matched by name)
   * into the effect's bundle; with `actionIndex`/`field`, point that slot at it.
   */
  'model:import': [
    { effectId: number; files: { name: string; base64: string }[]; actionIndex?: number; field?: string },
    { id: number; textures: string[]; missing: string[]; view: EffectView },
  ]
  'effect:setBlendMode': [{ effectId: number; actionIndex: number; value: number }, EffectView]
  /** Every node's actions and Elden Ring fields, documented, for the part editor. */
  'effect:parts': [{ id: number }, FxPartView[]]
  /** Sets or scales fields (scaling keeps curves and random ranges). */
  'effect:setFields': [{ effectId: number; edits: FxFieldEdit[] }, EffectView]
  'assets:list': [{ resource: 'texture' | 'model'; query: string }, AssetEntry[]]
  /**
   * PNG data URL, or null when there's nothing to show. Models use their albedo
   * texture. `greyAsAlpha` (for the preview) makes greyscale masks transparent;
   * `'mask'` also uses brightness as alpha for mask layers that have no alpha.
   */
  'assets:thumb': [
    { resource: 'texture' | 'model'; id: number; textureType?: string; size?: number; greyAsAlpha?: boolean | 'mask' },
    string | null,
  ]
  'effect:preview': [{ id: number; scale?: number; shift?: number[] }, PreviewSpec]
  /** A model's geometry for the preview, or null if it can't be read. */
  'model:mesh': [{ id: number }, ModelMeshView[] | null]
  /** The textures a model draws with (its own and its material's). */
  'model:textures': [{ id: number }, ModelTextureView[]]
  /** An animated effect model's skeleton, clip and skinning, or null. */
  'model:rig': [{ model: number; anibnd: number; animation: number }, ModelRigView | null]
  /** Lighting presets taken from the game's light probes (read-only). */
  'env:list': [void, EnvironmentAreaView[]]
  'env:get': [{ area: string; time: number; probe: number }, EnvironmentView]
}
