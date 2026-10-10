/** The Enemies page's list of characters, searched by name, alias or model. */
import { useEnemies } from '../pageContext.ts'

export function CharactersPanel() {
  const p = useEnemies()
  const q = p.query.trim().toLowerCase()
  const shown = (p.list ?? []).filter(
    (e) =>
      !q || e.name.toLowerCase().includes(q) || e.chr.includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q)),
  )
  return (
    <div className="panel">
      <div className="panel-head">
        <input
          placeholder="Search by name or model (c2130)"
          value={p.query}
          onChange={(e) => p.setQuery(e.target.value)}
        />
        <div className="faint" style={{ fontSize: 12 }}>
          {p.list ? `${shown.length} of ${p.list.length} characters` : 'Reading…'}
        </div>
      </div>
      <div className="panel-body">
        {p.list && !shown.length && <div className="empty">No character matches.</div>}
        {shown.slice(0, 600).map((e) => (
          <div
            key={e.chr}
            className={`list-item${p.chr === e.chr ? ' selected' : ''}`}
            onClick={() => p.pickCharacter(e.chr)}
            title={e.aliases.length ? `Also: ${e.aliases.join(', ')}` : undefined}
          >
            <span className="grow ellipsis">{e.name === e.chr ? <span className="faint">Unnamed</span> : e.name}</span>
            {e.bundle && (
              <span
                className="badge"
                title="Has effects of its own (only loaded with it): Spellforge copies the ones you use into the common effects"
              >
                own fx
              </span>
            )}
            <span className="id">{e.chr}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
