/**
 * A behaviour recipe's form: what it does and for which weapon, skill or
 * animation, when (frames of an animation, or while a SpEffect is on), and the
 * animation it plays, with the special attacks a weapon category has.
 */
import { useState, useEffect, useMemo } from 'react'
import { animationIdText, describeAnimationId } from '../../../shared/animIds.ts'
import type { BehaviourSlot, BehaviourWeapon, BehaviourSkill } from '../../../shared/api.ts'
import {
  type Recipe,
  type RecipeWindow,
  recipeProblems,
  type HksInput,
  INPUT_LABELS,
  SPECIAL_ATTACK_SPEFFECT,
  type SkillType,
  SKILL_TYPE_FUNCTIONS,
  type DodgeRoll,
  DODGE_LABELS,
  type HeavySet,
  HEAVY_SET_LABELS,
} from '../../../shared/recipes.ts'
import { toFrames, toSeconds, snapToFrame } from '../../../shared/frames.ts'
import { call } from '../../lib/ipc.ts'
import { parseAnimationInput } from '../dialogs/animationInput.ts'
import { KINDS } from './recipeKinds.ts'

/** The special attack each charged R2 leads to (the game's code: Heavy1 → Special1, Heavy2 → Special2; two-handed alike). */
const SPECIAL_OF: Record<string, number> = { '030500': 30950, '030510': 30955, '032500': 32950, '032510': 32955 }

