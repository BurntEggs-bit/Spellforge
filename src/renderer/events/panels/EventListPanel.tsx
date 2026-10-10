/** The Events page's events of the open script: searched by id or what they do, and Add for an event of your own. */
import { MenuButton } from '../../shared/menu.tsx'
import { EVENT_KINDS } from '../labels.ts'
import { useEvents } from '../pageContext.ts'

export function EventListPanel() {
  const t = useEvents()
  const { current } = t
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          {current ? (
            <b className="grow ellipsis">
              {current.file} <span className="dim">{current.title}</span>
            </b>
          ) : (
            <span className="grow faint">No script selected.</span>
          )}
          <MenuButton
            label="+ Add ▾"
            className="primary"
            width={360}
            items={EVENT_KINDS.map((k) => ({ label: k.label, hint: k.hint, run: () => t.startRecipe(k.kind) }))}
          />
        </div>
        {current && (
          <input
            placeholder="Search by id or what it does"
            value={t.eventFilter}
            onChange={(e) => t.setEventFilter(e.target.value)}
          />
        )}
      </div>
      <div className="panel-body">
        {current && t.shownEvents.length === 0 && <div className="empty">Nothing matches.</div>}
        {t.shownEvents.map((e) => (
          <div
            key={e.id}
            className={`list-item${t.selected === e.id ? ' selected' : ''}`}
            onClick={() => t.selectEvent(e.id)}
          >
            <span className="id" style={{ minWidth: 92 }}>
              {e.id}
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="ellipsis">{e.about || <span className="faint">{e.lines} lines</span>}</div>
            </div>
            {e.recipe && <span className="badge added">yours</span>}
            {e.marker && (
              <span className="badge changed" title="Gives a Rowa Fruit when it starts">
                marker
              </span>
            )}
            {!e.started && (
              <span className="faint" style={{ fontSize: 11 }} title="No line in this script starts it">
                not started
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
