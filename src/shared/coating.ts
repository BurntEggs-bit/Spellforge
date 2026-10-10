/**
 * Weapon buffs (greases, buff spells) coat the whole blade: the game spawns
 * the coating effect along each group of dummy polys (300, 301, 302… from
 * enchantStartDmyId to enchantEndDmyId), not just at the points. A
 * longsword has only 300 at the hilt and 301 at the tip, and every size of
 * every coating has emitters that are 15 cm boxes along the blade: copies
 * every 15 cm tile it.
 */

/** How far apart a coating's copies are along the blade. */
const COAT_STEP = 0.15

/**
 * Where a coating's copies go along a blade's points (in order, weapon
 * space): each stretch between two points split evenly into steps of about
 * COAT_STEP, and the last point itself. `f` is the fraction from `from` to `to`.
 */
export function coatingStops(points: number[][]): { from: number; to: number; f: number }[] {
  if (points.length < 2) return points.length ? [{ from: 0, to: 0, f: 0 }] : []
  const out: { from: number; to: number; f: number }[] = []
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k]
    const b = points[k + 1]
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / COAT_STEP))
    for (let j = 0; j < n; j++) out.push({ from: k, to: k + 1, f: j / n })
  }
  out.push({ from: points.length - 2, to: points.length - 1, f: 1 })
  return out
}
