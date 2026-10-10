/**
 * One field of an event, edited: what it links to (an effect, a SpEffect, the
 * behavior row a judge means for the weapon in hand) and, for a sound or an
 * effect, whether only another character's files have it.
 */
import { useState, useEffect } from 'react'
import type { AnimFieldView, BrowseRow, EffectLocation, JudgeRowView, SoundPlaceView } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { JudgeCopyDialog } from '../dialogs/JudgeCopyDialog.tsx'
import { NumberInput } from './NumberInput.tsx'

export function FieldRow({
  f,
  animation,
  onEdit,
  onOpenRow,
  onOpenEffect,
  weapon,
  onParamsEdited,
  version,
  soundType,
}: {
  f: AnimFieldView
  /** The animation the event is in. */
  animation: string
  onEdit: (v: number) => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
  weapon: { id: number; name: string } | null
  onParamsEdited: () => void
  version: number
  /** For a SoundID: its event's SoundType. */
  soundType?: number
}) {
  const ui = useUi()
  // A SoundID's sound: only a character's bank has it (it plays near them, not on you), or none.
  const [place, setPlace] = useState<SoundPlaceView | null>(null)
  useEffect(() => {
    if (f.name !== 'SoundID' || f.value <= 0 || soundType === undefined) return setPlace(null)
    let live = true
    call('sound:place', { type: soundType, id: f.value })
      .then((r) => live && setPlace(r))
      .catch(() => live && setPlace(null))
    return () => {
      live = false
    }
  }, [f.name, f.value, soundType, version])
  // An effect only a character's (or a map's) own bundle has: the game shows it only near them.
  // Kept with the id it was read for, so another value shows nothing until its own answer arrives.
  const [located, setLocated] = useState<{ id: number; at: EffectLocation | null } | null>(null)
  useEffect(() => {
    if (f.link !== 'effect' || f.value <= 0) return
    const id = f.value
    let live = true
    call('effect:locate', { id })
      .then((at) => live && setLocated({ id, at }))
      .catch(() => live && setLocated({ id, at: null }))
    return () => {
      live = false
    }
  }, [f.link, f.value, version])
  const elsewhere = f.link === 'effect' && located?.id === f.value ? located.at : null
  const [judgeRows, setJudgeRows] = useState<BrowseRow[] | null>(null)
  useEffect(() => setJudgeRows(null), [f.value])
  // What this judge means for the weapon in the viewport's right hand.
  const [mine, setMine] = useState<JudgeRowView | null>(null)
  const [copying, setCopying] = useState(false)
  useEffect(() => {
    if (f.link !== 'judge' || f.value < 0 || !weapon) return setMine(null)
    let live = true
    call('anim:judgeRowFor', { judge: f.value, weapon: weapon.id })
      .then((r) => live && setMine(r))
      .catch(() => live && setMine(null))
    return () => {
      live = false
    }
  }, [f.link, f.value, weapon?.id, version])
  let input: React.ReactNode
  if (f.type === 'b')
    input = <input type="checkbox" checked={!!f.value} onChange={(e) => onEdit(e.target.checked ? 1 : 0)} />
  else if (f.entries?.length) {
    const known = f.entries.some((e) => e.value === f.value)
    input = (
      <select value={f.value} onChange={(e) => onEdit(Number(e.target.value))} style={{ width: '100%' }}>
        {!known && <option value={f.value}>{f.value}</option>}
        {f.entries.map((e) => (
          <option key={e.value} value={e.value}>
            {e.name} ({e.value})
          </option>
        ))}
      </select>
    )
  } else input = <NumberInput value={f.value} float={f.type.startsWith('f')} onCommit={onEdit} />

  return (
    <>
      <div className={`field-label${f.link ? ' refs' : ''}`} title={`${f.type} at byte ${f.offset}`}>
        {f.name}
      </div>
      <div className="field-value">
        <div className="field-input">{input}</div>
        {f.about && <div className="field-hint">{f.about}</div>}
        {place?.where === 'character' && (
          <div className="judge-mine missing">
            <span className="dim">
              Only in {place.owner ?? place.chr}’s sound bank ({place.bank}), which the game loads near them: it won’t
              play on you.
            </span>
            <button
              className="primary"
              title={`Copies ${place.name} and the audio it plays into your mod's copy of the player's sound bank`}
              onClick={async () => {
                const r = await ui.run('Bringing the sound into your bank', () =>
                  call('sound:bring', { type: soundType!, id: f.value }),
                )
                if (!r) return
                ui.toast(
                  `${r.name} is in your sound bank now${r.mediaBytes ? ` (${Math.round(r.mediaBytes / 1024)} KB of audio)` : ''}. Save to keep it.`,
                )
                onParamsEdited()
              }}
            >
              Bring into your bank
            </button>
          </div>
        )}
        {place?.where === 'none' && <div className="field-hint">No sound bank has {place.name}: it plays nothing.</div>}
        {elsewhere && (
          <div className="judge-mine missing">
            <span className="dim">
              Only in {elsewhere.owner}’s effects ({elsewhere.bundle.slice(elsewhere.bundle.lastIndexOf('/') + 1)}),
              which the game loads near them: it won’t show on you.
            </span>
            <button
              className="primary"
              title="Copies it, with the effects and files it uses, into your mod's common effects as an effect of your own; this event then plays the copy"
              onClick={async () => {
                const r = await ui.run('Bringing the effect into your effects', () =>
                  call('effect:bring', { id: f.value }),
                )
                if (!r) return
                onEdit(r.id)
                ui.toast(
                  `Effect ${r.id}, a copy of ${f.value}, is in your effects now; this event plays it. Save to keep it.`,
                )
                onParamsEdited()
              }}
            >
              Bring into your effects
            </button>
          </div>
        )}
        {f.link && (f.link === 'judge' ? f.value >= 0 : f.value > 0) && (
          <div className="field-refs">
            {f.link === 'effect' && (
              <button className="ref-link" onClick={() => onOpenEffect(f.value)}>
                Effect {f.value} {f.linkLabel && <span className="faint">{f.linkLabel}</span>}
              </button>
            )}
            {f.link === 'speffect' && (
              <button className="ref-link" onClick={() => onOpenRow('SpEffectParam', f.value)}>
                SpEffect {f.value} {f.linkLabel && <span className="faint">{f.linkLabel}</span>}
              </button>
            )}
            {f.link === 'judge' && mine && (
              <div className={`judge-mine${mine.plays !== null ? '' : ' missing'}`}>
                {mine.plays !== null ? (
                  <>
                    <button
                      className="ref-link"
                      onClick={() => onOpenRow('BehaviorParam_PC', mine.plays!)}
                      title={
                        mine.borrowed
                          ? `${mine.weaponName} has no row of its own for this judge, so the game plays ${mine.borrowed === 'every' ? "every weapon's (variation 0)" : "its base variation's"}`
                          : 'Open this behavior row'
                      }
                    >
                      For {mine.weaponName}: Behavior {mine.plays}
                      {mine.borrowed && (
                        <span className="faint">
                          {' '}
                          ({mine.borrowed === 'every' ? 'every weapon’s' : 'its base variation’s'})
                        </span>
                      )}{' '}
                      {mine.summary && <span className="faint">→ {mine.summary}</span>}
                    </button>
                    {mine.borrowed && (
                      <button
                        title={`Adds BehaviorParam_PC ${mine.id}, a copy of behavior ${mine.plays}, for ${mine.weaponName} alone: change what it does there`}
                        onClick={async () => {
                          const r = await ui.run('Adding a behavior row', () =>
                            call('anim:createJudgeRow', { judge: f.value, weapon: mine.weapon }),
                          )
                          if (!r) return
                          setMine(r)
                          onParamsEdited()
                          onOpenRow('BehaviorParam_PC', r.id)
                        }}
                      >
                        Make its own
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="dim">
                      {mine.weaponName} (variation {mine.variation}) has no behavior row for judge {f.value}: this event
                      does nothing with it.
                    </span>
                    <button
                      className="primary"
                      title={`Adds BehaviorParam_PC ${mine.id}, a copy of one of this weapon's behavior rows; then choose what it does there`}
                      onClick={async () => {
                        const r = await ui.run('Adding a behavior row', () =>
                          call('anim:createJudgeRow', { judge: f.value, weapon: mine.weapon }),
                        )
                        if (!r) return
                        setMine(r)
                        onParamsEdited()
                        onOpenRow('BehaviorParam_PC', r.id)
                      }}
                    >
                      Make behavior {mine.id}
                    </button>
                    <button
                      title="Copies what this judge does on another weapon (the one this event came from, say), for this weapon or for every weapon"
                      onClick={() => setCopying(true)}
                    >
                      Copy from another weapon…
                    </button>
                  </>
                )}
              </div>
            )}
            {copying && mine && (
              <JudgeCopyDialog
                judge={f.value}
                animation={animation}
                mine={mine}
                onClose={() => setCopying(false)}
                onDone={(r, id) => {
                  setCopying(false)
                  setMine(r)
                  onParamsEdited()
                  onOpenRow('BehaviorParam_PC', id)
                  ui.toast(`Behavior ${id} plays for ${r.weaponName} now. Save to keep it.`)
                }}
              />
            )}
            {f.link === 'judge' &&
              (judgeRows === null ? (
                <button
                  className="ref-link"
                  onClick={() => call('anim:judgeRows', { judge: f.value }).then(setJudgeRows)}
                >
                  {f.linkLabel ? `Show ${f.linkLabel}` : 'No behavior row uses this judge'}
                </button>
              ) : (
                <>
                  {judgeRows.slice(0, 40).map((r) => (
                    <button key={r.id} className="ref-link" onClick={() => onOpenRow(r.param, r.id)}>
                      Behavior {r.id} {r.name && <span className="faint">{r.name}</span>}
                    </button>
                  ))}
                  {judgeRows.length > 40 && (
                    <span
                      className="faint"
                      style={{ fontSize: 11 }}
                      title="Each weapon uses the row for its behavior variation (variation × 1000 + judge)"
                    >
                      … and {judgeRows.length - 40} more
                    </span>
                  )}
                </>
              ))}
          </div>
        )}
      </div>
    </>
  )
}
