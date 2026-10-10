/**
 * The Animations page's animation properties (F3): its id, category, motion
 * and looping, and how its clips in the behaviour graph play (speed, cut,
 * mode, mirrored), as ERClipGeneratorTool sets them.
 */
import { useState, useEffect } from 'react'
import { animationIdText, animationName, describeAnimationId } from '../../../shared/animIds.ts'
import type { AnimClipEdit, AnimClipView, AnimProperties } from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { Modal } from '../../shared/Modal.tsx'
import { parseAnimationInput } from './animationInput.ts'

/** F3: an animation's id, category and motion reference. */
export function PropertiesDialog({
  name,
  onClose,
  onDone,
}: {
  name: string
  onClose: () => void
  onDone: (name: string) => void
}) {
  const ui = useUi()
  const [p, setP] = useState<(AnimProperties & { usedBy?: string[] }) | null>(null)
  const [category, setCategory] = useState('')
  const [id, setId] = useState('')
  const [kind, setKind] = useState<AnimProperties['motion']>('own')
  const [source, setSource] = useState('')
  const [loop, setLoop] = useState(false)
  // Its clips: numbers as typed (applied when they read as numbers).
  const [clip, setClip] = useState<{
    speed: string
    cropStart: string
    cropEnd: string
    mode: number
    mirror: boolean
  }>({
    speed: '1',
    cropStart: '0',
    cropEnd: '0',
    mode: 0,
    mirror: false,
  })
  useEffect(() => {
    call('anim:properties', { name })
      .then((x) => {
        setP(x)
        setCategory(String(x.category))
        setId(animationIdText(x.id))
        setKind(x.motion)
        setSource(x.source ?? '')
        setLoop(x.loop)
        if (x.clip) setClip(clipText(x.clip))
      })
      .catch(ui.error)
  }, [name, ui])
  if (!p) return null
  const clipEdit = p.clip ? clipChanges(p.clip, clip) : {}
  const clipBad = Object.values(clipEdit).some((v) => typeof v === 'number' && !Number.isFinite(v))
  const to = /^\d{1,3}$/.test(category) && /^\d{1,6}$/.test(id) ? animationName(Number(category), Number(id)) : null
  const moving = to !== null && to !== name
  const src = kind === 'own' ? null : parseAnimationInput(source, p.category)
  const changed =
    moving ||
    kind !== p.motion ||
    (kind !== 'own' && src !== p.source) ||
    loop !== p.loop ||
    Object.keys(clipEdit).length > 0
  const apply = () =>
    ui.run('Changing the animation', async () => {
      const r = await call('anim:setProperties', {
        name,
        ...(moving ? { category: Number(category), id: Number(id) } : {}),
        ...(kind !== p.motion || (kind !== 'own' && src !== p.source)
          ? { motion: { kind, ...(src ? { source: src } : {}) } }
          : {}),
        ...(loop !== p.loop ? { loop } : {}),
        ...(Object.keys(clipEdit).length ? { clip: clipEdit } : {}),
      })
      onDone(r.name)
      onClose()
    })
  return (
    <Modal
      escapeCloses
      title={`Properties of ${name}`}
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="grow faint" style={{ fontSize: 12 }}>
            Ctrl+Z undoes it.
          </span>
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!changed || !to || (kind !== 'own' && !src) || clipBad} onClick={apply}>
            Apply
          </button>
        </>
      }
    >
      <div className="fields" style={{ gridTemplateColumns: '150px 1fr' }}>
        <div className="field-label">Category and id</div>
        <div className="field-value">
          <div className="field-input">
            <span className="mono faint">a</span>
            <input
              className="mono"
              style={{ width: 60 }}
              value={category}
              onChange={(e) => setCategory(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <span className="mono faint">_</span>
            <input
              className="mono"
              style={{ width: 90 }}
              value={id}
              onChange={(e) => setId(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <span className="faint" style={{ fontSize: 12 }}>
              {to
                ? moving
                  ? `→ ${to}${describeAnimationId(Number(id)) ? `: ${describeAnimationId(Number(id))}` : ''}`
                  : (describeAnimationId(p.id) ?? '')
                : '0–999 _ 0–999999'}
            </span>
          </div>
          {moving && (
            <div className="field-hint">
              A different id is a different move (the game calls moves by id). Its motion keeps playing from {name}’s
              file; register the new name.
            </div>
          )}
        </div>
        <div className="field-label">Motion</div>
        <div className="field-value">
          <select value={kind} onChange={(e) => setKind(e.target.value as AnimProperties['motion'])}>
            <option value="own">Its own motion file</option>
            <option value="motion">The motion of another animation (own events)</option>
            <option value="full">Everything from another animation (motion and events)</option>
          </select>
          {kind === 'own' ? (
            <div className="field-hint">
              Plays <span className="mono">{p.motion === 'own' ? p.file : `${to ?? name}.hkt`}</span> (a motion file of
              that name must exist in the binders).
            </div>
          ) : (
            <div className="field-input" style={{ marginTop: 6 }}>
              <input
                className="mono"
                placeholder="a050_030000"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
              <span className="faint" style={{ fontSize: 12 }}>
                {src ?? 'an animation name'}
              </span>
            </div>
          )}
        </div>
        <div className="field-label">Loops</div>
        <div className="field-value">
          <label className="row">
            <input
              type="checkbox"
              checked={loop}
              disabled={kind === 'full'}
              onChange={(e) => setLoop(e.target.checked)}
            />
            <span className="dim">Plays looped by default (idle and loop states)</span>
          </label>
        </div>
        {p.clip && (
          <>
            <div className="field-label">Clip speed</div>
            <div className="field-value">
              <div className="field-input">
                <input
                  className="mono"
                  style={{ width: 70 }}
                  value={clip.speed}
                  onChange={(e) => setClip({ ...clip, speed: e.target.value })}
                />
                <span className="faint" style={{ fontSize: 12 }}>
                  × (1 plays it as made, 1.2 a fifth faster)
                </span>
              </div>
            </div>
            <div className="field-label">Clip cut</div>
            <div className="field-value">
              <div className="field-input">
                <input
                  className="mono"
                  style={{ width: 70 }}
                  value={clip.cropStart}
                  onChange={(e) => setClip({ ...clip, cropStart: e.target.value })}
                />
                <span className="faint">s from the start,</span>
                <input
                  className="mono"
                  style={{ width: 70 }}
                  value={clip.cropEnd}
                  onChange={(e) => setClip({ ...clip, cropEnd: e.target.value })}
                />
                <span className="faint">s from the end</span>
              </div>
            </div>
            <div className="field-label">Clip mode</div>
            <div className="field-value">
              <div className="field-input">
                <select value={clip.mode} onChange={(e) => setClip({ ...clip, mode: Number(e.target.value) })}>
                  <option value={0}>Plays once</option>
                  <option value={1}>Loops</option>
                  <option value={2}>Controlled by the game</option>
                  <option value={3}>Ping-pong (forward, then back)</option>
                </select>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={clip.mirror}
                    onChange={(e) => setClip({ ...clip, mirror: e.target.checked })}
                  />
                  <span className="dim">Mirrored (left for right)</span>
                </label>
              </div>
              <div className="field-hint">
                How the behaviour graph plays it: {p.clip.clips} {p.clip.clips === 1 ? 'clip' : 'clips'}, one per state
                that plays this id, all set together
                {p.clip.same ? '' : ' (they differ now: these are the first one’s)'}.
                {p.clip.startBound > 0 &&
                  ` ${p.clip.startBound === p.clip.clips ? 'Its' : `${p.clip.startBound} of its`} clips start where the jump left off (TimeActEditor_10), as a jump attack’s landing needs.`}
              </div>
            </div>
          </>
        )}
        <div className="field-label">Stored</div>
        <div className="field-value mono faint meta" style={{ fontSize: 12 }}>
          <span>type {p.raw.type}</span>
          <span>a {p.raw.a}</span>
          <span>b {p.raw.b}</span>
          <span>{p.file || '(no file name)'}</span>
          <span>{p.events} events</span>
          <span>{p.registration}</span>
        </div>
        {p.usedBy && p.usedBy.length > 0 && (
          <>
            <div className="field-label">Used by</div>
            <div className="field-value faint" style={{ fontSize: 12 }}>
              {p.usedBy.slice(0, 12).join(', ')}
              {p.usedBy.length > 12 ? ` and ${p.usedBy.length - 12} more` : ''} take their motion or events from it
              {moving ? ': moving it leaves them playing nothing.' : '.'}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

/** A clip's settings as the fields show them. */
function clipText(c: AnimClipView) {
  const n = (v: number) => String(Math.round(v * 1000) / 1000)
  return { speed: n(c.playbackSpeed), cropStart: n(c.cropStart), cropEnd: n(c.cropEnd), mode: c.mode, mirror: c.mirror }
}

/** What the fields change (numbers that don't read as numbers come back as NaN, which can't be applied). */
function clipChanges(c: AnimClipView, t: ReturnType<typeof clipText>): AnimClipEdit {
  const out: AnimClipEdit = {}
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const was = clipText(c)
  if (t.speed !== was.speed) out.playbackSpeed = num(t.speed) > 0 ? num(t.speed) : NaN
  if (t.cropStart !== was.cropStart) out.cropStart = num(t.cropStart) >= 0 ? num(t.cropStart) : NaN
  if (t.cropEnd !== was.cropEnd) out.cropEnd = num(t.cropEnd) >= 0 ? num(t.cropEnd) : NaN
  if (t.mode !== c.mode) out.mode = t.mode
  if (t.mirror !== c.mirror) out.mirror = t.mirror
  return out
}
