/** IPC contract: the character viewer: skeleton, clips, equipment, what a move does (simulation) and its sounds. */
import type { RetargetRequest } from './enemies.ts'

export interface SkeletonView {
  bones: { name: string; parent: number; t: number[]; r: number[]; s: number[] }[]
}

/** A decoded animation, every frame pre-sampled. Arrays are base64 little-endian. */
export interface ClipView {
  animation: string
  /** The .hkx actually played (another animation's, for references). */
  hkx: string
  binder: string
  frames: number
  frameDuration: number
  duration: number
  /** Skeleton bone per track. */
  tracks: number[]
  /** Float32 [frame][track][tx ty tz rx ry rz rw sx sy sz] */
  data: string
  /** Float32 [frame][x y z yaw], or null without root motion. */
  root: string | null
  /**
   * The category's hand grip pose (aXXX_000009): the fingers, which attack
   * animations leave out. Applied first, under the animation.
   */
  hand: { hkx: string; tracks: number[]; data: string } | null
}

export interface DummyView {
  id: number
  position: number[]
  forward: number[]
  up: number[]
  /** Skeleton bone the dummy rides on (-1: model root). */
  bone: number
  /** Position/axes are relative to this skeleton bone's reference pose (-1: model
   *  space; -2: the rigid part's own space, which rides directly on `bone`). */
  space: number
}

export interface PartMeshView {
  /** Float32 xyz */
  positions: string
  normals: string | null
  /** Float32 uv */
  uvs: string | null
  /** Uint32 triangle list */
  indices: string
  /** Uint16 x4 skeleton bones, Float32 x4 weights (skinned meshes) */
  skinIndex: string | null
  skinWeight: string | null
  /** Rigid meshes: the skeleton bone they ride on. */
  bone: number
  /** Weapons: the weapon's own bone the mesh hangs on (moved by WeaponAnimView clips). */
  ownBone?: string | null
  albedo: string | null
  normalMap: string | null
  /** G roughness, B metalness (three.js packing). */
  ormMap: string | null
  alphaTest: boolean
  material: string
}

/** A weapon model's own clips (a katana's scabbard showing and hiding), sampled like ClipView. */
export interface WeaponAnimView {
  /** Bone names of the weapon's skeleton (tracks index into these). */
  bones: string[]
  clips: Record<
    string,
    {
      frames: number
      frameDuration: number
      tracks: number[]
      /** Float32 [frame][track][tx ty tz rx ry rz rw sx sy sz] */ data: string
    }
  >
}

/**
 * Where the game puts each of a weapon's models (WepAbsorpPosParam): body
 * dummy poly ids, with 2000 added for points on the hip (2069 is dummy 69).
 */
export interface WeaponPlacement {
  /** The WepAbsorpPosParam row. */
  row: number
  slots: {
    right: number
    left: number
    both: number
    leftBoth: number
    rightHang: number
    leftHang: number
    invisible: number
  }[]
  /** Its passive effects hide it in game (Unseen Blade's state, always on): its model doesn't show, its hits do. */
  hidden?: boolean
}

export interface PartView {
  name: string
  meshes: PartMeshView[]
  /** Weapons with clips of their own: the default pose is a999_000000. */
  weaponAnim?: WeaponAnimView
  /** PNG data URLs by texture name. */
  textures: Record<string, string>
  dummies: DummyView[]
  /** FLVER bones (for bone helpers): name, parent and the skeleton bone each follows. */
  bones: {
    name: string
    parent: number
    skeletonBone: number
    /** Not in the skeleton: moves with its nearest skeleton ancestor. */
    glued: boolean
    /** Bind pose in model space (column-major 4x4). */
    bind: number[]
    /** Its bounding box in its own space: min x y z, max x y z. */
    box?: number[]
  }[]
  /** How many models the parts file holds (a weapon with a scabbard or a pair has 2). */
  models?: number
}

export interface EquipChoice {
  id: number
  name: string
  /** Part file, e.g. bd_m_1810 (null when the model file is missing). */
  part: string | null
  /** Added or changed by this project (listed first). */
  project: boolean
  /** The model comes from the project's own parts folder. */
  customModel: boolean
  /** Weapons: greases and buff spells can be used on it in game (Is Buffable). */
  buffable?: boolean
}

export interface EquipmentLists {
  head: EquipChoice[]
  body: EquipChoice[]
  arms: EquipChoice[]
  legs: EquipChoice[]
  weapons: EquipChoice[]
  /** Items and spells that coat a weapon (greases, Electrify Armament…): previewed on the held weapons. */
  buffs: BuffChoice[]
  /** The bare head's parts by kind (face, eyes and mouth, hair, eyebrows, beard, eyelashes, accessories): part file names. */
  faceParts?: FacePartGroup[]
}

export interface FacePartGroup {
  /** "face", "hair", "fg20"… */
  key: string
  label: string
  parts: string[]
}

