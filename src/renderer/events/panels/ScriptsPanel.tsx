/** The Events page's scripts: the common one, the shared events, then one per map; filtered by name or id. */
import { useEvents } from '../pageContext.ts'

export function ScriptsPanel() {
  const t = useEvents()
  return (
    <div className="panel">
      <div className="panel-head">
        <input
          placeholder="Filter by map name or id"
          value={t.fileFilter}
          onChange={(e) => t.setFileFilter(e.target.value)}
        />
        <label
          className="row dim"
          style={{ fontSize: 12 }}
          title="Only scripts with your events, markers or your own copy"
        >
          <input type="checkbox" checked={t.onlyMine} onChange={(e) => t.setOnlyMine(e.target.checked)} />
          Only mine
        </label>
      </div>
      <div className="panel-body">
        {t.shownFiles.length === 0 && <div className="empty">Nothing matches.</div>}
        {t.shownFiles.map((f) => (
          <div
            key={f.file}
            className={`list-item${t.file === f.file ? ' selected' : ''}`}
            onClick={() => t.selectFile(f.file)}
            title={
              f.file === 'common'
                ? 'Runs whatever map you are in'
                : f.file === 'common_func'
                  ? 'Events the maps start with values of their own (fog walls, ambushes, graces…)'
                  : `Runs while ${f.title || f.file} is loaded`
            }
          >
            <span className="mono" style={{ minWidth: 104 }}>
              {f.file}
            </span>
            <span className="grow ellipsis dim">{f.title}</span>
            {f.own > 0 && <span className="badge added">{f.own} yours</span>}
            {f.edited && f.own === 0 && <span className="badge changed">edited</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
