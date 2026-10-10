/** The Animations page's list of a category's animations, filtered by id, name or #tag. */
import { useState, useMemo } from 'react'
import { categoryLabel, describeAnimationId } from '../../shared/animIds.ts'
import type { AnimCategoryView, AnimListItem } from '../../shared/api.ts'
import { StateBadge } from '../shared/ui.tsx'
import { RegDot } from './RegDot.tsx'

export function AnimationList({
  category,
  info,
  anims,
  selected,
  onSelect,
  onDuplicateCategory,
}: {
  category: number | null
  info: AnimCategoryView | null
  anims: AnimListItem[]
  selected: string | null
  onSelect: (name: string) => void
  onDuplicateCategory: () => void
}) {
  const [query, setQuery] = useState('')
  const [onlyProject, setOnlyProject] = useState(false)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return anims.filter(
      (a) =>
        (!onlyProject || a.state) &&
        (!q ||
          a.name.includes(q) ||
          (a.source ?? '').includes(q) ||
          (a.title ?? '').toLowerCase().includes(q) ||
          (a.tags ?? []).some((t) => t.toLowerCase().includes(q.replace(/^#/, '')))),
    )
  }, [anims, query, onlyProject])

  if (category === null)
    return (
      <div className="panel">
        <div className="panel-body" />
      </div>
    )
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          <div className="panel-title grow">
            {categoryLabel(category)}{' '}
            <span className="faint" style={{ fontWeight: 400 }}>
              {anims.length} animations
            </span>
          </div>
          <button
            className="ghost icon"
            onClick={onDuplicateCategory}
            title="Copy every animation in this category into a new category"
          >
            Copy category…
          </button>
        </div>
        {info?.hint && (
          <div className="dim ellipsis" style={{ fontSize: 12 }} title={info.hint}>
            Used by {info.hint}
          </div>
        )}
        <input
          placeholder="Filter by id, name or #tag, e.g. 030000"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="row dim" style={{ fontSize: 12 }} title="Only animations this project added or edited">
          <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
          Project only
        </label>
      </div>
      <div className="panel-body">
        {shown.map((a) => (
          <div
            key={a.name}
            className={`list-item${selected === a.name ? ' selected' : ''}`}
            title={describeAnimationId(Number(a.name.slice(-6))) ?? undefined}
            onClick={() => onSelect(a.name)}
          >
            <RegDot r={a.registration} />
            <span className="mono">{a.name}</span>
            {a.title ? (
              <span
                className="grow ellipsis anim-list-title"
                title={`${a.title}${a.tags?.length ? ` · #${a.tags.join(' #')}` : ''}`}
              >
                {a.title}
              </span>
            ) : (
              <span className="grow ellipsis faint" style={{ fontSize: 11 }}>
                {a.motion === 'motion' ? `↪ ${a.source}` : a.motion === 'full' ? `= ${a.source}` : ''}
              </span>
            )}
            <StateBadge state={a.state} />
            <span className="id" title="Events">
              {a.events}
            </span>
          </div>
        ))}
        {!shown.length && <div className="empty">{anims.length ? 'No animations match.' : 'Loading…'}</div>}
      </div>
    </div>
  )
}
