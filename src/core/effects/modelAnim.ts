/**
 * Animated effect models. A RichModel/Model action can name an `anibnd`
 * (sfx/hkx/sNNNNN.anibnd inside the effect bundle) and an `animation`: the
 * model is skinned to that binder's skeleton and plays the clip, e.g. Agheel's
 * and Ekzyke's dragon heads (s88681 + s88680 a000_000301), whose rest pose is
 * folded up and only opens its jaw and neck through the animation.
 *
 *   sNNNNN_skeleton.hkx        the skeleton (Havok 2018 tagfile)
 *   sNNNNN_aXXX_YYYYYY.hkx     clips; animation id = XXX * 1,000,000 + YYYYYY
 */
import { entryFileName, readBnd4 } from '../formats/bnd4.ts'
import { readFlver } from '../formats/flver.ts'
import { readTagfile } from '../formats/havok/tagfile.ts'
import { readAnimation } from '../formats/havok/animation.ts'
import { readSkeleton, type Bone } from '../formats/havok/skeleton.ts'
import { sampleClip, type SampledClip } from '../animation/character.ts'

export interface ModelRig {
  skeleton: Bone[]
  clip: SampledClip
  /** Per FLVER mesh: four skeleton bone indices and weights per vertex (null = not skinned). */
  meshes: ({ skinIndex: Uint16Array; skinWeight: Float32Array } | null)[]
}

function animationFileName(anibnd: number, animation: number): string {
  const cat = Math.floor(animation / 1_000_000)
  const sub = animation % 1_000_000
  return `s${String(anibnd).padStart(5, '0')}_a${String(cat).padStart(3, '0')}_${String(sub).padStart(6, '0')}.hkx`
}

/**
 * Skeleton, sampled clip and skinning for a model and its animation. Null when
 * the binder, skeleton or clip is missing or unreadable.
 */
export function readModelRig(
  flverData: Buffer,
  anibndData: Buffer,
  anibnd: number,
  animation: number,
): ModelRig | null {
  try {
    const bnd = readBnd4(anibndData)
    const skelEntry = bnd.entries.find(
      (e) => entryFileName(e).endsWith('_skeleton.hkx') || entryFileName(e) === 'skeleton.hkx',
    )
    const want = animationFileName(anibnd, animation)
    const animEntry = bnd.entries.find((e) => entryFileName(e) === want)
    if (!skelEntry || !animEntry) return null
    const skeleton = readSkeleton(readTagfile(skelEntry.data))
    const clip = sampleClip(readAnimation(readTagfile(animEntry.data)), want)

    // FLVER bone -> skeleton bone by name, else the nearest ancestor that has one.
    const fl = readFlver(flverData)
    const byName = new Map(skeleton.map((b, i) => [b.name, i]))
    const toSkel = fl.bones.map(() => -2)
    const resolve = (i: number, depth = 0): number => {
      if (i < 0 || i >= fl.bones.length || depth > 64) return 0
      if (toSkel[i] !== -2) return toSkel[i]
      toSkel[i] = byName.get(fl.bones[i].name) ?? resolve(fl.bones[i].parent, depth + 1)
      return toSkel[i]
    }
    fl.bones.forEach((_, i) => resolve(i))
    const meshes = fl.meshes.map((m) => {
      if (!m.dynamic || !m.boneIndices || !m.boneWeights) return null
      const skinIndex = new Uint16Array(m.boneIndices.length)
      for (let k = 0; k < skinIndex.length; k++) skinIndex[k] = Math.max(0, toSkel[m.boneIndices[k]] ?? 0)
      return { skinIndex, skinWeight: m.boneWeights }
    })
    return { skeleton, clip, meshes }
  } catch {
    return null
  }
}
