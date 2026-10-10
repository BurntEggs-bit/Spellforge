/** The Animations page's category properties (Shift+F3): its TAE id and header. */
import { useState, useEffect } from 'react'
import type { AnimCategoryProperties } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'

/** Shift+F3: a category's TAE file. */
export function CategoryPropertiesDialog({
  category,
  onClose,
  onDone,
}: {
  category: number
  onClose: () => void
  onDone: () => void
}) {
  const ui = useUi()
  const [p, setP] = useState<AnimCategoryProperties | null>(null)
  const [taeId, setTaeId] = useState('')
  useEffect(() => {
    call('anim:categoryProperties', { category })
      .then((x) => {
        setP(x)
        setTaeId(String(x.taeId))
      })
      .catch(ui.error)
  }, [category, ui])
  if (!p) return null
  const n = Number(taeId)
  const apply = () =>
    call('anim:setCategoryProperties', { category, taeId: n })
      .then((x) => {
        setP(x)
        onDone()
        onClose()
      })
      .catch(ui.error)
  return (
    <Modal
      escapeCloses
      title={`Category ${p.label}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
          <button className="primary" disabled={!/^\d+$/.test(taeId) || n === p.taeId} onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="fields" style={{ gridTemplateColumns: '150px 1fr' }}>
        <div className="field-label">TAE id</div>
        <div className="field-value">
          <div className="field-input">
            <input
              className="mono"
              style={{ width: 110 }}
              value={taeId}
              onChange={(e) => setTaeId(e.target.value.replace(/\D/g, '').slice(0, 9))}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              the game’s own files use 2000 + category ({2000 + category})
            </span>
          </div>
        </div>
        <div className="field-label">File</div>
        <div className="field-value mono faint meta" style={{ fontSize: 12, wordBreak: 'break-all' }}>
          <span>{p.entryName}</span>
          <span>binder id {p.entryId}</span>
        </div>
        <div className="field-label">Contents</div>
        <div className="field-value dim">
          {p.animations} animations, {p.events.toLocaleString()} events
        </div>
        {p.header.map((h) => (
          <div key={h.name} style={{ display: 'contents' }}>
            <div className="field-label">{h.name}</div>
            <div className="field-value mono faint" style={{ fontSize: 12 }}>
              {h.value}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
