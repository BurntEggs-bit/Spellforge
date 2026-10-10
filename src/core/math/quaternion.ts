/**
 * Quaternions as [x, y, z, w] (Havok's and three.js's order), Hamilton
 * product: qmul(a, b) turns by b, then by a.
 */
export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

export function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function qinv(a: ArrayLike<number>): Quat {
  return [-a[0], -a[1], -a[2], a[3]]
}

export function qrot(q: ArrayLike<number>, v: ArrayLike<number>): Vec3 {
  const t = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q))
  return [t[0], t[1], t[2]]
}

export function qnorm(q: ArrayLike<number>): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/** Angle between two rotations, in degrees. */
export function qangle(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI
}
