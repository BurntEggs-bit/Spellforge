/**
 * An event's judge that does nothing for the weapon in hand (pasted from
 * another weapon's animation): another weapon's behavior row for it,
 * copied for this weapon or for every weapon, with its own attack and
 * bullets to balance if wanted.
 */
import { useEffect, useState } from 'react'
import type { JudgeRowView, JudgeSourceView } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { InActiveWindow, useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'

function sourceOption(s: JudgeSourceView) {
  return (
    <option key={s.id} value={s.id}>
      {s.weapons || `Variation ${s.variation}`}: {s.summary}
    </option>
  )
}

export function JudgeCopyDialog({
  judge,
  animation,
  mine,
  onClose,
  onDone,
}: {
  judge: number
  /** The animation the event is in: its own weapons' rows come first. */
  animation: string
  mine: JudgeRowView
  onClose: () => void
  /** The weapon's view after the copy, and the row made. */
  onDone: (r: JudgeRowView, id: number) => void
}) {
  const ui = useUi()
  const [sources, setSources] = useState<JudgeSourceView[] | null>(null)
  const [from, setFrom] = useState<number | null>(null)
  const [everyWeapon, setEveryWeapon] = useState(false)
  const [ownCopies, setOwnCopies] = useState(false)
  useEffect(() => {
    let live = true
    call('anim:judgeSources', { judge, animation })
      .then((list) => {
        if (!live) return
        setSources(list)
        setFrom(list[0]?.id ?? null)
      })
      .catch((e) => live && ui.error(e))
    return () => {
      live = false
    }
  }, [judge, animation, ui])
  const source = sources?.find((s) => s.id === from)
  const copy = async () => {
    if (from === null) return
    const r = await ui.run('Copying the behavior row', () =>
      call('anim:createJudgeRow', { judge, weapon: mine.weapon, from, everyWeapon, ownCopies }),
    )
    if (!r || r.plays === null) return
    onDone(r, r.plays)
  }
  return (
    <InActiveWindow>
      <Modal
        escapeCloses
        title={`Copy judge ${judge} from another weapon`}
        width={620}
        onClose={onClose}
        footer={
          <>
            <span className="grow" />
            <button className="ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={from === null} onClick={copy}>
              Copy
            </button>
          </>
        }
      >
        <div className="dim" style={{ marginBottom: 10 }}>
          {mine.weaponName} has no behavior row for judge {judge}, so this event does nothing with it. Copy what it does
          on another weapon: the event plays the copy.
        </div>
        {sources?.length === 0 && <div className="dim">No weapon has a behavior row for judge {judge}.</div>}
        {!!sources?.length && (
          <div className="form-grid">
            <label>Copy</label>
            <select value={from ?? ''} onChange={(e) => setFrom(Number(e.target.value))}>
              {sources.some((s) => s.owner)
                ? (
                    [
                      ['This animation’s weapons', sources.filter((s) => s.owner)],
                      ['Other weapons', sources.filter((s) => !s.owner)],
                    ] as const
                  ).map(([label, group]) =>
                    group.length ? (
                      <optgroup key={label} label={label}>
                        {group.map(sourceOption)}
                      </optgroup>
                    ) : null,
                  )
                : sources.map(sourceOption)}
            </select>
            <label>For</label>
            <select value={everyWeapon ? 'every' : 'mine'} onChange={(e) => setEveryWeapon(e.target.value === 'every')}>
              <option value="mine">
                {mine.weaponName} (variation {mine.variation})
              </option>
              <option value="every">Every weapon without a row of its own (variation 0)</option>
            </select>
            <span />
            <label
              className="row"
              title="Copies of the attack and bullets it fires (and their attacks), to balance for this weapon alone. Effects stay as they are."
            >
              <input type="checkbox" checked={ownCopies} onChange={(e) => setOwnCopies(e.target.checked)} /> Its own
              attack and bullets
            </label>
          </div>
        )}
        {source && (
          <div className="faint" style={{ marginTop: 10, fontSize: 12 }}>
            Behavior {source.id} becomes behavior {everyWeapon ? mine.id - mine.variation * 1000 : mine.id}
            {ownCopies
              ? ', with copies of what it fires.'
              : `, firing the same ${source.summary.split(' ')[0].toLowerCase()} as ${source.weapons || 'it'}.`}
          </div>
        )}
      </Modal>
    </InActiveWindow>
  )
}
