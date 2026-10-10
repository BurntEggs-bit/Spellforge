/**
 * The effect, part by part: each node in plain words ("3D model · spawns 2
 * every 0.03 s, each lives 0.2 s"), and for the selected part its look
 * (models, textures), friendly controls (spawning, life, size, motion, spin,
 * position) and every raw field under Advanced, each with its description.
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  EffectView,
  FxActionView,
  FxFieldEdit,
  FxFieldView,
  FxPartView,
  PreviewEmitter,
  PreviewSpec,
} from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { Swatch, Thumb, useUi } from '../shared/ui.tsx'
import { Slot, useSlotActions } from './slots.tsx'

type Edit = Omit<FxFieldEdit, 'actionIndex' | 'field'>

const fmt = (n: number) => String(+n.toFixed(4))
const secs = (n: number) => `${+n.toFixed(2)} s`

/* ------------------------------ friendly view ----------------------------- */
interface Pick {
  slot: RegExp
  field: RegExp
}
interface Group {
  title: string
  hint: string
  picks: Pick[]
  /** Offer "smaller / bigger" buttons that scale every field in the group. */
  scaleAll?: string
}

const GROUPS: Group[] = [
  {
    title: 'Spawning',
    hint: 'How many appear, how often, and from what shape.',
    picks: [
      { slot: /^Emitter$/, field: /^(interval|perEmission|threshold|maxConcurrent|totalEmissions)$/ },
      { slot: /^EmitterShape$/, field: /^(direction|radius|sizeX|sizeY|sizeZ|width|height|depth|emitInside)$/ },
      { slot: /^DirectionSpread$/, field: /^(angle|angleX|angleY|distribution)$/ },
    ],
  },
  {
    title: 'Life & timing',
    hint: 'When this part starts, how long it runs, and how long each piece lasts.',
    picks: [
      { slot: /^NodeAttributes$/, field: /^(delay|duration)$/ },
      { slot: /^ParticleAttributes$/, field: /^duration$/ },
    ],
  },
  {
    title: 'Size',
    hint: 'How big each piece is. Sizes that change over its life keep their shape when scaled.',
    scaleAll: 'size',
    picks: [
      {
        slot: /^Appearance$/,
        field:
          /^(size|sizeX|sizeY|sizeZ|width|height|length|radius|particleSizeX|particleSizeY|particleSizeMultiplier|particleLength|particleWidth)$/,
      },
      { slot: /^ParticleModifier$/, field: /^(scaleX|scaleY|scaleZ)$/ },
    ],
  },
  {
    title: 'Motion',
    hint: 'How fast pieces fly, fall and turn, and how the part itself moves.',
    picks: [
      { slot: /^ParticleModifier$/, field: /^speed$/ },
      {
        slot: /^ParticleMovement$/,
        field: /^(speed|speedMultiplier|acceleration|accelerationMultiplier|gravity|maxTurnAngle|turnInterval)$/,
      },
      {
        slot: /^NodeMovement$/,
        field: /^(speedZ|accelerationZ|accelerationY|angularSpeed[XYZ]|angularSpeedMultiplier[XYZ])$/,
      },
    ],
  },
  {
    title: 'Spin',
    hint: 'Starting rotation and how fast each piece spins.',
    scaleAll: 'spin speed',
    picks: [{ slot: /^Appearance$/, field: /^(rotation[XYZ]?|angularSpeed[XYZ]?|spin.*)$/ }],
  },
  {
    title: 'Position',
    hint: 'Where this part sits relative to its parent, and how it is turned.',
    picks: [{ slot: /^NodeTransform$/, field: /^(offset|rotation|offsetVariance|rotationVariance)$/ }],
  },
  {
    title: 'Look',
    hint: 'Blending, facing and brightness. Colours are in the Color section.',
    picks: [{ slot: /^Appearance$/, field: /^(blendMode|orientation|rgbMultiplier|alphaMultiplier|lighting|bloom)$/ }],
  },
]