export function RecipeEditor({
  recipe,
  slots,
  weapons,
  skills,
  current,
  category,
  clockTime,
  onCancel,
  onSave,
}: {
  recipe: Recipe
  slots: BehaviourSlot[]
  weapons: BehaviourWeapon[]
  skills: BehaviourSkill[]
  current: string | null
  category: number | null
  clockTime: () => number
  onCancel: () => void
  onSave: (r: Recipe, makeWindow: boolean, specialWindows?: RecipeWindow[]) => void
}) {
  const [r, setR] = useState<Recipe>(recipe)
  const isNew = !('speffect' in recipe) || recipe.speffect === 0
  // Jumps and chains: a window Spellforge makes, or a SpEffect of your own.
  const [windowMode, setWindowMode] = useState<'make' | 'speffect'>(isNew ? 'make' : 'speffect')
  // Special attacks: which of the weapon's own charged R2 animations get the game's window, and when.
  const [special, setSpecial] = useState<{ ids: string[]; have: string[]; from: number; to: number }>({
    ids: [],
    have: [],
    from: 8,
    to: 23,
  })
  useEffect(() => {
    if (r.kind !== 'specialAttack' || !r.weapon) return
    let live = true
    call('anim:list', { category: r.weapon, query: '' })
      .then((list) => {
        if (!live) return
        const have = ['030500', '030510', '032500', '032510'].filter((id) => list.some((a) => a.id === Number(id)))
        const done = new Set((r.windows ?? []).map((w) => w.animation))
        // Ticked where the special attack each charge leads to is in the category (030500 → 030950, 030510 → 030955…).
        const leadsTo = (id: string) => list.some((a) => a.id === SPECIAL_OF[id])
        setSpecial((s) => ({ ...s, have, ids: have.filter((id) => !done.has(`a${r.weapon}_${id}`) && leadsTo(id)) }))
      })
      .catch(() => live && setSpecial((s) => ({ ...s, have: [], ids: [] })))
    return () => {
      live = false
    }
  }, [r.kind, r.kind === 'specialAttack' ? r.weapon : 0])
  const set = (patch: Partial<Recipe>) => setR({ ...r, ...patch } as Recipe)
  const weaponPick = (value: number, onChange: (n: number) => void) => (
    <WeaponPick value={value} weapons={weapons} onChange={onChange} />
  )
  const kindInfo = KINDS.find((k) => k.kind === r.kind)!
  const windowFields = (r.kind === 'jump' || r.kind === 'chain') && (
    <>
      <div className="field-label">When</div>
      <div className="field-value">
        <select value={windowMode} onChange={(e) => setWindowMode(e.target.value as 'make' | 'speffect')}>
          <option value="make">During part of an animation (Spellforge adds a SpEffect event)</option>
          <option value="speffect">While a SpEffect of my own is on</option>
        </select>
        {windowMode === 'make' ? (
          <div className="recipe-window">
            <input
              className="mono"
              style={{ width: 130 }}
              value={r.window?.animation ?? current ?? ''}
              placeholder="a050_030000"
              onChange={(e) => {
                const name = parseAnimationInput(e.target.value, category) ?? e.target.value
                set({
                  window: { animation: name, start: r.window?.start ?? 0, end: r.window?.end ?? 0.3 },
                } as Partial<Recipe>)
              }}
            />
            <span className="faint">frames</span>
            <input
              className="mono"
              style={{ width: 52 }}
              value={Math.round(toFrames(r.window?.start ?? 0))}
              onChange={(e) =>
                set({
                  window: {
                    animation: r.window?.animation ?? current ?? '',
                    start: toSeconds(Number(e.target.value) || 0),
                    end: r.window?.end ?? 0.3,
                  },
                } as Partial<Recipe>)
              }
            />
            <span className="faint">to</span>
            <input
              className="mono"
              style={{ width: 52 }}
              value={Math.round(toFrames(r.window?.end ?? 0))}
              onChange={(e) =>
                set({
                  window: {
                    animation: r.window?.animation ?? current ?? '',
                    start: r.window?.start ?? 0,
                    end: toSeconds(Number(e.target.value) || 0),
                  },
                } as Partial<Recipe>)
              }
            />
            <button
              className="ghost icon"
              title="From the playhead, for 10 frames"
              onClick={() => {
                const t = snapToFrame(clockTime())
                set({
                  window: { animation: r.window?.animation ?? current ?? '', start: t, end: t + toSeconds(10) },
                } as Partial<Recipe>)
              }}
            >
              at the playhead
            </button>
            <div className="field-hint">
              {r.kind === 'jump'
                ? 'The input pressed in these frames plays the other animation. Keep them inside the animation’s cancel window for that input (ChrActionFlag, e.g. 4 for R1) and before its “special transition” flag (66), after which R1 restarts the combo.'
                : 'From the first of these frames the character goes straight into the other animation.'}
            </div>
          </div>
        ) : (
          <div className="recipe-window">
            <span className="faint">SpEffect</span>
            <input
              className="mono"
              style={{ width: 110 }}
              value={r.speffect || ''}
              onChange={(e) => set({ speffect: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            />
            <div className="field-hint">
              Put an AddSpEffect event for it in the animations yourself (ids under 16,777,216).
            </div>
          </div>
        )}
      </div>
    </>
  )
  // What would keep it out of the script (a combo of 12, an event the graph lacks): shown here, and it can't be saved.
  const problems = recipeProblems(r, slots.length ? new Set(slots.map((s) => s.event)) : undefined)
  const valid = (() => {
    if (problems.length) return false
    if ((r.kind === 'jump' || r.kind === 'chain') && windowMode === 'make')
      return !!r.window && /^a\d{3}_\d{6}$/.test(r.window.animation) && r.window.end > r.window.start
    if ((r.kind === 'jump' || r.kind === 'chain') && windowMode === 'speffect') return r.speffect > 0
    if (r.kind === 'handChange')
      return (r.forms ?? []).every((f) =>
        f.window && !f.speffect
          ? /^a\d{3}_\d{6}$/.test(f.window.animation) && f.window.end > f.window.start
          : f.speffect > 0,
      )
    return true
  })()
  return (
    <div className="recipe-editor">
      <div className="row" style={{ alignItems: 'baseline' }}>
        <b className="nowrap">{kindInfo.label}</b>
        <span className="grow faint" style={{ fontSize: 12 }}>
          {kindInfo.hint}
        </span>
      </div>
      <div className="fields" style={{ gridTemplateColumns: '120px 1fr' }}>
        {windowFields}
        {r.kind === 'jump' && (
          <>
            <div className="field-label">Pressing</div>
            <div className="field-value">
              <select value={r.input} onChange={(e) => set({ input: e.target.value as HksInput })}>
                {(Object.keys(INPUT_LABELS) as HksInput[]).map((k) => (
                  <option key={k} value={k}>
                    {INPUT_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {(r.kind === 'jump' || r.kind === 'chain') && (
          <>
            <div className="field-label">Plays</div>
            <div className="field-value">
              <EventPick value={r.event} slots={slots} onChange={(event) => set({ event: event ?? r.event })} />
            </div>
          </>
        )}
        {(r.kind === 'handChange' ||
          r.kind === 'specialAttack' ||
          r.kind === 'comboLength' ||
          r.kind === 'dodge' ||
          r.kind === 'noGuard') && (
          <>
            <div className="field-label">Weapon</div>
            <div className="field-value">{weaponPick(r.weapon, (n) => set({ weapon: n }))}</div>
          </>
        )}
        {r.kind === 'handChange' && (
          <>
            <div className="field-label">One-handed</div>
            <div className="field-value">
              <EventPick value={r.oneHanded} slots={slots} nullable onChange={(e) => set({ oneHanded: e })} />
            </div>
            <div className="field-label">Two-handed</div>
            <div className="field-value">
              <EventPick value={r.twoHanded} slots={slots} nullable onChange={(e) => set({ twoHanded: e })} />
              <div className="field-hint">
                Instead of changing grip, the button plays these. Default: the crossbow reload slots (a{r.weapon}_037040
                one-handed, a{r.weapon}_037030 two-handed), free on other weapons and played upper and lower body as the
                game plays them; put your animation there with Duplicate.
              </div>
            </div>
            <div className="field-label">Follow-ups and forms</div>
            <div className="field-value">
              {(r.forms ?? []).map((f, k) => {
                const setForm = (patch: Partial<NonNullable<typeof r.forms>[number]>) =>
                  set({ forms: (r.forms ?? []).map((x, i) => (i === k ? { ...x, ...patch } : x)) })
                const made = f.speffect > 0
                const playhead = snapToFrame(clockTime())
                return (
                  <div key={k} className="recipe-form">
                    <div className="recipe-window">
                      <select
                        value={f.window ? 'make' : 'speffect'}
                        disabled={made && !!f.window}
                        onChange={(e) =>
                          setForm(
                            e.target.value === 'make'
                              ? {
                                  speffect: 0,
                                  window: { animation: current ?? '', start: playhead, end: playhead + toSeconds(10) },
                                }
                              : { window: undefined },
                          )
                        }
                      >
                        <option value="make">
                          Right after part of an animation (Spellforge adds the SpEffect event)
                        </option>
                        <option value="speffect">While a SpEffect of my own is on (a form)</option>
                      </select>
                      {f.window && made && (
                        <span className="faint">
                          {f.window.animation}, frames {Math.round(toFrames(f.window.start))}–
                          {Math.round(toFrames(f.window.end))} (SpEffect {f.speffect})
                        </span>
                      )}
                      {f.window && !made && (
                        <>
                          <input
                            className="mono"
                            style={{ width: 130 }}
                            value={f.window.animation}
                            placeholder="a050_030010"
                            onChange={(e) =>
                              setForm({
                                window: {
                                  ...f.window!,
                                  animation: parseAnimationInput(e.target.value, category) ?? e.target.value,
                                },
                              })
                            }
                          />
                          <span className="faint">frames</span>
                          <input
                            className="mono"
                            style={{ width: 52 }}
                            value={Math.round(toFrames(f.window.start))}
                            onChange={(e) =>
                              setForm({ window: { ...f.window!, start: toSeconds(Number(e.target.value) || 0) } })
                            }
                          />
                          <span className="faint">to</span>
                          <input
                            className="mono"
                            style={{ width: 52 }}
                            value={Math.round(toFrames(f.window.end))}
                            onChange={(e) =>
                              setForm({ window: { ...f.window!, end: toSeconds(Number(e.target.value) || 0) } })
                            }
                          />
                          <button
                            className="ghost icon"
                            title="From the playhead, for 10 frames"
                            onClick={() =>
                              setForm({
                                window: {
                                  animation: f.window!.animation || current || '',
                                  start: playhead,
                                  end: playhead + toSeconds(10),
                                },
                              })
                            }
                          >
                            at the playhead
                          </button>
                        </>
                      )}
                      {!f.window && (
                        <>
                          <span className="faint">SpEffect</span>
                          <input
                            className="mono"
                            style={{ width: 90 }}
                            value={f.speffect || ''}
                            onChange={(e) => setForm({ speffect: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                          />
                        </>
                      )}
                    </div>
                    <div className="recipe-window">
                      <span className="faint">plays one-handed</span>
                      <EventPick
                        value={f.oneHanded}
                        slots={slots}
                        nullable
                        onChange={(e) => setForm({ oneHanded: e })}
                      />
                      <span className="faint">two-handed</span>
                      <EventPick
                        value={f.twoHanded}
                        slots={slots}
                        nullable
                        onChange={(e) => setForm({ twoHanded: e })}
                      />
                      <button
                        className="ghost icon"
                        title="Remove it"
                        onClick={() => set({ forms: (r.forms ?? []).filter((_, i) => i !== k) })}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
              <button
                className="ghost icon"
                onClick={() => {
                  const t = snapToFrame(clockTime())
                  set({
                    forms: [
                      ...(r.forms ?? []),
                      {
                        speffect: 0,
                        oneHanded: 'W_AttackCrossbowRightEmpty',
                        twoHanded: null,
                        window: current ? { animation: current, start: t, end: t + toSeconds(10) } : undefined,
                      },
                    ],
                  })
                }}
              >
                + A follow-up or a form
              </button>
              <div className="field-hint">
                Follow-up: right after part of an animation, the button plays this (a trick finisher); otherwise it does
                what’s above. Form: while a lasting SpEffect of yours is on, it plays other moves.
              </div>
            </div>
          </>
        )}
        {r.kind === 'specialAttack' && (
          <>
            <div className="field-label">Its window</div>
            <div className="field-value">
              {special.have.length ? (
                <div className="recipe-window">
                  {special.have.map((id) => {
                    const done = (r.windows ?? []).some((w) => w.animation === `a${r.weapon}_${id}`)
                    return (
                      <label key={id} className="row" title={done ? 'Already has it' : undefined}>
                        <input
                          type="checkbox"
                          disabled={done}
                          checked={done || special.ids.includes(id)}
                          onChange={(e) =>
                            setSpecial((s) => ({
                              ...s,
                              ids: e.target.checked ? [...s.ids, id] : s.ids.filter((x) => x !== id),
                            }))
                          }
                        />
                        <span className="mono">
                          a{r.weapon}_{id}
                        </span>
                        <span className="faint" style={{ fontSize: 11 }}>
                          → {animationIdText(SPECIAL_OF[id])}
                        </span>
                      </label>
                    )
                  })}
                  <span className="faint">frames</span>
                  <input
                    className="mono"
                    style={{ width: 52 }}
                    value={special.from}
                    onChange={(e) => setSpecial((s) => ({ ...s, from: Number(e.target.value) || 0 }))}
                  />
                  <span className="faint">to</span>
                  <input
                    className="mono"
                    style={{ width: 52 }}
                    value={special.to}
                    onChange={(e) => setSpecial((s) => ({ ...s, to: Number(e.target.value) || 0 }))}
                  />
                </div>
              ) : (
                <div className="warn" style={{ fontSize: 12 }}>
                  a{r.weapon} has no charged R2 of its own (030500…): the window would go into its class’s, shared by
                  every weapon of the class. Give the weapon heavy attacks of its own first (Moveset), then add this.
                </div>
              )}
              <div className="field-hint">
                Played when the weapon allows them, R2 and the dodge button are held, and SpEffect{' '}
                {SPECIAL_ATTACK_SPEFFECT} is on (its charged R2 applies it: event 67, frames 8–23 on the game’s curved
                swords). 030950 follows the first charged R2, 030955 the second (032950 / 032955 two-handed).
              </div>
            </div>
          </>
        )}
        {r.kind === 'heavySet' && (
          <>
            <div className="field-label">When</div>
            <div className="field-value">
              <div className="recipe-window">
                <span className="faint">While SpEffect</span>
                <input
                  className="mono"
                  style={{ width: 110 }}
                  value={r.speffect || ''}
                  onChange={(e) => set({ speffect: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                />
                <span className="faint">is on</span>
              </div>
              <div className="field-hint">
                One your skill applies for as long as the heavy attacks change, like Barbaric Roar’s buff (ids under
                16,777,216). The game’s own are 1681 and 1686 (1683 and 1688 held left in both hands) for Barbaric Roar,
                1811, 1816 and 1861 for War Cry.
              </div>
            </div>
            <div className="field-label">Heavy attacks</div>
            <div className="field-value">
              <select value={r.set} onChange={(e) => set({ set: Number(e.target.value) as HeavySet })}>
                {([0, 1] as HeavySet[]).map((k) => (
                  <option key={k} value={k}>
                    {HEAVY_SET_LABELS[k]} set
                  </option>
                ))}
              </select>
              <div className="field-hint">
                R2 plays 030600 instead of 030500 and 030610 for the second heavy attack (032600 and 032610 two-handed),
                from the weapon’s category: the classes Barbaric Roar and War Cry go on have them. The set picks which
                moves the behaviour graph plays there.
              </div>
            </div>
          </>
        )}
        {r.kind === 'comboLength' && (
          <>
            <div className="field-label">Attacks</div>
            <div className="field-value">
              <div className="recipe-window">
                <input
                  className="mono"
                  style={{ width: 50 }}
                  value={r.count || ''}
                  onChange={(e) => set({ count: Number(e.target.value.replace(/\D/g, '')) })}
                />
                <label className="row">
                  <input type="checkbox" checked={r.dual} onChange={(e) => set({ dual: e.target.checked })} />{' '}
                  powerstance chain
                </label>
                <select
                  value={r.grip ?? ''}
                  title="The game counts one combo length per weapon, whatever the grip"
                  onChange={(e) => set({ grip: (e.target.value || undefined) as 'one' | 'two' | undefined })}
                >
                  <option value="">either grip</option>
                  <option value="one">one-handed</option>
                  <option value="two">two-handed</option>
                </select>
              </div>
              <div className="field-hint">
                The weapon’s category needs each of them (030000, 030010… up to the last; two-handed 032000…).
              </div>
            </div>
          </>
        )}
        {r.kind === 'skillType' && (
          <>
            <div className="field-label">Skill</div>
            <div className="field-value">
              <select value={r.skill} onChange={(e) => set({ skill: Number(e.target.value) })}>
                {!skills.some((s) => s.type === r.skill) && (
                  <option value={r.skill}>
                    type {r.skill} (a{600 + r.skill})
                  </option>
                )}
                {skills.map((s) => (
                  <option key={s.id} value={s.type}>
                    {s.project ? '★ ' : ''}
                    {s.name} (a{600 + s.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="field-label">Acts as</div>
            <div className="field-value">
              <select value={r.as} onChange={(e) => set({ as: e.target.value as SkillType })}>
                {(Object.keys(SKILL_TYPE_FUNCTIONS) as SkillType[]).map((k) => (
                  <option key={k} value={k}>
                    {SKILL_TYPE_FUNCTIONS[k].label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        {r.kind === 'dodge' && (
          <>
            <div className="field-label">Rolls like</div>
            <div className="field-value">
              <select
                value={typeof r.roll === 'number' ? 'own' : r.roll}
                onChange={(e) => set({ roll: e.target.value === 'own' ? 4 : (e.target.value as DodgeRoll) })}
              >
                {(Object.keys(DODGE_LABELS) as DodgeRoll[]).map((k) => (
                  <option key={k} value={k}>
                    a {DODGE_LABELS[k]} load
                  </option>
                ))}
                <option value="own">my own rolls (an EvasionWeightIndex the behaviour graph has)</option>
              </select>
              {typeof r.roll === 'number' && (
                <input
                  className="mono"
                  style={{ width: 50, marginLeft: 6 }}
                  value={r.roll}
                  onChange={(e) => set({ roll: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                />
              )}
            </div>
          </>
        )}
        {r.kind === 'noGuard' && (
          <>
            <div className="field-label">When</div>
            <div className="field-value">
              <label className="row">
                <input
                  type="checkbox"
                  checked={r.twoHandedOnly}
                  onChange={(e) => set({ twoHandedOnly: e.target.checked })}
                />{' '}
                only two-handed
              </label>
            </div>
          </>
        )}
        {r.kind === 'code' && (
          <>
            <div className="field-label">Name</div>
            <div className="field-value">
              <input value={r.title} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div className="field-label">Code</div>
            <div className="field-value">
              <textarea
                className="mono recipe-code"
                rows={10}
                spellCheck={false}
                value={r.code}
                onChange={(e) => set({ code: e.target.value })}
              />
              <div className="field-hint">
                Runs at the end of the script. Use numbers for env / act ids, and compare with == TRUE.
              </div>
            </div>
          </>
        )}
        <div className="field-label">Note</div>
        <div className="field-value">
          <input value={r.note ?? ''} placeholder="for you" onChange={(e) => set({ note: e.target.value })} />
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
        <button
          className="primary"
          disabled={!valid}
          onClick={() =>
            onSave(
              r,
              (r.kind === 'jump' || r.kind === 'chain') && windowMode === 'make' && !r.speffect,
              r.kind === 'specialAttack'
                ? special.ids.map((id) => ({
                    animation: `a${r.weapon}_${id}`,
                    start: toSeconds(special.from),
                    end: toSeconds(special.to),
                  }))
                : [],
            )
          }
        >
          Save behaviour
        </button>
      </div>
    </div>
  )
}

/** A weapon by its special category (the project's weapons first), or a category typed in. */
function WeaponPick({
  value,
  weapons,
  onChange,
}: {
  value: number
  weapons: BehaviourWeapon[]
  onChange: (n: number) => void
}) {
  const known = weapons.filter((w) => w.category === value)
  return (
    <div className="recipe-window">
      <select
        value={known.length ? value : 'other'}
        onChange={(e) => e.target.value !== 'other' && onChange(Number(e.target.value))}
      >
        {!known.length && <option value="other">category a{value}</option>}
        {weapons.map((w) => (
          <option key={w.id} value={w.category}>
            {w.project ? '★ ' : ''}
            {w.name} (a{w.category})
          </option>
        ))}
      </select>
      <input
        className="mono"
        style={{ width: 60 }}
        value={value}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
        title="The special category (spAtkcategory) the script checks"
      />
      {known.length > 1 && (
        <span className="faint" style={{ fontSize: 11 }}>
          {known.length} weapons share it
        </span>
      )}
    </div>
  )
}

/** A behaviour event, by the animation id it plays (searchable). */
function EventPick({
  value,
  slots,
  nullable,
  onChange,
}: {
  value: string | null
  slots: BehaviourSlot[]
  nullable?: boolean
  onChange: (e: string | null) => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return slots
      .filter(
        (s) =>
          s.event === value ||
          !t ||
          s.event.toLowerCase().includes(t) ||
          animationIdText(s.animId).includes(t) ||
          (describeAnimationId(s.animId) ?? '').toLowerCase().includes(t),
      )
      .slice(0, 400)
  }, [slots, q, value])
  return (
    <span className="event-pick">
      <input placeholder="filter: 030950, special, R2…" value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {nullable && <option value="">— the game’s own —</option>}
        {value && !slots.some((s) => s.event === value) && <option value={value}>{value}</option>}
        {shown.map((s) => (
          <option key={s.event} value={s.event}>
            {animationIdText(s.animId)} {describeAnimationId(s.animId) ?? s.event.replace(/^W_/, '')}, {s.event}
          </option>
        ))}
      </select>
    </span>
  )
}
