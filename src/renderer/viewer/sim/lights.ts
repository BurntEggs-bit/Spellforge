/** Effect lights merged into the few point lights the viewer has. */
import * as THREE from 'three'

type FxLight = { pos: THREE.Vector3; color: number[]; radius: number }

/**
 * More effect lights than the viewer has: merged into `n`, each the lights
 * nearest it added together (a coated blade's dozen small lights become a
 * few along it, as bright in total).
 */
export function mergeLights(lit: FxLight[], n: number): FxLight[] {
  if (lit.length <= n) return lit
  const power = (o: FxLight) => Math.max(o.color[0], o.color[1], o.color[2]) * Math.max(0, o.color[3] ?? 1)
  // Seeds: the brightest, then each the farthest from those so far.
  const seeds = [lit.reduce((a, b) => (power(b) > power(a) ? b : a))]
  while (seeds.length < n) {
    let best: FxLight | null = null
    let far = 1e-8
    for (const o of lit) {
      const d = Math.min(...seeds.map((x) => x.pos.distanceToSquared(o.pos)))
      if (d > far) {
        far = d
        best = o
      }
    }
    if (!best) break
    seeds.push(best)
  }
  const groups: FxLight[][] = seeds.map(() => [])
  for (const o of lit) {
    let k = 0
    for (let j = 1; j < seeds.length; j++)
      if (seeds[j].pos.distanceToSquared(o.pos) < seeds[k].pos.distanceToSquared(o.pos)) k = j
    groups[k].push(o)
  }
  return groups
    .filter((g) => g.length)
    .map((g) => {
      const w = g.map(power)
      const total = w.reduce((a, b) => a + b, 0) || 1
      const pos = new THREE.Vector3()
      g.forEach((o, j) => pos.addScaledVector(o.pos, w[j] / total))
      const color = [0, 1, 2].map((c) => g.reduce((sum, o) => sum + o.color[c] * Math.max(0, o.color[3] ?? 1), 0))
      return { pos, color: [...color, 1], radius: Math.max(...g.map((o) => o.radius + o.pos.distanceTo(pos))) }
    })
}