/** Friendly labels by action slot + field (falls back to the field name). */
function friendlyLabel(slot: string, action: string, field: string): string {
  const key = `${slot}.${field}`
  const map: Record<string, string> = {
    'Emitter.interval': 'Every (seconds)',
    'Emitter.perEmission': 'How many each time',
    'Emitter.threshold': 'Every (metres moved)',
    'Emitter.maxConcurrent': 'Most alive at once (−1 = no limit)',
    'Emitter.totalEmissions': 'Total spawns (−1 = no limit)',
    'EmitterShape.direction': 'Initial direction',
    'EmitterShape.radius': 'Spawn radius (m)',
    'DirectionSpread.angle': 'Spread angle (°)',
    'NodeAttributes.delay': 'Starts after (s)',
    'NodeAttributes.duration': 'Runs for (s, ≤ 0 = until the effect ends)',
    'ParticleAttributes.duration': 'Each piece lasts (s, ≤ 0 = while the part runs)',
    'ParticleModifier.speed': 'Launch speed (m/s)',
    'ParticleModifier.scaleX': 'Size multiplier',
    'ParticleModifier.scaleY': 'Size multiplier (height)',
    'ParticleModifier.scaleZ': 'Size multiplier (depth)',
    'ParticleMovement.speed': 'Speed (m/s)',
    'ParticleMovement.acceleration': 'Acceleration (m/s²)',
    'ParticleMovement.gravity': 'Gravity',
    'NodeMovement.speedZ': 'Part moves forward (m/s)',
    'NodeMovement.accelerationZ': 'Part accelerates forward',
    'NodeTransform.offset': 'Position (x, y, z m)',
    'NodeTransform.rotation': 'Rotation (x, y, z °)',
    'NodeTransform.offsetVariance': 'Random position ±',
    'NodeTransform.rotationVariance': 'Random rotation ±',
    'Appearance.blendMode': 'Blending',
    'Appearance.orientation': 'Faces',
    'Appearance.rgbMultiplier': 'Brightness',
    'Appearance.alphaMultiplier': 'Opacity',
  }
  if (map[key]) return map[key]
  if (slot === 'NodeMovement' && /^angularSpeed[XYZ]$/.test(field)) return `Part spins ${field.slice(12)} (°/s)`
  if (slot === 'NodeMovement' && /^angularSpeedMultiplier[XYZ]$/.test(field))
    return `Spin multiplier ${field.slice(22)}`
  if (slot === 'Appearance') {
    if (/^size$|^sizeX$|^width$|^particleSizeX$/.test(field)) return action === 'PointLight' ? 'Radius' : 'Width'
    if (/^sizeY$|^height$|^particleSizeY$/.test(field)) return 'Height'
    if (field === 'sizeZ') return 'Depth'
    if (field === 'radius') return 'Radius (m)'
    if (/^rotation/.test(field)) return `Start rotation ${field.slice(8) || ''} (°)`.trim()
    if (/^angularSpeed[XYZ]?$/.test(field)) return `Spin ${field.slice(12)} (°/s)`.trim()
  }
  return field
}

/** What special values mean, e.g. a duration of −0.033 is "forever" in game. */
function valueNote(slot: string, field: string, value: FxFieldView['value']): string {
  if (typeof value !== 'number') return ''
  if (slot === 'NodeAttributes' && field === 'duration' && value <= 0) return 'until the effect ends'
  if (slot === 'ParticleAttributes' && field === 'duration' && value <= 0) return 'as long as the part runs'
  if (slot === 'Emitter' && (field === 'maxConcurrent' || field === 'totalEmissions') && value < 0) return 'no limit'
  return ''
}

function partSummary(e: PreviewEmitter | undefined): string {
  if (!e) return ''
  const bits: string[] = []
  const em = e.emission
  if (em.kind === 'once') bits.push('appears once')
  else if (em.kind === 'periodic')
    bits.push(
      `${em.perEmission > 1 ? `${em.perEmission} ` : ''}every ${secs(em.interval)}${em.maxConcurrent > 0 ? `, at most ${em.maxConcurrent} at once` : ''}`,
    )
  else if (em.kind === 'distance') bits.push(`one every ${+em.threshold.toFixed(2)} m it moves`)
  if (e.lifetime > 0) bits.push(`each lasts ${secs(e.lifetime)}`)
  if (e.delay > 0) bits.push(`starts after ${secs(e.delay)}`)
  if (e.nodeDuration > 0) bits.push(`runs ${secs(e.nodeDuration)}`)
  const speed = e.speed.samples[0]?.[0] ?? 0
  if (Math.abs(speed) > 0.01) bits.push(`flies ${+speed.toFixed(1)} m/s`)
  if (!e.attached && e.lifetime > 0) bits.push('stays where spawned')
  if (e.nodeSpin) bits.push('orbits')
  return bits.join(', ')
}

