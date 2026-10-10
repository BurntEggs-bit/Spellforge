/**
 * The Events page's event: its lines in plain words (the ids in them open
 * what they are), what starts it, and its test marker; for the project's
 * own events, their recipe to edit. A recipe being made shows here too.
 */
import type { EventLineView, EventRefView } from '../../../shared/api.ts'
import { useIdLookup } from '../../ids/IdLookup.tsx'
import { EventRecipeEditor } from '../EventRecipeEditor.tsx'
import { recipeSentence } from '../labels.ts'
import { useEvents } from '../pageContext.ts'

export function EventPanel() {
  const t = useEvents()
  const v = t.view
  if (t.editing)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="inspector">
            <EventRecipeEditor
              recipe={t.editing}
              files={t.files.filter((f) => f.canAdd)}
              onCancel={() => t.setEditing(null)}
              onSave={t.saveRecipe}
            />
          </div>
        </div>
      </div>
    )
  if (!v)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty">Pick an event, or add one of your own (+ Add).</div>
        </div>
      </div>
    )
  const recipe = v.recipe
  return (
    <div className="panel">
      <div className="panel-body">
        <div className="inspector">
          <div className="inspector-head">
            <div className="row">
              <span className="badge kind">Event</span>
              {recipe && <span className="badge added">yours</span>}
              <span className="mono faint">{v.file}</span>
            </div>
            <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <h2 className="grow">Event {v.id}</h2>
              <div className="toolbar">
                {recipe && (
                  <>
                    <button onClick={() => t.setEditing(recipe)}>Edit</button>
                    <button onClick={() => t.deleteRecipe(recipe)} title="Takes it out of the script on Save">
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="meta dim" style={{ fontSize: 12 }}>
              <span>{v.restarts ? 'Starts again when you rest at a grace' : 'Runs once per load'}</span>
              <span>
                {v.lines.length} line{v.lines.length === 1 ? '' : 's'}
              </span>
              {v.parameters > 0 && <span>takes {v.parameters} values from what starts it</span>}
            </div>
            {recipe && <div className="dim">{recipeSentence(recipe)}.</div>}
            <label
              className="row"
              title="Gives a Rowa Fruit (item lot 997200) the moment the event starts: proof that it runs. Take it off when you're done."
            >
              <input type="checkbox" checked={v.marker} onChange={(e) => t.setMarker(e.target.checked)} />
              <span className="dim">Test marker: a Rowa Fruit when it starts</span>
            </label>
          </div>
          <section className="section">
            <header>
              <h3>Started by</h3>
            </header>
            <div className="content">
              {v.runsAlone ? (
                <div className="dim">The game runs it whenever the script loads.</div>
              ) : v.startedBy.length ? (
                v.startedBy.slice(0, 60).map((s, k) => (
                  <div key={k} className="row" style={{ fontSize: 12 }}>
                    <button
                      className="ref-link"
                      onClick={() => (s.file ? t.selectFile(s.file) : t.selectEvent(s.event))}
                      title={s.file ? `Open ${s.file}` : `Open event ${s.event}`}
                    >
                      {s.file ? `${s.file}, event ${s.event}` : `Event ${s.event}`}
                    </button>
                    <span className="faint">
                      {s.slot ? `slot ${s.slot}` : ''}
                      {s.args.some((a) => a !== 0) ? ` with ${s.args.join(', ')}` : ''}
                    </span>
                  </div>
                ))
              ) : (
                <div className="warn" style={{ fontSize: 12 }}>
                  Nothing in this script starts it, so it never runs.
                </div>
              )}
            </div>
          </section>
          <section className="section">
            <header>
              <h3>What it does</h3>
            </header>
            <div className="content event-lines">
              {v.lines.map((l) => (
                <Line key={l.index} line={l} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Opens what an id in a line is: its row, the event, or What is this ID?. */
function useOpenRef() {
  const t = useEvents()
  const lookup = useIdLookup()
  return (r: EventRefView) => {
    if (r.kind === 'itemLot') t.onOpenRow('ItemLotParam_map', r.value)
    else if (r.kind === 'speffect') t.onOpenRow('SpEffectParam', r.value)
    else if (r.kind === 'event' && t.events.some((e) => e.id === r.value)) t.selectEvent(r.value)
    else lookup(r.value)
  }
}

/** One line: its number, its words, and its ids as links. */
function Line({ line }: { line: EventLineView }) {
  const open = useOpenRef()
  const parts = line.text.split(/(\d+)/)
  return (
    <div className={`event-line${line.known ? '' : ' unknown'}`} title={line.code}>
      <span className="mono faint">{line.index}</span>
      <span>
        {parts.map((p, k) => {
          const ref = /^\d+$/.test(p) ? line.refs.find((r) => String(r.value) === p) : undefined
          return ref ? (
            <button key={k} className="ref-link inline" onClick={() => open(ref)} title={REF_TITLE[ref.kind] ?? ''}>
              {p}
            </button>
          ) : (
            <span key={k}>{p}</span>
          )
        })}
        {line.argument && (
          <span className="faint" title="Some of its values are handed to the event by what starts it">
            {' '}
            (from what starts it)
          </span>
        )}
      </span>
    </div>
  )
}

const REF_TITLE: Record<string, string> = {
  flag: 'What is this flag?',
  entity: 'What the maps place with this id',
  area: 'Which region this is',
  itemLot: 'Open the item lot',
  speffect: 'Open the SpEffect',
  event: 'Open the event',
  text: 'Which text this is',
  sound: 'What is this id?',
}