export interface BuffChoice {
  /** EquipParamGoods id, or Magic id for a spell. */
  id: number
  name: string
  project: boolean
  /** A spell that buffs the weapon (Electrify Armament, Bloodflame Blade…), not an item. */
  spell?: boolean
}

/**
 * A weapon buff's coating on one held weapon: the effect for that weapon's
 * blade size, along each group of dummy polys (300, 301, 302…; 310… for a
 * second blade), which run up the blade. The game coats the whole line from
 * a group's first point to its last, not just the points.
 */
export interface BuffRun {
  effectId: number
  /** First dummy poly of each group on that weapon model (300 for 10300, 20300 or 11300). */
  groups: number[]
  /** Each group's last dummy poly (enchantEndDmyId), or -1: as far as the numbers run on (301, 302…). */
  ends?: number[]
  source: DummySource
}

/**
 * The model a dummy poly is on: the character's own, a hand's weapon, or that
 * weapon's second model (`:1`: the other blade of a pair, its scabbard).
 */
export type DummySource = 'body' | 'right' | 'left' | 'right:1' | 'left:1'

/** One attack hit: a sphere at a dummy poly, or a capsule between two. */
export interface SimHit {
  dummy1: number
  dummy2: number
  radius: number
  source: DummySource
  /** Which of the attack's hit shapes (hit0…hit15). */
  slot?: number
}

export interface SimBullet {
  id: number
  name: string
  dummy: number
  source: DummySource
  /** m/s; acceleration m/s²; max speed (0: none). */
  speed: number
  accel: number
  maxSpeed: number
  /** Seconds alive (from life, else distance / speed). */
  life: number
  gravity: number
  radius: number
  radiusMax: number
  spreadTime: number
  count: number
  /**
   * Degrees: side aim (positive to the left), the side step between shots,
   * up aim (from level) and the up step between shots. Shot k aims at
   * angle + k × angleInterval: the game doesn't centre a spread, its rows do
   * (Flaming Strike: -90 + k × 36).
   */
  angle: number
  angleInterval: number
  angleX: number
  angleXInterval: number
  /** Random spread, degrees: side to side and up and down (shootAngleYMaxRandom, shootAngleXMaxRandom). */
  randomYaw: number
  randomPitch: number
  /** A later stage aimed from the character's facing instead of its parent's flight (isOwnerOverrideInitAngle). */
  ownerAngle: boolean
  /** Goes through the ground instead of ending on it (isPenetrateMap). */
  penetrateMap: boolean
  effect: number
  attack: number | null
  hits: SimHit[]
  /** Effect played where it hits or ends. */
  hitEffect: number
  /** Bullet spawned where it hits or ends (the next stage of a chain), or -1. */
  hitBullet: number
  /** Bullets it emits while flying, and when (seconds), or -1. */
  intervalBullet: number
  intervalMin: number
  intervalMax: number
  intervalWait: number
  /** Speed floor (m/s; 0 = none). */
  minSpeed: number
  /** Turning toward the target, degrees per second (0 = none). */
  homingAngle: number
  /** Homes without a lock-on. */
  autoHoming: boolean
  /** Stops homing this close to the target. */
  homingStop: number
  /** EmittePosType: 0 default (dummy poly), 5 parent bullet, others target-relative. */
  emitPos: number
  /** The child takes over this bullet's effect (one continuous effect) / speed. */
  inheritSfx: boolean
  inheritSpeed: boolean
  /** When the next stage spawns (0 always, 1/2 water, 3 missed, 4 hit enemy, 254 expired, 255 ground or enemy). */
  launchCondition: number
  /** Seconds between shots while an event that keeps firing lasts (shootInterval; 0: once). */
  shootInterval: number
}

/** An animation event acted out in the viewport. */
export interface SimAction {
  event: number
  kind: 'attack' | 'common' | 'pc' | 'throw' | 'bullet' | 'speffect' | 'ffx' | 'sound'
  start: number
  end: number
  /** Short line for the active-events list, e.g. "AtkParam 1001003, 2 hits". */
  label: string
  /** The behaviour row it resolved to (for links), if any. */
  behavior: number | null
  /** The attack row its hits come from (attacks). */
  attack?: number
  hits: SimHit[]
  bullet: SimBullet | null
  /**
   * Fired again every `bullet.shootInterval` seconds while the event lasts: a
   * spell's cast event that keeps firing (CastHighlightedMagic's flag at @4),
   * like Comet Azur's beam.
   */
  repeat?: boolean
  /** Every bullet the chain can reach (the bullet, its hit and interval bullets, theirs…), by id. */
  bulletTable: Record<string, SimBullet>
  /**
   * FFX events: the effect and where it spawns. `slot`: the event's SlotID
   * when it has one (>= 0); a character holds one effect per slot, so an
   * effect spawned into a slot another still holds ends that one.
   */
  effect: { id: number; dummy: number; source: DummySource; follow: boolean; slot?: number } | null
  /** Sound events: the sound and the dummy poly it plays at (-1: the body). */
  sound?: { id: number; type: number; name: string | null; dummy: number; source: DummySource }
  /** Why it couldn't be resolved, if it couldn't. */
  note?: string
}

