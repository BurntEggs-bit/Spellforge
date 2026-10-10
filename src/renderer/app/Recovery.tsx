/**
 * Unsaved changes kept from last time (src/main/services/recovery.ts): the
 * start screen lists the projects that have some, and opening one asks to
 * bring them back, exactly as they were and still unsaved.
 */
import { useState } from 'react'
import type { RecoveryInfo } from '../../shared/api.ts'
import { InActiveWindow } from '../shared/ui.tsx'
import { ModalShell } from '../shared/Modal.tsx'
import { plural } from '../../shared/format.ts'

const whenText = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
/** The project's folder as people know it: "Bloody Scythe/mod". */
const projectLabel = (modDir: string) => modDir.split(/[\\/]/).filter(Boolean).slice(-2).join('/')

/** Asked when a project with kept changes opens. */
export function RestoreDialog({
  info,
  onRestore,
  onDiscard,
}: {
  info: RecoveryInfo
  onRestore: () => void
  onDiscard: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <InActiveWindow>
      <ModalShell style={{ width: 'min(580px, 94vw)' }}>
        <header>
          <h2 className="grow">Unsaved changes from last time</h2>
        </header>
        <div className="body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            Spellforge closed before <b>{plural(info.changes, 'change')}</b> to this project were saved (the last one{' '}
            {whenText(info.last)}). Bring them back? They return exactly as they were, still unsaved: save to write them
            into your mod folder.
          </div>
          {(info.filesChanged || info.gameChanged) && (
            <div className="version-note warn">
              {info.filesChanged
                ? 'Your mod folder’s files changed since (saved by another tool, or copied over). '
                : ''}
              {info.gameChanged ? 'The game was updated since. ' : ''}
              The changes are made again on the files as they are now, so a few may come out differently.
            </div>
          )}
          {confirming && (
            <div className="version-note warn">Discarding can’t be undone: those changes are gone for good.</div>
          )}
        </div>
        <footer>
          <span className="grow" />
          {confirming ? (
            <>
              <button onClick={() => setConfirming(false)}>Keep them</button>
              <button className="danger" onClick={onDiscard}>
                Discard for good
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirming(true)}>Discard them…</button>
              <button className="primary" onClick={onRestore}>
                Restore them
              </button>
            </>
          )}
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}

/** On the start screen: the projects Spellforge closed on with changes unsaved. */
export function KeptChanges({ list, onRestore }: { list: RecoveryInfo[]; onRestore: (modDir: string) => void }) {
  if (!list.length) return null
  return (
    <section className="section kept-changes">
      <header>
        <h3>Unsaved changes from last time</h3>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((k) => (
          <div key={k.modDir} className="row">
            <span className="grow">
              <b>{projectLabel(k.modDir)}</b>{' '}
              <span className="faint">
                {plural(k.changes, 'change')}, the last {whenText(k.last)}
              </span>
            </span>
            <button className="primary" onClick={() => onRestore(k.modDir)} title={k.modDir}>
              Open and restore
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
