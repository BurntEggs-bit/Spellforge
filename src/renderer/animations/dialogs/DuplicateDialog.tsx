/** The Animations page's Duplicate dialog: an animation, or a whole category, copied to a new category or id. */
import { useMemo, useState, useEffect } from 'react'
import { animationIdText, animationName, categoryLabel } from '../../../shared/animIds.ts'
import type { AnimCategoryView } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { Modal } from '../../shared/Modal.tsx'
import { useUi } from '../../shared/ui.tsx'

export function DuplicateDialog({
  scope,
  source,
  sourceCategory,
  categories,
  onClose,
  onDone,
}: {
  scope: 'one' | 'category'
  source: string | null
  sourceCategory: number | null
  categories: AnimCategoryView[]
  onClose: () => void
  onDone: (created: string | null, toCategory: number) => void
}) {
  const ui = useUi()
  const used = useMemo(() => new Set(categories.map((c) => c.category)), [categories])
  const suggest = useMemo(() => {
    const from = sourceCategory ?? 0
    for (let c = from + 1; c < 1000; c++) if (!used.has(c)) return c
    for (let c = 0; c < 1000; c++) if (!used.has(c)) return c
    return 999
  }, [used, sourceCategory])
  const srcId = source ? Number(source.slice(5)) : null
  const [toCategory, setToCategory] = useState(String(suggest))
  const [toId, setToId] = useState(srcId !== null ? animationIdText(srcId) : '')
  const [register, setRegister] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [clash, setClash] = useState<string[]>([])

  const cat = Number(toCategory)
  const catOk = /^\d{1,3}$/.test(toCategory.trim())
  const idNum = Number(toId)
  const idOk = scope === 'category' || /^\d{1,6}$/.test(toId.trim())
  const target = catOk && idOk && scope === 'one' ? animationName(cat, idNum) : null
  const exists = catOk && used.has(cat)
  const srcInfo = categories.find((c) => c.category === sourceCategory)

  // Which targets already exist.
  useEffect(() => {
    setClash([])
    if (!catOk || !exists) return
    let live = true
    call('anim:list', { category: cat, query: '' }).then(async (l) => {
      if (!live) return
      const have = new Set(l.map((a) => a.id))
      if (scope === 'one') setClash(idOk && have.has(idNum) ? [target!] : [])
      else if (sourceCategory !== null) {
        const src = await call('anim:list', { category: sourceCategory, query: '' })
        if (live) setClash(src.filter((a) => have.has(a.id)).map((a) => animationName(cat, a.id)))
      }
    })
    return () => {
      live = false
    }
  }, [toCategory, toId])

  const same = scope === 'one' ? target === source : cat === sourceCategory
  const conflicts = same ? [] : clash
  const go = () =>
    ui.run('Copying animations', async () => {
      const r = await call('anim:duplicate', {
        names: scope === 'one' && source ? [source] : undefined,
        fromCategory: scope === 'category' && sourceCategory !== null ? sourceCategory : undefined,
        toCategory: cat,
        toId: scope === 'one' ? idNum : undefined,
        register,
        overwrite,
      })
      const made = r.created.length + r.replaced.length
      const reg = r.registration
      const notReg = reg?.skipped.filter((s) => s.reason !== 'already playable') ?? []
      ui.toast(
        `${made ? `Created ${r.created.length}${r.replaced.length ? `, replaced ${r.replaced.length}` : ''} animation${made === 1 ? '' : 's'} in ${categoryLabel(cat)}.` : 'Nothing was copied.'}` +
          (r.skipped.length ? `\nSkipped ${r.skipped.length} (${r.skipped[0].reason}).` : '') +
          (reg
            ? `\nRegistered ${reg.added.length} in the behaviour graph${notReg.length ? `; ${notReg.length} have no selector for their ID` : ''}.`
            : '') +
          '\nNothing is written until you press “Save to project”.',
        made === 0,
      )
      if (made) onDone(scope === 'one' ? (r.created[0] ?? r.replaced[0] ?? null) : null, cat)
    })

  return (
    <Modal
      title={
        scope === 'one'
          ? `Duplicate ${source}`
          : `Copy category ${sourceCategory !== null ? categoryLabel(sourceCategory) : ''}`
      }
      width={620}
      onClose={onClose}
      escapeCloses
      footer={
        <>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!catOk || !idOk || same} onClick={go}>
            {scope === 'one' ? 'Duplicate' : 'Copy category'}
          </button>
        </>
      }
    >
      <div className="dim" style={{ fontSize: 12.5 }}>
        {scope === 'one' ? 'Plays' : `${srcInfo?.animations ?? ''} copies, each playing`} the original’s motion (no .hkt
        copied), with {scope === 'one' ? 'its' : 'their'} own events.
      </div>
      <div className="fields" style={{ gridTemplateColumns: '150px 1fr' }}>
        <div
          className="field-label"
          title="A weapon plays a category through wepmotionCategory (movesets below 100) or spAtkcategory (unique movesets); a skill through swordArtsTypeNew (category − 600)."
        >
          Into category
        </div>
        <div className="field-value">
          <div className="field-input">
            <span className="mono faint">a</span>
            <input
              className="mono"
              style={{ width: 90 }}
              value={toCategory}
              onChange={(e) => setToCategory(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              {!catOk
                ? '0–999'
                : exists
                  ? `${categoryLabel(cat)} exists — copies are added to it`
                  : `${categoryLabel(cat)} is new`}
            </span>
          </div>
        </div>
        {scope === 'one' && (
          <>
            <div className="field-label">Animation id</div>
            <div className="field-value">
              <div className="field-input">
                <input
                  className="mono"
                  style={{ width: 90 }}
                  value={toId}
                  onChange={(e) => setToId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <span className="faint" style={{ fontSize: 12 }}>
                  {target ? `→ ${target}` : ''}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
      <label className="row">
        <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
        <span title="Adds clips to c0000.behbnd, as ERClipGeneratorTool does">Register in the behaviour graph</span>
      </label>
      {same && (
        <div className="warn">That’s the original — pick another category{scope === 'one' ? ' or id' : ''}.</div>
      )}
      {conflicts.length > 0 && (
        <label className="row warn">
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          <span>
            {conflicts.length === 1 ? `${conflicts[0]} already exists` : `${conflicts.length} of these already exist`} —
            replace {conflicts.length === 1 ? 'it' : 'them'} (otherwise {conflicts.length === 1 ? 'it is' : 'they are'}{' '}
            skipped)
          </span>
        </label>
      )}
    </Modal>
  )
}
