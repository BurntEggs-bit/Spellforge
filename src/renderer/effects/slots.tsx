/**
 * Model and texture slots of an effect: what each one does in plain words,
 * the slot widget (drop a palette asset or a file from Explorer, or type an
 * id), and the import/set actions behind it.
 */
import { fileToBase64 } from '../lib/files.ts'
import { useEffect, useRef, useState } from 'react'
import type { EffectView, ResourceSlot } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { Thumb, useUi } from '../shared/ui.tsx'
import { plural } from '../../shared/format.ts'
import { addDropTarget } from './assetDrag.ts'

/** What a slot does, in plain words: a short title and a one-line explanation. */
export function slotRole(slot: Pick<ResourceSlot, 'action' | 'field' | 'resource' | 'textureType'>): {
  title: string
  detail: string
} {
  if (slot.resource === 'model')
    return { title: '3D model', detail: 'The shape that is drawn. Its own textures come with it.' }
  const a = slot.action
  switch (slot.field) {
    case 'layer1':
      return a === 'LensFlare'
        ? { title: 'Flare layer 1', detail: 'One of the glints drawn across the screen.' }
        : { title: 'Main image', detail: 'What this sprite looks like: its colour and shape.' }
    case 'layer2':
      return a === 'LensFlare'
        ? { title: 'Flare layer 2', detail: 'One of the glints drawn across the screen.' }
        : { title: 'Mask', detail: 'Cuts out the main image: white keeps it, black hides it.' }
    case 'layer3':
    case 'layer4':
      return {
        title: a === 'LensFlare' ? `Flare layer ${slot.field.slice(-1)}` : 'Extra layer',
        detail: 'An additional image layer.',
      }
    case 'normalMap':
      return a === 'Distortion'
        ? { title: 'Distortion map', detail: 'How the background is bent: its pattern sets the ripple.' }
        : { title: 'Normal map', detail: 'Fake surface depth, used when the particle is lit or distorts.' }
    case 'specular':
      return { title: 'Shine map', detail: 'How glossy it looks under light (lit particles only).' }
    case 'mask':
      return { title: 'Mask', detail: a === 'RadialBlur' ? 'Where the blur applies.' : 'Where the distortion applies.' }
    case 'texture':
      if (a === 'Distortion') return { title: 'Shape image', detail: 'The shape of the distortion.' }
      if (a === 'WaterInteraction') return { title: 'Ripple image', detail: 'The shape pressed into water.' }
      if (/Tracer/.test(a)) return { title: 'Trail image', detail: 'Stretched along the trail behind the part.' }
      if (/GPU/.test(a)) return { title: 'Particle image', detail: 'What each of the many tiny particles looks like.' }
      return { title: 'Image', detail: 'What this sprite looks like: its colour and shape.' }
    default:
      return { title: slot.field, detail: slot.resource === 'texture' ? `Texture (_${slot.textureType})` : '' }
  }
}

/** A model's texture by suffix, in plain words. */
export function modelTextureRole(type: string): string {
  switch (type) {
    case 'a':
      return 'Colour'
    case 'n':
      return 'Surface bumps'
    case 'm':
      return 'Metal / shine'
    case 'em':
      return 'Glow'
    case '3m':
      return 'Shine'
    case 'd':
      return 'Detail'
    default:
      return `_${type}`
  }
}

