/** The Animations page's Name and tags dialog (F2). */
import { useState } from 'react'
import { describeAnimationId } from '../../../shared/animIds.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'

/** F2: the project's own name for an animation, and tags to find it by. */
export function RenameDialog({
  name,
  title,
  tags,
  onClose,
  onDone,
}: {
  name: string
  title?: string
  tags?: string[]
  onClose: () => void
  onDone: () => void
}) {
  const ui = useUi()
  const [t, setT] = useState(title ?? '')
  const [g, setG] = useState((tags ?? []).join(', '))
  const save = () =>
    call('anim:setNote', {
      name,
      title: t,
      tags: g
        .split(/[,#]/)
        .map((x) => x.trim())
        .filter(Boolean),
    })
      .then(() => {
        onDone()
        onClose()
      })
      .catch(ui.error)
  return (
    <Modal
      escapeCloses
      title={`Name ${name}`}
      width={500}
      onClose={onClose}
      footer={
        <>
          <span className="grow faint" style={{ fontSize: 12 }}>
            Kept in the project (.spellforge/animation-notes.json); the game never sees it.
          </span>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="fields" style={{ gridTemplateColumns: '90px 1fr' }}>
        <div className="field-label">Name</div>
        <div className="field-value">
          <input
            autoFocus
            value={t}
            placeholder={describeAnimationId(Number(name.slice(5))) ?? 'e.g. Heavy slam, frost version'}
            onChange={(e) => setT(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <div className="field-label">Tags</div>
        <div className="field-value">
          <input
            value={g}
            placeholder="comma separated: frost, wip, boss"
            onChange={(e) => setG(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
      </div>
    </Modal>
  )
}
