/** Which way an effect was authored: guessed from its emitters, for the preview's Axis. */
import type { PreviewSpec } from '../../../shared/api.ts'

/**
 * Guess whether an effect is authored with +Z up (item glows, things on the
 * ground) rather than +Z forward (projectiles). Projectiles move: they emit
 * by distance or have node speed. Upright effects raise their emitters and
 * stretch their shapes along Z.
 */
export function guessUpright(spec: PreviewSpec): boolean {
  if (spec.emitters.some((e) => e.emission.kind === 'distance' || e.nodeSpeedZ !== 0)) return false
  // Z-up effects (item glows, the Torrent barrier 800) stack things along Z
  // and keep Y thin; their X can be long (a barrier's width).
  // Shapes are measured after their node's rotation.
  let y = 0
  let z = 0
  for (const e of spec.emitters) {
    y += Math.abs(e.offset[1])
    z += Math.abs(e.offset[2])
    if (e.shape.kind === 'box') {
      const r = e.rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]
      const [sx, sy, sz] = e.shape.size
      y += Math.abs(r[3] * sx) + Math.abs(r[4] * sy) + Math.abs(r[5] * sz)
      z += Math.abs(r[6] * sx) + Math.abs(r[7] * sy) + Math.abs(r[8] * sz)
    }
  }
  // 3x: forward effects held at a height (Agheel's dragon head, 1 m up,
  // breathing 1-6 m ahead) stack along Z too, but never keep Y that thin.
  return z > 0.05 && z > 3 * y
}
