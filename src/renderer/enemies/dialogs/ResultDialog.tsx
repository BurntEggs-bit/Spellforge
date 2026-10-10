/** What was made from a move or a bullet, with where to see it next. */
import { InActiveWindow } from '../../shared/ui.tsx'
import type { Result } from '../useEnemiesPage.ts'
import { SoundLoaderNote } from './SoundLoaderNote.tsx'
import { ModalShell } from '../../shared/Modal.tsx'

export function ResultDialog({
  result,
  onClose,
  onOpenRow,
  onOpenAnimation,
  onScale,
}: {
  result: Result
  onClose: () => void
  onOpenRow: (param: string, id: number) => void
  onOpenAnimation: (p: { category: number; animation: string; weapon?: number }) => void
  /** Resize its effects and hitboxes (ScaleDialog). */
  onScale: () => void
}) {
  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="enemy-dialog">
        <header>
          <h2 className="grow">
            {result.kind === 'skill' ? (result.skill.attack ? 'Attack made' : 'Skill made') : 'Spell made'}
          </h2>
        </header>
        <div className="body">
          <div>{result.kind === 'skill' ? result.skill.summary : result.spell.summary}</div>
          <ul className="enemy-list faint">
            {(result.kind === 'skill' ? result.skill.rows : result.spell.rows).map((r) => (
              <li key={`${r.param}:${r.id}`}>
                <button className="link" onClick={() => onOpenRow(r.param, r.id)}>
                  {r.param} {r.id}
                </button>{' '}
                {r.name}
              </li>
            ))}
          </ul>
          <div className="dim">Written to the mod folder when you save.</div>
          {(result.kind === 'skill' ? result.skill.sounds : result.spell.sounds).copied > 0 && <SoundLoaderNote />}
        </div>
        <footer>
          <span className="grow" />
          {!(result.kind === 'skill' && result.skill.attack) && (
            <button onClick={onScale} title="Make its effects and hitboxes bigger or smaller, together">
              Scale it…
            </button>
          )}
          {result.kind === 'skill' && (
            <button
              className="primary"
              onClick={() => {
                onClose()
                onOpenAnimation({
                  category: result.skill.category,
                  animation: result.skill.animations[0],
                  weapon: result.weapon,
                })
              }}
            >
              Watch it in Animations
            </button>
          )}
          {result.kind === 'spell' && (
            <button
              className="primary"
              onClick={() => {
                onClose()
                onOpenRow('Magic', result.spell.spell)
              }}
            >
              Open the spell
            </button>
          )}
          <button onClick={onClose}>Close</button>
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
