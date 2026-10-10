/** An R1 made from a move: where it's cut into steps, one per press. */
import type { EnemySkillPlan } from '../../../shared/api.ts'
import { plural } from '../../../shared/format.ts'

/**
 * An R1 split into steps: one per press of R1, cut at the times given
 * (seconds into the move; the plan suggests one in each pause between its
 * hits), and which R1 each part becomes.
 */
export function StepsChoice({
  plan,
  target,
  steps,
  text,
  onText,
  onSteps,
}: {
  plan: EnemySkillPlan
  target: string
  steps: number[] | null
  text: string
  onText: (t: string) => void
  onSteps: (v: number[] | null) => void
}) {
  const parse = (t: string) =>
    [
      ...new Set(
        t
          .split(/[\s,;]+/)
          .map(Number)
          .filter((v) => Number.isFinite(v) && v > 0.05 && v < plan.length - 0.05),
      ),
    ].sort((a, b) => a - b)
  const m = /^(.*-r1)-(\d+)$/.exec(target)
  const edges = steps ? [0, ...steps, plan.length] : []
  const parts = edges.slice(1).map((to, k) => {
    const from = edges[k]
    const t = m ? plan.attackTargets.find((x) => x.key === `${m[1]}-${Number(m[2]) + k}`) : undefined
    const hits = plan.hits.filter((h) => h >= from - 1e-4 && h < to).length
    return { label: t?.label ?? null, from, to, hits }
  })
  return (
    <div className="enemy-steps">
      <label className="row">
        <input
          type="checkbox"
          checked={steps !== null}
          onChange={(e) => onSteps(e.target.checked ? plan.cuts : null)}
        />
        One per R1 press, cut at
        <input
          value={text}
          disabled={steps === null}
          style={{ width: 150 }}
          title="Seconds into the move, between its hits"
          onChange={(e) => onText(e.target.value)}
          onBlur={() => {
            const v = parse(text)
            onSteps(v.length ? v : null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        s
      </label>
      {steps && (
        <div className={parts.some((p) => !p.label) ? 'warn' : 'faint'} style={{ fontSize: 12 }}>
          {parts
            .map(
              (p, k) =>
                `${p.label ?? `no R1 for step ${k + 1}`}: ${p.from.toFixed(2)}–${p.to.toFixed(2)} s, ${plural(p.hits, 'hit')}`,
            )
            .join('; ')}
        </div>
      )}
    </div>
  )
}
