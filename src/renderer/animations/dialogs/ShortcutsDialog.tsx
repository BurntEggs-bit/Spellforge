/** The Animations page's shortcuts sheet (F1), listed from the keymap that handles them. */
import { Modal } from '../../shared/Modal.tsx'
import { KEYMAP } from '../keymap.ts'

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal escapeCloses title="Animation shortcuts" width={640} onClose={onClose}>
      <div className="shortcut-list">
        {KEYMAP.flatMap((s) => (s.label ? [s.label] : [])).map(([keys, what]) => (
          <div key={keys} style={{ display: 'contents' }}>
            <span className="mono shortcut-keys">{keys}</span>
            <span className="dim">{what}</span>
          </div>
        ))}
      </div>
    </Modal>
  )
}
