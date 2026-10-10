/** Animated effect models (Agheel's dragon head): a model's skeleton, its clip and its skinning. */
import type { ModelRigView } from '../../shared/api.ts'
import { base64Floats, base64Uint16 } from '../lib/base64.ts'

/** An animated effect model's rig, decoded from `model:rig` (see ModelRigView). */
export interface ModelRig {
  bones: ModelRigView['bones']
  frames: number
  frameDuration: number
  duration: number
  tracks: number[]
  data: Float32Array
  meshes: ({ skinIndex: Uint16Array; skinWeight: Float32Array } | null)[]
  loop: boolean
  speed: number
}

/** A rig from the main process with its clip and skinning decoded, playing as the emitter's animation says. */
export function decodeRig(view: ModelRigView, anim: { loop: boolean; speed: number }): ModelRig {
  return {
    bones: view.bones,
    frames: view.frames,
    frameDuration: view.frameDuration,
    duration: view.duration,
    tracks: view.tracks,
    data: base64Floats(view.data),
    meshes: view.meshes.map((m) =>
      m ? { skinIndex: base64Uint16(m.skinIndex), skinWeight: base64Floats(m.skinWeight) } : null,
    ),
    loop: anim.loop,
    speed: anim.speed,
  }
}
