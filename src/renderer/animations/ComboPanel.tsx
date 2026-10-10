/**
 * The combo viewer (F8, DS Anim Studio's): animations played one after
 * another in the viewport, each cut where the next input would cancel it
 * (its ChrActionFlag cancel window), at a frame, or at its end, with the
 * character carried on by each one's root motion and a short blend between
 * them. Its events (hitboxes, bullets, effects) play at their times too.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors): the combo viewer is
 * its design.
 */
import { useEffect, useState } from 'react'
import type { AnimationView } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { animationName, categoryLabel, describeAnimationId } from '../../shared/animIds.ts'
import { toFrames, toSeconds } from '../../shared/frames.ts'
import { parseAnimationInput } from './dialogs/animationInput.ts'

/** Where a combo goes on to the next animation. */
export type ComboCut = 'end' | 'r1' | 'r2' | 'dodge' | 'any' | { frame: number }

export interface ComboStepDef {
  animation: string
  cut: ComboCut
}

/** ChrActionFlag (type 0) FlagType values for each way on (DS Anim Studio's names). */
const CUT_FLAGS: Record<string, number[]> = {
  r1: [4, 115],
  r2: [116],
  dodge: [26],
  any: [4, 115, 116, 117, 118, 26, 34, 104, 103, 11],
}

/** Where an animation is cut (seconds; null: its end): the start of the cancel window the way on needs. */
export function cutTime(view: AnimationView, cut: ComboCut): number | null {
  if (cut === 'end') return null
  if (typeof cut === 'object') return Math.max(0, toSeconds(cut.frame))
  const flags = CUT_FLAGS[cut] ?? []
  let best: number | null = null
  for (const e of view.events) {
    if (e.type !== 0) continue
    const f = e.fields.find((x) => x.name === 'FlagType')?.value
    if (f === undefined || !flags.includes(f)) continue
    if (e.start > 0.05 && (best === null || e.start < best)) best = e.start
  }
  return best
}

const CUT_LABELS: [Exclude<ComboCut, { frame: number }>, string][] = [
  ['r1', 'when R1 can cancel it'],
  ['r2', 'when R2 can cancel it'],
  ['dodge', 'when a dodge can cancel it'],
  ['any', 'at its first cancel window'],
  ['end', 'at its end'],
]

