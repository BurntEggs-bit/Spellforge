/**
 * The Params page's Browse panel: weapons, items, spells, skills, bullets and
 * effects by name or id, or every param table and its rows.
 */
import { useState, useRef, useEffect } from 'react'
import type { BrowseKind, BrowseRow, ParamInfo } from '../../shared/api.ts'
import { ensureWidth } from '../app/dock.tsx'
import { useParams } from './pageContext.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from './paramLabels.ts'
import { usePersistentSize, SplitHandle } from '../shared/split.tsx'
import { StateBadge, CopyId } from '../shared/ui.tsx'
import { PREF_KEYS } from '../lib/storage.ts'
import { groupParams, MOST_USED_NOTES } from './paramGroups.ts'

/** The Browse tabs before All params, in order. */
const KINDS: { kind: BrowseKind; label: string }[] = [
  { kind: 'weapons', label: 'Weapons' },
  { kind: 'goods', label: 'Items' },
  { kind: 'spells', label: 'Spells' },
  { kind: 'skills', label: 'Skills' },
  { kind: 'bullets', label: 'Bullets' },
  { kind: 'effects', label: 'Effects' },
]

type BrowserTab = BrowseKind | 'params'

export function BrowsePanel() {
  const { project, version, openRow: onOpen, root: selected, openUpdate } = useParams()
  const [tab, setTab] = useState<BrowserTab>('weapons')
  /** In the Params tab: the param whose rows are shown, or null for the list. */
  const [param, setParam] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyProject, setOnlyProject] = useState(false)
  const [rows, setRows] = useState<BrowseRow[]>([])
  const [params, setParams] = useState<ParamInfo[]>([])
  /** All params: the param list stays on the left with its own search; rows open beside it. */
  const [paramQuery, setParamQuery] = useState('')
  const [listWidth, setListWidth] = usePersistentSize(PREF_KEYS.paramListWidth, 230, 150)
  const split = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (tab !== 'params') return
    let live = true
    call('params:list', undefined).then((r) => live && setParams(r))
    return () => {
      live = false
    }
  }, [tab, version])

  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      if (tab === 'params' && !param) {
        setRows([])
      } else if (tab === 'params' && param) {
        call('params:rows', { param, query, onlyProject, limit: 600 }).then((r) => live && setRows(r))
      } else {
        call('browse:list', { kind: tab as BrowseKind, query, onlyProject, limit: 400 }).then((r) => live && setRows(r))
      }
    }, 120)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [tab, param, query, onlyProject, version])

  const added = project.changes.reduce((n, c) => n + c.added, 0)
  const changed = project.changes.reduce((n, c) => n + c.changed, 0)
  const switchTab = (t: BrowserTab) => {
    setTab(t)
    if (t !== 'params') setParam(null)
    setQuery('')
    // All params shows two columns: make room if the panel is narrow.
    if (t === 'params') ensureWidth('params', 'browse', 560)
  }
  const q = paramQuery.trim().toLowerCase()
  const shownParams = params.filter(
    (p) =>
      (!onlyProject || p.added + p.changed > 0) &&
      (!q || p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q)),
  )
  const limit = tab === 'params' ? 600 : 400
  const v = project.version

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="tabs">
          {KINDS.map((k) => (
            <button key={k.kind} className={`tab${tab === k.kind ? ' active' : ''}`} onClick={() => switchTab(k.kind)}>
              {k.label}
            </button>
          ))}
          <button
            className={`tab${tab === 'params' ? ' active' : ''}`}
            onClick={() => switchTab('params')}
            title="Every param table in regulation.bin"
          >
            All params
          </button>
        </div>
        {tab !== 'params' && (
          <input placeholder="Search by name or id" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        <label className="row dim" style={{ fontSize: 12 }} title="Only rows this project added or edited">
          <input type="checkbox" checked={onlyProject} onChange={(e) => setOnlyProject(e.target.checked)} />
          Project only ({added} new, {changed} edited)
        </label>
        {v?.older && (
          <div
            className={v.known ? 'version-note' : 'version-note warn'}
            title={
              v.known
                ? `Since your project was made, game updates changed ${v.updateChanged.toLocaleString()} rows${v.updateAdded ? ` and added ${v.updateAdded.toLocaleString()}` : ''}. Spellforge compares your project with game ${v.project}, so only the changes you made count as edited.

In game, your regulation.bin replaces the game’s: those rows stay as they were in ${v.project}.`
                : `Spellforge doesn’t have game ${v.project}’s files to compare with, so rows changed by game updates since then show as edited too.

To fix that, point Spellforge at a copy of game ${v.project} once (Setup → Elden Ring → Choose…), then back at your game.`
            }
          >
            <div className="row">
              <span className="grow">
                Made with game <b>{v.project}</b>, installed <b>{v.game}</b>
                {v.known ? '' : ': update changes show as edited'} <span className="faint">ⓘ</span>
              </span>
              <button
                onClick={openUpdate}
                title="Bring the update’s changes into your project’s files; your own changes stay"
              >
                Update from game…
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="panel-body">
        {tab === 'params' ? (
          <div
            className="params-split"
            ref={split}
            style={{
              ['--list-w' as string]: `${listWidth}px`,
              gridTemplateColumns: 'var(--list-w) 6px minmax(0, 1fr)',
            }}
          >
            <div className="params-col">
              <input placeholder="Search params" value={paramQuery} onChange={(e) => setParamQuery(e.target.value)} />
              <div className="params-scroll">
                {shownParams.length === 0 && <div className="empty">Nothing matches.</div>}
                {groupParams(shownParams).map((g) => {
                  const closed = collapsed.has(g.name) && !q
                  return (
                    <div key={g.name}>
                      <div
                        className="param-group-head"
                        onClick={() =>
                          setCollapsed((c) => {
                            const n = new Set(c)
                            if (n.has(g.name)) n.delete(g.name)
                            else n.add(g.name)
                            return n
                          })
                        }
                      >
                        <span>{closed ? '▸' : '▾'}</span>
                        <span className="grow">{g.name}</span>
                        <span className="faint">{g.items.length}</span>
                      </div>
                      {!closed &&
                        g.items.map((p) => {
                          const label =
                            PARAM_LABELS[p.name] && PARAM_LABELS[p.name] !== p.name ? PARAM_LABELS[p.name] : ''
                          const note = MOST_USED_NOTES.get(p.name)
                          return (
                            <div
                              key={p.name}
                              className={`list-item param-item${param === p.name ? ' selected' : ''}`}
                              title={p.description}
                              onClick={() => {
                                setParam(p.name)
                                setQuery('')
                              }}
                            >
                              <span className="grow" style={{ minWidth: 0 }}>
                                <span className="ellipsis" style={{ display: 'block' }}>
                                  {label || p.name}
                                  {label && <span className="faint mono"> {p.name}</span>}
                                </span>
                                {note && <span className="param-note">{note}</span>}
                              </span>
                              {p.added > 0 && <span className="badge added">+{p.added}</span>}
                              {p.changed > 0 && <span className="badge changed">~{p.changed}</span>}
                              <span className="id">{p.rows}</span>
                            </div>
                          )
                        })}
                    </div>
                  )
                })}
              </div>
            </div>
            <SplitHandle
              target={split}
              cssVar="--list-w"
              value={listWidth}
              min={150}
              room={160}
              onCommit={setListWidth}
            />
            <div className="params-col">
              {!param ? (
                <div className="empty">No param selected.</div>
              ) : (
                <>
                  <div className="row" style={{ gap: 6 }}>
                    <b className="grow ellipsis">{PARAM_LABELS[param] ?? param}</b>
                    <span className="faint">{params.find((p) => p.name === param)?.rows ?? ''} rows</span>
                  </div>
                  <input
                    placeholder="Search rows by name or id"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="params-scroll">
                    {rows.length === 0 && <div className="empty">Nothing matches.</div>}
                    {rows.map((r, i) => (
                      <div
                        key={`${r.param}:${r.id}:${i}`}
                        className={`list-item${selected?.param === r.param && selected.id === r.id ? ' selected' : ''}`}
                        onClick={() => onOpen(r.param, r.id)}
                      >
                        <span className="grow ellipsis">{r.name || <span className="faint">unnamed</span>}</span>
                        <StateBadge state={r.state} />
                        <CopyId id={r.id} />
                      </div>
                    ))}
                    {rows.length >= limit && <div className="empty">First {limit} shown: refine the search.</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {rows.length === 0 && <div className="empty">Nothing matches.</div>}
            {rows.map((r, i) => (
              <div
                key={`${r.param}:${r.id}:${i}`}
                className={`list-item${selected?.param === r.param && selected.id === r.id ? ' selected' : ''}`}
                onClick={() => onOpen(r.param, r.id)}
              >
                <span className="grow ellipsis">{r.name || <span className="faint">unnamed</span>}</span>
                <StateBadge state={r.state} />
                <CopyId id={r.id} />
              </div>
            ))}
            {rows.length >= limit && <div className="empty">First {limit} shown: refine the search.</div>}
          </>
        )}
      </div>
    </div>
  )
}
