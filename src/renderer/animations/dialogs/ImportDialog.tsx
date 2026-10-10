/** The Animations page's Import events dialog (Ctrl+I). */
import { useState } from 'react'
import { describeAnimationId } from '../../../shared/animIds.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'
import { parseAnimationInput } from './animationInput.ts'

/** Ctrl+I: another animation's events into this one. */
export function ImportDialog({
  name,
  category,
  onClose,
  onDone,
}: {
  name: string
  category: number
  onClose: () => void
  onDone: () => void
}) {
  const ui = useUi()
  const [from, setFrom] = useState('')
  const [mode, setMode] = useState<'replace' | 'add'>('add')
  const [motion, setMotion] = useState(false)
  const src = parseAnimationInput(from, category)
  const go = () =>
    src &&
    ui.run('Copying events', async () => {
      await call('anim:importEvents', { name, from: src, mode, motion })
      onDone()
      onClose()
    })
  return (
    <Modal
      escapeCloses
      title={`Import events into ${name}`}
      width={540}
      onClose={onClose}
      footer={
        <>
          <span className="grow faint" style={{ fontSize: 12 }}>
            Ctrl+Z undoes it.
          </span>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!src || src === name} onClick={go}>
            Import
          </button>
        </>
      }
    >
      <div className="fields" style={{ gridTemplateColumns: '120px 1fr' }}>
        <div className="field-label">From</div>
        <div className="field-value">
          <div className="field-input">
            <input
              autoFocus
              className="mono"
              placeholder="a050_030000, or 030000 in this category"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && go()}
            />
          </div>
          <div className="field-hint">
            {src
              ? `${src}${describeAnimationId(Number(src.slice(5))) ? `: ${describeAnimationId(Number(src.slice(5)))}` : ''}`
              : 'Any category’s animation (or one of another weapon’s).'}
          </div>
        </div>
        <div className="field-label">Its events</div>
        <div className="field-value">
          <label className="row">
            <input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} />
            Add them to this animation’s events
          </label>
          <label className="row">
            <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            Replace this animation’s events with them
          </label>
        </div>
        <div className="field-label">Motion</div>
        <div className="field-value">
          <label className="row">
            <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} />
            Play its motion too
          </label>
        </div>
      </div>
    </Modal>
  )
}
