/** The Animations page's Go to dialogs: an animation (Ctrl+G) or a category (Ctrl+H). */
import { useState } from 'react'
import { describeAnimationId, categoryLabel } from '../../../shared/animIds.ts'
import type { AnimCategoryView } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { Modal } from '../../shared/Modal.tsx'
import { parseAnimationInput } from './animationInput.ts'

/** Ctrl+G (an animation) and Ctrl+H (a category, by its number or TAE id). */
export function GoToDialog({
  kind,
  category,
  categories,
  onClose,
  onAnimation,
  onCategory,
}: {
  kind: 'animation' | 'category'
  category: number | null
  categories: AnimCategoryView[]
  onClose: () => void
  onAnimation: (name: string) => void
  onCategory: (c: number) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const anim = kind === 'animation' ? parseAnimationInput(text, category) : null
  const cat =
    kind === 'category'
      ? (() => {
          const m = /^a?(\d{1,4})$/.exec(text.trim().toLowerCase())
          if (!m) return null
          const n = Number(m[1])
          // A TAE id (2000 + category) works too.
          return categories.some((c) => c.category === n)
            ? n
            : n >= 2000 && categories.some((c) => c.category === n - 2000)
              ? n - 2000
              : null
        })()
      : null
  const go = async () => {
    setError(null)
    if (kind === 'category') {
      if (cat === null) return setError('No such category')
      onCategory(cat)
      return onClose()
    }
    if (!anim)
      return setError(
        category === null ? 'Type a full name, e.g. a050_030000' : 'Type an id like 030000, or a name like a050_030000',
      )
    try {
      await call('anim:get', { name: anim })
      onAnimation(anim)
      onClose()
    } catch {
      setError(`${anim} isn’t in the player’s animations`)
    }
  }
  return (
    <Modal
      escapeCloses
      title={kind === 'animation' ? 'Go to animation' : 'Go to category'}
      width={440}
      onClose={onClose}
    >
      <input
        autoFocus
        className="mono"
        placeholder={kind === 'animation' ? 'a050_030000, or 030000 in this category' : 'a050, 50, or the TAE id 2050'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && go()}
      />
      <div className="faint" style={{ fontSize: 12 }}>
        {kind === 'animation'
          ? anim
            ? `${anim}${describeAnimationId(Number(anim.slice(5))) ? `: ${describeAnimationId(Number(anim.slice(5)))}` : ''}`
            : 'Enter opens it.'
          : cat !== null
            ? `${categoryLabel(cat)}${categories.find((c) => c.category === cat)?.hint ? `: ${categories.find((c) => c.category === cat)?.hint}` : ''}`
            : 'Enter opens it.'}
      </div>
      {error && <div className="warn">{error}</div>}
    </Modal>
  )
}
