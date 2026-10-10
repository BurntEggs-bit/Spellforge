/** 3D vectors as plain arrays [x, y, z]. */

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function cross(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/** The vector scaled to length 1, or null when it has (almost) no length. */
export function normalize(v: ArrayLike<number>): number[] | null {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 1e-8 ? [v[0] / length, v[1] / length, v[2] / length] : null
}
