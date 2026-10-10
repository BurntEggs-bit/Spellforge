/** The character viewer's scene state and the shapes its helpers share. */
import type * as THREE from 'three'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import type { BuffRun, CapsuleView, ClipView, PartView, SimAction, SkeletonView } from '../../../shared/api.ts'
import type { BulletRun } from '../sim/bullets.ts'
import type { FxManager } from '../../fx/fxruns.ts'
import type { LightingPrefs } from '../prefs.ts'

/**
 * The viewer's scene and what plays in it, shared by the render loop, the
 * loaders and the scene helpers (posing, parts, overlays, simulation).
 */
export interface ViewerState {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** The orbit camera: yaw and pitch (radians), distance (m), and the point it looks at (scene space). */
  orbit: { yaw: number; pitch: number; dist: number; target: THREE.Vector3 }
  setLighting: (l: LightingPrefs) => void
  /** The character's space, mirrored on X: the game's data is left-handed (see the scene setup). */
  world: THREE.Group
  /** The character, moved by root motion; the skeleton's root bones hang off it. */
  actor: THREE.Group
  bones: THREE.Bone[]
  skeleton: THREE.Skeleton | null
  skel: SkeletonView | null
  /** Each bone's reference pose in actor space, and its inverse. */
  ref: THREE.Matrix4[]
  invRef: THREE.Matrix4[]
  refPose: { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[]
  /** Equipment models by slot ('head'…'left', 'face:hair', 'right:1' for a weapon's second model). */
  parts: Map<string, LoadedPart>
  /** The character's own model (the player's body, or another character's whole model). */
  body: LoadedPart | null
  clip: Clip | null
  /** A combo (F8): its animations one after another; null for one animation. */
  segments: Segment[] | null
  helperLines: LineSegments2
  trail: THREE.Line
  /** The playhead, for the simulation and the overlays. */
  time: number
  actions: SimAction[]
  /** Weapon buff coatings on the held weapons. */
  buffs: BuffRun[]
  fx: FxManager
  bullets: BulletRun[]
  /** Stand-in targets for homing bullets (character space). */
  targets: THREE.Vector3[]
  /** The bullets and effects need working out again (new events, equipment, root motion). */
  runsDirty: boolean
  /** The character's hit capsule (NpcParam). */
  capsule: CapsuleView | null
  /** How far the animation's hitboxes reach from where it starts, and the farthest point (world group space). */
  reach: { dist: number; point: THREE.Vector3 } | null
}

/** A loaded animation clip: its view and decoded tracks (10 floats a bone a frame), root motion and hand grip. */
export interface Clip {
  view: ClipView
  data: Float32Array
  root: Float32Array | null
  hand: Float32Array | null
}

/** Root motion at a time: where the character stands (actor space) and its turn about Y. */
export type Root = { x: number; y: number; z: number; yaw: number }

/**
 * One animation of a combo (F8): when it starts on the combo's clock, which
 * part of its clip plays (from, to: seconds), and its pose where it was cut,
 * kept for blending into the next.
 */
export interface Segment {
  clip: Clip
  t0: number
  from: number
  to: number
  frozen: { p: Float32Array; q: Float32Array; s: Float32Array } | null
}

/** A model in the scene: the body or a piece of equipment. */
export interface LoadedPart {
  slot: string
  view: PartView
  objects: THREE.Object3D[]
  /** Rides on one bone (weapons) rather than skinned to the skeleton. */
  rigid: boolean
  dummyFrames: THREE.Matrix4[]
  binds: THREE.Matrix4[]
  /** Weapon meshes on the weapon's own bones, posed by its own clips (see poseWeapon). */
  posed: { mesh: THREE.Object3D; bone: string; flip: THREE.Matrix4 }[]
  weaponClips: {
    bones: string[]
    clips: Map<string, { frames: number; frameDuration: number; tracks: number[]; data: Float32Array }>
  } | null
}

/** A text label drawn over the scene at a point. */
export interface Overlay {
  label: string
  pos: THREE.Vector3
  color: string
}
