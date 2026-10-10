/**
 * An event recipe's form: the script it goes in, what it does with which
 * ids (each with a line saying what the id is), and the test marker. Flags
 * can be new ones nothing in the game uses; a gift's item lot can be made
 * for any item.
 */
import { useEffect, useState } from 'react'
import type { EventDo, EventFileView, EventRecipe, EventWhen } from '../../shared/api.ts'
import { eventRecipeProblems } from '../../shared/eventRecipes.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { BANNERS, EVENT_KINDS } from './labels.ts'

const PLAYER = 10000
const ITEM_KINDS: { value: number; label: string }[] = [
  { value: 2, label: 'Weapon' },
  { value: 1, label: 'Item (goods)' },
  { value: 3, label: 'Armour' },
  { value: 4, label: 'Talisman' },
  { value: 5, label: 'Ash of War' },
]

export function EventRecipeEditor({
  recipe,
  files,
  onCancel,
  onSave,
}: {
  recipe: EventRecipe
  /** The scripts recipes can go in. */
  files: EventFileView[]
  onCancel: () => void
  onSave: (r: EventRecipe) => void
}) {
  const ui = useUi()
  const [r, setR] = useState<EventRecipe>(recipe)
  const set = (patch: Partial<EventRecipe>) => setR({ ...r, ...patch } as EventRecipe)
  const kind = EVENT_KINDS.find((k) => k.kind === r.kind)!
  const newFlag = async (apply: (flag: number) => void) => {
    const f = await ui.run('Finding a free flag', () => call('events:newFlag', { file: r.file }))
    if (f !== undefined) apply(f)
  }
  const flagField = (label: string, value: number, apply: (flag: number) => void, hint?: string) => (
    <>
      <div className="field-label">{label}</div>
      <div className="field-value">
        <div className="recipe-window" style={{ marginTop: 0 }}>
          <IdInput value={value} onChange={apply} />
          <button onClick={() => newFlag(apply)} title="A flag nothing in the game uses, kept across loads">
            New flag
          </button>
        </div>
        <IdHint id={value} />
        {hint && <div className="field-hint">{hint}</div>}
      </div>
    </>
  )
  const idField = (label: string, value: number, apply: (v: number) => void, hint?: string) => (
    <>
      <div className="field-label">{label}</div>
      <div className="field-value">
        <IdInput value={value} onChange={apply} />
        <IdHint id={value} />
        {hint && <div className="field-hint">{hint}</div>}
      </div>
    </>
  )
  const problems = eventRecipeProblems(r)
  return (
    <div className="recipe-editor">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <b className="nowrap">{kind.label}</b>
        <span className="grow faint" style={{ fontSize: 12 }}>
          {kind.hint}
        </span>
      </div>
      <div className="fields" style={{ gridTemplateColumns: '120px 1fr' }}>
        <div className="field-label">Script</div>
        <div className="field-value">
          <select value={r.file} onChange={(e) => set({ file: e.target.value })}>
            {files.map((f) => (
              <option key={f.file} value={f.file}>
                {f.file}
                {f.title ? `: ${f.title}` : ''}
              </option>
            ))}
          </select>
          <div className="field-hint">
            The common script runs wherever you are; a map’s runs while that map is loaded.
          </div>
        </div>
        {r.kind === 'giveItems' && (
          <>
            {idField('Item lot', r.lot, (lot) => set({ lot }), 'ItemLotParam_map: what the player gets.')}
            <div className="field-label">Or an item</div>
            <div className="field-value">
              <MakeLot onMade={(lot) => set({ lot })} />
            </div>
            <div className="field-label">Once per save</div>
            <div className="field-value">
              <label className="row">
                <input
                  type="checkbox"
                  checked={r.flag > 0}
                  onChange={(e) => (e.target.checked ? newFlag((flag) => set({ flag })) : set({ flag: 0 }))}
                />
                <span className="dim">
                  {r.flag > 0 ? `Flag ${r.flag} remembers it was given` : 'Every time the script loads (a test gift)'}
                </span>
              </label>
            </div>
          </>
        )}
        {r.kind === 'setFlag' && (
          <>
            {flagField('Flag', r.flag, (flag) => set({ flag }))}
            <div className="field-label">To</div>
            <div className="field-value">
              <select value={r.state ? 'on' : 'off'} onChange={(e) => set({ state: e.target.value === 'on' })}>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            <WhenFields when={r.when} onChange={(when) => set({ when })} />
          </>
        )}
        {r.kind === 'whileSpEffect' && (
          <>
            {idField(
              'Character',
              r.entity,
              (entity) => set({ entity }),
              r.entity === PLAYER ? 'The player (10000).' : 'An entity id the map gives a character.',
            )}
            {idField('SpEffect', r.speffect, (speffect) => set({ speffect }))}
            <DoFields value={r.do} onChange={(d) => set({ do: d })} />
          </>
        )}
        {r.kind === 'enableEnemy' && (
          <>
            {idField(
              'Enemy',
              r.entity,
              (entity) => set({ entity }),
              'Its entity id in the map (the map must place it).',
            )}
            {flagField('When flag', r.flag, (flag) => set({ flag }), 'It stays away until this flag turns on.')}
          </>
        )}
        {r.kind === 'boss' && (
          <>
            {idField('Boss', r.entity, (entity) => set({ entity }), 'Its entity id in the map.')}
            {flagField(
              'Defeat flag',
              r.defeatFlag,
              (defeatFlag) => set({ defeatFlag }),
              'On once it’s defeated: it stays gone.',
            )}
            {idField(
              'Arena',
              r.arena,
              (arena) => set({ arena }),
              'A region (MSB) the player walks into to start the fight.',
            )}
            {idField('Name', r.name, (name) => set({ name }), 'NpcName text for its health bar (0: no bar).')}
            <div className="field-label">Banner</div>
            <div className="field-value">
              <select value={r.banner} onChange={(e) => set({ banner: Number(e.target.value) })}>
                {BANNERS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="field-label">Test marker</div>
        <div className="field-value">
          <label className="row">
            <input type="checkbox" checked={!!r.test} onChange={(e) => set({ test: e.target.checked })} />
            <span className="dim">A Rowa Fruit when it starts: proof that it runs</span>
          </label>
        </div>
        <div className="field-label">Note</div>
        <div className="field-value">
          <input
            value={r.note ?? ''}
            placeholder="for you"
            onChange={(e) => set({ note: e.target.value || undefined })}
          />
        </div>
      </div>
      {problems.map((p) => (
        <div key={p} className="warn" style={{ fontSize: 12 }}>
          {p}
        </div>
      ))}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" disabled={problems.length > 0} onClick={() => onSave(r)}>
          Save event
        </button>
      </div>
    </div>
  )
}

/** A whole-number id as typed (empty: 0). */
function IdInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      className="mono"
      style={{ width: 130 }}
      value={value || ''}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  )
}

/** What an id is, in a line (What is this ID?'s first answer), as it's typed. */
function IdHint({ id }: { id: number }) {
  const [text, setText] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => {
    if (!(id > 0)) return
    let live = true
    const t = window.setTimeout(() => {
      call('ids:lookup', { id })
        .then((l) => {
          if (!live) return
          const placed = l.placed[0]
          const row = l.rows[0]
          const what = placed
            ? `${placed.name || placed.part} (${placed.kind}) in ${placed.mapName || placed.map}`
            : row
              ? `${row.param} ${row.id}${row.name ? `: ${row.name}` : ''}`
              : l.flag && !l.flag.unused
                ? `Flag: ${l.flag.summary}`
                : (l.texts[0]?.text ?? '')
          setText({ id, text: what })
        })
        .catch(() => live && setText({ id, text: '' }))
    }, 250)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [id])
  const shown = text && text.id === id ? text.text : ''
  return shown ? <div className="field-hint ellipsis">{shown}</div> : null
}

/** When a set-flag recipe acts. */
function WhenFields({ when, onChange }: { when: EventWhen; onChange: (w: EventWhen) => void }) {
  return (
    <>
      <div className="field-label">When</div>
      <div className="field-value">
        <select
          value={when.kind}
          onChange={(e) =>
            onChange(
              e.target.value === 'flag'
                ? { kind: 'flag', flag: 0 }
                : e.target.value === 'area'
                  ? { kind: 'area', area: 0 }
                  : { kind: 'load' },
            )
          }
        >
          <option value="load">As the script loads</option>
          <option value="flag">When another flag turns on</option>
          <option value="area">When the player walks into an area</option>
        </select>
        {when.kind === 'flag' && (
          <div className="recipe-window">
            <span className="faint">Flag</span>
            <IdInput value={when.flag} onChange={(flag) => onChange({ kind: 'flag', flag })} />
            <IdHint id={when.flag} />
          </div>
        )}
        {when.kind === 'area' && (
          <div className="recipe-window">
            <span className="faint">Area</span>
            <IdInput value={when.area} onChange={(area) => onChange({ kind: 'area', area })} />
            <IdHint id={when.area} />
          </div>
        )}
      </div>
    </>
  )
}

/** What a SpEffect recipe does while the SpEffect is on. */
function DoFields({ value, onChange }: { value: EventDo; onChange: (d: EventDo) => void }) {
  const n = value.kind === 'speffect' ? value.speffect : value.kind === 'flag' ? value.flag : value.lot
  const make = (kind: EventDo['kind'], v: number): EventDo =>
    kind === 'speffect' ? { kind, speffect: v } : kind === 'flag' ? { kind, flag: v } : { kind, lot: v }
  return (
    <>
      <div className="field-label">Then</div>
      <div className="field-value">
        <div className="recipe-window" style={{ marginTop: 0 }}>
          <select value={value.kind} onChange={(e) => onChange(make(e.target.value as EventDo['kind'], 0))}>
            <option value="speffect">Give it another SpEffect</option>
            <option value="flag">Set a flag on</option>
            <option value="itemLot">Give the player an item lot</option>
          </select>
          <IdInput value={n} onChange={(v) => onChange(make(value.kind, v))} />
        </div>
        <IdHint id={n} />
        <div className="field-hint">
          {value.kind === 'itemLot'
            ? 'Each time the SpEffect turns on.'
            : 'Undone (taken off, set off) when the SpEffect ends.'}
        </div>
      </div>
    </>
  )
}

/** Makes an item lot that gives one item, for a gift. */
function MakeLot({ onMade }: { onMade: (lot: number) => void }) {
  const ui = useUi()
  const [category, setCategory] = useState(2)
  const [item, setItem] = useState(0)
  const [count, setCount] = useState(1)
  return (
    <>
      <div className="recipe-window" style={{ marginTop: 0 }}>
        <select value={category} onChange={(e) => setCategory(Number(e.target.value))}>
          {ITEM_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <IdInput value={item} onChange={setItem} />
        <span className="faint">×</span>
        <input
          className="mono"
          style={{ width: 48 }}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
        />
        <button
          disabled={!item}
          onClick={async () => {
            const lot = await ui.run('Making the item lot', () => call('events:itemLot', { category, item, count }))
            if (lot !== undefined) onMade(lot)
          }}
          title="Adds an item lot (ItemLotParam_map) that gives this, and uses it"
        >
          Make its lot
        </button>
      </div>
      <IdHint id={item} />
    </>
  )
}
