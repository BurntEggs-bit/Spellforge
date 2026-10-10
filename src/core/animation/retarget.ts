/**
 * Retargeting: an animation made for one skeleton (an enemy's) played by
 * another (the player's).
 *
 * FromSoftware's humanoid rigs share bone names (Pelvis, Spine1, L_UpperArm,
 * R_Hand...) and their axis conventions: in the reference pose a player's
 * L_Calf and Margit's point the same way to within his bent knees. So for
 * each matched bone the player takes the source bone's world rotation
 * ("absolute": the same limb directions, the player's own bone lengths).
 * Bones whose conventions differ (the root bones; a bone more than 100
 * degrees off at rest) take the source's rotation relative to its reference
 * pose instead ("relative"), as can the spine, neck and head when the
 * player should keep standing upright rather than stoop like the enemy.
 *
 * Sizes: the body's height above the ground and the root motion (how far
 * the move carries the character) scale by the ratio of leg lengths, so the
 * feet stay on the ground. Mirroring swaps left and right (a move made
 * with the left hand, done with the right).
 */
import type { Bone } from '../formats/havok/skeleton.ts'
import { type Quat, type Vec3, qmul, qrot, qnorm, qinv, qangle } from '../math/quaternion.ts'

/** A rotation reflected across the plane x = 0 (the body's left-right mirror). */
function mirrorQ(q: ArrayLike<number>): Quat {
  return [q[0], -q[1], -q[2], q[3]]
}

/** "L_Hand" <-> "R_Hand"; names without a side stay. */
export function otherSide(name: string): string {
  if (/^L_/.test(name)) return `R_${name.slice(2)}`
  if (/^R_/.test(name)) return `L_${name.slice(2)}`
  if (/_L$/.test(name)) return `${name.slice(0, -2)}_R`
  if (/_R$/.test(name)) return `${name.slice(0, -2)}_L`
  return name
}

/** Parents before children. */
function order(bones: Bone[]): number[] {
  const out: number[] = []
  const done = new Set<number>()
  const visit = (i: number) => {
    if (done.has(i)) return
    const p = bones[i].parent
    if (p >= 0 && p !== i) visit(p)
    done.add(i)
    out.push(i)
  }
  bones.forEach((_, i) => visit(i))
  return out
}

/** World rotations and positions of a pose given as local transforms. */
function worlds(bones: Bone[], seq: number[], localR: Quat[], localT: Vec3[]): { R: Quat[]; P: Vec3[] } {
  const R: Quat[] = new Array(bones.length)
  const P: Vec3[] = new Array(bones.length)
  for (const i of seq) {
    const p = bones[i].parent
    if (p < 0) {
      R[i] = localR[i]
      P[i] = localT[i]
    } else {
      R[i] = qmul(R[p], localR[i])
      const o = qrot(R[p], localT[i])
      P[i] = [P[p][0] + o[0], P[p][1] + o[1], P[p][2] + o[2]]
    }
  }
  return { R, P }
}

