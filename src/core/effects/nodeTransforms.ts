/**
 * Effect node transforms: a node's StaticNodeTransform turns its children by
 * `rotation` (degrees, about Z, then X, then Y) and then moves them by
 * `offset`, in its parent's axes. Turning or moving a whole effect changes
 * the transform of each node under its root, so every part keeps its place
 * relative to the others.
 *
 * Matrices are 3×3, row-major, acting on column vectors in the game's axes.
 *
 * Credit: @cccode/fxr (CCCode; Unlicense): the transform actions and their
 * order of rotations.
 */
import { BasicNode, NodeEmitterNode, RandomNodeTransform, StaticNodeTransform, type FXR } from '@cccode/fxr'

export type Mat3 = number[]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0)
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}

export function apply3(m: Mat3, v: number[]): number[] {
  return [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2])
}

const RAD = Math.PI / 180

/** A node's rotation (degrees about X, Y, Z) as a matrix: Z first, then X, then Y. */
export function eulerToMatrix([x, y, z]: number[]): Mat3 {
  const [cx, sx] = [Math.cos(x * RAD), Math.sin(x * RAD)]
  const [cy, sy] = [Math.cos(y * RAD), Math.sin(y * RAD)]
  const [cz, sz] = [Math.cos(z * RAD), Math.sin(z * RAD)]
  const rx: Mat3 = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rz: Mat3 = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  return mul3(ry, mul3(rx, rz))
}

/** The node rotation (degrees about X, Y, Z) of a rotation matrix: the inverse of eulerToMatrix. */
export function matrixToEuler(m: Mat3): number[] {
  const sx = Math.max(-1, Math.min(1, -m[5]))
  const x = Math.asin(sx)
  let y: number
  let z: number
  if (Math.abs(sx) < 1 - 1e-9) {
    y = Math.atan2(m[2], m[8])
    z = Math.atan2(m[3], m[4])
  } else {
    // Turned a quarter about X: Y and Z turn about the same axis; all of it goes to Y.
    y = Math.atan2(-m[6], m[0])
    z = 0
  }
  const deg = (r: number) => {
    const d = r / RAD
    return Math.abs(d) < 1e-9 ? 0 : d
  }
  return [deg(x), deg(y), deg(z)]
}

/**
 * Turns and then moves a whole effect, in its own axes: each node under the
 * root gets `rotation` and `offset` applied to its transform (one is added
 * where a node has none, and a node that can't hold one is put under a new
 * node that does).
 */
export function transformEffect(fxr: FXR, rotation: Mat3, offset: number[]): void {
  // Without a turn, rotations are left as written (re-encoding them would change the stored angles).
  const turns = rotation.some((v, i) => Math.abs(v - IDENTITY[i]) > 1e-9)
  const [ex, ey, ez] = matrixToEuler(rotation)
  const fresh = () => new StaticNodeTransform({ offset: [offset[0], offset[1], offset[2]], rotation: [ex, ey, ez] })
  fxr.root.nodes = fxr.root.nodes.map((n) => {
    if (n instanceof BasicNode || n instanceof NodeEmitterNode) {
      for (const c of n.configs) {
        const tr = c.nodeTransform
        if (tr instanceof StaticNodeTransform || tr instanceof RandomNodeTransform) {
          const moved = turns ? apply3(rotation, tr.offset) : tr.offset
          if (turns) {
            const [x, y, z] = matrixToEuler(mul3(rotation, eulerToMatrix(tr.rotation)))
            tr.rotation = [x, y, z]
          }
          tr.offset = [moved[0] + offset[0], moved[1] + offset[1], moved[2] + offset[2]]
        } else c.nodeTransform = fresh()
      }
      return n
    }
    return new BasicNode([fresh()], [n])
  })
}

/** Moves a whole effect by `t`, in its own axes (transformEffect without turning). */
export function shiftEffect(fxr: FXR, t: number[]): void {
  if (Math.hypot(t[0], t[1], t[2]) < 1e-6) return
  transformEffect(fxr, IDENTITY, t)
}
