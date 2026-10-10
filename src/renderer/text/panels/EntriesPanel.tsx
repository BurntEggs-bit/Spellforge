/** The Text page's entries of the open file: searched by id or text, filtered to edited or newer in game. */
import { STATE_LABEL } from '../labels.ts'
import { useText } from '../pageContext.ts'

export function EntriesPanel() {
  const t = useText()
  const { current, entries, total, filter } = t
  return (
    <div className="panel">
      <div className="panel-head">
        {current ? (
          <>
            <div className="row">
              <b className="grow ellipsis">{current.title}</b>
              <span className="faint">
                {total} {filter === 'edited' ? 'edited' : filter === 'outdated' ? 'newer in game' : 'entries'}
              </span>
            </div>
            <input placeholder="Search by id or text" value={t.query} onChange={(e) => t.setQuery(e.target.value)} />
            <div className="seg small" role="tablist">
              {(['all', 'edited', 'outdated'] as const).map((f) => (
                <button
                  key={f}
                  className={filter === f ? 'active' : ''}
                  onClick={() => t.setFilter(f)}
                  disabled={f === 'outdated' && !current.outdated && filter !== 'outdated'}
                >
                  {f === 'all'
                    ? 'All'
                    : f === 'edited'
                      ? `Edited${current.edited ? ` (${current.edited})` : ''}`
                      : `Newer in game${current.outdated ? ` (${current.outdated})` : ''}`}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="faint">No file selected.</div>
        )}
      </div>
      <div className="panel-body">
        {current && entries.length === 0 && (
          <div className="empty">{filter === 'edited' ? 'Nothing edited in this file.' : 'Nothing matches.'}</div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            className={`list-item text-entry${t.selected === e.id ? ' selected' : ''}`}
            onClick={() => t.select(e.id)}
          >
            <span className="id" style={{ minWidth: 64 }}>
              {e.id}
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">
                {e.text === null ? (
                  e.original ? (
                    <span className="faint">{e.original.split('\n')[0]}</span>
                  ) : (
                    <span className="faint">(empty)</span>
                  )
                ) : (
                  e.text.split('\n')[0] || <span className="faint">(blank)</span>
                )}
              </div>
              {e.rowName && e.rowName !== e.text && (
                <div className="faint ellipsis" style={{ fontSize: 11 }}>
                  {e.rowName}
                </div>
              )}
            </div>
            {e.state && (
              <span className={`badge ${STATE_LABEL[e.state].cls}`} title={STATE_LABEL[e.state].title}>
                {STATE_LABEL[e.state].text}
              </span>
            )}
          </div>
        ))}
        {total > entries.length && (
          <div className="empty">
            {entries.length} of {total} shown: refine the search.
          </div>
        )}
      </div>
    </div>
  )
}
