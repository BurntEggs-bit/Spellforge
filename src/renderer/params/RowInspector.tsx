/** The Inspector for a param row: its fields, documented and edited, and what refers to it. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FieldView, RowView } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from './paramLabels.ts'
import { GameIcon, StateBadge, useUi } from '../shared/ui.tsx'
import { useIdLookup } from '../ids/IdLookup.tsx'
import { SplitHandle, usePersistentSize } from '../shared/split.tsx'
import { ScaleDialog } from './ScaleDialog.tsx'
import { ENTIRE_SPELL_TIP } from '../shared/spell.ts'
import { PREF_KEYS, readText, usePersistentState, writeText } from '../lib/storage.ts'
import { RenameRowDialog, CopyRowDialog, DeleteRowDialog } from './RowDialogs.tsx'
import { ITEM_PARAMS, WeaponLevelsSection, WhereToGetSection } from './RowExtras.tsx'
import { fileToBase64 } from '../lib/files.ts'

/** Rows "Duplicate into project" copies together with everything they own. */
const DUPLICABLE = new Set([
  'EquipParamWeapon',
  'EquipParamGoods',
  'Magic',
  'SwordArtsParam',
  'Bullet',
  'SpEffectParam',
])

export function RowInspector({
  param,
  id,
  version = 0,
  onNavigate,
  onOpenEffect,
  onEdited,
  onDuplicate,
  onOpenRow,
  onDeleted,
  onOpenAnimation,
  onEntireSpell,
}: {
  param: string
  id: number
  /** Bumped after edits anywhere: the row is read again (without losing the filter). */
  version?: number
  onNavigate: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
  onEdited: () => void
  onDuplicate: () => void
  /** A row was added (copy) — open it. */
  onOpenRow: (param: string, id: number) => void
  onDeleted: () => void
  /** Show an animation in the Animations workspace (with a weapon in hand). */
  onOpenAnimation?: (name: string, weapon?: number) => void
  /** Entire spell: cast this spell (a Magic row) from start to finish in the Animations viewer. */
  onEntireSpell?: (spell: number) => void
}) {
  const ui = useUi()
  const [row, setRow] = useState<RowView | null>(null)
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [hints, setHintsState] = useState(() => readText(PREF_KEYS.fieldHints) !== 'off')
  const setHints = (on: boolean) => {
    setHintsState(on)
    writeText(PREF_KEYS.fieldHints, on ? 'on' : 'off')
  }
  const [labelWidth, setLabelWidth] = usePersistentSize(PREF_KEYS.labelColumnWidth, 230, 120)
  const fieldsWrap = useRef<HTMLDivElement>(null)
  const modelInput = useRef<HTMLInputElement>(null)
  const [dialog, setDialog] = useState<null | 'copy' | 'delete' | 'rename' | 'scale'>(null)
  // Field groups folded shut, by param (the same groups stay shut on every row of it).
  const [folded, setFolded] = usePersistentState<Record<string, string[]>>(PREF_KEYS.fieldGroups, {})

  useEffect(() => {
    call('row:get', { param, id }).then(setRow).catch(ui.error)
  }, [param, id, version, ui])

  const q = filter.trim().toLowerCase()
  const fields = useMemo(() => {
    if (!row) return []
    return row.fields.filter((f) => {
      if (q) return f.label.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)
      // By default: links, effects, key switches and non-default-looking values.
      return (
        showAll ||
        f.key ||
        f.refs.length > 0 ||
        f.effect ||
        (typeof f.value === 'number' && f.value !== 0 && f.value !== -1)
      )
    })
  }, [row, q, showAll])

  if (!row) return <div className="empty">Loading…</div>

  const set = async (f: FieldView, value: number | string) => {
    const next = await ui.run('Saving field', () => call('row:set', { param, id, field: f.name, value }))
    if (next) {
      setRow(next)
      onEdited()
    }
  }
  const saveName = async (text: string) => {
    const next = await ui.run('Saving the in-game name', () => call('text:setName', { param, id, text }))
    if (next) {
      setRow(next)
      onEdited()
    }
  }
  const nameShown =
    row.gameName !== undefined && (!q || 'in-game name'.includes(q) || (row.gameName ?? '').toLowerCase().includes(q))

  const shut = new Set(folded[param] ?? [])
  const fold = (group: string) => {
    const next = new Set(shut)
    if (next.has(group)) next.delete(group)
    else next.add(group)
    setFolded({ ...folded, [param]: [...next] })
  }
  const fieldList = () => {
    const counts = new Map<string, number>()
    for (const f of fields) if (f.group) counts.set(f.group, (counts.get(f.group) ?? 0) + 1)
    const out: ReactNode[] = []
    let last: string | undefined
    for (const f of fields) {
      const open = !f.group || !!q || !shut.has(f.group)
      if (f.group && f.group !== last)
        out.push(
          <button
            key={`group:${f.group}`}
            className={`field-group${last === undefined && !nameShown ? ' first' : ''}`}
            aria-expanded={open}
            onClick={() => fold(f.group!)}
            title={open ? 'Fold these fields away' : 'Show these fields'}
          >
            <span className="twisty">{open ? '▾' : '▸'}</span>
            {f.group}
            <span className="count">{counts.get(f.group)}</span>
          </button>,
        )
      last = f.group
      if (!open) continue
      out.push(
        <FieldRow
          key={f.name}
          field={f}
          hints={hints}
          onSet={set}
          onNavigate={onNavigate}
          onOpenEffect={onOpenEffect}
        />,
      )
    }
    return out
  }

  return (
    <div className="inspector">
      <div className="inspector-head">
        <div className="row">
          <span className="badge kind" title={row.paramDescription}>
            {PARAM_LABELS[param] ?? param}
          </span>
          <StateBadge state={row.state} />
          <span className="mono faint">{id}</span>
        </div>
        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {row.icon && (
            <GameIcon
              kind={row.icon.kind}
              id={row.icon.id}
              size={row.icon.kind === 'Status' ? 40 : 64}
              title={`Its icon in game (${row.icon.kind.toLowerCase()} icon ${row.icon.id})`}
            />
          )}
          <h2 className="grow" style={{ minWidth: 160, overflowWrap: 'anywhere' }}>
            {row.name || `${param} ${id}`}
          </h2>
          <div className="toolbar">
            {DUPLICABLE.has(param) && (
              <button
                className="primary"
                onClick={onDuplicate}
                title="Copy it with everything it owns (behaviors, bullets, attacks, effects) under new ids"
              >
                Duplicate…
              </button>
            )}
            {param === 'Magic' && onEntireSpell && (
              <button onClick={() => onEntireSpell(id)} title={ENTIRE_SPELL_TIP}>
                Entire spell
              </button>
            )}
            {row.scalable && (
              <button onClick={() => setDialog('scale')} title="Its effects and hitboxes, bigger or smaller, together">
                Scale…
              </button>
            )}
            {param === 'SwordArtsParam' && (
              <button
                onClick={async () => {
                  const gem = await ui.run('Making the Ash of War item', () => call('skill:ashOfWar', { id }))
                  if (gem === undefined) return
                  onEdited()
                  onOpenRow('EquipParamGem', gem)
                }}
                title="An Ash of War item (EquipParamGem) that puts this skill on weapons: a copy of one whose skill plays the same animations (the one it has, if it has one)"
              >
                Ash of War item
              </button>
            )}
            {param === 'SpEffectParam' && row.fields.find((f) => f.name === 'wepParamChange')?.value === 1 && (
              <button
                onClick={async () => {
                  const copy = await ui.run('Copying the buff for the left hand', () =>
                    call('speffect:bothHands', { id }),
                  )
                  if (copy === undefined) return
                  onEdited()
                  setRow(await call('row:get', { param, id }))
                  ui.toast(`SpEffect ${copy}, its copy for the left hand's weapon, starts with it now.`)
                }}
                title="The buff on both weapons: a copy for the left hand, with its look on the left weapon, started as it's cast"
              >
                Both hands
              </button>
            )}
            {param === 'EquipParamWeapon' && (
              <button
                onClick={async () => {
                  const r = await ui.run('Copying the model', () => call('weapon:ownModel', { id }))
                  if (!r) return
                  onEdited()
                  setRow(await call('row:get', { param, id }))
                  ui.toast(
                    `Model ${r.model} is a copy of its model, its own now (${r.rows} ${r.rows === 1 ? 'row uses' : 'rows use'} it). Its textures and model can change without changing the original's. Save to write it.`,
                  )
                }}
                title="A copy of its model under a new id, with its own textures, so changing them leaves the original alone"
              >
                Model of its own
              </button>
            )}
            {param === 'EquipParamWeapon' && (
              <button
                onClick={() => modelInput.current?.click()}
                title="A model (.flver) and textures (.png or .dds named like its own, e.g. WP_A_8000_a.png) into its own model"
              >
                Import model…
              </button>
            )}
            <input
              ref={modelInput}
              type="file"
              accept=".flver,.png,.dds"
              multiple
              style={{ display: 'none' }}
              onChange={async (e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (!files.length) return
                const r = await ui.run('Importing into its model', async () =>
                  call('weapon:importModel', {
                    id,
                    files: await Promise.all(
                      files.map(async (f) => ({
                        name: f.name,
                        base64: await fileToBase64(f),
                      })),
                    ),
                  }),
                )
                if (!r) return
                onEdited()
                setRow(await call('row:get', { param, id }))
                ui.toast(
                  `Model ${r.model}: ${[
                    files.some((f) => /\.flver$/i.test(f.name)) ? 'its model' : '',
                    r.replaced.length ? `textures ${r.replaced.join(', ')}` : '',
                    r.added.length ? `new textures ${r.added.join(', ')}` : '',
                  ]
                    .filter(Boolean)
                    .join('; ')}. Save to write it.`,
                )
              }}
            />
            <button onClick={() => setDialog('copy')} title="Only this row, under a new id">
              Copy row
            </button>
            <button
              onClick={() => setDialog('rename')}
              title="Its name in Spellforge and Smithbox (the in-game name is a field below)"
            >
              Rename
            </button>
            <button onClick={() => setDialog('delete')} title="Remove this row">
              Delete
            </button>
          </div>
        </div>
      </div>

      {row.enemyAttack && (
        <div className="warn notice">
          <span className="grow">
            Its attack, <b>AtkParam_Npc {row.enemyAttack.id}</b>
            {row.enemyAttack.name ? ` (${row.enemyAttack.name})` : ''}, is an enemy’s: fired by the player, the bullet
            does no damage (the player’s attacks are read from AtkParam_Pc).
          </span>
          <button
            onClick={async () => {
              const next = await ui.run('Copying the attack for the player', () =>
                call('row:playerAttack', { id: row.enemyAttack!.id }),
              )
              if (!next) return
              onEdited()
              setRow(await call('row:get', { param, id }))
              const push = (v: RowView) => Number(v.fields.find((f) => f.name === 'knockbackDist')?.value ?? 0)
              const enemy = push(await call('row:get', { param: 'AtkParam_Npc', id: row.enemyAttack!.id }))
              ui.toast(
                `AtkParam_Pc ${next.id} added: the same attack, for the player` +
                  (push(next) !== enemy
                    ? `, pushing ${+push(next).toFixed(2)} m instead of the enemy’s ${+enemy.toFixed(2)} m (a player’s skill pushes 2 m at most).`
                    : '.'),
              )
            }}
          >
            Copy the attack for the player
          </button>
        </div>
      )}

      {row.warnings?.map((w) => (
        <div key={w} className="warn notice">
          <span className="grow">{w}</span>
        </div>
      ))}

      {row.shops &&
        (row.shops.some((s) => s.regular) ? (
          <div className="dim" title="A shop lists the rows between the two ids its dialogue opens">
            Sold by{' '}
            {row.shops
              .filter((s) => s.regular)
              .map((s) => `${s.by} (rows ${s.from}–${s.to})`)
              .join('; ')}
          </div>
        ) : (
          <div className="warn notice">
            <span className="grow">
              No shop sells it: a shop lists only the rows between the two ids its dialogue opens, and {id} is in none
              {row.shops.length
                ? ` (it’s in ${row.shops.map((s) => `${s.by}’s other menu, rows ${s.from}–${s.to}`).join('; ')})`
                : ''}
              .
            </span>
          </div>
        ))}

      {dialog === 'rename' && (
        <RenameRowDialog
          initial={row.name}
          onCancel={() => setDialog(null)}
          onConfirm={async (name) => {
            const next = await ui.run('Renaming', () => call('row:rename', { param, id, name }))
            setDialog(null)
            if (next) {
              setRow(next)
              onEdited()
            }
          }}
        />
      )}
      {dialog === 'copy' && (
        <CopyRowDialog
          param={param}
          id={id}
          name={row.name}
          onCancel={() => setDialog(null)}
          onDone={(newId) => {
            setDialog(null)
            onEdited()
            onOpenRow(param, newId)
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteRowDialog
          param={param}
          id={id}
          name={row.name}
          onCancel={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            onEdited()
            onDeleted()
          }}
        />
      )}

      {dialog === 'scale' && (
        <ScaleDialog
          param={param}
          id={id}
          onClose={() => setDialog(null)}
          onDone={() => onEdited()}
          onOpenAnimation={onOpenAnimation}
        />
      )}

      <section className="section">
        <header>
          <h3>Fields</h3>
          <span className="grow" />
          <input
            placeholder="Filter fields"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 160 }}
          />
          <label className="row dim" style={{ fontSize: 12 }} title="Show what each field does under its name">
            <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />
            hints
          </label>
          <label className="row dim" style={{ fontSize: 12 }} title="Also list fields at 0 or −1 (hidden by default)">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            all {row.fields.length}
          </label>
        </header>
        <div className="content fields-wrap" ref={fieldsWrap} style={{ ['--label-w' as string]: `${labelWidth}px` }}>
          <SplitHandle
            target={fieldsWrap}
            cssVar="--label-w"
            value={labelWidth}
            min={120}
            room={150}
            onCommit={setLabelWidth}
            style={{ left: 'calc(var(--label-w) + 16px)' }}
          />
          {/* The label column never takes more than 45% of a narrow Inspector, so values always show. */}
          <div
            className="fields"
            style={{ gridTemplateColumns: 'minmax(80px, min(var(--label-w), 45%)) minmax(110px, 1fr)' }}
          >
            {nameShown && (
              <NameRow
                value={row.gameName ?? ''}
                hints={hints}
                hint={
                  param === 'Magic'
                    ? 'The name players see: a spell’s is its item’s (Goods, same id).'
                    : 'The name players see (the item text, saved with the project).'
                }
                onSave={saveName}
              />
            )}
            {fieldList()}
          </div>
          {fields.length === 0 && !nameShown && <div className="faint">No fields match.</div>}
        </div>
      </section>

      {param === 'EquipParamWeapon' && <WeaponLevelsSection id={id} version={version} />}
      {ITEM_PARAMS.has(param) && <WhereToGetSection param={param} id={id} version={version} onOpenRow={onOpenRow} />}

      {row.animations !== undefined && (
        <section className="section">
          <header>
            <h3>Fired by animations</h3>
            <span className="faint">{row.animations.length}</span>
            <span className="grow" />
            <span
              className="mono faint"
              title="Animations fire this judge; the weapon or skill in use decides which variation’s row it means. Read from the project’s c0000.anibnd if it has one, else the game’s."
            >
              judge {row.animationJudge}
            </span>
          </header>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {row.animations.length === 0 ? (
              <div className="faint">
                No player animation fires it (an NPC, a SpEffect or a bullet may; or it’s unused).
              </div>
            ) : (
              <table className="plan">
                <thead>
                  <tr>
                    <th>Animation</th>
                    <th>Event</th>
                    <th>Time</th>
                    <th>Dummy poly</th>
                  </tr>
                </thead>
                <tbody>
                  {row.animations.slice(0, 60).map((a, i) => (
                    <tr key={i}>
                      <td>
                        {onOpenAnimation ? (
                          <button
                            className="ref-link mono"
                            onClick={() => onOpenAnimation(a.animation)}
                            title="Open in the Animations workspace"
                          >
                            {a.animation}
                          </button>
                        ) : (
                          <span className="mono">{a.animation}</span>
                        )}
                      </td>
                      <td>{a.event}</td>
                      <td className="mono">
                        {a.start.toFixed(2)}–{a.end.toFixed(2)}s
                      </td>
                      <td className="mono">{a.dummyPoly ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {row.animations.length > 60 && <div className="faint">… and {row.animations.length - 60} more</div>}
          </div>
        </section>
      )}
    </div>
  )
}

/** The in-game name (item text), as the first field: saved on Enter or leaving the box. */
function NameRow({
  value,
  hints,
  hint,
  onSave,
}: {
  value: string
  hints: boolean
  hint: string
  onSave: (text: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const text = draft.trim()
    if (!text || text === value) return setDraft(value)
    onSave(text)
  }
  return (
    <>
      <div className="field-label" title="The item text with this row’s id (Weapon names, Item names, Skill names…)">
        In-game name
        {hints && <div className="field-hint">{hint}</div>}
      </div>
      <div className="field-value">
        <div className="field-input">
          <input
            className="game-name"
            value={draft}
            placeholder="None"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>
    </>
  )
}

function FieldRow({
  field: f,
  hints,
  onSet,
  onNavigate,
  onOpenEffect,
}: {
  field: FieldView
  hints: boolean
  onSet: (f: FieldView, v: number | string) => void
  onNavigate: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
}) {
  const [draft, setDraft] = useState(String(f.value))
  useEffect(() => setDraft(String(f.value)), [f.value])
  const lookup = useIdLookup()

  const commit = () => {
    if (draft === String(f.value)) return
    if (f.type.startsWith('fixstr')) return onSet(f, draft)
    const n = Number(draft)
    if (Number.isNaN(n)) return setDraft(String(f.value))
    onSet(f, n)
  }

  const linked = f.refs.length > 0 || !!f.effect
  // Spellforge's own hint, else the community note (skipping empty or "?" ones).
  const hintText =
    f.hint ??
    (f.description && f.description.trim().length > 3 && f.description !== f.label
      ? f.description.split(/\r?\n/)[0]
      : '')
  const unlisted =
    !!f.enumOptions?.length && typeof f.value === 'number' && !f.enumOptions.some((o) => o.value === f.value)
  return (
    <>
      <div
        className={`field-label${linked ? ' refs' : ''}`}
        title={`${f.name} (${f.type})${f.description ? '\n\n' + f.description : ''}`}
      >
        {f.label}
        {hints && hintText && <div className="field-hint">{hintText}</div>}
      </div>
      <div className="field-value">
        <div className="field-input">
          {f.isBool && typeof f.value === 'number' ? (
            <input type="checkbox" checked={f.value !== 0} onChange={(e) => onSet(f, e.target.checked ? 1 : 0)} />
          ) : f.enumOptions && f.enumOptions.length > 0 && typeof f.value === 'number' ? (
            <select style={{ width: '100%' }} value={f.value} onChange={(e) => onSet(f, Number(e.target.value))}>
              {unlisted && <option value={f.value}>{f.value} (no name)</option>}
              {f.enumOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} ({o.value})
                </option>
              ))}
            </select>
          ) : Array.isArray(f.value) ? (
            <span className="mono faint">{f.value.join(' ')}</span>
          ) : (
            <input
              className="mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          )}
          {f.effect && (
            <button
              className={`fx-chip${f.effect.exists ? '' : ' missing'}`}
              onClick={() => f.effect!.exists && onOpenEffect(f.effect!.id)}
              title={f.effect.exists ? 'Open this effect' : 'Not in the common effect bundles'}
            >
              ✦ open
            </button>
          )}
          {f.icon && f.icon.exists && (
            <GameIcon kind={f.icon.kind} id={f.icon.id} size={f.icon.kind === 'Status' ? 28 : 40} />
          )}
        </div>
        {f.effect && (
          <div className="field-hint">
            {f.effect.exists ? (
              <>
                ✦ Effect {f.effect.id}
                {f.effect.name ? `: ${f.effect.name}` : ''}
              </>
            ) : (
              <>
                Effect {f.effect.id}: not in the common effects (a character’s or a map’s own: it shows only where
                that’s loaded).
              </>
            )}
          </div>
        )}
        {f.refMissing && <div className="field-hint warn">{f.refMissing}</div>}
        {f.about && (
          <button
            className={`about-link ${f.about.kind}`}
            onClick={() => lookup(f.about!.lookup)}
            title={
              f.about.kind === 'flag'
                ? 'An event flag: see everything that uses it'
                : f.about.kind === 'text'
                  ? 'Its text: see everything with this id'
                  : f.about.kind === 'entity'
                    ? 'An entity in a map: see what the maps place with it'
                    : 'See everything with this id'
            }
          >
            <span className="about-mark">
              {f.about.kind === 'flag' ? '⚑' : f.about.kind === 'text' ? '“' : f.about.kind === 'entity' ? '⌖' : '⇄'}
            </span>
            {f.about.label}
          </button>
        )}
        {f.icon && !f.icon.exists && !f.icon.known && f.icon.id > 0 && (
          <div className="field-hint">
            No {f.icon.kind === 'Item' ? 'item' : f.icon.kind === 'Status' ? 'status' : 'map'} icon {f.icon.id} in the
            game’s menu icons: it shows blank.
          </div>
        )}
        {unlisted && (
          <div className="field-hint">{f.value} has no name in the param definitions (the game may still use it).</div>
        )}
        {f.refs.length > 0 && (
          // Full names on their own lines, so nothing is cut off.
          <div className="field-refs">
            {f.refs.map((r) => (
              <button
                key={`${r.param}:${r.id}`}
                className="ref-link"
                title={`Open ${r.param} ${r.id}`}
                onClick={() => onNavigate(r.param, r.id)}
              >
                → {r.name || `${PARAM_LABELS[r.param] ?? r.param} ${r.id}`}{' '}
                <span className="faint">{PARAM_LABELS[r.param] ?? r.param}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
