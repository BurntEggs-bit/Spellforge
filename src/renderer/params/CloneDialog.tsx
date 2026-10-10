/** Duplicate into project: rows copied with everything they own, under new ids. */
import { useEffect, useMemo, useState } from 'react'
import type { ClonePlanView, DuplicateRequest, PlanNodeView } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from './paramLabels.ts'
import { useUi } from '../shared/ui.tsx'
import { IdPicker } from '../shared/IdPicker.tsx'
import { ModalShell } from '../shared/Modal.tsx'

export function CloneDialog({
  roots,
  onClose,
  onDone,
}: {
  roots: { param: string; id: number }[]
  onClose: () => void
  onDone: (newRoot: { param: string; id: number }) => void
}) {
  const ui = useUi()
  const [forceClone, setForceClone] = useState<string[]>([])
  const [forceShare, setForceShare] = useState<string[]>([])
  const [nameSuffix, setNameSuffix] = useState(' (copy)')
  const [cloneEffects, setCloneEffects] = useState(true)
  const [includeChildEffects, setIncludeChildEffects] = useState(true)
  const [plan, setPlan] = useState<ClonePlanView | null>(null)
  const [filter, setFilter] = useState<'all' | 'clone' | 'shared'>('all')
  /** Off: ids are picked automatically (the default). On: every copy's id can be set by hand. */
  const [manualIds, setManualIds] = useState(false)
  const [idOverrides, setIdOverrides] = useState<Record<string, number>>({})
  const [behaviorVariation, setBehaviorVariation] = useState<number | undefined>(undefined)
  const [effectIdStart, setEffectIdStart] = useState<number | undefined>(undefined)

  const request = () => ({
    roots,
    forceClone,
    forceShare,
    nameSuffix,
    idOverrides: manualIds ? idOverrides : undefined,
    behaviorVariation: manualIds ? behaviorVariation : undefined,
    effectIdStart: manualIds ? effectIdStart : undefined,
    cloneEffects,
    includeChildEffects,
  })

  useEffect(() => {
    const t = window.setTimeout(() => call('clone:plan', request()).then(setPlan).catch(ui.error), manualIds ? 250 : 0)
    return () => window.clearTimeout(t)
  }, [
    forceClone,
    forceShare,
    manualIds,
    idOverrides,
    behaviorVariation,
    effectIdStart,
    cloneEffects,
    includeChildEffects,
  ])

  const counts = useMemo(() => {
    const c: Record<string, { clone: number; shared: number }> = {}
    for (const n of plan?.nodes ?? []) {
      c[n.param] ??= { clone: 0, shared: 0 }
      if (n.status === 'shared') c[n.param].shared++
      else c[n.param].clone++
    }
    return c
  }, [plan])

  const effectCount = plan?.effects.filter((e) => e.exists).length ?? 0
  const childCount = new Set(plan?.effects.flatMap((e) => e.children) ?? []).size

  const toggle = (n: PlanNodeView) => {
    if (n.status === 'root') return
    if (n.status === 'shared') {
      setForceShare((s) => s.filter((k) => k !== n.key))
      setForceClone((s) => [...s, n.key])
    } else {
      setForceClone((s) => s.filter((k) => k !== n.key))
      setForceShare((s) => [...s, n.key])
    }
  }

  const apply = () =>
    ui.run('Duplicating', async () => {
      const r = await call('clone:apply', { ...request(), cloneEffects, includeChildEffects } as DuplicateRequest)
      const rows = Object.values(r.rowsAdded).reduce((a, b) => a + b, 0)
      ui.toast(
        `Duplicated ${rows} rows and ${r.effectMapping.length} effects; relinked ${r.fieldsRelinked + r.sfxFieldsRelinked} references.\n` +
          'Nothing is written until you press “Save to project”.',
      )
      onDone(r.newRoots[0])
    })

  const shown = (plan?.nodes ?? []).filter(
    (n) => filter === 'all' || (filter === 'shared' ? n.status === 'shared' : n.status !== 'shared'),
  )

  return (
    <ModalShell onClose={onClose}>
      <header>
        <h2 className="grow">Duplicate into project</h2>
        <button className="ghost" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="body">
        {!plan && <div className="empty">Working out what it owns…</div>}
        {plan && (
          <>
            <div className="stat-row">
              {Object.entries(counts).map(([param, c]) => (
                <div key={param} className="stat">
                  <b>{c.clone}</b>
                  <span>
                    {PARAM_LABELS[param] ?? param} copied{c.shared ? `, ${c.shared} kept shared` : ''}
                  </span>
                </div>
              ))}
              <div className="stat">
                <b>{cloneEffects ? effectCount + (includeChildEffects ? childCount : 0) : 0}</b>
                <span>effects copied</span>
              </div>
            </div>

            <IdsNeeded plan={plan} />

            {manualIds && cloneEffects && plan.effectIds.length > 0 && (
              <div className="row" style={{ gap: 8 }}>
                <span className="dim">Copied effects start at</span>
                <input
                  className="mono"
                  style={{ width: 110 }}
                  value={effectIdStart ?? plan.effectIds[0][1]}
                  onChange={(e) =>
                    setEffectIdStart(e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : undefined)
                  }
                />
                <span className="faint">and up (the next free ids)</span>
              </div>
            )}

            {plan.behaviorVariations.length > 0 && (
              <div className="dim meta">
                <span>
                  New behavior variation{' '}
                  {plan.behaviorVariations.map(([a, b], k) => (
                    <span key={a} className="mono">
                      {k ? ', ' : ''}
                      {a} → {b}
                    </span>
                  ))}
                </span>
                <span>
                  id offsets{' '}
                  {Object.entries(plan.offsets).map(([p, o], k) => (
                    <span key={p} className="mono">
                      {k ? ', ' : ''}
                      {PARAM_LABELS[p] ?? p} +{o}
                    </span>
                  ))}
                </span>
              </div>
            )}

            {plan.errors.map((e) => (
              <div key={e} className="error">
                {e}
              </div>
            ))}

            <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
              <label className="row">
                <input type="checkbox" checked={cloneEffects} onChange={(e) => setCloneEffects(e.target.checked)} />
                <span title="Recoloring the copies then doesn’t change the original">Copies get their own effects</span>
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  disabled={!cloneEffects}
                  checked={includeChildEffects}
                  onChange={(e) => setIncludeChildEffects(e.target.checked)}
                />
                including child effects
              </label>
              <label className="row">
                Name suffix
                <input value={nameSuffix} onChange={(e) => setNameSuffix(e.target.value)} style={{ width: 110 }} />
              </label>
              <label
                className="row"
                title="Off: Spellforge picks safe, unused ids. On: set each copy's id yourself (still checked)."
              >
                <input type="checkbox" checked={manualIds} onChange={(e) => setManualIds(e.target.checked)} />
                Choose IDs myself
              </label>
            </div>

            {manualIds && plan.behaviorVariations.length > 0 && (
              <div className="row" style={{ gap: 8 }}>
                <span
                  className="dim"
                  title="A weapon's attacks, skills and bullets are looked up through this number (behavior ids = category × 100,000,000 + variation × 1,000 + judge), so they move together."
                >
                  Behavior variation for the copy
                </span>
                <input
                  className="mono"
                  style={{ width: 90 }}
                  value={behaviorVariation ?? plan.behaviorVariations[0][1]}
                  onChange={(e) =>
                    setBehaviorVariation(e.target.value ? Number(e.target.value.replace(/[^0-9]/g, '')) : undefined)
                  }
                />
                <span className="faint">(behavior rows follow it)</span>
              </div>
            )}

            <div className="faint" style={{ fontSize: 12 }}>
              <b>Kept shared</b>: also used elsewhere in the game, so the copy keeps pointing at the original (common
              status effects, shared attacks). Click one to copy it anyway.
            </div>

            <div className="row">
              <div className="tabs">
                {(['all', 'clone', 'shared'] as const).map((f) => (
                  <button key={f} className={`tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
                    {f === 'all' ? 'Everything' : f === 'clone' ? 'Copied' : 'Kept shared'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ maxHeight: '38vh', overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
              <table className="plan">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Name</th>
                    <th>Id</th>
                    <th>New id</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((n) => (
                    <tr
                      key={n.key}
                      onClick={() => toggle(n)}
                      style={{ cursor: n.status === 'root' ? 'default' : 'pointer' }}
                    >
                      <td>
                        <span className="badge kind">{PARAM_LABELS[n.param] ?? n.param}</span>
                      </td>
                      <td className="ellipsis" style={{ maxWidth: 300 }}>
                        {n.name || <span className="faint">unnamed</span>}
                      </td>
                      <td className="mono">{n.id}</td>
                      <td className="mono" onClick={(e) => manualIds && e.stopPropagation()}>
                        {n.status === 'shared' ? (
                          <span className="faint">—</span>
                        ) : manualIds &&
                          !(n.param === 'BehaviorParam_PC' && plan.behaviorVariations.length > 0) &&
                          // A spell's Magic row always takes its item's id.
                          !(
                            n.param === 'Magic' &&
                            plan.nodes.some(
                              (m) => m.param === 'EquipParamGoods' && m.id === n.id && m.status !== 'shared',
                            )
                          ) &&
                          n.newId !== undefined ? (
                          <IdPicker
                            compact
                            param={n.param}
                            value={idOverrides[n.key] ?? n.newId}
                            exclude={plan.nodes
                              .filter(
                                (m) =>
                                  m.key !== n.key &&
                                  m.status !== 'shared' &&
                                  m.param === n.param &&
                                  m.newId !== undefined,
                              )
                              .map((m) => m.newId!)}
                            onChange={(v) => setIdOverrides((o) => ({ ...o, [n.key]: v }))}
                          />
                        ) : (
                          n.newId
                        )}
                      </td>
                      <td>
                        <span className={`badge ${n.status}`}>
                          {n.status === 'shared' ? 'kept shared' : n.status === 'root' ? 'root' : 'copy'}
                        </span>{' '}
                        {n.sharedReason && <span className="faint">{n.sharedReason}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <footer>
        <span className="faint grow">Written to the mod folder when you save.</span>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!plan || plan.errors.length > 0} onClick={apply}>
          Duplicate
        </button>
      </footer>
    </ModalShell>
  )
}

/** "2880–2885, 2890" */
function idRanges(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return out.join(', ')
}

/** Every new id the duplicate takes, by kind: how many and which. */
function IdsNeeded({ plan }: { plan: ClonePlanView }) {
  const byParam = new Map<string, number[]>()
  for (const n of plan.nodes) {
    if (n.status === 'shared' || n.newId === undefined) continue
    byParam.set(n.param, [...(byParam.get(n.param) ?? []), n.newId])
  }
  const rows = [...byParam.entries()].map(([param, ids]) => ({ kind: PARAM_LABELS[param] ?? param, param, ids }))
  if (plan.effectIds.length) rows.push({ kind: 'Effects (FXR)', param: '', ids: plan.effectIds.map(([, to]) => to) })
  const total = rows.reduce((a, r) => a + r.ids.length, 0)
  return (
    <div className="ids-needed">
      <div className="subhead">IDs this copy needs: {total}</div>
      <table className="plan">
        <thead>
          <tr>
            <th>Kind</th>
            <th>How many</th>
            <th>New IDs</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind}>
              <td>
                <span className="badge kind">{r.kind}</span>
                {r.param && <span className="faint mono"> {r.param}</span>}
              </td>
              <td className="mono">{r.ids.length}</td>
              <td className="mono">
                <div className="ids-ranges">{idRanges(r.ids)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
