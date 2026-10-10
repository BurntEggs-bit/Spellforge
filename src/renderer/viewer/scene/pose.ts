/**
 * Posing the character: its skeleton (one THREE.Bone per bone, bound at the
 * reference pose), the clip's bones at a time, root motion (with DS Anim
 * Studio's multipliers) and a combo's animations played one into the next.
 */
import * as THREE from 'three'
import type { ClipView, SkeletonView } from '../../../shared/api.ts'
import { base64Floats } from '../../lib/base64.ts'
import { FPS } from '../../../shared/frames.ts'
import type { HelperPrefs } from '../prefs.ts'
import type { ViewerState, Clip, Root, Segment } from './state.ts'

/** A clip from the main process with its tracks decoded. */
export function decodeClip(view: ClipView): Clip {
  return {
    view,
    data: base64Floats(view.data),
    root: view.root ? base64Floats(view.root) : null,
    hand: view.hand ? base64Floats(view.hand.data) : null,
  }
}

/** A clip's length in seconds (its last frame's time when it gives none). */
export function clipLength(view: ClipView): number {
  return view.duration || (view.frames - 1) * view.frameDuration
}

/** The skeleton's bones under the actor at their reference pose, and the reference matrices skins bind to. */
export function setupSkeleton(s: ViewerState, skel: SkeletonView): void {
  s.skel = skel
  s.bones = skel.bones.map((b) => {
    const o = new THREE.Bone()
    o.name = b.name
    o.position.set(b.t[0], b.t[1], b.t[2])
    o.quaternion.set(b.r[0], b.r[1], b.r[2], b.r[3])
    o.scale.set(b.s[0], b.s[1], b.s[2])
    return o
  })
  s.bones.forEach((o, i) => {
    const p = skel.bones[i].parent
    ;(p >= 0 ? s.bones[p] : s.actor).add(o)
  })
  s.refPose = s.bones.map((o) => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }))
  // Reference pose in actor space (bone world matrices with the actor's own world undone).
  s.actor.updateMatrixWorld(true)
  const toActor = s.actor.matrixWorld.clone().invert()
  s.ref = s.bones.map((o) => toActor.clone().multiply(o.matrixWorld))
  s.invRef = s.ref.map((m) => m.clone().invert())
  s.skeleton = new THREE.Skeleton(
    s.bones,
    s.invRef.map((m) => m.clone()),
  )
}

/** Back to the reference pose with no root motion (a new clip starts from it; the export's rest pose). */
export function resetPose(s: ViewerState): void {
  s.bones.forEach((o, i) => {
    const r = s.refPose[i]
    o.position.copy(r.p)
    o.quaternion.copy(r.q)
    o.scale.copy(r.s)
  })
  s.actor.position.set(0, 0, 0)
  s.actor.rotation.set(0, 0, 0)
}

const qa = new THREE.Quaternion()
const qb = new THREE.Quaternion()

/** The bones of a clip at a time (the category's hand grip first, then the animation). */
function poseBones(s: ViewerState, c: Clip, time: number): void {
  const v = c.view
  const n = v.tracks.length
  const f = Math.max(0, Math.min(v.frames - 1, time / v.frameDuration))
  const f0 = Math.floor(f)
  const f1 = Math.min(v.frames - 1, f0 + 1)
  const a = f - f0
  // Grip pose for the fingers (the animation overrides any bone it has).
  if (c.hand && v.hand) {
    const hd = c.hand
    v.hand.tracks.forEach((b, i) => {
      const bone = s.bones[b]
      if (!bone) return
      const o = i * 10
      bone.position.set(hd[o], hd[o + 1], hd[o + 2])
      bone.quaternion.set(hd[o + 3], hd[o + 4], hd[o + 5], hd[o + 6])
      bone.scale.set(hd[o + 7], hd[o + 8], hd[o + 9])
    })
  }
  const d = c.data
  for (let i = 0; i < n; i++) {
    const bone = s.bones[v.tracks[i]]
    if (!bone) continue
    const o0 = (f0 * n + i) * 10
    const o1 = (f1 * n + i) * 10
    bone.position.set(
      d[o0] + (d[o1] - d[o0]) * a,
      d[o0 + 1] + (d[o1 + 1] - d[o0 + 1]) * a,
      d[o0 + 2] + (d[o1 + 2] - d[o0 + 2]) * a,
    )
    qa.set(d[o0 + 3], d[o0 + 4], d[o0 + 5], d[o0 + 6])
    qb.set(d[o1 + 3], d[o1 + 4], d[o1 + 5], d[o1 + 6])
    bone.quaternion.slerpQuaternions(qa, qb, a)
    bone.scale.set(
      d[o0 + 7] + (d[o1 + 7] - d[o0 + 7]) * a,
      d[o0 + 8] + (d[o1 + 8] - d[o0 + 8]) * a,
      d[o0 + 9] + (d[o1 + 9] - d[o0 + 9]) * a,
    )
  }
}

/** A clip's root motion at a time, with DS Anim Studio's multipliers (along the ground, up and down, turning); null without root motion. */
export function rootAt(c: Clip, time: number, h: HelperPrefs): Root | null {
  if (!c.root) return null
  const v = c.view
  const f = Math.max(0, Math.min(v.frames - 1, time / v.frameDuration))
  const f0 = Math.floor(f)
  const f1 = Math.min(v.frames - 1, f0 + 1)
  const a = f - f0
  const r = c.root
  const at = (k: number) => r[f0 * 4 + k] + (r[f1 * 4 + k] - r[f0 * 4 + k]) * a
  const sxz = h.rootScaleXZ ?? 1
  return { x: at(0) * sxz, y: at(1) * (h.rootScaleY ?? 1), z: at(2) * sxz, yaw: at(3) * (h.rootRotation ?? 1) }
}