/** Set a slot's id, or import an image or .dds / a .flver (+ textures) into it. */
export function useSlotActions(effectId: number, onChanged: (fx: EffectView) => void) {
  const ui = useUi()
  const setResource = async (slot: ResourceSlot, value: number) => {
    const next = await ui.run(slot.resource === 'model' ? 'Changing model' : 'Changing texture', () =>
      call('effect:setResource', { effectId, actionIndex: slot.actionIndex, field: slot.field, value }),
    )
    if (next) onChanged(next)
  }
  const importModel = async (slot: ResourceSlot, files: File[]) => {
    if (!files.some((f) => /\.flver$/i.test(f.name))) {
      ui.toast('Select the model’s .flver file (and its .dds textures).', true)
      return
    }
    const r = await ui.run('Importing model', async () =>
      call('model:import', {
        effectId,
        files: await Promise.all(
          files
            .filter((f) => /\.(flver|dds|png)$/i.test(f.name))
            .map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })),
        ),
        actionIndex: slot.actionIndex,
        field: slot.field,
      }),
    )
    if (!r) return
    const msg = [`Imported model ${r.id}${r.textures.length ? ` with ${plural(r.textures.length, 'texture')}` : ''}.`]
    if (r.missing.length)
      msg.push(
        `Still missing textures (name the .dds files exactly like this and import them): ${r.missing.join(', ')}`,
      )
    ui.toast(msg.join('\n'), r.missing.length > 0)
    onChanged(r.view)
  }
  const importInto = async (slot: ResourceSlot, files: File[]) => {
    if (slot.resource === 'model') return importModel(slot, files)
    const file = files[0]
    if (!/\.(dds|png)$/i.test(file.name)) {
      ui.toast('Pick a .png image, or a .dds texture (BC7, BC1 or BC4).', true)
      return
    }
    const r = await ui.run(`Importing ${file.name}`, async () =>
      call('texture:import', {
        effectId,
        textureType: slot.textureType ?? 'a',
        base64: await fileToBase64(file),
        actionIndex: slot.actionIndex,
        field: slot.field,
      }),
    )
    if (r) {
      ui.toast(
        `Imported ${file.name} as texture ${r.id} (_${slot.textureType ?? 'a'}). Save to write it into your project.`,
      )
      onChanged(r.view)
    }
  }
  return { setResource, importInto }
}

export function Slot({
  slot,
  onSet,
  onImport,
  partLabel,
}: {
  slot: ResourceSlot
  onSet: (value: number) => void
  /** Import files into this slot: a .png or .dds for textures, a .flver (+ its textures) for models. */
  onImport: (files: File[]) => void
  /** Which part of the effect uses it, when listed outside the part. */
  partLabel?: string
}) {
  const [over, setOver] = useState(false)
  const [draft, setDraft] = useState(String(slot.value))
  const box = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(String(slot.value)), [slot.value])
  // Library tiles dragged onto it (assetDrag.ts). Files from Explorer come through the browser's drag and drop below.
  useEffect(() => {
    const el = box.current
    if (!el) return
    return addDropTarget(el, {
      accepts: (a) =>
        a.resource === slot.resource &&
        (slot.resource === 'model' || !slot.textureType || a.textureType === slot.textureType),
      drop: (a) => onSet(a.id),
      setOver,
    })
  }, [slot.resource, slot.textureType, onSet])

  const isTexture = slot.resource === 'texture'
  const role = slotRole(slot)

  return (
    <div
      ref={box}
      className={`slot${over ? ' drop-ok' : ''}${slot.exists ? '' : ' missing'}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const files = [...(e.dataTransfer.files ?? [])]
        if (!files.length) return
        e.preventDefault()
        onImport(files)
      }}
      title={
        isTexture
          ? 'Drop a texture from the list below, or an image (.png) or .dds file from Explorer'
          : 'Drop a model from the list below, or a .flver (with its .png or .dds textures) from Explorer'
      }
    >
      <Thumb resource={slot.resource} id={slot.value} textureType={slot.textureType} size={48} />
      <div className="grow">
        <div>
          <b>{role.title}</b>
          {partLabel && <span className="faint">, {partLabel}</span>}
        </div>
        <div className="faint" style={{ fontSize: 11 }}>
          {role.detail}
          {!slot.exists && <span className="bad"> Not found in the effect bundles.</span>}
        </div>
      </div>
      <button
        className="ghost"
        onClick={() => fileInput.current?.click()}
        title={
          isTexture
            ? 'Import your own image (.png, packed as the game packs its textures) or a .dds into this slot'
            : 'Import a .flver model: select its .png or .dds textures too'
        }
      >
        {isTexture ? 'Import texture…' : 'Import model…'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept={isTexture ? '.png,.dds' : '.flver,.dds,.png'}
        multiple={!isTexture}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length) onImport(files)
          e.target.value = ''
        }}
      />
      <input
        className="mono"
        style={{ width: 90 }}
        value={draft}
        title={
          isTexture
            ? `Texture id (s${String(slot.value).padStart(5, '0')}_${slot.textureType})`
            : `Model id (s${String(slot.value).padStart(5, '0')}.flver)`
        }
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft)
          if (!Number.isNaN(n) && n !== slot.value) onSet(n)
          else setDraft(String(slot.value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}