function restWorlds(bones: Bone[], seq: number[]) {
  return worlds(
    bones,
    seq,
    bones.map((b) => qnorm(b.r)),
    bones.map((b) => [...b.t] as Vec3),
  )
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Length of a leg (thigh + calf), from bone positions at rest. */
function legLength(bones: Bone[], P: Vec3[]): number | null {
  const at = (n: string) => bones.findIndex((b) => b.name === n)
  for (const side of ['L_', 'R_']) {
    const t = at(`${side}Thigh`)
    const c = at(`${side}Calf`)
    const f = at(`${side}Foot`)
    if (t >= 0 && c >= 0 && f >= 0) return dist(P[t], P[c]) + dist(P[c], P[f])
  }
  return null
}

/** Bones that carry the character's position: the root of each rig, matched by role. */
const BODY_ROOT: Record<string, string[]> = { RootPos: ['RootPos', 'Root'] }
const POSTURE = new Set(['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'])

export interface RetargetOptions {
  /** Swap left and right (a move made with the left hand, for a right-handed weapon). */
  mirror: boolean
  /** Target size relative to the source (default: their leg lengths). */
  scale?: number
  /** How far the root motion carries the target, as a multiple of the scaled distance (1: in proportion). */
  travel?: number
  /** Keep the target's own upright spine, neck and head (copy the source's movement, not its stoop). */
  upright?: boolean
  /** Target bones to animate (tracks), by name; default: every matched bone. */
  trackNames?: string[]
}

export interface RetargetSource {
  bones: Bone[]
  frames: number
  frameDuration: number
  /** Bone of each track. */
  tracks: number[]
  /** [frame][track][tx ty tz rx ry rz rw sx sy sz] */
  data: Float32Array
  /** [frame][x y z yaw], or null. */
  root: Float32Array | null
}

export interface RetargetResult {
  frames: number
  frameDuration: number
  tracks: number[]
  data: Float32Array
  root: Float32Array | null
  scale: number
  /** Each target bone that follows a source bone. */
  matched: { target: string; source: string; mode: 'absolute' | 'relative' }[]
  /** Track bones nothing in the source drives (they keep their reference pose). */
  unmatched: string[]
}

/** Which source bone drives each target bone (by name; the player's RootPos follows a source's Root). */
function matchBones(src: Bone[], dst: Bone[]): Map<number, number> {
  const byName = new Map(src.map((b, i) => [b.name, i]))
  const out = new Map<number, number>()
  dst.forEach((b, d) => {
    for (const n of BODY_ROOT[b.name] ?? [b.name]) {
      const e = byName.get(n)
      if (e !== undefined) {
        out.set(d, e)
        break
      }
    }
  })
  return out
}

export function retarget(src: RetargetSource, dst: Bone[], opt: RetargetOptions): RetargetResult {
  const S = src.bones
  const sSeq = order(S)
  const dSeq = order(dst)
  const sRest = restWorlds(S, sSeq)
  const dRest = restWorlds(dst, dSeq)
  const legS = legLength(S, sRest.P)
  const legD = legLength(dst, dRest.P)
  const scale = opt.scale ?? (legS && legD ? legD / legS : 1)
  const travel = opt.travel ?? 1

  const match = matchBones(S, dst)
  // The root bone stays at rest: rigs use it differently (the player's turns
  // the upper body, RootPos undoing it below the waist; Margit's turns all of
  // him). Every bone below takes its world rotation from the source anyway.
  const masterD = dst.findIndex((b) => b.parent < 0)
  match.delete(masterD)
  const sByName = new Map(S.map((b, i) => [b.name, i]))
  // Mirroring: each source bone plays its other-side partner's motion, reflected.
  const partner = S.map((b, i) => (opt.mirror ? (sByName.get(otherSide(b.name)) ?? i) : i))
  const K: Quat[] = S.map((_, i) => (opt.mirror ? qmul(qinv(mirrorQ(sRest.R[partner[i]])), sRest.R[i]) : [0, 0, 0, 1]))

  // Per matched target bone: absolute or relative, and the fixed turn that goes with it.
  const C = new Map<number, Quat>()
  const matched: RetargetResult['matched'] = []
  for (const [d, e] of match) {
    const rel = qmul(qinv(sRest.R[e]), dRest.R[d])
    const isRoot = !!BODY_ROOT[dst[d].name]
    const relative = isRoot || (opt.upright && POSTURE.has(dst[d].name)) || qangle(sRest.R[e], dRest.R[d]) > 100
    C.set(d, relative ? rel : [0, 0, 0, 1])
    matched.push({ target: dst[d].name, source: S[e].name, mode: relative ? 'relative' : 'absolute' })
  }
  // The bone that carries the body's height and sway: the player's RootPos
  // (else the pelvis), driven by the source's Root (else its pelvis).
  let bodyRootD = dst.findIndex((b) => !!BODY_ROOT[b.name])
  if (bodyRootD < 0) bodyRootD = dst.findIndex((b) => b.name === 'Pelvis')
  const driverS = match.get(bodyRootD) ?? S.findIndex((b) => b.name === 'Pelvis')
  const masterS = S.findIndex((b) => b.parent < 0)

  const names = opt.trackNames ?? dst.filter((_, d) => match.has(d)).map((b) => b.name)
  const tracks = names.map((n) => dst.findIndex((b) => b.name === n)).filter((i) => i >= 0)
  const unmatched = tracks.filter((d) => !match.has(d)).map((d) => dst[d].name)

  const T = tracks.length
  const out = new Float32Array(src.frames * T * 10)
  const srcTrackOf = new Map(src.tracks.map((b, t) => [b, t]))
  const n = src.tracks.length
  const sLocalR0 = S.map((b) => qnorm(b.r))
  const sLocalT0 = S.map((b) => [...b.t] as Vec3)
  const dLocalR0 = dst.map((b) => qnorm(b.r))
  const dLocalT0 = dst.map((b) => [...b.t] as Vec3)

  // The source root bone's sideways place in the first frame (see the body root below).
  let masterOffset: Vec3 = [0, 0, 0]
  for (let f = 0; f < src.frames; f++) {
    // The source pose.
    const lr = sLocalR0.slice()
    const lt = sLocalT0.slice()
    for (const [b, t] of srcTrackOf) {
      const o = (f * n + t) * 10
      lt[b] = [src.data[o], src.data[o + 1], src.data[o + 2]]
      lr[b] = qnorm([src.data[o + 3], src.data[o + 4], src.data[o + 5], src.data[o + 6]])
    }
    const w = worlds(S, sSeq, lr, lt)
    // Mirrored: bone i does what its partner did, reflected.
    const sR: Quat[] = opt.mirror ? S.map((_, i) => qmul(mirrorQ(w.R[partner[i]]), K[i])) : w.R
    const sP: Vec3[] = opt.mirror ? S.map((_, i) => [-w.P[partner[i]][0], w.P[partner[i]][1], w.P[partner[i]][2]]) : w.P
    if (f === 0 && masterS >= 0) masterOffset = [sP[masterS][0], 0, sP[masterS][2]]

    // The target pose, parents first.
    const R: Quat[] = new Array(dst.length)
    const P: Vec3[] = new Array(dst.length)
    const LR: Quat[] = new Array(dst.length)
    const LT: Vec3[] = new Array(dst.length)
    for (const d of dSeq) {
      const p = dst[d].parent
      const pr: Quat = p >= 0 ? R[p] : [0, 0, 0, 1]
      const pp: Vec3 = p >= 0 ? P[p] : [0, 0, 0]
      const e = match.get(d)
      R[d] = e !== undefined ? qnorm(qmul(sR[e], C.get(d)!)) : qmul(pr, dLocalR0[d])
      if (d === bodyRootD && driverS >= 0) {
        // Where the source's body is in its model space, scaled: its root
        // bone's own movement included (part of a jump can be there rather
        // than in the root motion), less a constant sideways offset of the
        // root bone (Margit's rig stands 0.42 m off its origin at rest).
        const m = masterD >= 0 && P[masterD] ? P[masterD] : [0, 0, 0]
        const v = sP[driverS]
        P[d] = [m[0] + (v[0] - masterOffset[0]) * scale, m[1] + v[1] * scale, m[2] + (v[2] - masterOffset[2]) * scale]
      } else {
        const o = qrot(pr, dLocalT0[d])
        P[d] = [pp[0] + o[0], pp[1] + o[1], pp[2] + o[2]]
      }
      LR[d] = qnorm(qmul(qinv(pr), R[d]))
      LT[d] = qrot(qinv(pr), [P[d][0] - pp[0], P[d][1] - pp[1], P[d][2] - pp[2]])
    }
    for (let t = 0; t < T; t++) {
      const d = tracks[t]
      const o = (f * T + t) * 10
      out.set(LT[d], o)
      out.set(LR[d], o + 3)
      out.set(dst[d].s, o + 7)
    }
  }

  let root: Float32Array | null = null
  if (src.root) {
    root = new Float32Array(src.frames * 4)
    for (let f = 0; f < src.frames; f++) {
      const x = src.root[f * 4]
      const y = src.root[f * 4 + 1]
      const z = src.root[f * 4 + 2]
      const yaw = src.root[f * 4 + 3]
      root[f * 4] = (opt.mirror ? -x : x) * scale * travel
      root[f * 4 + 1] = y * scale
      root[f * 4 + 2] = z * scale * travel
      root[f * 4 + 3] = opt.mirror ? -yaw : yaw
    }
  }
  return { frames: src.frames, frameDuration: src.frameDuration, tracks, data: out, root, scale, matched, unmatched }
}