/** Which segment plays at a time on the combo's clock (the last one runs to its end). */
export function segmentAt(segs: Segment[], time: number): number {
  for (let i = 0; i < segs.length - 1; i++) if (time < segs[i + 1].t0) return i
  return segs.length - 1
}

/**
 * Where the character stands at a time (actor space): one clip's root
 * motion, or a combo's, each animation carrying on from where the one
 * before was cut (its root motion turned to face the same way).
 */
function rootWorldAt(s: ViewerState, time: number, h: HelperPrefs): Root {
  const segs = s.segments
  if (!segs?.length) return (s.clip && h.rootMotion ? rootAt(s.clip, time, h) : null) ?? { x: 0, y: 0, z: 0, yaw: 0 }
  if (!h.rootMotion) return { x: 0, y: 0, z: 0, yaw: 0 }
  const k = segmentAt(segs, time)
  // Where segment k starts: the first plays as it is; each next one starts where the last was cut.
  let base: Root = rootAt(segs[0].clip, segs[0].from, h) ?? { x: 0, y: 0, z: 0, yaw: 0 }
  for (let i = 0; i <= k; i++) {
    const g = segs[i]
    const start = rootAt(g.clip, g.from, h) ?? { x: 0, y: 0, z: 0, yaw: 0 }
    const t = i === k ? Math.min(g.to, g.from + Math.max(0, time - g.t0)) : g.to
    const r = rootAt(g.clip, t, h) ?? start
    const turn = base.yaw - start.yaw
    const dx = r.x - start.x
    const dz = r.z - start.z
    const cs = Math.cos(turn)
    const sn = Math.sin(turn)
    const at = {
      x: base.x + dx * cs + dz * sn,
      y: base.y + (r.y - start.y),
      z: base.z - dx * sn + dz * cs,
      yaw: base.yaw + (r.yaw - start.yaw),
    }
    if (i === k) return at
    base = at
  }
  return base
}

/** How long blending into the next animation of a combo takes (seconds). */
const COMBO_BLEND = 0.1

/** The bones' pose now, kept to blend from. */
function capturePose(s: ViewerState): { p: Float32Array; q: Float32Array; s: Float32Array } {
  const n = s.bones.length
  const out = { p: new Float32Array(n * 3), q: new Float32Array(n * 4), s: new Float32Array(n * 3) }
  s.bones.forEach((b, i) => {
    b.position.toArray(out.p, i * 3)
    b.quaternion.toArray(out.q, i * 4)
    b.scale.toArray(out.s, i * 3)
  })
  return out
}

const blendP = new THREE.Vector3()
const blendQ = new THREE.Quaternion()

/** Poses the character at a time: the clip's (or the combo's) bones, then where root motion puts it. */
export function pose(s: ViewerState, time: number, h: HelperPrefs): void {
  const segs = s.segments
  if (segs?.length && s.bones.length) {
    const k = segmentAt(segs, time)
    const g = segs[k]
    const into = time - g.t0
    // Blending from the animation before: its pose where it was cut, kept once.
    const blending = k > 0 && into < COMBO_BLEND
    if (blending && !segs[k - 1].frozen) {
      poseBones(s, segs[k - 1].clip, segs[k - 1].to)
      segs[k - 1].frozen = capturePose(s)
    }
    poseBones(s, g.clip, Math.min(g.to, g.from + Math.max(0, into)))
    if (blending) {
      const fz = segs[k - 1].frozen!
      const w = Math.max(0, into) / COMBO_BLEND
      s.bones.forEach((b, i) => {
        b.position.copy(blendP.fromArray(fz.p, i * 3).lerp(b.position, w))
        b.quaternion.copy(blendQ.fromArray(fz.q, i * 4).slerp(b.quaternion, w))
        b.scale.copy(blendP.fromArray(fz.s, i * 3).lerp(b.scale, w))
      })
    }
  } else {
    const c = s.clip
    if (!c || !s.bones.length) return
    poseBones(s, c, time)
  }
  const r = rootWorldAt(s, time, h)
  s.actor.position.set(r.x, r.y, r.z)
  s.actor.rotation.set(0, r.yaw, 0)
  s.actor.updateMatrixWorld(true)
}

/** The root motion's path as the trail line, sampled every frame. */
export function buildTrail(s: ViewerState, h: HelperPrefs): void {
  const g = new THREE.BufferGeometry()
  const end = s.segments?.length
    ? s.segments[s.segments.length - 1].t0 +
      (s.segments[s.segments.length - 1].to - s.segments[s.segments.length - 1].from)
    : s.clip
      ? clipLength(s.clip.view)
      : 0
  if (s.clip?.root || s.segments?.some((x) => x.clip.root)) {
    const pts: number[] = []
    for (let t = 0; t <= end + 1e-6; t += 1 / FPS) {
      const r = rootWorldAt(s, t, h)
      pts.push(r.x, r.y + 0.01, r.z)
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
  }
  s.trail.geometry.dispose()
  s.trail.geometry = g
}
