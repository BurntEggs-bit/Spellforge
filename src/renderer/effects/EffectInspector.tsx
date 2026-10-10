/**
 * The Inspector for an effect (FXR): its preview, colours, parts and assets,
 * what uses it, and getting it from another bundle.
 *
 * Credit: FXR Playground (its guides' authors): the recolouring advice shown
 * with the colours.
 */
import { useEffect, useMemo, useState } from 'react'
import type { EffectLocation, EffectView, RecolorOp } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from '../params/paramLabels.ts'
import { hexToRgba } from '../lib/color.ts'
import { StateBadge, useUi } from '../shared/ui.tsx'
import { EffectPreview } from './preview/EffectPreview.tsx'
import { PartsSection } from './PartsEditor.tsx'
import { AssetsSection } from './AssetsSection.tsx'
import { ScaleDialog } from '../params/ScaleDialog.tsx'
import { MenuButton } from '../shared/menu.tsx'
import { ENTIRE_SPELL_TIP } from '../shared/spell.ts'

const ADDITIVE = new Set([0, 4, 7])

export function EffectInspector({
  id,
  onOpenEffect,
  onOpenRow,
  onEdited,
  onEntireSpell,
}: {
  id: number
  onOpenEffect: (id: number) => void
  onOpenRow: (param: string, id: number) => void
  onEdited: () => void
  /** Entire spell: cast a spell this effect is part of from start to finish in the Animations viewer. */
  onEntireSpell?: (spell: number) => void
}) {
  const ui = useUi()
  const [fx, setFx] = useState<EffectView | null>(null)
  const [nodeIndex, setNodeIndex] = useState<number | null>(null)
  const [color, setColor] = useState('#ff3b2f')
  const [hue, setHue] = useState(120)
  const [includeChildren, setIncludeChildren] = useState(false)
  // Weapon-buff coatings: recolour every blade size together unless told otherwise.
  const [includeSizes, setIncludeSizes] = useState(true)
  /** Bumped after each edit so the preview resamples. */
  const [edits, setEdits] = useState(0)
  const [scaling, setScaling] = useState(false)

  // An effect outside the common bundles (a character's own): where it is, to copy it in.
  const [elsewhere, setElsewhere] = useState<EffectLocation | null | undefined>(undefined)
  const load = () => {
    setElsewhere(undefined)
    call('effect:get', { id })
      .then(setFx)
      .catch(async (e) => {
        const where = await ui.run('Looking through the game’s effect bundles', () => call('effect:locate', { id }))
        if (where === undefined) return
        if (where) setElsewhere(where)
        else ui.error(e)
      })
  }
  useEffect(load, [id, ui])
  const bringIn = async () => {
    const r = await ui.run('Copying it into the common effects', () => call('effect:import', { id }))
    if (!r) return
    onEdited()
    ui.toast(
      `Copied into the common effects: ${r.effects.length === 1 ? `effect ${r.effects[0]}` : `effects ${r.effects.join(', ')}`}${r.files.length ? `, with ${r.files.join(', ')}` : ''}.`,
    )
    setElsewhere(null)
    load()
  }

  const blends = useMemo(() => {
    if (!fx) return []
    const scope = nodeIndex === null ? fx.nodes : fx.nodes.filter((n) => n.index === nodeIndex)
    return scope.flatMap((n) => n.blends)
  }, [fx, nodeIndex])

  if (!fx && elsewhere)
    return (
      <div className="panel-pad">
        <section className="section">
          <header>
            <h3>Effect {id}</h3>
            <span className="faint">{elsewhere.name}</span>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="warn">
              In <b>{elsewhere.owner}</b>’s own effects (<code>{elsewhere.bundle}</code>), which the game loads only
              where they appear: your weapons, skills and bullets can’t show it from there.
            </div>
            <div className="row">
              <button
                className="primary"
                onClick={bringIn}
                title="Into the effects loaded everywhere, with the effects it spawns and the textures and models it needs. It keeps its id."
              >
                Copy into the common effects
              </button>
            </div>
          </div>
        </section>
      </div>
    )
  if (!fx) return <div className="empty">Loading effect…</div>

  /** After any edit: show the new view, resample the preview, mark the project dirty. */
  const changed = (next: EffectView) => {
    setFx(next)
    setEdits((n) => n + 1)
    onEdited()
  }

  const apply = async (recolor: RecolorOp, label: string) => {
    const next = await ui.run(label, () =>
      call('effect:recolor', {
        effectId: id,
        recolor,
        nodeIndex: nodeIndex ?? undefined,
        includeChildren,
        includeSizes: !!fx?.sizeFamily && includeSizes && nodeIndex === null,
      }),
    )
    if (next) {
      setFx(next)
      setEdits((n) => n + 1)
      onEdited()
    }
  }

  const rgba = hexToRgba(color)
  const dark = Math.max(rgba[0], rgba[1], rgba[2]) < 0.2
  const additiveInScope = blends.some((b) => ADDITIVE.has(b.value))
  // The game's id, whether read from the game or from the project's copy of its bundle: rows use it.
  const sharedWithGame = fx.state !== 'added' && fx.usedBy.length > 0

  const file = `f${String(fx.id).padStart(9, '0')}.fxr`
  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="row">
          <span className="badge kind">Effect</span>
          {fx.state ? (
            <StateBadge state={fx.state} />
          ) : (
            <span
              className="badge kind"
              title={
                fx.source === 'project'
                  ? 'Your project has its own copy of this bundle, but this effect is the same as the game’s'
                  : 'Read from the game'
              }
            >
              {fx.source === 'project' ? 'unchanged' : 'from game'}
            </span>
          )}
          <span className="mono faint">{fx.id}</span>
        </div>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <h2 className="grow" style={{ minWidth: 160, overflowWrap: 'anywhere' }}>
            {fx.name || <span className="mono">{file}</span>}
          </h2>
          <div className="toolbar">
            {onEntireSpell && fx.spells.length === 1 && (
              <button
                onClick={() => onEntireSpell(fx.spells[0].id)}
                title={`${ENTIRE_SPELL_TIP} (${fx.spells[0].name})`}
              >
                Entire spell
              </button>
            )}
            {onEntireSpell && fx.spells.length > 1 && (
              <MenuButton
                label="Entire spell ▾"
                className=""
                title={ENTIRE_SPELL_TIP}
                width={260}
                items={fx.spells.map((s) => ({ label: s.name, run: () => onEntireSpell(s.id) }))}
              />
            )}
            {fx.state !== 'added' && (
              <button
                className={sharedWithGame ? 'primary' : undefined}
                onClick={async () => {
                  const copy = await ui.run('Copying the effect', () => call('effect:copy', { id }))
                  if (copy === undefined) return
                  onEdited()
                  ui.toast(
                    `Effect ${copy}, a copy of ${id}, is your own: change it without changing the game’s. Save to keep it.`,
                  )
                  onOpenEffect(copy)
                }}
                title="A copy under a new id, to change without changing the game’s (or anything else using this one)"
              >
                Copy as your own
              </button>
            )}
            <button
              onClick={() => setScaling(true)}
              title="Bigger or smaller: its particles, offsets, lengths and radii"
            >
              Scale…
            </button>
          </div>
        </div>
        <div className="mono faint meta">
          {fx.name && <span>{file}</span>}
          <span>{fx.bundle.replace(/^sfx\//, '')}</span>
        </div>
      </div>

      {sharedWithGame && (
        <div className="warn">
          The game’s own effect
          {fx.usedBy.length > 1 ? `, used by ${fx.usedBy.length}${fx.usedBy.length >= 50 ? '+' : ''} rows` : ''}: edits
          change it everywhere it’s used. <b>Copy as your own</b> first, or duplicate the weapon or bullet.
        </div>
      )}
      {fx.warnings.map((w) => (
        <div key={w} className="warn">
          {w}
        </div>
      ))}

      <EffectPreview effectId={id} version={edits} flight={fx.flight} />
      {scaling && (
        <ScaleDialog
          param="effect"
          id={id}
          onClose={() => setScaling(false)}
          onDone={() => {
            setEdits((n) => n + 1)
            onEdited()
            load()
          }}
        />
      )}

      <PartsSection
        fx={fx}
        selected={nodeIndex}
        onSelect={setNodeIndex}
        onChanged={changed}
        onOpenEffect={onOpenEffect}
      />

      <section className="section">
        <header>
          <h3>Color</h3>
          <span className="grow" />
          <span className="faint">{nodeIndex === null ? 'whole effect' : `part #${nodeIndex}`}</span>
          {nodeIndex !== null && (
            <button className="ghost" onClick={() => setNodeIndex(null)}>
              whole effect
            </button>
          )}
        </header>
        <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="op-grid">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <button
              className="primary"
              onClick={() => apply({ op: 'replace', rgba }, 'Recoloring')}
              title="Make the effect this color, keeping its brightness and fades"
            >
              Recolor
            </button>
            <button
              onClick={() => apply({ op: 'replaceHue', rgb: rgba.slice(0, 3) }, 'Recoloring')}
              title="Change only the hue, keep saturation and brightness"
            >
              Hue only
            </button>
            <button
              onClick={() => apply({ op: 'multiply', rgba }, 'Tinting')}
              title="Multiply current colors by this color"
            >
              Tint
            </button>
          </div>
          <div className="op-grid">
            <span className="dim">Shift hue</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={hue}
              onChange={(e) => setHue(Number(e.target.value))}
              style={{ width: 140 }}
            />
            <span className="mono" style={{ width: 40 }}>
              {hue}°
            </span>
            <button onClick={() => apply({ op: 'hueShift', degrees: hue }, 'Shifting hue')}>Apply</button>
            <span className="grow" />
            <button className="ghost" onClick={() => apply({ op: 'saturation', factor: 1.5 }, 'Saturating')}>
              More vivid
            </button>
            <button className="ghost" onClick={() => apply({ op: 'grayscale' }, 'Desaturating')}>
              Grayscale
            </button>
            <button className="ghost" onClick={() => apply({ op: 'invert' }, 'Inverting')}>
              Invert
            </button>
          </div>
          {fx.sizeFamily && (
            <label
              className="row dim"
              title={`This coating has a version per weapon size (${fx.sizeFamily.join(', ')}): recolor them together`}
            >
              <input type="checkbox" checked={includeSizes} onChange={(e) => setIncludeSizes(e.target.checked)} />
              All {fx.sizeFamily.length} blade sizes ({fx.sizeFamily[0]}–{fx.sizeFamily[fx.sizeFamily.length - 1]})
            </label>
          )}
          {fx.children.length > 0 && (
            <label className="row dim" title="Separate files: they change for everything that uses them">
              <input type="checkbox" checked={includeChildren} onChange={(e) => setIncludeChildren(e.target.checked)} />
              Child effects too ({fx.children.join(', ')})
            </label>
          )}
          {fx.models.length > 0 && (
            <div className="faint">3D models keep their textures’ colours: a recolour changes them little.</div>
          )}
          {dark && additiveInScope && (
            <div className="warn">
              Dark colours vanish on additive blending: set the blend mode to Normal (2) to see them.
            </div>
          )}
        </div>
      </section>

      <AssetsSection fx={fx} onChanged={changed} />

      {(fx.details.origin || fx.details.behaviour || fx.details.color || fx.details.info || fx.details.category) && (
        <section className="section">
          <header>
            <h3>Info</h3>
          </header>
          <div className="content fields" style={{ gridTemplateColumns: '110px 1fr' }}>
            {fx.details.category && (
              <>
                <span className="field-label">Category</span>
                <span>{fx.details.category}</span>
              </>
            )}
            {fx.details.origin && (
              <>
                <span className="field-label">Used by</span>
                <span>{fx.details.origin}</span>
              </>
            )}
            {fx.details.behaviour && (
              <>
                <span className="field-label">Looks like</span>
                <span>{fx.details.behaviour}</span>
              </>
            )}
            {fx.details.color && (
              <>
                <span className="field-label">Colors</span>
                <span>{fx.details.color}</span>
              </>
            )}
            {fx.details.info && (
              <>
                <span className="field-label">Notes</span>
                <span>{fx.details.info}</span>
              </>
            )}
          </div>
          {fx.credit && fx.details.origin && (
            <div className="content faint" style={{ fontSize: 11, paddingTop: 0 }}>
              {fx.credit}
            </div>
          )}
        </section>
      )}

      {fx.usedBy.length > 0 && (
        <section className="section">
          <header>
            <h3>Used by</h3>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fx.usedBy.map((u) => (
              <div
                key={`${u.param}:${u.id}:${u.field}`}
                className="list-item"
                style={{ padding: '3px 4px' }}
                onClick={() => onOpenRow(u.param, u.id)}
              >
                <span className="badge kind">{PARAM_LABELS[u.param] ?? u.param}</span>
                <span className="grow ellipsis">{u.name || <span className="faint">unnamed</span>}</span>
                <span className="faint">{u.field}</span>
                <span className="id">{u.id}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
