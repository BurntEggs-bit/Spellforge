/** One event's fields: its start and end frames, every field of its type, or its raw bytes. */
import { useState } from 'react'
import { type AnimEventView, FLOAT_MAX } from '../../../shared/api.ts'
import { FPS, frameNumber } from '../../../shared/frames.ts'
import { isOpen, kindOf } from './events.ts'
import { FieldRow } from './FieldRow.tsx'
import { NumberInput } from './NumberInput.tsx'
import { RawEditor } from './RawEditor.tsx'
import { plural } from '../../../shared/format.ts'

export function EventInspector({
  ev,
  animation,
  onEdit,
  onDuplicate,
  onDelete,
  onOpenRow,
  onOpenEffect,
  weapon,
  onParamsEdited,
  version,
}: {
  weapon: { id: number; name: string } | null
  onParamsEdited: () => void
  version: number
  ev: AnimEventView
  /** The animation the event is in. */
  animation: string
  onEdit: (req: {
    start?: number
    end?: number
    field?: { type: string; offset: number; value: number }
    raw?: string
  }) => void
  onDuplicate: () => void
  onDelete: () => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
}) {
  const [showReserved, setShowReserved] = useState(false)
  const reserved = ev.fields.filter((f) => f.reserved)
  const fields = ev.fields.filter((f) => showReserved || !f.reserved)
  return (
    <section className="section">
      <header>
        <span className={`kind-dot kind-${kindOf(ev.typeName)}`} />
        <h3 style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text)' }}>{ev.typeName}</h3>
        <span className="faint mono">type {ev.type}</span>
        <span className="grow" />
        <button className="ghost icon" onClick={onDuplicate} title="Copy this event (Ctrl+D)">
          Duplicate
        </button>
        <button className="ghost icon" onClick={onDelete} title="Delete this event (Delete)">
          Delete
        </button>
      </header>
      <div className="content">
        <div className="fields" style={{ gridTemplateColumns: 'minmax(120px, 34%) 1fr' }}>
          <div className="field-label">Start frame</div>
          <div className="field-value">
            <div className="field-input">
              <NumberInput value={frameNumber(ev.start)} float narrow onCommit={(v) => onEdit({ start: v / FPS })} />
              <span className="faint mono nowrap">{ev.start.toFixed(3)} s</span>
            </div>
          </div>
          <div className="field-label">End frame</div>
          <div className="field-value">
            <div className="field-input">
              {isOpen(ev.end) ? (
                <>
                  <span className="grow dim">Until the animation ends</span>
                  <button className="ghost icon" onClick={() => onEdit({ end: ev.start + 3 / FPS })}>
                    Set an end
                  </button>
                </>
              ) : (
                <>
                  <NumberInput value={frameNumber(ev.end)} float narrow onCommit={(v) => onEdit({ end: v / FPS })} />
                  <span className="faint mono nowrap">{ev.end.toFixed(3)} s</span>
                  <button
                    className="ghost icon"
                    title="Last until the animation ends"
                    onClick={() => onEdit({ end: FLOAT_MAX })}
                  >
                    ∞
                  </button>
                </>
              )}
            </div>
          </div>
          {fields.map((f) => (
            <FieldRow
              key={f.offset + f.name}
              f={f}
              animation={animation}
              onEdit={(value) => onEdit({ field: { type: f.type, offset: f.offset, value } })}
              onOpenRow={onOpenRow}
              onOpenEffect={onOpenEffect}
              weapon={weapon}
              onParamsEdited={onParamsEdited}
              version={version}
              soundType={f.name === 'SoundID' ? ev.fields.find((x) => x.name === 'SoundType')?.value : undefined}
            />
          ))}
        </div>
        {!ev.known && <RawEditor raw={ev.raw} onApply={(raw) => onEdit({ raw })} />}
        <div className="row" style={{ marginTop: 10 }}>
          {reserved.length > 0 && (
            <label className="row faint" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={showReserved} onChange={(e) => setShowReserved(e.target.checked)} />
              Show {plural(reserved.length, 'reserved field')}
            </label>
          )}
          <span className="grow" />
          {ev.known && (
            <details className="faint" style={{ fontSize: 11 }}>
              <summary>Raw bytes</summary>
              <span className="mono" style={{ wordBreak: 'break-all' }}>
                {ev.raw}
              </span>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}
