/**
 * Find events (Ctrl+F): every animation's events of a type, or holding a
 * value in a field (an effect id, a SpEffect, a behaviour judge, a sound, a
 * dummy poly, or any named field), in one category or all of them. A hit
 * opens its animation with the event selected.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { OPEN_EVENT_END, type AnimEventType, type AnimFindResult } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { frameNumber } from '../../shared/frames.ts'
import { categoryLabel } from '../../shared/animIds.ts'
import { plural, pluralLocale } from '../../shared/format.ts'

const ROLES: { value: string; label: string }[] = [
  { value: '', label: 'Any field' },
  { value: '@effect', label: 'An effect id (FFX)' },
  { value: '@speffect', label: 'A SpEffect id' },
  { value: '@judge', label: 'A behaviour judge id' },
  { value: '@sound', label: 'A sound id' },
  { value: '@dummy', label: 'A dummy poly' },
]

const frames = (s: number) => (s >= OPEN_EVENT_END ? 'end' : String(frameNumber(s, 1)))

export function FindPanel({
  category,
  focusSeq,
  onOpen,
}: {
  category: number | null
  focusSeq: number
  onOpen: (animation: string, index: number) => void
}) {
  const ui = useUi()
  const [types, setTypes] = useState<AnimEventType[]>([])
  const [type, setType] = useState<string>('')
  const [field, setField] = useState('')
  const [value, setValue] = useState('')
  const [scope, setScope] = useState<'all' | 'category'>('all')
  const [result, setResult] = useState<AnimFindResult | null>(null)
  const [busy, setBusy] = useState(false)
  const valueRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    call('anim:eventTypes', undefined)
      .then(setTypes)
      .catch(() => {})
  }, [])
  // Ctrl+F: here, ready to type a value.
  useEffect(() => {
    if (focusSeq) valueRef.current?.focus({ preventScroll: true })
  }, [focusSeq])
  const t = type === '' ? null : Number(type)
  const typeFields = useMemo(() => (t === null ? [] : (types.find((x) => x.type === t)?.fields ?? [])), [t, types])
  const v = value.trim() === '' ? null : Number(value)
  const valid =
    (t !== null || v !== null) && (v === null || Number.isFinite(v)) && (scope === 'all' || category !== null)
  const run = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const r = await call('anim:find', {
        type: t,
        field: field || undefined,
        value: v,
        category: scope === 'category' ? category : null,
        limit: 800,
      })
      setResult(r)
    } catch (e) {
      ui.error(e)
    } finally {
      setBusy(false)
    }
  }
  // Hits grouped by animation, in order.
  const groups = useMemo(() => {
    const out: { animation: string; hits: AnimFindResult['hits'] }[] = []
    for (const h of result?.hits ?? []) {
      const last = out[out.length - 1]
      if (last?.animation === h.animation) last.hits.push(h)
      else out.push({ animation: h.animation, hits: [h] })
    }
    return out
  }, [result])
  return (
    <div className="panel">
      <div className="panel-head find-head">
        <select value={type} onChange={(e) => setType(e.target.value)} title="Event type">
          <option value="">Any event type</option>
          {types.map((x) => (
            <option key={x.type} value={x.type}>
              {x.name} ({x.type})
            </option>
          ))}
        </select>
        <div className="row">
          <select
            className="grow"
            value={field}
            onChange={(e) => setField(e.target.value)}
            title="Which field holds the value"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
            {typeFields.length > 0 && (
              <optgroup label="This type’s fields">
                {typeFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <input
            ref={valueRef}
            className="mono"
            style={{ width: 110 }}
            placeholder="value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && run()}
          />
        </div>
        <div className="row">
          <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'category')}>
            <option value="all">Every category</option>
            <option value="category" disabled={category === null}>
              {category === null ? 'This category' : `Only ${categoryLabel(category)}`}
            </option>
          </select>
          <span className="grow" />
          <button className="primary" disabled={!valid || busy} onClick={run}>
            {busy ? 'Finding…' : 'Find'}
          </button>
        </div>
        {result && (
          <div className="faint" style={{ fontSize: 12 }}>
            {pluralLocale(result.total, 'event')} in {plural(groups.length, 'animation')}
            {result.total > result.hits.length ? ` (showing ${result.hits.length})` : ''}, of{' '}
            {result.animations.toLocaleString()} searched
          </div>
        )}
      </div>
      <div className="panel-body">
        {!result && (
          <div className="empty">
            Events by type or by a value they hold (an effect, a SpEffect, a judge, a sound…), in every animation.
          </div>
        )}
        {groups.map((g) => (
          <div key={g.animation} className="find-group">
            <div className="find-anim mono">{g.animation}</div>
            {g.hits.map((h) => (
              <div
                key={h.index}
                className="list-item find-hit"
                onClick={() => onOpen(h.animation, h.index)}
                title={`${h.typeName}${h.summary ? `\n${h.summary}` : ''}`}
              >
                <span className="mono faint">
                  {frames(h.start)}–{frames(h.end)}
                </span>
                <span className="ellipsis">{h.typeName}</span>
                {h.field ? (
                  <span className="mono faint ellipsis find-field">
                    {h.field} = {h.value}
                  </span>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
