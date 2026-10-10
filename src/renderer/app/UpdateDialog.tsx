/**
 * "Update from game": brings a project made with an older game version up to
 * the installed one. Shows what the update changed for each kind of file
 * (worked out against the vanilla files of the project's own version), lets
 * the modder pick, then applies, saves (with backups) and reopens.
 */
import { useEffect, useState } from 'react'
import type { GameUpdatePlan, GameUpdateRequest, ProjectSummary } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { InActiveWindow, useUi } from '../shared/ui.tsx'
import { ModalShell } from '../shared/Modal.tsx'
import { pluralLocale } from '../../shared/format.ts'

export function UpdateDialog({
  onCancel,
  onDone,
}: {
  onCancel: () => void
  onDone: (summary: ProjectSummary, written: string[], to: string) => void
}) {
  const ui = useUi()
  const [plan, setPlan] = useState<GameUpdatePlan | null | undefined>(undefined)
  const [pick, setPick] = useState<GameUpdateRequest>({ params: true, text: true, effects: true, animations: true })
  useEffect(() => {
    let live = true
    ui.run('Checking what the game update changed', () => call('project:updatePlan', undefined)).then((p) => {
      if (!live) return
      setPlan(p ?? null)
      if (p) setPick({ params: !!p.params, text: !!p.text, effects: !!p.effects, animations: !!p.animations })
    })
    return () => {
      live = false
    }
  }, [ui])

  const apply = async () => {
    if (!plan) return
    const r = await ui.run(`Updating your project to ${plan.to}`, () => call('project:updateFromGame', pick))
    if (r) onDone(r.summary, r.written, plan.to)
  }

  const row = (
    key: keyof GameUpdateRequest,
    title: string,
    body: React.ReactNode,
    available: boolean,
    why?: string,
  ) => (
    <label className={`update-row${available ? '' : ' off'}`}>
      <input
        type="checkbox"
        disabled={!available}
        checked={available && pick[key]}
        onChange={(e) => setPick({ ...pick, [key]: e.target.checked })}
      />
      <span>
        <b>{title}</b>
        <span className="dim">{available ? body : why}</span>
      </span>
    </label>
  )

  return (
    <InActiveWindow>
      <ModalShell onClose={onCancel} style={{ width: 'min(620px, 94vw)' }}>
        <header>
          <h2 className="grow">{plan ? `Update from game ${plan.from} to ${plan.to}` : 'Update from game'}</h2>
        </header>
        <div className="body update-body">
          {plan === undefined && <div className="faint">Comparing your project with both game versions…</div>}
          {plan === null && <div>Your project already matches the installed game.</div>}
          {plan && (
            <>
              <div
                className="dim"
                title="In game a mod’s files replace the game’s whole files, so an update’s changes are lost while the mod is on"
              >
                Brings the update’s changes (since game {plan.from}) into the mod’s own copies of these files.{' '}
                <b>Your own changes stay.</b>
              </div>
              {row(
                'params',
                'Params (regulation.bin)',
                <>
                  {pluralLocale(plan.params?.fromUpdate.changed ?? 0, 'row')} the update changed and{' '}
                  {pluralLocale(plan.params?.fromUpdate.added ?? 0, 'row')} it added come in. Your{' '}
                  {pluralLocale(plan.params?.added ?? 0, 'added row')} and{' '}
                  {pluralLocale(plan.params?.changed ?? 0, 'changed row')} stay
                  {plan.params?.conflicts
                    ? `; ${pluralLocale(plan.params.conflicts, 'field')} you both changed keep your value`
                    : ''}
                  .
                </>,
                !!plan.params,
                `Spellforge doesn’t have game ${plan.from}’s files, so it can’t tell your changes from the update’s. Point it at a copy of game ${plan.from} once (Setup → Elden Ring), then back.`,
              )}
              {row(
                'text',
                'Text',
                <>
                  {pluralLocale(plan.text?.entries ?? 0, 'newer entry', 'newer entries')} in{' '}
                  {pluralLocale(plan.text?.files ?? 0, 'text file')}.
                </>,
                !!plan.text,
                'Nothing newer.',
              )}
              {row(
                'effects',
                'Effects',
                <>
                  {pluralLocale(plan.effects?.added ?? 0, 'new effect')}
                  {plan.effects?.known
                    ? `, ${pluralLocale(plan.effects.changed, 'updated effect')}`
                    : ' (updated ones can’t be told apart without the old version’s files)'}
                  {plan.effects?.conflicts
                    ? `; ${pluralLocale(plan.effects.conflicts, 'effect')} you both changed stay yours`
                    : ''}
                  .
                </>,
                !!plan.effects && (plan.effects.added > 0 || plan.effects.changed > 0),
                'Nothing new.',
              )}
              {row(
                'animations',
                'Animations',
                <>
                  {pluralLocale(plan.animations?.changed ?? 0, 'updated animation')},{' '}
                  {pluralLocale(plan.animations?.added ?? 0, 'new animation')}
                  {plan.animations?.categories
                    ? ` (${pluralLocale(plan.animations.categories, 'new category', 'new categories')})`
                    : ''}
                  {plan.animations?.conflicts
                    ? `; ${pluralLocale(plan.animations.conflicts, 'animation')} you both changed stay yours`
                    : ''}
                  {plan.animations?.motionFiles
                    ? `; ${pluralLocale(plan.animations.motionFiles, 'animation file')} of your skills moved onto the new game’s binders`
                    : ''}
                  {plan.animations?.soundEvents
                    ? `; ${pluralLocale(plan.animations.soundEvents, 'sound')} your skills and spells brought in, brought into the new game’s sound bank`
                    : ''}
                  .
                </>,
                !!plan.animations &&
                  (plan.animations.added > 0 ||
                    plan.animations.changed > 0 ||
                    !!plan.animations.motionFiles ||
                    !!plan.animations.soundEvents),
                'Nothing new.',
              )}
              {plan.untouched.length > 0 && (
                <div className="faint" style={{ fontSize: 12 }}>
                  Kept as they are: {plan.untouched.join(', ')}.
                </div>
              )}
              <div className="faint" style={{ fontSize: 12 }}>
                Saves when done{plan.unsaved ? ' (with your unsaved changes)' : ''}; every file it replaces is backed up
                first.
              </div>
            </>
          )}
        </div>
        <footer>
          <span className="grow" />
          <button onClick={onCancel}>{plan ? 'Cancel' : 'Close'}</button>
          {plan && (
            <button className="primary" disabled={!Object.values(pick).some(Boolean)} onClick={apply}>
              Update to {plan.to}
            </button>
          )}
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
