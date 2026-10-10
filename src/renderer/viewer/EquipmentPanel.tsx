/** The viewer's Equipment panel: armour, weapons, a weapon buff, how the weapons are held, the bare head. */
import { useState, useMemo } from 'react'
import type { EquipmentLists, WeaponPlacement, BuffChoice, EquipChoice } from '../../shared/api.ts'
import { defaultFaceParts } from './equipment.ts'
import type { EquipPrefs } from './prefs.ts'

export function EquipmentPanel({
  lists,
  value,
  onChange,
  placements,
  onOpenRow,
}: {
  lists: EquipmentLists | null
  value: EquipPrefs
  onChange: (e: EquipPrefs) => void
  placements?: { right: WeaponPlacement | null; left: WeaponPlacement | null }
  onOpenRow?: (param: string, id: number) => void
}) {
  // Where the right-hand weapon's scabbard hangs, for the note under the switch.
  const hang = placements?.right
  const hangDummy = hang ? hang.slots[1]?.right : -1
  const slots: {
    key: 'head' | 'body' | 'arms' | 'legs' | 'right' | 'left'
    label: string
    list: 'head' | 'body' | 'arms' | 'legs' | 'weapons'
  }[] = [
    { key: 'head', label: 'Head', list: 'head' },
    { key: 'body', label: 'Body', list: 'body' },
    { key: 'arms', label: 'Arms', list: 'arms' },
    { key: 'legs', label: 'Legs', list: 'legs' },
    { key: 'right', label: 'Right weapon', list: 'weapons' },
    { key: 'left', label: 'Left weapon', list: 'weapons' },
  ]
  return (
    <div className="vp-panel">
      {!lists && <div className="faint">Loading equipment…</div>}
      {lists &&
        slots.map((s) => (
          <EquipSlot
            key={s.key}
            label={s.label}
            choices={lists[s.list]}
            value={value[s.key] ?? null}
            onChange={(part) => onChange({ ...value, [s.key]: part })}
          />
        ))}
      {lists && (
        <div className="vp-slot">
          <span
            className="dim"
            title="A grease, other item or spell that coats the weapon: shown on the held weapons along the whole blade, sized for each (buff spells: the right-hand weapon)"
          >
            Weapon buff
          </span>
          <span />
          <select
            value={value.buffSpell != null ? `m${value.buffSpell}` : value.buff != null ? `g${value.buff}` : ''}
            onChange={(e) => {
              const v = e.target.value
              onChange({
                ...value,
                buff: v.startsWith('g') ? Number(v.slice(1)) : null,
                buffSpell: v.startsWith('m') ? Number(v.slice(1)) : null,
              })
            }}
          >
            <option value="">— none —</option>
            {(
              [
                ['This project', (b: BuffChoice) => b.project],
                ['Greases and items', (b: BuffChoice) => !b.project && !b.spell],
                ['Spells', (b: BuffChoice) => !b.project && !!b.spell],
              ] as const
            ).map(([label, keep]) => {
              const list = lists.buffs.filter(keep)
              if (!list.length) return null
              return (
                <optgroup key={label} label={label}>
                  {list.map((b) => (
                    <option key={`${b.spell ? 'm' : 'g'}${b.id}`} value={`${b.spell ? 'm' : 'g'}${b.id}`}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
        </div>
      )}
      {(value.buff != null || value.buffSpell != null) &&
        (() => {
          // The game won't coat these (Is Buffable off): somber weapons, catalysts, elemental affinities.
          const held = [value.right, value.left]
            .map((v) =>
              v && v.includes(':') ? lists?.weapons.find((w) => w.id === Number(v.split(':')[0])) : undefined,
            )
            .filter((w): w is EquipChoice => !!w && w.buffable === false)
          return held.length ? (
            <div className="faint" style={{ fontSize: 12 }}>
              In game {held.map((w) => w.name).join(' and ')} can’t take buffs (its Is Buffable is off): the coating
              shows here, not there.
            </div>
          ) : null
        })()}
      <div className="vp-slot">
        <span
          className="dim"
          title="Where the game puts the weapons for each way of holding them (WepAbsorpPosParam): in the hands, at the two-handed grip, hung on the body"
        >
          Held
        </span>
        <span />
        <select
          value={value.style ?? 'auto'}
          onChange={(e) => onChange({ ...value, style: e.target.value as EquipPrefs['style'] })}
        >
          <option value="auto">As the animation says (032xxx–033xxx two-handed)</option>
          <option value="one">One-handed</option>
          <option value="right">Right weapon in both hands</option>
          <option value="left">Left weapon in both hands</option>
        </select>
      </div>
      <label
        className="row"
        style={{ marginTop: 4 }}
        title="A weapon's second model, its scabbard (or the other of a pair), where the game hangs it while the weapon is drawn"
      >
        <input
          type="checkbox"
          checked={value.sheaths !== false}
          onChange={(e) => onChange({ ...value, sheaths: e.target.checked })}
        />
        Scabbards where the game hangs them
      </label>
      {value.sheaths !== false && hang && hangDummy !== undefined && hangDummy > 0 && (
        <div className="faint" style={{ fontSize: 12, marginLeft: 22 }}>
          Right weapon: body dummy {hangDummy % 1000}
          {hangDummy >= 1000 ? ' (hip)' : ''}, from{' '}
          {onOpenRow ? (
            <button
              className="ref-link"
              onClick={() => onOpenRow('WepAbsorpPosParam', hang.row)}
              title="Its right_1 / left_1 fields pick the dummy poly; change them to move it, in game too"
            >
              WepAbsorpPosParam {hang.row}
            </button>
          ) : (
            `WepAbsorpPosParam ${hang.row}`
          )}
        </div>
      )}
      <label className="row" style={{ marginTop: 4 }}>
        <input
          type="checkbox"
          checked={value.female}
          onChange={(e) => onChange({ ...value, female: e.target.checked })}
        />
        Female body (uses _f_ parts where the game has them)
      </label>
      {lists?.faceParts?.length ? (
        <>
          <div
            className="vp-head"
            title="The face and hair, shown when no helmet is worn: the parts FaceParam picks from. FaceGen shaping isn't applied."
          >
            Bare head
          </div>
          {lists.faceParts.map((g) => (
            <div key={g.key} className="vp-slot">
              <span className="dim">{g.label}</span>
              <span />
              <select
                value={value.faceParts?.[g.key] ?? ''}
                onChange={(e) =>
                  onChange({ ...value, faceParts: { ...(value.faceParts ?? {}), [g.key]: e.target.value || null } })
                }
              >
                <option value="">— none —</option>
                {g.parts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button
            className="ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => onChange({ ...value, head: null, faceParts: defaultFaceParts(lists, value.female) })}
            title="A face, eyes, hair, eyebrows and eyelashes, and the helmet off"
          >
            Show a bare head
          </button>
        </>
      ) : null}
    </div>
  )
}

function EquipSlot({
  label,
  choices,
  value,
  onChange,
}: {
  label: string
  choices: EquipChoice[]
  value: string | null
  onChange: (v: string | null) => void
}) {
  const [q, setQ] = useState('')
  const key = (c: EquipChoice) => `${c.id}:${c.part}`
  // Older settings stored only the model; match it to the first row using it.
  const current = !value
    ? ''
    : value.includes(':')
      ? value
      : choices.find((c) => c.part === value)
        ? key(choices.find((c) => c.part === value)!)
        : ''
  const { mine, game } = useMemo(() => {
    const t = q.trim().toLowerCase()
    const match = (c: EquipChoice) =>
      !!c.part && (!t || c.name.toLowerCase().includes(t) || String(c.id).includes(t) || c.part.includes(t))
    const keep = (c: EquipChoice) => match(c) || key(c) === current
    return { mine: choices.filter((c) => c.project && keep(c)), game: choices.filter((c) => !c.project && keep(c)) }
  }, [choices, q, current])
  const option = (c: EquipChoice) => (
    <option key={key(c)} value={key(c)}>
      {c.name} ({c.part}
      {c.customModel ? ', custom model' : ''})
    </option>
  )
  return (
    <div className="vp-slot">
      <span className="dim">{label}</span>
      <input placeholder="filter" value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={current} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— none —</option>
        {mine.length > 0 && <optgroup label="This project">{mine.map(option)}</optgroup>}
        <optgroup label="Game">{game.map(option)}</optgroup>
      </select>
    </div>
  )
}
