/** The Animations page's Add event dialog. */
import { useState, useEffect } from 'react'
import type { AnimEventType } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { Modal } from '../../shared/Modal.tsx'
import { kindOf } from '../editor/events.ts'

/** Picks an event type to add (DS Anim Studio's template), searched by name or number. */
export function EventTypePicker({ onClose, onPick }: { onClose: () => void; onPick: (type: number) => void }) {
  const [types, setTypes] = useState<AnimEventType[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    call('anim:eventTypes', undefined).then(setTypes)
  }, [])
  const q = query.trim().toLowerCase()
  const shown = types.filter((t) => !q || t.name.toLowerCase().includes(q) || String(t.type) === q).slice(0, 200)
  return (
    <Modal title="Add an event" width={560} onClose={onClose} escapeCloses>
      <input
        autoFocus
        placeholder="Search: FFX, SpEffect, Behavior, sound… or a type number"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && shown[0] && onPick(shown[0].type)}
      />
      <div className="type-list">
        {shown.map((t) => (
          <div key={t.type} className="list-item" onClick={() => onPick(t.type)}>
            <span className={`kind-dot kind-${kindOf(t.name)}`} />
            <span className="grow ellipsis">{t.name}</span>
            <span className="faint mono" style={{ fontSize: 11 }}>
              {t.uses ? `${t.uses.toLocaleString()} uses` : 'unused in game'}
            </span>
            <span className="id">{t.type}</span>
          </div>
        ))}
      </div>
      <div className="faint" style={{ fontSize: 11 }}>
        Event names and fields: DS Anim Studio’s Elden Ring template (MIT, Meowmaritus).
      </div>
    </Modal>
  )
}
