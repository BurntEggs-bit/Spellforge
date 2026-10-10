/**
 * The viewer's export (DS Anim Studio's "Export skeleton & animations"):
 * the character and its animation as a binary glTF for Blender and other tools.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors): the export follows
 * its "Export skeleton & animations".
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { HelperPrefs } from './prefs.ts'
import { clipLength, pose, resetPose, rootAt } from './scene/pose.ts'
import type { ViewerState } from './scene/state.ts'

/** What the viewport can export (DS Anim Studio's "Export skeleton & animations"). */
export interface ViewportExport {
  /** The character as a binary glTF (.glb): model, skeleton and the animation playing; or only the skeleton and animation. */
  glb(what: 'model' | 'skeleton'): Promise<{ name: string; data: ArrayBuffer }>
}

/**
 * The character as glTF (binary .glb), for Blender and other tools: a copy
 * of its skeleton (and, for 'model', its skinned armour and held weapons
 * with their textures) under a root mirrored on X (the game's data is
 * left-handed, glTF right-handed, as the viewport shows it), with the
 * animation playing (one clip: every bone's track at every frame, plus the
 * root motion on the character).
 */
export async function exportGlb(
  s: ViewerState,
  what: 'model' | 'skeleton',
  h: HelperPrefs,
): Promise<{ name: string; data: ArrayBuffer }> {
  const c = s.clip
  if (!c || !s.bones.length) throw new Error('Pick an animation to export first')
  // The pose the animation starts in, so the copy's rest matches the file's bind pose.
  resetPose(s)
  s.actor.updateMatrixWorld(true)
  const copy = cloneSkinned(s.actor) as THREE.Group
  pose(s, s.time, h)
  copy.name = 'c0000'
  copy.position.set(0, 0, 0)
  copy.rotation.set(0, 0, 0)
  if (what === 'skeleton') {
    const drop: THREE.Object3D[] = []
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) drop.push(o)
    })
    for (const o of drop) o.parent?.remove(o)
  }
  const root = new THREE.Group()
  root.name = 'Spellforge export (mirrored to right-handed)'
  root.scale.set(-1, 1, 1)
  root.add(copy)

  const v = c.view
  const n = v.tracks.length
  const times = Float32Array.from({ length: v.frames }, (_, f) => f * v.frameDuration)
  const tracks: THREE.KeyframeTrack[] = []
  const d = c.data
  for (let i = 0; i < n; i++) {
    const bone = s.bones[v.tracks[i]]
    if (!bone) continue
    const pos = new Float32Array(v.frames * 3)
    const rot = new Float32Array(v.frames * 4)
    const scl = new Float32Array(v.frames * 3)
    for (let f = 0; f < v.frames; f++) {
      const o = (f * n + i) * 10
      pos.set([d[o], d[o + 1], d[o + 2]], f * 3)
      rot.set([d[o + 3], d[o + 4], d[o + 5], d[o + 6]], f * 4)
      scl.set([d[o + 7], d[o + 8], d[o + 9]], f * 3)
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, times, pos))
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, rot))
    tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.scale`, times, scl))
  }
  if (c.root && h.rootMotion) {
    const pos = new Float32Array(v.frames * 3)
    const rot = new Float32Array(v.frames * 4)
    const q = new THREE.Quaternion()
    for (let f = 0; f < v.frames; f++) {
      const r = rootAt(c, f * v.frameDuration, h)
      if (!r) continue
      pos.set([r.x, r.y, r.z], f * 3)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw)
      rot.set([q.x, q.y, q.z, q.w], f * 4)
    }
    tracks.push(new THREE.VectorKeyframeTrack('c0000.position', times, pos))
    tracks.push(new THREE.QuaternionKeyframeTrack('c0000.quaternion', times, rot))
  }
  const name = v.animation
  const clip = new THREE.AnimationClip(name, clipLength(v), tracks)
  const data = (await new GLTFExporter().parseAsync(root, {
    binary: true,
    animations: [clip],
    onlyVisible: false,
  })) as ArrayBuffer
  return { name: `${name}${what === 'skeleton' ? ' skeleton' : ''}.glb`, data }
}
