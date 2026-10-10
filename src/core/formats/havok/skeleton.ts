/** A Havok skeleton (hkaSkeleton): its bones, their parents and the reference pose. */
import { itemsOfType } from './objects.ts'
import type { Tagfile } from './tagfile.ts'

export interface Bone {
  name: string
  parent: number
  /** Reference pose, local to the parent: translation, rotation (x, y, z, w), scale. */
  t: [number, number, number]
  r: [number, number, number, number]
  s: [number, number, number]
}

export function readSkeleton(tf: Tagfile): Bone[] {
  const sk = itemsOfType(tf, 'hkaSkeleton')[0]?.value
  if (!sk) throw new Error('No hkaSkeleton in this file')
  const bones = sk.bones as { name: string }[]
  const parents = sk.parentIndices as Int16Array
  const pose = sk.referencePose as
    { translation: Float32Array; rotation: { vec: Float32Array }; scale: Float32Array }[] | Float32Array
  return bones.map((b, i) => {
    // hkQsTransform is 12 floats: translation, rotation, scale (each padded to 4).
    const q = qsAt(pose, i)
    return {
      name: b.name,
      parent: parents[i],
      t: [q[0], q[1], q[2]],
      r: [q[4], q[5], q[6], q[7]],
      s: [q[8], q[9], q[10]],
    }
  })
}
function qsAt(pose: unknown, i: number): number[] {
  if (pose instanceof Float32Array) return Array.from(pose.subarray(i * 12, i * 12 + 12))
  const p = (
    pose as { translation: Float32Array; rotation: { vec: Float32Array } | Float32Array; scale: Float32Array }[]
  )[i]
  const rot = p.rotation instanceof Float32Array ? p.rotation : p.rotation.vec
  return [...p.translation, ...rot, ...p.scale]
}