/* ------------------------------- field input ------------------------------ */
const SCALES = [0.5, 0.8, 1.25, 2]

function FieldInput({
  field,
  label,
  onEdit,
  compact,
  note,
}: {
  field: FxFieldView
  label?: string
  onEdit: (e: Edit) => void
  compact?: boolean
  /** What the current value means, shown beside it. */
  note?: string
}) {
  const [draft, setDraft] = useState<string[]>([])
  const values = Array.isArray(field.value) ? field.value : [field.value]
  useEffect(
    () => setDraft(values.map((v) => (typeof v === 'number' ? fmt(v) : String(v)))),
    [JSON.stringify(field.value)],
  )

  const commit = () => {
    const nums = draft.map(Number)
    if (nums.some((n) => !Number.isFinite(n)))
      return setDraft(values.map((v) => (typeof v === 'number' ? fmt(v) : String(v))))
    const next = Array.isArray(field.value) ? nums : nums[0]
    if (
      JSON.stringify(next) ===
      JSON.stringify(
        Array.isArray(field.value) ? field.value.map((v) => +fmt(v as number)) : +fmt(field.value as number),
      )
    )
      return
    onEdit({ value: field.kind === 'int' ? Math.round(nums[0]) : next })
  }

  let control: React.ReactNode
  if (field.kind === 'bool') {
    control = <input type="checkbox" checked={!!field.value} onChange={(e) => onEdit({ value: e.target.checked })} />
  } else if (field.kind === 'enum' && field.enumOptions) {
    const known = field.enumOptions.some((o) => o.value === field.value)
    control = (
      <select
        value={String(field.value)}
        onChange={(e) => onEdit({ value: Number(e.target.value) })}
        title={field.enumOptions.find((o) => o.value === field.value)?.desc}
      >
        {!known && <option value={String(field.value)}>{String(field.value)}</option>}
        {field.enumOptions.map((o) => (
          <option key={o.value} value={o.value} title={o.desc}>
            {o.label.replace(/([a-z])([A-Z])/g, '$1 $2')} ({o.value})
          </option>
        ))}
      </select>
    )
  } else {
    control = (
      <span className="row" style={{ gap: 4 }}>
        {draft.map((d, i) => (
          <input
            key={i}
            className="mono num"
            style={{ width: field.components > 1 ? 64 : 84 }}
            value={d}
            title={field.animated ? 'Typing a number replaces the curve with a constant' : undefined}
            onChange={(e) => setDraft(draft.map((x, j) => (j === i ? e.target.value : x)))}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ))}
      </span>
    )
  }
  const canScale = field.kind === 'scalar' || field.kind === 'vector'
  return (
    <div className={`fx-field${compact ? ' compact' : ''}`}>
      <div className="fx-field-label" title={field.desc}>
        {label ?? field.name}
        {label && label !== field.name && <span className="faint mono"> {field.name}</span>}
      </div>
      <div className="fx-field-value">
        {control}
        {note && <span className="faint">= {note}</span>}
        {canScale && (field.animated || field.modifiers.length > 0) && (
          <span className="scale-chips">
            {SCALES.map((k) => (
              <button
                key={k}
                className="chip"
                onClick={() => onEdit({ scale: k })}
                title={`Multiply by ${k}, keeping its curve and randomness`}
              >
                ×{k}
              </button>
            ))}
          </span>
        )}
      </div>
      {(field.animated || field.modifiers.length > 0) && (
        <div className="fx-field-note faint">
          {field.animated && (
            <>
              changes over {field.animated.over || 'time'}: {fmt(field.animated.min)} → {fmt(field.animated.max)} (
              {field.animated.keys} keys, {field.animated.function})
            </>
          )}
          {field.modifiers.length > 0 && (
            <>
              {field.animated ? ', ' : ''}
              {field.modifiers.join(', ')}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------- part editor ------------------------------ */
function fieldsFor(actions: FxActionView[], picks: Pick[]): { action: FxActionView; field: FxFieldView }[] {
  const out: { action: FxActionView; field: FxFieldView }[] = []
  for (const p of picks)
    for (const a of actions)
      if (p.slot.test(a.slot))
        for (const f of a.fields) if (p.field.test(f.name) && !f.unknown) out.push({ action: a, field: f })
  return out
}

function PartEditor({
  effectId,
  part,
  node,
  onEdit,
  onChanged,
}: {
  effectId: number
  part: FxPartView
  node: EffectView['nodes'][number]
  onEdit: (edits: FxFieldEdit[], label: string) => void
  onChanged: (fx: EffectView) => void
}) {
  const [advanced, setAdvanced] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const slots = useSlotActions(effectId, onChanged)
  const appearance = part.actions.find((a) => a.slot === 'Appearance')

  return (
    <div className="part-editor">
      {appearance && <div className="faint part-desc">{appearance.desc.split('\n')[0]}</div>}

      {node.slots.length > 0 && (
        <div className="part-group">
          <div className="part-group-title">Model & textures</div>
          {node.slots.map((s) => (
            <Slot
              key={`${s.actionIndex}:${s.field}`}
              slot={s}
              onSet={(v) => slots.setResource(s, v)}
              onImport={(f) => slots.importInto(s, f)}
            />
          ))}
        </div>
      )}

      {GROUPS.map((g) => {
        const items = fieldsFor(part.actions, g.picks)
        if (!items.length) return null
        const scalable = g.scaleAll
          ? items
              .filter((i) => i.field.kind === 'scalar' || i.field.kind === 'vector')
              .filter((i) => i.action.slot === 'Appearance')
          : []
        return (
          <div key={g.title} className="part-group">
            <div className="part-group-title" title={g.hint}>
              {g.title}
              {scalable.length > 0 && (
                <span className="scale-chips">
                  {SCALES.map((k) => (
                    <button
                      key={k}
                      className="chip"
                      title={`Multiply every ${g.scaleAll} by ${k}`}
                      onClick={() =>
                        onEdit(
                          scalable.map((i) => ({ actionIndex: i.action.actionIndex, field: i.field.name, scale: k })),
                          `Scaling ${g.scaleAll}`,
                        )
                      }
                    >
                      ×{k}
                    </button>
                  ))}
                </span>
              )}
            </div>
            <div className="faint part-hint">{g.hint}</div>
            {items.map(({ action, field }) => (
              <FieldInput
                key={`${action.actionIndex}:${field.name}`}
                field={field}
                label={friendlyLabel(action.slot, action.name, field.name)}
                note={valueNote(action.slot, field.name, field.value)}
                onEdit={(e) =>
                  onEdit([{ actionIndex: action.actionIndex, field: field.name, ...e }], `Changing ${field.name}`)
                }
              />
            ))}
          </div>
        )
      })}

      <div className="part-group">
        <div className="row">
          <button className="ghost" onClick={() => setAdvanced(!advanced)}>
            {advanced ? '▾' : '▸'} Advanced: every field
          </button>
          {advanced && (
            <label className="row dim" style={{ marginLeft: 'auto' }}>
              <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} /> unnamed fields
            </label>
          )}
        </div>
        {advanced &&
          part.actions.map((a) => {
            const fields = a.fields.filter((f) => unknown || !f.unknown)
            if (!fields.length) return null
            return (
              <details key={a.actionIndex} className="fx-action" open={a.slot === 'Appearance' || a.slot === 'Emitter'}>
                <summary>
                  <b>{a.name}</b>{' '}
                  <span className="faint">
                    {a.slot} #{a.actionIndex}
                  </span>
                </summary>
                <div className="faint fx-action-desc">{a.desc.split('\n')[0]}</div>
                {fields.map((f) => (
                  <FieldInput
                    key={f.name}
                    field={f}
                    compact
                    onEdit={(e) => onEdit([{ actionIndex: a.actionIndex, field: f.name, ...e }], `Changing ${f.name}`)}
                  />
                ))}
              </details>
            )
          })}
      </div>
    </div>
  )
}

/* -------------------------------- section -------------------------------- */
export function PartsSection({
  fx,
  selected,
  onSelect,
  onChanged,
  onOpenEffect,
}: {
  fx: EffectView
  selected: number | null
  onSelect: (index: number | null) => void
  onChanged: (fx: EffectView) => void
  onOpenEffect: (id: number) => void
}) {
  const ui = useUi()
  const [parts, setParts] = useState<FxPartView[] | null>(null)
  const [spec, setSpec] = useState<PreviewSpec | null>(null)
  const [showGroups, setShowGroups] = useState(false)

  // Reload whenever the effect view changes (after any edit).
  useEffect(() => {
    let live = true
    call('effect:parts', { id: fx.id })
      .then((p) => live && setParts(p))
      .catch(() => live && setParts([]))
    call('effect:preview', { id: fx.id })
      .then((s) => live && setSpec(s))
      .catch(() => live && setSpec(null))
    return () => {
      live = false
    }
  }, [fx])

  const emitterByNode = useMemo(() => {
    const m = new Map<number, PreviewEmitter>()
    for (const e of spec?.emitters ?? []) if (e.effectId === fx.id && !m.has(e.nodeIndex)) m.set(e.nodeIndex, e)
    return m
  }, [spec, fx.id])

  const edit = async (edits: FxFieldEdit[], label: string) => {
    const next = await ui.run(label, () => call('effect:setFields', { effectId: fx.id, edits }))
    if (next) onChanged(next)
  }

  const visible = fx.nodes.filter(
    (n) => n.index > 0 && (showGroups || n.isProxy || !['Group', 'Emitter'].includes(n.label)),
  )
  const sel = selected !== null ? fx.nodes.find((n) => n.index === selected) : undefined
  const selPart = selected !== null ? parts?.find((p) => p.index === selected) : undefined

  return (
    <section className="section">
      <header>
        <h3>Parts</h3>
        <span className="faint">{visible.length}</span>
        <span className="grow" />
        <label className="row dim" title="Groups move, turn and time the parts under them">
          <input type="checkbox" checked={showGroups} onChange={(e) => setShowGroups(e.target.checked)} /> groups
        </label>
      </header>
      <div className="content parts">
        {visible.map((n) => {
          const isSel = selected === n.index
          return (
            <div key={n.index} className={`part${isSel ? ' selected' : ''}`}>
              <div
                className="part-row"
                style={{ paddingLeft: 6 + Math.max(0, n.depth - 1) * 12 }}
                onClick={() => onSelect(isSel ? null : n.index)}
              >
                <Swatch color={n.color} wide />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis">
                    <b>{n.isProxy ? `Child effect ${n.proxyTarget}` : n.label}</b>
                    <span className="faint"> #{n.index}</span>
                  </div>
                  <div className="faint ellipsis part-summary">
                    {n.isProxy
                      ? 'A separate effect file played here'
                      : partSummary(emitterByNode.get(n.index)) ||
                        (n.label === 'Group' ? 'Moves, turns and times the parts under it' : '')}
                  </div>
                </div>
                {n.slots.slice(0, 3).map((s) => (
                  <Thumb
                    key={s.actionIndex + s.field}
                    resource={s.resource}
                    id={s.value}
                    textureType={s.textureType}
                    size={28}
                  />
                ))}
                {n.isProxy && n.proxyTarget !== undefined && (
                  <button
                    className="fx-chip"
                    title="Open this child effect"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenEffect(n.proxyTarget!)
                    }}
                  >
                    ✦{n.proxyTarget}
                  </button>
                )}
                <span className="faint">{isSel ? '▾' : '▸'}</span>
              </div>
              {isSel && sel && selPart && (
                <PartEditor effectId={fx.id} part={selPart} node={sel} onEdit={edit} onChanged={onChanged} />
              )}
              {isSel && sel && !selPart && (
                <div className="faint" style={{ padding: 8 }}>
                  Loading…
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
