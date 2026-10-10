/**
 * Evaluating a B-spline at a parameter, with the standard algorithms of
 * Piegl and Tiller, The NURBS Book (2nd ed.): A2.1 finds the knot span, A2.2
 * its non-zero basis functions, A3.1 sums the control points they weight.
 *
 * Credit: The NURBS Book (Les Piegl and Wayne Tiller): the algorithms named
 * above.
 */

export interface BSpline {
  degree: number
  /** Non-decreasing; control points + degree + 1 of them. */
  knots: ArrayLike<number>
  /** Control points, `dims` numbers each. */
  points: Float32Array
  dims: number
}

/**
 * The span s with knots[s] ≤ u < knots[s + 1] among the spans control points
 * reach (A2.1): the first for u before the start, the last for u at or past the end.
 */
export function findSpan(knots: ArrayLike<number>, degree: number, count: number, u: number): number {
  if (u >= knots[count]) return count - 1
  let span = degree
  while (span < count - 1 && u >= knots[span + 1]) span++
  return span
}

/** The degree + 1 basis functions non-zero at u in a span (A2.2), for control points span − degree … span. */
export function basisFunctions(knots: ArrayLike<number>, span: number, degree: number, u: number): number[] {
  const basis = [1]
  const left = [0]
  const right = [0]
  for (let j = 1; j <= degree; j++) {
    left[j] = u - knots[span + 1 - j]
    right[j] = knots[span + j] - u
    let saved = 0
    for (let r = 0; r < j; r++) {
      const denominator = right[r + 1] + left[j - r]
      const share = denominator !== 0 ? basis[r] / denominator : 0
      basis[r] = saved + right[r + 1] * share
      saved = left[j - r] * share
    }
    basis[j] = saved
  }
  return basis
}

/** The spline's point at u (A3.1), written to `out` from `at`. */
export function evaluate(spline: BSpline, u: number, out: Float32Array, at: number): void {
  const { degree, knots, points, dims } = spline
  const span = findSpan(knots, degree, points.length / dims, u)
  const basis = basisFunctions(knots, span, degree, u)
  for (let d = 0; d < dims; d++) out[at + d] = 0
  for (let i = 0; i <= degree; i++) {
    const point = (span - degree + i) * dims
    for (let d = 0; d < dims; d++) out[at + d] += basis[i] * points[point + d]
  }
}
