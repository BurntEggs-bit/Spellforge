/** The Animations page's dialog that moves a category to a new number (Shift+F2). */
import { useMemo, useState } from 'react'
import { categoryLabel } from '../../../shared/animIds.ts'
import type { AnimCategoryView } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'
import { plural } from '../../../shared/format.ts'

/** Shift+F2: every animation of a category to a new number. */
export function RenumberDialog({
  category,
  categories,
  onClose,
  onDone,
}: {
  category: number
  categories: AnimCategoryView[]
  onClose: () => void
  onDone: (to: number) => void
}) {
  const ui = useUi()
  const used = useMemo(() => new Set(categories.map((c) => c.category)), [categories])
  const [to, setTo] = useState(() => {
    for (let c = category + 1; c < 1000; c++) if (!used.has(c)) return String(c)
    return ''
  })
  const [params, setParams] = useState(true)
  const [register, setRegister] = useState(true)
  const n = Number(to)
  const ok = /^\d{1,3}$/.test(to) && !used.has(n)
  const info = categories.find((c) => c.category === category)
  const go = () =>
    ui.run(`Moving ${categoryLabel(category)}`, async () => {
      const r = await call('anim:renumberCategory', { category, to: n, register, params })
      ui.toast(
        `${r.animations} animations moved to ${categoryLabel(r.category)}.` +
          (r.rows ? `\n${plural(r.rows, 'weapon or skill field')} now point at it.` : '') +
          (r.registration ? `\nRegistered ${r.registration.added.length} in the behaviour graph.` : '') +
          '\nNothing is written until you save.',
      )
      onDone(r.category)
      onClose()
    })
  return (
    <Modal
      escapeCloses
      title={`Move category ${categoryLabel(category)}`}
      width={560}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!ok} onClick={go}>
            Move
          </button>
        </>
      }
    >
      <div className="dim" style={{ fontSize: 12.5 }}>
        Its {info?.animations ?? ''} animations get the new number; their motions keep playing from the old names (no
        motion file copied), and animations that take everything from them follow. It can’t be undone (close without
        saving to drop it).
      </div>
      <div className="fields" style={{ gridTemplateColumns: '150px 1fr' }}>
        <div className="field-label">New category</div>
        <div className="field-value">
          <div className="field-input">
            <span className="mono faint">a</span>
            <input
              autoFocus
              className="mono"
              style={{ width: 90 }}
              value={to}
              onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              {!/^\d{1,3}$/.test(to)
                ? '0–999'
                : used.has(n)
                  ? `${categoryLabel(n)} is taken`
                  : `${categoryLabel(n)} is free`}
            </span>
          </div>
        </div>
      </div>
      <label className="row">
        <input type="checkbox" checked={params} onChange={(e) => setParams(e.target.checked)} />
        <span>
          Weapons and skills using {categoryLabel(category)} follow it{' '}
          <span className="faint">(wepmotionCategory, spAtkcategory, swordArtsTypeNew)</span>
        </span>
      </label>
      <label className="row">
        <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
        <span>Register the moved animations in the behaviour graph</span>
      </label>
    </Modal>
  )
}
