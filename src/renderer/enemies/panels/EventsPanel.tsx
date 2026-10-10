/**
 * The Enemies page's "What it does": the move's events, which come along into a
 * skill, and copying them (Ctrl+C) to paste into the player's animations.
 */
import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { AnimationView } from '../../../shared/api.ts'
import { plural } from '../../../shared/format.ts'
import { setCopiedEvents } from '../../animations/eventClipboard.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { useEnemies } from '../pageContext.ts'
import { plainName } from '../names.ts'

/** Which of a move's events a skill made from it brings along (as src/main/workflows/enemyMoves.ts decides). */
function comesAlong(e: AnimationView['events'][number]): { yes: boolean; why: string } {
  if (e.type === 1 || e.type === 2)
    return { yes: true, why: e.type === 1 ? 'an attack: copied for you' : 'a bullet: copied for you' }
  if (e.fields.some((f) => f.link === 'effect')) return { yes: true, why: 'an effect: copied into the common effects' }
  if (e.type === 144 || e.type === 145) return { yes: true, why: 'camera shake' }
  if (e.type === 608) return { yes: true, why: 'its speed' }
  const flag = e.type === 0 ? e.fields.find((f) => f.name === 'FlagType')?.value : undefined
  if (flag !== undefined && [27, 28, 39, 51, 113, 132, 134].includes(flag))
    return { yes: true, why: 'part of its motion (gravity, falling, collision, jump frames)' }
  if (/sound|wwise/i.test(e.typeName)) return { yes: true, why: 'a sound: brought from its sound bank into yours' }
  if (e.type === 66 || e.type === 67) return { yes: false, why: 'a SpEffect made for the character' }
  if (/ModelMask/i.test(e.typeName)) return { yes: false, why: 'part of its own model' }
  return { yes: false, why: 'its own movement and AI timing (the skill uses yours)' }
}

export function EventsPanel() {
  const p = useEnemies()
  const ui = useUi()
  const { anim, current } = p
  // The events picked to copy, by index, for the move shown: another move starts afresh.
  const move = `${p.chr}:${anim?.name}`
  const [pickedFor, setPickedFor] = useState<{ move: string; indices: number[] }>({ move: '', indices: [] })
  const picked = pickedFor.move === move ? pickedFor.indices : []
  const setPicked = (indices: number[]) => setPickedFor({ move, indices })
  if (!anim || !current)
    return (
      <div className="panel">
        <div className="empty">No move selected.</div>
      </div>
    )
  const events = [...anim.events].sort((a, b) => a.start - b.start)
  const copy = async () => {
    if (!picked.length || !p.chr) return
    try {
      setCopiedEvents(await call('enemy:copyEvents', { chr: p.chr, animation: anim.name, indices: picked }))
      ui.toast(`Copied ${plural(picked.length, 'event')}. Ctrl+V pastes at the playhead, in any of your animations.`)
    } catch (e) {
      ui.error(e)
    }
  }
  // A click picks one event (and plays from it); Ctrl adds or removes one, Shift a run of them.
  const pick = (e: MouseEvent, index: number, start: number) => {
    p.clock.set(start)
    if (e.ctrlKey || e.metaKey)
      setPicked(picked.includes(index) ? picked.filter((i) => i !== index) : [...picked, index])
    else if (e.shiftKey && picked.length) {
      const order = events.map((x) => x.index)
      const [a, b] = [order.indexOf(picked[picked.length - 1]), order.indexOf(index)].sort((x, y) => x - y)
      setPicked([...new Set([...picked, ...order.slice(a, b + 1)])])
    } else setPicked([index])
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && picked.length) {
      e.preventDefault()
      void copy()
    }
  }
  return (
    <div className="panel" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="panel-head">
        <div className="row">
          <b className="grow mono">{anim.name}</b>
          {picked.length > 0 && (
            <button
              className="ghost"
              onClick={copy}
              title="Copy the picked events (Ctrl+C) to paste into your animations"
            >
              Copy {picked.length > 1 ? picked.length : ''}
            </button>
          )}
          <span className="faint">{events.length} events</span>
        </div>
        {current.actions.filter((a) => a.kind !== 'speffect').length > 0 && (
          <div className="dim" style={{ fontSize: 12 }}>
            {current.actions
              .filter((a) => a.kind !== 'speffect')
              .map(
                (a) =>
                  `${a.start.toFixed(2)} s ${a.kind === 'bullet' ? 'fires' : 'hits with'} ${plainName(a.name) || `${a.kind} ${a.id}`}`,
              )
              .join('; ')}
          </div>
        )}
      </div>
      <div className="panel-body">
        {events.map((e) => {
          const c = comesAlong(e)
          return (
            <div
              key={e.index}
              className={`list-item enemy-event${picked.includes(e.index) ? ' selected' : ''}`}
              title={c.why}
              onClick={(m) => pick(m, e.index, e.start)}
            >
              <span className="mono faint" style={{ minWidth: 44 }}>
                {e.start.toFixed(2)}
              </span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{e.typeName}</div>
                <div className="faint ellipsis" style={{ fontSize: 11 }}>
                  {e.summary}
                  {e.fields
                    .filter((f) => f.linkLabel)
                    .map((f) => `, ${f.linkLabel}`)
                    .join('')}
                </div>
              </div>
              <span className={`badge ${c.yes ? 'added' : ''}`}>{c.yes ? 'comes along' : 'stays'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
