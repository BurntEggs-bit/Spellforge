/** The Animations page's categories (a050…), searched by number or what uses them, and registering new animations. */
import { useState, useRef, useEffect, useMemo } from 'react'
import type { AnimCategoryView } from '../../shared/api.ts'
import { StateBadge } from '../shared/ui.tsx'
import { plural } from '../../shared/format.ts'

export function CategoryPanel({
  categories,
  selected,
  unregistered,
  onSelect,
  onRegister,
}: {
  categories: AnimCategoryView[] | null
  selected: number | null
  unregistered: string[]
  onSelect: (c: number) => void
  onRegister: () => void
}) {
  const [query, setQuery] = useState('')
  const [onlyProject, setOnlyProject] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // A category opened from elsewhere (a copy, a link) is never hidden by the filter.
  useEffect(() => {
    if (selected === null || !categories) return
    const c = categories.find((x) => x.category === selected)
    const q = query.trim().toLowerCase()
    if (c && ((onlyProject && !c.state) || (q && !c.label.includes(q) && !(c.hint ?? '').toLowerCase().includes(q)))) {
      setQuery('')
      setOnlyProject(false)
    }
    listRef.current?.querySelector(`[data-cat="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected, categories])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (categories ?? []).filter(
      (c) =>
        (!onlyProject || c.state) &&
        (!q || c.label.includes(q) || String(c.category) === q || (c.hint ?? '').toLowerCase().includes(q)),
    )
  }, [categories, query, onlyProject])

  return (
    <div className="panel">
      <div className="panel-head">
        <input placeholder="Search: a050, scythe, katana…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="row dim" style={{ fontSize: 12 }} title="Only categories this project added or changed">
          <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
          Project only
        </label>
        {unregistered.length > 0 && (
          <div className="warn row" style={{ alignItems: 'flex-start' }}>
            <span
              className="grow"
              title="Not in the behaviour graph: the game can’t play them until they’re registered"
            >
              {plural(unregistered.length, 'new animation')} not registered
            </span>
            <button className="primary" onClick={onRegister} title={unregistered.slice(0, 20).join('\n')}>
              Register
            </button>
          </div>
        )}
      </div>
      <div className="panel-body" ref={listRef}>
        {!categories && <div className="empty">Loading…</div>}
        {shown.map((c) => (
          <div
            key={c.category}
            data-cat={c.category}
            className={`list-item anim-cat${selected === c.category ? ' selected' : ''}`}
            onClick={() => onSelect(c.category)}
            title={c.hint}
          >
            <span className="mono anim-cat-label">{c.label}</span>
            <span className="grow ellipsis dim">{c.hint ?? ''}</span>
            <StateBadge state={c.state} />
            <span className="id">{c.animations}</span>
          </div>
        ))}
        {categories && !shown.length && <div className="empty">No categories match.</div>}
      </div>
    </div>
  )
}