export function ComboPanel({
  steps,
  onSteps,
  playing,
  onPlay,
  current,
  category,
}: {
  steps: ComboStepDef[]
  onSteps: (s: ComboStepDef[]) => void
  playing: boolean
  onPlay: (on: boolean) => void
  /** The animation open on the page (added with "This animation"). */
  current: string | null
  category: number | null
}) {
  const ui = useUi()
  const [views, setViews] = useState<Record<string, AnimationView | null>>({})
  const [adding, setAdding] = useState('')
  // Each step's events, for its cut time and what it is.
  useEffect(() => {
    let live = true
    for (const s of steps) {
      if (s.animation in views) continue
      call('anim:get', { name: s.animation })
        .then((v) => live && setViews((m) => ({ ...m, [s.animation]: v })))
        .catch(() => live && setViews((m) => ({ ...m, [s.animation]: null })))
    }
    return () => {
      live = false
    }
  }, [steps])
  const set = (i: number, patch: Partial<ComboStepDef>) =>
    onSteps(steps.map((s, k) => (k === i ? { ...s, ...patch } : s)))
  const add = (name: string) => onSteps([...steps, { animation: name, cut: steps.length ? 'r1' : 'r1' }])
  const addTyped = () => {
    const n = parseAnimationInput(adding, category)
    if (!n) return ui.toast('Type an animation, e.g. a050_030010 (or 030010 in this category).', true)
    add(n)
    setAdding('')
  }
  /** The R1 chain of the current category: 030000, 030010, 030020… while they exist. */
  const r1Chain = async (twoHanded: boolean) => {
    if (category === null) return
    const list = await call('anim:list', { category, query: '' })
    const ids = new Set(list.map((a) => a.id))
    const base = twoHanded ? 32000 : 30000
    const out: ComboStepDef[] = []
    for (let k = 0; k < 8 && ids.has(base + k * 10); k++)
      out.push({
        animation: animationName(category, base + k * 10),
        cut: 'r1',
      })
    if (!out.length)
      return ui.toast(`${categoryLabel(category)} has no ${twoHanded ? 'two-handed ' : ''}R1 chain (0${base}…).`, true)
    out[out.length - 1].cut = 'end'
    onSteps(out)
  }
  const total = steps.reduce((t, s) => {
    const v = views[s.animation]
    const len = v ? Math.max(v.length, 0.1) : 0
    const cut = v ? cutTime(v, s.cut) : null
    return t + (cut ?? len)
  }, 0)
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          <div
            className="panel-title grow"
            title="Each animation goes on to the next where the next input could cancel it (or at a frame of yours), root motion carried on, hitboxes, bullets and effects at their times. F8 plays and stops."
          >
            Combo <span className="faint">F8</span>
          </div>
          {playing ? (
            <button className="primary" onClick={() => onPlay(false)} title="Back to the animation on its own (F8)">
              ■ Stop
            </button>
          ) : (
            <button
              className="primary"
              disabled={!steps.length}
              onClick={() => onPlay(true)}
              title="Play these animations one after another in the viewport (F8)"
            >
              ▶ Play combo
            </button>
          )}
        </div>
      </div>
      <div className="panel-body combo-body">
        {steps.map((s, i) => {
          const v = views[s.animation]
          const cut = v ? cutTime(v, s.cut) : null
          const what = describeAnimationId(Number(s.animation.slice(5)))
          return (
            <div key={i} className="combo-step">
              <div className="row">
                <span className="combo-n">{i + 1}</span>
                <span className="mono grow ellipsis" title={what ?? undefined}>
                  {s.animation}
                </span>
                <button
                  className="ghost icon"
                  disabled={i === 0}
                  title="Earlier"
                  onClick={() => onSteps(steps.map((x, k) => (k === i - 1 ? steps[i] : k === i ? steps[i - 1] : x)))}
                >
                  ↑
                </button>
                <button className="ghost icon" title="Remove" onClick={() => onSteps(steps.filter((_, k) => k !== i))}>
                  ✕
                </button>
              </div>
              {what && (
                <div className="faint" style={{ fontSize: 11, marginLeft: 26 }}>
                  {what}
                </div>
              )}
              {v === null && (
                <div className="warn" style={{ marginLeft: 26 }}>
                  Not in the player’s animations
                </div>
              )}
              {i < steps.length - 1 || s.cut !== 'end' ? (
                <div className="row combo-cut">
                  <span className="faint">then on</span>
                  <select
                    value={typeof s.cut === 'object' ? 'frame' : s.cut}
                    onChange={(e) =>
                      set(i, {
                        cut:
                          e.target.value === 'frame'
                            ? { frame: Math.round(toFrames(cut ?? v?.length ?? 1)) }
                            : (e.target.value as ComboCut),
                      })
                    }
                  >
                    {CUT_LABELS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                    <option value="frame">at a frame</option>
                  </select>
                  {typeof s.cut === 'object' ? (
                    <input
                      className="mono"
                      style={{ width: 60 }}
                      value={s.cut.frame}
                      onChange={(e) => set(i, { cut: { frame: Number(e.target.value.replace(/\D/g, '')) || 0 } })}
                    />
                  ) : (
                    <span className="mono faint">
                      {v
                        ? cut !== null
                          ? `frame ${Math.round(toFrames(cut))}`
                          : s.cut === 'end'
                            ? 'its end'
                            : 'no such window: its end'
                        : ''}
                    </span>
                  )}
                </div>
              ) : null}
            </div>
          )
        })}
        {!steps.length && <div className="empty">No animations.</div>}
        <div className="combo-add">
          <div className="row">
            <button
              className="ghost icon"
              disabled={!current}
              onClick={() => current && add(current)}
              title="Add the animation open on the page"
            >
              + This animation
            </button>
            <button
              className="ghost icon"
              disabled={category === null}
              onClick={() => r1Chain(false)}
              title="030000, 030010, 030020… of this category"
            >
              R1 chain
            </button>
            <button
              className="ghost icon"
              disabled={category === null}
              onClick={() => r1Chain(true)}
              title="032000, 032010… of this category"
            >
              Two-handed
            </button>
            <span className="grow" />
            <button className="ghost icon" disabled={!steps.length} onClick={() => onSteps([])}>
              Clear
            </button>
          </div>
          <div className="row">
            <input
              className="mono grow"
              placeholder="a050_030010, or 030010 here"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTyped()}
            />
            <button className="ghost icon" onClick={addTyped}>
              Add
            </button>
          </div>
          {steps.length > 0 && (
            <div className="faint" style={{ fontSize: 11.5 }}>
              About {total.toFixed(2)} s, {Math.round(toFrames(total))} frames.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
