/**
 * The effect engine's scene units and gains: how FXR colours map into the
 * scene, matched to the game by eye (see each), shared by the effect preview
 * and the character viewer.
 */

/** Effect lights the preview shows at once: a fixed set of point lights, so shaders never recompile mid-play. */
export const MAX_LIGHTS = 4

/** Ground height: effects are previewed at roughly chest height. */
export const GROUND_Y = -1.2

/**
 * FXR colours are far brighter than the scene (fire cores are ~20-90,
 * flashes several hundred, lit smoke ~5). This maps them into scene units so
 * a colour of ~20 reads as a bright core, lit smoke as mid-grey by day.
 */
export const FX_EXPOSURE = 0.05

/**
 * Effect exposure now: FX_EXPOSURE times the eye adaptation relative to
 * daylight. The game exposes effects together with the rest of the frame, so
 * at night or in caves (darker probes) they get brighter just like the scene.
 * Without this, dark-coloured effects (a deep red recolour) vanish at night
 * though they glow in game. Each viewport sets it from its lighting.
 */
export const fxExposure = { value: FX_EXPOSURE }

/** Additive alpha above 1 brightens, up to this factor (see FRAGMENT). */
export const FX_ALPHA_BOOST = 4

/**
 * Extra brightness for additive (glowing) particles and models: the "Glow"
 * slider in the preview and the animation viewport. No single value matches
 * every effect against the game (a deep red Bloody Rings wants ~4x, Rock
 * Sling and lightning spears blow out above ~1x), so it's the user's call,
 * remembered per machine and shared by both views.
 */
export const FX_ADDITIVE_GAIN = 1

/**
 * Glowing models (MATBIN GXFT_Emissive, e.g. Glintstone crystals): glow
 * colour x particle colour, in effect-colour units. By eye: a Glintstone
 * Pebble crystal reads as a bright self-lit shard by day.
 */
export const FX_GLOW_GAIN = 20

/** Effect lights are stronger than their colour suggests: fire spells visibly light the ground. */
export const FX_LIGHT_GAIN = 3

/** Extra bloom from FXR bloomColor (rgb x alpha, typically 0.05-0.1). */
export const FX_BLOOM_GAIN = 10
