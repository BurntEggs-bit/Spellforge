/**
 * Pick a row id by hand: live status (free / taken by which row / something
 * already points at it), "next free", and the ids around it, used ones with
 * their names, optionally every free one too.
 */
import { useEffect, useState } from 'react'
import type { IdNeighborhood } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'

export function IdPicker({
  param,
  value,
  onChange,
  exclude = [],
  compact = false,
}: {
  param: string
  value: number
  onChange: (id: number) => void
  /** Ids already picked for other new rows. */
  exclude?: number[]
  /** One line (for tables); the nearby list opens on demand. */
  compact?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  const [info, setInfo] = useState<IdNeighborhood | null>(null)
  const [open, setOpen] = useState(!compact)
  const [showFree, setShowFree] = useState(false)
  useEffect(() => setDraft(String(value)), [value])

  const excludeKey = exclude.join(',')
  useEffect(() => {
    const n = Number(draft)
    if (!draft || !Number.isInteger(n) || n < 0) return setInfo(null)
    let live = true
    const t = window.setTimeout(
      () =>
        call('ids:near', { param, id: n, radius: 40, exclude })
          .then((r) => live && setInfo(r))
          .catch(() => live && setInfo(null)),
      200,
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [param, draft, excludeKey])

  const commit = (n: number) => {
    setDraft(String(n))
    if (n !== value) onChange(n)
  }
  const taken = info && !info.free && info.problem === 'already exists'
  const status = !info ? null : info.free ? 'free' : taken ? 'taken' : 'warn'

  const used = new Set(info?.rows.map((r) => r.id) ?? [])
  const referenced = new Set(info?.referenced ?? [])
  const entries: { id: number; kind: 'used' | 'referenced' | 'free'; name?: string }[] = []
  if (info) {
    for (let id = info.from; id <= info.to; id++) {
      if (used.has(id)) entries.push({ id, kind: 'used', name: info.rows.find((r) => r.id === id)?.name })
      else if (referenced.has(id)) entries.push({ id, kind: 'referenced' })
      else if (showFree) entries.push({ id, kind: 'free' })
    }
  }

  return (
    <div className={`id-picker${compact ? ' compact' : ''}`}>
      <div className="row" style={{ gap: 6 }}>
        <input
          className={`mono id-input ${status ?? ''}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={() => draft && commit(Number(draft))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          style={{ width: compact ? 96 : 120 }}
        />
        {status === 'free' && (
          <span className="id-status free" title="No row has this id and nothing points at it">
            ✓ free
          </span>
        )}
        {status === 'taken' && (
          <span className="id-status taken" title="A row already has this id">
            ✕ taken{info?.name ? `: ${info.name}` : ''}
          </span>
        )}
        {status === 'warn' && (
          <span className="id-status warn" title={info?.problem}>
            ⚠ {info?.problem}
          </span>
        )}
        {info && !info.free && info.nextFree >= 0 && (
          <button className="ghost" onClick={() => commit(info.nextFree)} title="The next id a new row can safely take">
            next free: {info.nextFree}
          </button>
        )}
        {compact && (
          <button className="ghost" onClick={() => setOpen(!open)} title="Ids around this one">
            {open ? '▾' : '▸'}
          </button>
        )}
      </div>
      {open && info && (
        <div className="id-near">
          <div className="row faint" style={{ fontSize: 11 }}>
            <span className="grow">
              Ids {info.from}–{info.to}: {info.rows.length} in use
              {info.referenced.length ? `, ${info.referenced.length} referenced but missing` : ''}
            </span>
            <label className="row">
              <input type="checkbox" checked={showFree} onChange={(e) => setShowFree(e.target.checked)} /> show free ids
              too
            </label>
          </div>
          <div className="id-list">
            {entries.length === 0 && <div className="faint">Nothing in use here: every id is free.</div>}
            {entries.map((e) => (
              <div
                key={e.id}
                className={`id-entry ${e.kind}${e.id === Number(draft) ? ' current' : ''}`}
                onClick={() => e.kind !== 'used' && commit(e.id)}
                title={
                  e.kind === 'used'
                    ? 'In use'
                    : e.kind === 'referenced'
                      ? 'No row, but something points at this id'
                      : 'Free: click to use'
                }
              >
                <span className="mono">{e.id}</span>
                <span className="ellipsis">
                  {e.kind === 'used' ? (
                    e.name || <span className="faint">unnamed</span>
                  ) : e.kind === 'referenced' ? (
                    <span className="faint">referenced, no row</span>
                  ) : (
                    <span className="faint">free</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
