/**
 * "Scale…": a skill's, spell's or bullet's effects and hitboxes resized
 * together to a chosen size of the original (so 80% stays 80% however often
 * it's changed), previewed beside the 1.75 m figure before it's applied.
 * Effects other content uses are copied first. src/main/workflows/scale.ts does it.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ScalePlan, ScalePlanEffect, ScaleResult } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from './paramLabels.ts'
import { InActiveWindow, useUi } from '../shared/ui.tsx'
import { EffectPreview } from '../effects/preview/EffectPreview.tsx'
import { errorMessage } from '../../shared/errors.ts'
import { ModalShell } from '../shared/Modal.tsx'
import { plural } from '../../shared/format.ts'

const PRESETS = [50, 75, 90, 100, 110, 125, 150]
const pct = (size: number) => `${Math.round(size * 100)}%`
const metres = (r: number) => `${r.toFixed(2)} m`

/**
 * Where a held effect moves in the preview at `f` times its size now: about
 * the grip; and when its owner's grip on it is known and it isn't in your
 * hand yet, first so that grip is (as scale.ts applies it).
 */
function heldShift(e: ScalePlanEffect, f: number): number[] {
  const g = e.held!.grip
  const h = e.held!.handle
  if (!h || e.held!.fitted) return g.map((v) => (1 - f) * v)
  return g.map((v, k) => f * e.size * (v - h[k]) + (1 - f) * v)
}

