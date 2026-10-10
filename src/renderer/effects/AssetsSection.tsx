/**
 * Models & textures: what this effect uses (by part, each with its role,
 * models with their own textures), then the library of every model and
 * texture in the game's effect bundles. Picking a model shows its textures;
 * "Use in…" puts it into a slot without dragging.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AssetEntry, EffectView, ModelTextureView, ResourceSlot } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { Thumb } from '../shared/ui.tsx'
import { startAssetDrag } from './assetDrag.ts'
import { Slot, modelTextureRole, slotRole, useSlotActions } from './slots.tsx'

const PAGE = 240

function ModelTextures({ id }: { id: number }) {
  const [list, setList] = useState<ModelTextureView[] | null>(null)
  useEffect(() => {
    let live = true
    call('model:textures', { id })
      .then((l) => live && setList(l))
      .catch(() => live && setList([]))
    return () => {
      live = false
    }
  }, [id])
  if (!list) return <div className="faint">Loading textures…</div>
  if (!list.length)
    return <div className="faint">No textures of its own in the effect bundles (it may use the game’s defaults).</div>
  return (
    <div className="model-textures">
      {list.map((t) => (
        <div
          key={`${t.id}_${t.type}`}
          className="model-texture"
          title={`s${String(t.id).padStart(5, '0')}_${t.type} · ${t.source === 'material' ? 'from its material (MATBIN)' : t.source === 'model' ? 'named in the model file' : 'same id as the model'}${t.slot ? `\n${t.slot}` : ''}`}
        >
          <Thumb resource="texture" id={t.id} textureType={t.type} size={44} />
          <div>
            <div>{modelTextureRole(t.type)}</div>
            <div className="faint mono">
              {t.id}_{t.type}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AssetsSection({ fx, onChanged }: { fx: EffectView; onChanged: (fx: EffectView) => void }) {
  const slotActions = useSlotActions(fx.id, onChanged)
  const [kind, setKind] = useState<'model' | 'texture'>('model')
  const [query, setQuery] = useState('')
  const [assets, setAssets] = useState<AssetEntry[]>([])
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<AssetEntry | null>(null)

  useEffect(() => {
    // An answer for an older search never replaces a newer one.
    let live = true
    const t = window.setTimeout(
      () =>
        call('assets:list', { resource: kind, query }).then((a) => {
          if (!live) return
          setAssets(a)
          setShown(PAGE)
        }),
      120,
    )
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [kind, query])
  useEffect(() => setPicked(null), [kind, fx.id])

  // Slots by part, in effect order.
  const byPart = useMemo(
    () => fx.nodes.filter((n) => n.slots.length).map((n) => ({ label: `${n.label} #${n.index}`, slots: n.slots })),
    [fx],
  )
  const allSlots = byPart.flatMap((p) => p.slots.map((s) => ({ slot: s, part: p.label })))
  const usedModels = [
    ...new Set(allSlots.filter((s) => s.slot.resource === 'model' && s.slot.value > 0).map((s) => s.slot.value)),
  ]
  const targets = picked
    ? allSlots.filter(
        ({ slot }) =>
          slot.resource === picked.resource && (picked.resource === 'model' || slot.textureType === picked.textureType),
      )
    : []
  const use = (slot: ResourceSlot) => picked && slotActions.setResource(slot, picked.id)

  return (
    <section className="section">
      <header>
        <h3>Models & textures</h3>
      </header>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="subhead">Used by this effect</div>
        {byPart.length === 0 && <div className="faint">No model or texture slots.</div>}
        {byPart.map((p) => (
          <div key={p.label} className="used-part">
            <div className="faint used-part-title">{p.label}</div>
            {p.slots.map((s) => (
              <div key={`${s.actionIndex}:${s.field}`}>
                <Slot
                  slot={s}
                  onSet={(v) => slotActions.setResource(s, v)}
                  onImport={(f) => slotActions.importInto(s, f)}
                />
                {s.resource === 'model' && s.value > 0 && (
                  <div className="model-textures-wrap">
                    <div className="faint" style={{ fontSize: 11 }} title="They come with the model: no slot to set">
                      Model {s.value}’s textures
                    </div>
                    <ModelTextures id={s.value} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="subhead" title="Every model and texture in the game’s effect files">
          Library
        </div>
        <div
          className="row"
          title={`Click one to see ${kind === 'model' ? 'its textures and ' : ''}where it can go, or drag it onto a slot above.${kind === 'model' && usedModels.length > 0 ? ' Models this effect uses are outlined.' : ''}`}
        >
          <div className="tabs">
            <button className={`tab${kind === 'model' ? ' active' : ''}`} onClick={() => setKind('model')}>
              Models
            </button>
            <button className={`tab${kind === 'texture' ? ' active' : ''}`} onClick={() => setKind('texture')}>
              Textures
            </button>
          </div>
          <input className="grow" placeholder="search by id" value={query} onChange={(e) => setQuery(e.target.value)} />
          <span className="faint">{assets.length}</span>
        </div>

        {picked && (
          <div className="picked">
            <Thumb resource={picked.resource} id={picked.id} textureType={picked.textureType} size={72} />
            <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <b>
                  {picked.resource === 'model' ? `Model ${picked.id}` : `Texture ${picked.id}_${picked.textureType}`}
                </b>
                {picked.owner !== undefined && <span className="faint">, belongs to model {picked.owner}</span>}
                <span className="faint">, in {picked.bundle.replace(/^sfx\//, '')}</span>
              </div>
              {picked.resource === 'model' && <ModelTextures id={picked.id} />}
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {targets.length === 0 && (
                  <span className="faint">
                    No {picked.resource === 'model' ? 'model' : `_${picked.textureType} texture`} slot in this effect to
                    put it in.
                  </span>
                )}
                {targets.map(({ slot, part }) => (
                  <button
                    key={`${slot.actionIndex}:${slot.field}`}
                    onClick={() => use(slot)}
                    disabled={slot.value === picked.id}
                  >
                    Use as {slotRole(slot).title.toLowerCase()} of {part}
                  </button>
                ))}
              </div>
            </div>
            <button className="ghost" onClick={() => setPicked(null)}>
              ✕
            </button>
          </div>
        )}

        <div className="palette">
          {assets.slice(0, shown).map((a) => {
            const used =
              a.resource === 'model'
                ? usedModels.includes(a.id)
                : allSlots.some(
                    ({ slot }) =>
                      slot.resource === 'texture' && slot.value === a.id && slot.textureType === a.textureType,
                  )
            return (
              <div
                key={`${a.id}:${a.textureType ?? ''}`}
                className={`asset${used ? ' used' : ''}${picked && picked.id === a.id && picked.textureType === a.textureType ? ' picked' : ''}`}
                onClick={() => setPicked(a)}
                onPointerDown={(e) => startAssetDrag(e, a)}
                title={`${a.resource === 'model' ? 'Model' : 'Texture'} ${a.id}${a.textureType ? `_${a.textureType}` : ''}${a.owner !== undefined ? ` (model ${a.owner}’s ${modelTextureRole(a.textureType ?? '').toLowerCase()})` : ''}${used ? '\nUsed by this effect' : ''}`}
              >
                <Thumb resource={a.resource} id={a.id} textureType={a.textureType} size={64} />
                <div>
                  {a.id}
                  {a.textureType && <span className="t">_{a.textureType}</span>}
                </div>
                {a.owner !== undefined && <div className="owner">model {a.owner}</div>}
              </div>
            )
          })}
        </div>
        {assets.length > shown && (
          <button className="ghost" onClick={() => setShown(shown + PAGE)}>
            Show more ({assets.length - shown} left)
          </button>
        )}
      </div>
    </section>
  )
}
