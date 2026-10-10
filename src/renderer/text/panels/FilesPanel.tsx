/**
 * The Text page's files: the language, the files in their groups, and a
 * search through all of them.
 */
import { plural } from '../../../shared/format.ts'
import { fileKey } from '../labels.ts'
import { useText } from '../pageContext.ts'

export function FilesPanel() {
  const t = useText()
  const { hits, groups, current, filter } = t
  return (
    <div className="panel">
      <div className="panel-head">
        <select value={t.lang} onChange={(e) => t.setLang(e.target.value)} title="Language">
          {t.languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <input
          placeholder={`Search all ${t.langName} text`}
          value={t.searchAll}
          onChange={(e) => t.setSearchAll(e.target.value)}
        />
        {!hits && (
          <input placeholder="Filter files" value={t.fileFilter} onChange={(e) => t.setFileFilter(e.target.value)} />
        )}
        <label
          className="row dim"
          style={{ fontSize: 12 }}
          title="Only the files and entries you added, changed or removed"
        >
          <input
            type="checkbox"
            checked={filter === 'edited'}
            onChange={(e) => t.setFilter(e.target.checked ? 'edited' : 'all')}
          />
          Only what I edited ({t.editedCount})
        </label>
        {t.outdated > 0 && (
          <div className="version-note warn">
            <div>
              {t.base && !t.base.installed ? (
                <>
                  Your project’s text was made with game version <b>{t.base.version}</b>. Your installed game has{' '}
                  <b>{t.outdated.toLocaleString()}</b> newer entries it doesn’t have.
                </>
              ) : (
                <>
                  The installed game has <b>{t.outdated.toLocaleString()}</b> entries your text files lack.
                </>
              )}{' '}
              In game your copy replaces the game’s whole file, so those would show old text or nothing.
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <button
                className={filter === 'outdated' ? 'active' : ''}
                onClick={() => t.setFilter(filter === 'outdated' ? 'all' : 'outdated')}
              >
                {filter === 'outdated' ? 'Show everything' : 'Show them'}
              </button>
              <button
                className="primary"
                onClick={() => t.updateFromGame()}
                title="Adds the game's new entries and newer text; your own edits stay"
              >
                Update from game
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="panel-body">
        {hits ? (
          <>
            <div className="faint" style={{ padding: '2px 4px 6px' }}>
              {hits.length >= 300 ? 'First 300 matches' : `${plural(hits.length, 'match', 'matches')}`}
              <button className="ghost" style={{ marginLeft: 6 }} onClick={() => t.setSearchAll('')}>
                clear
              </button>
            </div>
            {hits.map((h) => (
              <div
                key={`${h.rel}|${h.file}|${h.id}`}
                className="list-item text-hit"
                onClick={() => t.open(h.rel, h.file, h.id)}
              >
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">{h.text.split('\n')[0]}</div>
                  <div className="faint ellipsis" style={{ fontSize: 11 }}>
                    {h.title} <span className="mono">{h.id}</span>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            {groups.length === 0 && (
              <div className="empty">
                {filter === 'edited' ? 'No edited text in this language.' : 'Nothing matches.'}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="param-group-head" style={{ cursor: 'default' }}>
                  <span className="grow">{g.label}</span>
                </div>
                {g.items.map((f) => (
                  <div
                    key={fileKey(f)}
                    className={`list-item${current && fileKey(current) === fileKey(f) ? ' selected' : ''}`}
                    onClick={() => t.open(f.rel, f.file)}
                    title={`${f.file}.fmg in ${f.rel}`}
                  >
                    <span className="grow ellipsis">{f.title}</span>
                    {f.edited > 0 && (
                      <span
                        className="badge changed"
                        title={`You added, changed or removed ${plural(f.edited, 'entry', 'entries')}`}
                      >
                        {f.edited} edited
                      </span>
                    )}
                    {f.outdated > 0 && (
                      <span
                        className="badge outdated"
                        title={`The installed game has ${plural(f.outdated, 'newer entry', 'newer entries')} for this file`}
                      >
                        {f.outdated} newer
                      </span>
                    )}
                    <span className="id">{f.count}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