export function ScaleDialog({
  param,
  id,
  onClose,
  onDone,
  onOpenAnimation,
}: {
  /** A skill (SwordArtsParam), spell (Magic or its item), bullet, or `effect`. */
  param: string
  id: number
  onClose: () => void
  /** After scaling: params, effects and animations changed. */
  onDone: (r: ScaleResult) => void
  /** Show one of a skill's animations, with a weapon that has it (to watch it at its new size). */
  onOpenAnimation?: (name: string, weapon?: number) => void
}) {
  const ui = useUi()
  const [plan, setPlan] = useState<ScalePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [percent, setPercent] = useState(100)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [hitboxes, setHitboxes] = useState(true)
  /** Held effects: about the grip (in the hand) or the point they appear at. */
  const [pivots, setPivots] = useState<Record<number, 'grip' | 'point'>>({})
  const [previewId, setPreviewId] = useState<number | null>(null)
  /** The size the preview shows: follows the slider after a moment. */
  const [shown, setShown] = useState(100)

  useEffect(() => {
    call('scale:plan', { param, id })
      .then((p) => {
        setPlan(p)
        const now = Math.round(p.size * 100)
        setPercent(now)
        setShown(now)
        setTicked(new Set(p.effects.map((e) => e.id)))
        setPivots(
          Object.fromEntries(p.effects.filter((e) => e.held).map((e) => [e.id, e.held!.inHand ? 'grip' : 'point'])),
        )
        setPreviewId(p.effects[0]?.id ?? null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [param, id])

  useEffect(() => {
    const t = setTimeout(() => setShown(percent), 250)
    return () => clearTimeout(t)
  }, [percent])

  const size = Math.min(500, Math.max(10, percent || 100)) / 100
  const preview = plan?.effects.find((e) => e.id === previewId)
  const previewFactor = preview ? Math.min(500, Math.max(10, shown)) / 100 / preview.size : 1
  const hitboxFactor = plan ? size / plan.hitboxSize : 1
  const hasHitboxes =
    !!plan && (plan.attacks.some((a) => a.radii.length) || plan.bullets.some((b) => b.radius > 0 || b.radiusMax > 0))
  const changes = useMemo(() => {
    if (!plan) return false
    const effects = plan.effects.some((e) => ticked.has(e.id) && Math.abs(size - e.size) > 1e-6)
    return effects || (hitboxes && hasHitboxes && Math.abs(hitboxFactor - 1) > 1e-6)
  }, [plan, ticked, size, hitboxes, hasHitboxes, hitboxFactor])

  const apply = async (watch: boolean) => {
    if (!plan) return
    const r = await ui.run(`Scaling ${plan.root.name} to ${pct(size)}`, () =>
      call('scale:apply', { param, id, size, effects: [...ticked], hitboxes: hitboxes && hasHitboxes, pivots }),
    )
    if (!r) return
    const parts = [
      r.effects ? `${plural(r.effects, 'effect')}${r.copied.length ? ` (${r.copied.length} copied first)` : ''}` : '',
      r.attacks ? plural(r.attacks, 'attack') : '',
      r.bullets ? plural(r.bullets, 'bullet') : '',
    ].filter(Boolean)
    ui.toast(
      `${plan.root.name} is now ${pct(r.size)}: ${parts.join(', ') || 'nothing needed changing'}. Save to write it.`,
    )
    onDone(r)
    if (watch && plan.animations[0] && onOpenAnimation) onOpenAnimation(plan.animations[0], plan.weapon?.id)
    onClose()
  }

  const toggle = (effect: number) =>
    setTicked((t) => {
      const next = new Set(t)
      if (next.has(effect)) next.delete(effect)
      else next.add(effect)
      return next
    })

  const kind =
    param === 'effect' ? 'effect' : param === 'SwordArtsParam' ? 'skill' : param === 'Bullet' ? 'bullet' : 'spell'
  // A held effect whose owner's grip is known: the size at which it reaches the weapon's point it appears at.
  const fitSize = plan?.effects.find((e) => e.held?.fitSize && ticked.has(e.id) && pivots[e.id] === 'grip')?.held
    ?.fitSize
  const fit = fitSize ? Math.round(fitSize * 100) : null

  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="scale-dialog">
        <header>
          <h2 className="grow">Scale {plan?.root.name ?? '…'}</h2>
          {plan && (
            <span className="badge kind">
              {param === 'effect' ? 'Effect' : (PARAM_LABELS[plan.root.param] ?? plan.root.param)}
            </span>
          )}
        </header>
        <div className="body">
          {error && <div className="version-note warn">{error}</div>}
          {!plan && !error && <div className="dim">Finding what it’s made of…</div>}
          {plan && (
            <div className="scale-layout">
              <div className="scale-preview">
                {preview ? (
                  <EffectPreview
                    effectId={preview.id}
                    version={0}
                    scale={previewFactor}
                    shift={
                      preview.held && pivots[preview.id] === 'grip' ? heldShift(preview, previewFactor) : undefined
                    }
                    figure
                  />
                ) : (
                  <div className="dim">No effects to preview: only its hitboxes change.</div>
                )}
                {preview && (
                  <div className="faint" style={{ fontSize: 12 }} title="Pick another effect in the list to see it">
                    {preview.name} at {pct(size)}, beside the 1.75 m figure
                  </div>
                )}
              </div>
              <div className="scale-controls">
                <div className="dim" title="Sizes are of the original: 100% is always how it was made">
                  {kind === 'effect'
                    ? 'Its particles, offsets, lengths and radii.'
                    : `Its effects and hitboxes together, so what you see and what hits stay matched.`}
                </div>
                <div className="scale-size">
                  <input
                    type="range"
                    min={10}
                    max={300}
                    step={1}
                    value={Math.min(300, percent)}
                    onChange={(e) => setPercent(Number(e.target.value))}
                  />
                  <input
                    className="mono"
                    type="number"
                    min={10}
                    max={500}
                    value={percent}
                    onChange={(e) => setPercent(Number(e.target.value))}
                  />
                  <span>%</span>
                </div>
                <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                  {PRESETS.map((p) => (
                    <button key={p} className={`ghost${p === percent ? ' active' : ''}`} onClick={() => setPercent(p)}>
                      {p}%
                    </button>
                  ))}
                  {fit !== null && (
                    <button
                      className={`ghost${fit === percent ? ' active' : ''}`}
                      onClick={() => setPercent(fit)}
                      title={`The size at which it reaches the ${plan.effects.find((e) => e.held?.fitSize)?.held?.weapon ?? 'weapon'}’s point it appears at (a hammer’s head at the weapon’s tip): the weapon’s own hits then match what you see`}
                    >
                      Fit the weapon: {fit}%
                    </button>
                  )}
                  <span className="faint">now {pct(plan.size)}</span>
                </div>

                {plan.effects.length > 0 && (
                  <section className="lookup-section">
                    <h3>Effects</h3>
                    <ul className="scale-list">
                      {plan.effects.map((e) => (
                        <li
                          key={e.id}
                          className={e.id === previewId ? 'selected' : ''}
                          onClick={() => setPreviewId(e.id)}
                        >
                          <div className="row">
                            <input
                              type="checkbox"
                              checked={ticked.has(e.id)}
                              onClick={(ev) => ev.stopPropagation()}
                              onChange={() => toggle(e.id)}
                            />
                            <span className="grow">
                              {e.name} <span className="mono faint">{e.id}</span>
                            </span>
                            {Math.abs(e.size - 1) > 1e-6 && <span className="faint">{pct(e.size)} now</span>}
                          </div>
                          {e.held && (
                            <label
                              className="row faint"
                              onClick={(ev) => ev.stopPropagation()}
                              title="Scale it about the weapon's grip, so it stays held, instead of about the point it appears at"
                            >
                              <input
                                type="checkbox"
                                checked={pivots[e.id] === 'grip'}
                                onChange={(ev) =>
                                  setPivots((p) => ({ ...p, [e.id]: ev.target.checked ? 'grip' : 'point' }))
                                }
                              />
                              {pivots[e.id] === 'grip'
                                ? `Kept in the hand: scaled about the ${e.held.weapon}’s grip`
                                : `Scaled where it appears, ${e.held.distance.toFixed(2)} m from the hand on the ${e.held.weapon}`}
                            </label>
                          )}
                          {e.children.length > 0 && (
                            <div className="faint">
                              with the {plural(e.children.length, 'effect')} it shows ({e.children.join(', ')})
                            </div>
                          )}
                          {e.sharedWith.length > 0 && (
                            <div className="faint">
                              Copied first, so these keep it as it is: {e.sharedWith.slice(0, 3).join('; ')}
                              {e.sharedWith.length > 3 ? '…' : ''}
                            </div>
                          )}
                          {e.usedBy !== undefined && e.usedBy > 0 && (
                            <div className="warn-text">
                              Used by {e.usedBy} row{e.usedBy === 1 ? '' : 's'} and animation
                              {e.usedBy === 1 ? '' : 's'}: they all change (scale a skill or spell to change it for that
                              one only).
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {hasHitboxes && (
                  <section className="lookup-section">
                    <h3>
                      <label className="row">
                        <input type="checkbox" checked={hitboxes} onChange={(e) => setHitboxes(e.target.checked)} />
                        Hitboxes
                        {Math.abs(plan.hitboxSize - 1) > 1e-6 && (
                          <span className="faint">({pct(plan.hitboxSize)} now)</span>
                        )}
                      </label>
                    </h3>
                    <ul className="lookup-list">
                      {plan.attacks
                        .filter((a) => a.radii.length)
                        .map((a) => (
                          <li key={`a${a.id}`}>
                            Attack <span className="mono">{a.id}</span> {a.name}: radius{' '}
                            {a.radii.map(metres).join(', ')}
                            {hitboxes && Math.abs(hitboxFactor - 1) > 1e-6 && (
                              <> → {a.radii.map((r) => metres(r * hitboxFactor)).join(', ')}</>
                            )}
                            {a.sharedWith.length > 0 && (
                              <div className="warn-text">
                                Also used by {a.sharedWith.slice(0, 3).join('; ')}: it changes there too.
                              </div>
                            )}
                          </li>
                        ))}
                      {plan.bullets
                        .filter((b) => b.radius > 0 || b.radiusMax > 0)
                        .map((b) => (
                          <li key={`b${b.id}`}>
                            Bullet <span className="mono">{b.id}</span> {b.name}: radius {metres(b.radius)}
                            {b.radiusMax > 0 ? ` (grows to ${metres(b.radiusMax)})` : ''}
                            {hitboxes && Math.abs(hitboxFactor - 1) > 1e-6 && (
                              <>
                                {' '}
                                → {metres(b.radius * hitboxFactor)}
                                {b.radiusMax > 0 ? ` (${metres(b.radiusMax * hitboxFactor)})` : ''}
                              </>
                            )}
                            {b.sharedWith.length > 0 && (
                              <div className="warn-text">
                                Also used by {b.sharedWith.slice(0, 3).join('; ')}: it changes there too.
                              </div>
                            )}
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
                {plan.notes.map((n, i) => (
                  <div key={i} className="faint">
                    {n}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer>
          <span className="faint grow" style={{ fontSize: 12 }}>
            Written to the mod folder when you save.
          </span>
          <button onClick={onClose}>Cancel</button>
          {kind === 'skill' && onOpenAnimation && plan?.animations.length ? (
            <button
              disabled={!changes}
              onClick={() => apply(true)}
              title="Scale it, then watch its animation in the Animations workspace"
            >
              Scale and watch
            </button>
          ) : null}
          <button className="primary" disabled={!changes} onClick={() => apply(false)}>
            Scale to {pct(size)}
          </button>
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
