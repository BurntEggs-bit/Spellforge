/**
 * The Animations page's Events panel: the animation's name, motion and
 * registration, its timeline, and the selected event or events.
 */
import { categoryLabel, describeAnimationId, animationIdText } from '../../../shared/animIds.ts'
import type { AnimationView, AnimEventEdit } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { IconUndo, IconPlus } from '../../shared/icons.tsx'
import { MenuButton } from '../../shared/menu.tsx'
import { downloadText, pickTextFile } from '../../lib/files.ts'
import { useUi, StateBadge } from '../../shared/ui.tsx'
import type { PlayClock } from '../../viewer/PlayClock.ts'
import type { AnimDialog } from '../useAnimationsPage.ts'
import { useCopiedEvents } from '../eventClipboard.ts'
import { FPS, frameNumber } from '../../../shared/frames.ts'
import { plural } from '../../../shared/format.ts'
import { RegDot } from '../RegDot.tsx'
import { EventInspector } from './EventInspector.tsx'
import { type LaneOrder, Timeline } from './Timeline.tsx'

export function AnimationEditor({
  view,
  eventIndex,
  selection,
  onSelectEvent,
  onSelectMany,
  onApplied,
  onAddEvent,
  onDuplicateEvent,
  onDeleteEvent,
  onDeleteSelected,
  onDuplicate,
  onDelete,
  onRegister,
  onOpenAnimation,
  onOpenRow,
  onOpenEffect,
  onUndo,
  onRedo,
  history,
  onDialog,
  onCopy,
  onPaste,
  muted,
  mutedTypes,
  onUnmuteTypes,
  colors,
  onPickColor,
  onResetColors,
  laneOrder,
  onLaneOrder,
  clock,
  weapon,
  onParamsEdited,
  version,
}: {
  clock: PlayClock
  /** The weapon in the viewport's right hand: judge ids are read for it. */
  weapon: { id: number; name: string } | null
  onParamsEdited: () => void
  /** Bumped when params change (a behavior row edited elsewhere). */
  version: number
  view: AnimationView
  eventIndex: number | null
  selection: number[]
  onSelectEvent: (i: number | null) => void
  onSelectMany: (indices: number[], focus: number | null) => void
  onApplied: (v: AnimationView) => void
  onAddEvent: () => void
  onDuplicateEvent: (i: number) => void
  onDeleteEvent: (i: number) => void
  onDeleteSelected: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRegister: () => void
  onOpenAnimation: (name: string) => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
  onUndo: () => void
  onRedo: () => void
  history: { undo: number; redo: number }
  onDialog: (d: AnimDialog) => void
  onCopy: (cut: boolean) => void
  onPaste: () => void
  muted: { mute: number[]; solo: number[] } | null
  mutedTypes: number[]
  onUnmuteTypes: () => void
  colors: Record<string, string>
  onPickColor: (type: number, current?: string) => void
  onResetColors: () => void
  laneOrder: LaneOrder
  onLaneOrder: (o: LaneOrder) => void
}) {
  const ui = useUi()
  const copied = useCopiedEvents()
  const ev = eventIndex !== null ? (view.events[eventIndex] ?? null) : null
  const edit = (req: Omit<AnimEventEdit, 'name'>) =>
    call('anim:setEvent', { name: view.name, ...req })
      .then(onApplied)
      .catch(ui.error)
  const exportEvents = (scope: 'one' | 'category') =>
    call('anim:exportText', scope === 'one' ? { names: [view.name] } : { category: view.category })
      .then((text) => downloadText(`${scope === 'one' ? view.name : categoryLabel(view.category)} events.txt`, text))
      .catch(ui.error)
  const exportNotes = () =>
    call('anim:notes', undefined)
      .then((n) => downloadText('animation names.json', JSON.stringify(n, null, 1), 'application/json'))
      .catch(ui.error)
  const importNotes = async () => {
    const f = await pickTextFile('.json,.txt,.csv')
    if (!f) return
    try {
      const r = await call('anim:importNotes', { text: f.text, replace: false })
      ui.toast(`Read ${plural(r.count, 'animation name')} from ${f.name}. Saved with the project.`)
      onApplied(await call('anim:get', { name: view.name }))
    } catch (e) {
      ui.error(e)
    }
  }

  const selectorsHave = view.selectors.filter((s) => s.registered).length
  const many = selection.length > 1
  return (
    <div className="inspector anim-editor">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <h2 className="mono">{view.name}</h2>
            <StateBadge state={view.state} />
            {describeAnimationId(view.id) && <span className="anim-what">{describeAnimationId(view.id)}</span>}
            {view.title && (
              <button className="anim-title" title="Your name for it (F2)" onClick={() => onDialog({ kind: 'rename' })}>
                {view.title}
              </button>
            )}
            {view.tags?.map((t) => (
              <span key={t} className="anim-tag">
                #{t}
              </span>
            ))}
          </div>
          <div className="dim meta" style={{ marginTop: 4 }}>
            {view.motion === 'own' && <span className="mono">{view.motionFile}</span>}
            {view.motion === 'motion' && (
              <span title="Plays that animation's motion, with events of its own">
                motion of{' '}
                <button className="ref-link mono" onClick={() => view.source && onOpenAnimation(view.source)}>
                  {view.source}
                </button>
              </span>
            )}
            {view.motion === 'full' && (
              <span title="Uses everything from that animation: its events are edited there">
                all from{' '}
                <button className="ref-link mono" onClick={() => view.source && onOpenAnimation(view.source)}>
                  {view.source}
                </button>
              </span>
            )}
            <span>{plural(view.events.length, 'event')}</span>
            <span>{frameNumber(view.length)} frames</span>
            {view.registration === 'registered' && (
              <span
                className="reg-ok row"
                style={{ gap: 5, display: 'inline-flex' }}
                title={
                  view.selectors.length
                    ? `In ${selectorsHave} of ${plural(view.selectors.length, 'behaviour selector')} for animation ID ${animationIdText(view.id)}`
                    : 'The behaviour graph has a clip for it'
                }
              >
                <RegDot r="registered" /> playable
              </span>
            )}
          </div>
        </div>
        <div className="toolbar">
          <button
            onClick={onDuplicate}
            title="Copy this animation to a new category or id; the copy reuses this motion"
          >
            Duplicate…
          </button>
          <MenuButton
            label="More ▾"
            className="ghost"
            title="Name, properties, import, export"
            width={320}
            items={[
              {
                label: 'Name and tags…',
                shortcut: 'F2',
                hint: 'Your own name for it, and tags to find it by',
                run: () => onDialog({ kind: 'rename' }),
              },
              {
                label: 'Properties…',
                shortcut: 'F3',
                hint: 'Its id, category and which motion it plays',
                run: () => onDialog({ kind: 'properties' }),
              },
              {
                label: 'Import events…',
                shortcut: 'Ctrl+I',
                hint: 'Another animation’s events, added or in place of these',
                run: () => onDialog({ kind: 'import' }),
              },
              {
                label: 'Category properties…',
                shortcut: 'Shift+F3',
                hint: 'Its TAE id and header',
                run: () => onDialog({ kind: 'categoryProperties' }),
              },
              {
                label: 'Move the category to a new number…',
                shortcut: 'Shift+F2',
                hint: 'Weapons and skills using it can follow',
                run: () => onDialog({ kind: 'renumber' }),
              },
              null,
              {
                label: 'Export this animation’s events',
                hint: 'A text file: every event by frame, with its fields',
                run: () => exportEvents('one'),
              },
              {
                label: `Export every ${categoryLabel(view.category)} animation’s events`,
                hint: 'The whole category as text',
                run: () => exportEvents('category'),
              },
              { label: 'Export animation names', hint: 'Your names and tags, as JSON', run: exportNotes },
              {
                label: 'Import animation names…',
                hint: 'JSON from Export, or lines like “a050_030000 = Heavy slam”',
                run: importNotes,
              },
              null,
              { label: 'Keyboard shortcuts', shortcut: 'F1', run: () => onDialog({ kind: 'shortcuts' }) },
              { label: 'Delete this animation', hint: 'From the project (Ctrl+Z undoes it)', run: onDelete },
            ]}
          />
        </div>
      </div>

      {view.registration !== 'registered' && (
        <div className={`reg-banner ${view.registration}`}>
          <RegDot r={view.registration} />
          <span className="grow">
            {view.registration === 'missing' &&
              `Not playable yet: ${plural(view.selectors.length, 'behaviour selector')} handle animation ID ${animationIdText(view.id)}, but none has a clip for ${view.name}.`}
            {view.registration === 'unsupported' &&
              `No behaviour selector handles animation ID ${animationIdText(view.id)}; registering needs a selector for it (the game’s states call animations by ID).`}
          </span>
          {view.registration === 'missing' && (
            <button
              className="primary"
              onClick={onRegister}
              title="Add a clip to every selector for this ID, like ERClipGeneratorTool"
            >
              Register
            </button>
          )}
        </div>
      )}

      <section className="section">
        <header>
          <h3>Events</h3>
          <span
            className="faint tl-hint"
            title="Drag to move, drag edges to resize, Alt: no frame snapping. Ctrl+click or drag a box to select several; drag one to move them together. Double-click a lane to add an event of its type. F1: every shortcut."
          >
            {many ? `${selection.length} selected` : `${FPS} fps`}
          </span>
          <select
            className="tl-order"
            value={laneOrder}
            onChange={(e) => onLaneOrder(e.target.value as LaneOrder)}
            title="How the lanes are ordered: by kind of event, by type number, or by when each type first happens"
          >
            <option value="kind">By kind</option>
            <option value="type">By type</option>
            <option value="time">By time</option>
          </select>
          <button className="ghost icon" onClick={onUndo} disabled={!history.undo} title="Undo the last edit (Ctrl+Z)">
            <IconUndo size={14} />
            Undo
          </button>
          <button className="ghost icon" onClick={onRedo} disabled={!history.redo} title="Redo (Ctrl+Y)">
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
              <IconUndo size={14} />
            </span>
            Redo
          </button>
          <button className="icon" onClick={onAddEvent} title="Add an event">
            <IconPlus size={14} />
            Event
          </button>
        </header>
        <Timeline
          clock={clock}
          view={view}
          selected={eventIndex}
          selection={selection}
          onSelect={(i, mode) => {
            if (i === null) return onSelectEvent(null)
            if (mode === 'replace') return onSelectEvent(i)
            const has = selection.includes(i)
            if (mode === 'focus') return onSelectMany(selection.length ? selection : [i], i)
            if (mode === 'toggle' && has)
              return onSelectMany(
                selection.filter((x) => x !== i),
                eventIndex === i ? null : eventIndex,
              )
            onSelectMany([...selection, i], i)
          }}
          onSelectMany={onSelectMany}
          onTimes={(edits) =>
            (edits.length === 1
              ? call('anim:setEvent', {
                  name: view.name,
                  index: edits[0].index,
                  start: edits[0].start,
                  end: edits[0].end,
                })
              : call('anim:setEvents', { name: view.name, edits })
            )
              .then(onApplied)
              .catch(ui.error)
          }
          onAdd={(type, t) =>
            call('anim:addEvent', { name: view.name, type, start: t, end: t + 3 / FPS })
              .then((r) => {
                onApplied(r.view)
                onSelectEvent(r.index)
              })
              .catch(ui.error)
          }
          muted={muted}
          mutedTypes={mutedTypes}
          colors={colors}
          order={laneOrder}
          onColor={onPickColor}
        />
        {muted?.mute.length || muted?.solo.length || mutedTypes.length || Object.keys(colors).length ? (
          <div className="tl-status faint meta">
            {muted?.solo.length ? <span>{muted.solo.length} soloed in the viewer</span> : null}
            {muted?.mute.length ? <span>{muted.mute.length} muted in the viewer (3 clears)</span> : null}
            {mutedTypes.length ? (
              <span>
                {plural(mutedTypes.length, 'event type')} muted everywhere{' '}
                <button className="ref-link" onClick={onUnmuteTypes}>
                  unmute
                </button>
              </span>
            ) : null}
            {Object.keys(colors).length ? (
              <span>
                {plural(Object.keys(colors).length, 'lane color')}{' '}
                <button className="ref-link" onClick={onResetColors}>
                  reset
                </button>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      {many ? (
        <div className="multi-note">
          <b>{selection.length} events selected.</b> Drag one to move them together. Delete removes them; Ctrl+C or
          Ctrl+X copies or cuts them, and Ctrl+V pastes at the playhead, in any animation. 1 mutes and 2 solos them in
          the viewer.
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <button className="ghost icon" onClick={() => onCopy(false)}>
              Copy
            </button>
            <button className="ghost icon" onClick={() => onCopy(true)}>
              Cut
            </button>
            <button className="ghost icon" onClick={onDeleteSelected}>
              Delete {selection.length}
            </button>
            <span className="grow" />
            <button className="ghost icon" onClick={() => onSelectEvent(null)}>
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {!many && copied?.length ? (
        <div className="faint" style={{ fontSize: 11.5, textAlign: 'right' }}>
          {plural(copied.length, 'event')} copied:{' '}
          <button className="ref-link" onClick={onPaste}>
            paste at the playhead (Ctrl+V)
          </button>
        </div>
      ) : null}

      {ev && !many ? (
        <EventInspector
          key={`${view.name}:${ev.index}`}
          ev={ev}
          animation={view.name}
          onEdit={(req) => edit({ index: ev.index, ...req })}
          onDuplicate={() => onDuplicateEvent(ev.index)}
          onDelete={() => onDeleteEvent(ev.index)}
          onOpenRow={onOpenRow}
          onOpenEffect={onOpenEffect}
          weapon={weapon}
          onParamsEdited={onParamsEdited}
          version={version}
        />
      ) : null}
    </div>
  )
}