/**
 * Entire spell: a spell cast from start to finish in the viewer, with every
 * bullet and effect it has. Its cast animations are its category's (400 +
 * Magic refType), right hand, in the order the behaviour graph plays them:
 * launch (045000, until its jump table 93 hands over to the cast), the cast
 * (045010), the held loop (045012) and its release (045011) for spells held
 * like Comet Azur, else the quick cast (045011), then the chained 2nd and 3rd
 * casts (045020, 045030).
 */
export interface EntireSpellPlan {
  spell: number
  name: string
  /** Each cast animation, cut `to` seconds in (null: to its end), and what it is ("launch", "cast", "held"…). */
  steps: { animation: string; to: number | null; what: string }[]
  /** What it's cast with in the right hand: the weapon held if it casts this kind of spell, else a staff or a seal. */
  catalyst: { id: number; name: string } | null
}

/** A character's hit capsule (NpcParam hitRadius / hitHeight; the player's is the "Human" row's). */
export interface CapsuleView {
  radius: number
  height: number
}

/**
 * A TAE sound event's audio, for the viewer: the Wwise event the game
 * posts, what it plays, and each sound as a file a browser plays.
 */

/**
 * Where a TAE sound event's sound is: the player's banks (it plays in game),
 * only a character's own (cs_cXXXX, loaded near that character: it doesn't
 * play on the player until it's brought into the player's bank), or none.
 */
export interface SoundPlaceView {
  where: 'player' | 'character' | 'none'
  /** The Wwise event (Play_c213006500). */
  name: string | null
  bank?: string
  chr?: string
  /** The character's name, for a character's. */
  owner?: string
}

export interface SoundClip {
  /** The Wwise event (Play_c…) and the bank it's in; null when no bank the character or the player loads has it. */
  event: string | null
  bank: string | null
  /** Each sound, Ogg Vorbis (converted from Wwise's .wem), base64, by media id. */
  audio: Record<number, string>
  /**
   * The choices the game picks between (a random container's sounds), with
   * their weights; each is sounds that play together, each with its loudness
   * (dB) and pitch (cents) from the bank.
   */
  choices: { media: number; volume: number; pitch: number }[][]
  weights: number[]
  /** Why nothing (or not all of it) plays. */
  note?: string
}

/** The character channels: request and response of each. */
export interface CharacterChannels {
  /** The player skeleton (Skeleton.hkx reference pose), or another character's (`chr`, e.g. c2130). */
  'char:skeleton': [{ chr?: string } | void, SkeletonView]
  /**
   * Decodes the motion an animation plays: the player's, another character's
   * (`chr`), or another character's played by the player (`retarget`).
   */
  'char:clip': [{ animation: string; chr?: string; retarget?: RetargetRequest }, ClipView]
  /** An equipment model; rigid parts (weapons) ride on `attach` (default R_Weapon). */
  'char:part': [{ part: string; attach?: string; female?: boolean; model?: number }, PartView]
  /** Where the game hangs a weapon's models (WepAbsorpPosParam), or null. */
  'char:placement': [{ weapon: number }, WeaponPlacement | null]
  /** The character's hit capsule (the player's: NpcParam 1, "Human"). */
  'char:capsule': [{ chr?: string } | void, CapsuleView]
  /** A TAE sound event's audio (sound type and id), from `chr`'s banks or the player's. */
  'sound:clip': [{ chr: string; type: number; id: number }, SoundClip]
  'sound:place': [{ type: number; id: number }, SoundPlaceView]
  'sound:bring': [{ type: number; id: number }, { name: string; copied: number; mediaBytes: number }]
  /**
   * The body's own model (c0000.chrbnd): dummy polys for effects, hitboxes
   * and weapons. For another character (`chr`), its whole model.
   */
  'char:body': [{ chr?: string } | void, PartView]
  /** The coating effects an item puts on the held weapons. */
  'char:buff': [{ goods?: number; spell?: number; right: number | null; left: number | null }, BuffRun[]]
  /** The looks the held weapons carry themselves (a Passive SpEffect cycling one with a weapon buff's look). */
  'char:ownLooks': [{ right: number | null; left: number | null }, BuffRun[]]
  'char:equipment': [{ female: boolean }, EquipmentLists]
  /**
   * What an animation's behaviour, bullet, SpEffect and effect events do, for
   * the weapons held; for another character (`chr`), through its own
   * behavior rows (NpcParam `variation`). With `spell` (a Magic row), its cast
   * events fire that spell's bullets and show its effects (Entire spell).
   */
  'char:actions': [
    { animation: string; right: number | null; left: number | null; chr?: string; variation?: number; spell?: number },
    SimAction[],
  ]
  /** Entire spell: a spell's cast animations in the order the game plays them, and what to hold. */
  'spell:entire': [{ spell: number; right: number | null }, EntireSpellPlan]
  /** The spells cast with a category's animations (category 400 + their refType). */
  'spell:forCategory': [{ category: number }, { id: number; name: string }[]]
}
