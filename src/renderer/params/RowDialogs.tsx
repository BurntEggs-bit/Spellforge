/** The Inspector's row dialogs: rename a row, copy it to a free id, delete it. */
import { useState, useEffect } from 'react'
import type { ShopRange, RowReferrer } from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'
import { plural } from '../../shared/format.ts'
import { call } from '../lib/ipc.ts'
import { IdPicker } from '../shared/IdPicker.tsx'
import { Modal } from '../shared/Modal.tsx'
import { InActiveWindow, useUi } from '../shared/ui.tsx'
import { PARAM_LABELS } from './paramLabels.ts'

/** The row dialogs' frame: a title, the content, the buttons at the right of the foot; the backdrop cancels. */
function SmallDialog({
  title,
  children,
  onCancel,
  footer,
}: {
  title: string
  children: React.ReactNode
  onCancel: () => void
  footer: React.ReactNode
}) {
  return (
    <InActiveWindow>
      <Modal
        title={title}
        onClose={onCancel}
        closeButton={false}
        width={480}
        footer={
          <>
            <span className="grow" />
            {footer}
          </>
        }
      >
        {children}
      </Modal>
    </InActiveWindow>
  )
}

/** Renames a row: the name Spellforge keeps with the project, not the in-game name. */
export function RenameRowDialog({
  initial,
  onCancel,
  onConfirm,
}: {
  initial: string
  onCancel: () => void
  onConfirm: (name: string) => void
}) {
  const [name, setName] = useState(initial)
  return (
    <SmallDialog
      title="Rename row"
      onCancel={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => onConfirm(name)}>
            Rename
          </button>
        </>
      }
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onConfirm(name)}
      />
      <div className="faint">Kept with the project (mod\.spellforge). The in-game name is a field of its own.</div>
    </SmallDialog>
  )
}

/** Copies the row alone to a free id (a shop row to a free row of its shop), under a name. */
export function CopyRowDialog({
  param,
  id,
  name,
  onCancel,
  onDone,
}: {
  param: string
  id: number
  name: string
  onCancel: () => void
  onDone: (newId: number) => void
}) {
  const ui = useUi()
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState(name ? `${name} (copy)` : '')
  /** A shop row: the shop it's in, and whether that shop has a free row left. */
  const [shop, setShop] = useState<{ shop: ShopRange | null; full: boolean } | null>(null)
  /** Why no free id could be found, when the lookup failed. */
  const [lookupError, setLookupError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        // A shop lists only its range of rows: a copy goes to the first free one there.
        if (param === 'ShopLineupParam') {
          const s = await call('shop:freeId', { id })
          if (!live) return
          setShop({ shop: s.shop, full: !!s.shop && s.id === null })
          if (s.id !== null) return setNewId(String(s.id))
        }
        const free = await call('row:freeId', { param, from: id + 1 })
        if (live) setNewId(String(free))
      } catch (e) {
        if (live) setLookupError(errorMessage(e))
      }
    })()
    return () => {
      live = false
    }
  }, [param, id])
  const confirm = async () => {
    const n = Number(newId)
    const r = await ui.run('Copying row', () => call('row:add', { param, id: n, copyFrom: id, name: newName }))
    if (r) onDone(n)
  }
  return (
    <SmallDialog
      title={`Copy ${PARAM_LABELS[param] ?? param} row`}
      onCancel={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={!newId} onClick={confirm}>
            Copy
          </button>
        </>
      }
    >
      <div className="dim">
        Only this row. Duplicate… copies a weapon, item, spell, skill, bullet or SpEffect with everything it uses.
      </div>
      {shop?.shop &&
        (shop.full ? (
          <div className="warn">
            {shop.shop.by}’s shop (rows {shop.shop.from}–{shop.shop.to}) has no free row: a copy outside it isn’t sold
            there. Pick an id in another shop’s rows.
          </div>
        ) : (
          <div className="faint">
            In {shop.shop.by}’s shop (rows {shop.shop.from}–{shop.shop.to}).
          </div>
        ))}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <span style={{ width: 70, paddingTop: 5 }}>New id</span>
        {newId ? (
          <IdPicker param={param} value={Number(newId)} onChange={(n) => setNewId(String(n))} />
        ) : lookupError ? (
          <span className="warn-text">No free id found: {lookupError}</span>
        ) : (
          <span className="faint">finding a free id…</span>
        )}
      </div>
      <label className="row">
        <span style={{ width: 70 }}>Name</span>
        <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </label>
    </SmallDialog>
  )
}

/** Deletes the row, listing the rows it would leave pointing at nothing. */
export function DeleteRowDialog({
  param,
  id,
  name,
  onCancel,
  onDone,
}: {
  param: string
  id: number
  name: string
  onCancel: () => void
  onDone: () => void
}) {
  const ui = useUi()
  const [refs, setRefs] = useState<RowReferrer[] | null>(null)
  /** Why the rows pointing at it couldn't be listed, when that failed (it can still be deleted). */
  const [refsError, setRefsError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    call('row:referrers', { param, id }).then(
      (found) => live && setRefs(found),
      (e) => live && setRefsError(errorMessage(e)),
    )
    return () => {
      live = false
    }
  }, [param, id])
  const confirm = async () => {
    const r = await ui.run('Deleting row', async () => {
      await call('row:delete', { param, id })
      return true
    })
    if (r) onDone()
  }
  return (
    <SmallDialog
      title="Delete row"
      onCancel={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" disabled={refs === null && !refsError} onClick={confirm}>
            Delete
          </button>
        </>
      }
    >
      <div>
        Delete <b>{name || `${param} ${id}`}</b> <span className="mono faint">{id}</span>? It’s removed from your
        project when you save.
      </div>
      {refs === null && !refsError && <div className="faint">Checking what uses it…</div>}
      {refsError && <div className="warn">Couldn’t check what else uses it: {refsError}</div>}
      {refs && refs.length > 0 && (
        <div className="warn">
          {plural(refs.length, 'other row')} still point at it and will be left pointing at nothing:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {refs.slice(0, 8).map((r) => (
              <li key={`${r.param}:${r.id}:${r.field}`}>
                {r.name || `${r.param} ${r.id}`} <span className="faint">({r.field})</span>
              </li>
            ))}
            {refs.length > 8 && <li className="faint">… and {refs.length - 8} more</li>}
          </ul>
        </div>
      )}
      {refs && refs.length === 0 && <div className="faint">Nothing else uses this row.</div>}
    </SmallDialog>
  )
}
