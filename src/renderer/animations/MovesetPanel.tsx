/**
 * The Animations page's Moveset panel: the weapon in the viewer's right hand
 * given other weapons' moves (light attacks from a thrusting sword, heavy
 * attacks from a hammer…) or spells' casts (light attacks that cast a
 * pebble, heavy attacks that throw a spear) and any skill, only that weapon
 * (and its affinities) changing. It can also show an effect on its attacks
 * (the golden hammer a skill made from Margit's leap conjures) and hide its
 * own model, for a weapon that is that effect, and hold it in another of the
 * game's stances (how it's held, walks, guards and changes grip, one- and
 * two-handed). Every choice plays in the viewer first (▶), with the weapon
 * in hand. The work is done in src/main/workflows/moveset.ts.
 */
import { useEffect, useMemo, useState } from 'react'
import type {
  MovesetCast,
  MovesetGrip,
  MovesetResult,
  MovesetSlotView,
  MovesetSource,
  MovesetSpell,
  MovesetStance,
  MovesetView,
} from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { IconPlay } from '../shared/icons.tsx'
import { errorMessage } from '../../shared/errors.ts'
import { categoryLabel } from '../../shared/animIds.ts'

/** A slot's choice: '' keep, 'class' its own again, a weapon id, or "spell:<id>". */
type Pick = string
const SPELL = 'spell:'

export function MovesetPanel({
  weapon,
  version,
  onPlay,
  onDone,
}: {
  /** The weapon in the viewer's right hand. */
  weapon: { id: number; name: string } | null
  version: number
  /** Plays an animation in the viewer (the weapon stays in hand). */
  onPlay: (animation: string) => void
  /** After a change (the page reads its categories and rows again). */
  onDone: (r: MovesetResult) => void
}) {
  const ui = useUi()
  const [view, setView] = useState<MovesetView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  /** For a slot casting a spell: the spell whose cast it looks like ('' its own). */
  const [likes, setLikes] = useState<Record<string, string>>({})
  /** For a slot taking moves: only its one- or two-handed ones (left out: both). */
  const [grips, setGrips] = useState<Record<string, MovesetGrip>>({})
  const [skill, setSkill] = useState('')
  const [hits, setHits] = useState<'source' | 'own'>('source')
  /** The effect on its attacks: '' keep, 'none' remove, else "animation#event". */
  const [effect, setEffect] = useState('')
  const [effectSlots, setEffectSlots] = useState<string[]>(['light', 'heavy'])
  const [hide, setHide] = useState<boolean | null>(null)
  /** Stances: '' keep, else the stance's id. */
  const [stanceOne, setStanceOne] = useState('')
  const [stanceBoth, setStanceBoth] = useState('')

  useEffect(() => {
    setPicks({})
    setLikes({})
    setGrips({})
    setSkill('')
    setEffect('')
    setHide(null)
    setStanceOne('')
    setStanceBoth('')
    setError(null)
    if (!weapon) {
      setView(null)
      return
    }
    let live = true
    call('moveset:get', { weapon: weapon.id })
      .then((v) => live && setView(v))
      .catch((e) => {
        if (!live) return
        setView(null)
        setError(errorMessage(e))
      })
    return () => {
      live = false
    }
  }, [weapon?.id, version])

  const changed =
    Object.values(picks).some((v) => v) ||
    !!skill ||
    !!effect ||
    (hide !== null && hide !== view?.hidden) ||
    !!stanceOne ||
    !!stanceBoth
  const apply = async () => {
    if (!view) return
    const slots: Record<string, number | 'class' | MovesetCast> = {}
    const held: Record<string, MovesetGrip> = {}
    for (const [k, v] of Object.entries(picks)) {
      if (!v) continue
      if (v.startsWith(SPELL))
        slots[k] = { spell: Number(v.slice(SPELL.length)), ...(likes[k] ? { like: Number(likes[k]) } : {}) }
      else {
        slots[k] = v === 'class' ? 'class' : Number(v)
        if (grips[k]) held[k] = grips[k]
      }
    }
    const fx =
      effect === 'none'
        ? null
        : effect
          ? { animation: effect.split('#')[0], event: Number(effect.split('#')[1]), slots: effectSlots }
          : undefined
    const r = await ui.run(`Giving ${view.weapon.name} its moves`, () =>
      call('moveset:apply', {
        weapon: view.weapon.id,
        slots,
        ...(Object.keys(held).length ? { grips: held } : {}),
        hits,
        ...(skill ? { skill: Number(skill) } : {}),
        ...(fx !== undefined ? { effect: fx } : {}),
        ...(hide !== null && hide !== view.hidden ? { hide } : {}),
        ...(stanceOne || stanceBoth
          ? {
              stance: {
                ...(stanceOne ? { one: Number(stanceOne) } : {}),
                ...(stanceBoth ? { both: Number(stanceBoth) } : {}),
              },
            }
          : {}),
      }),
    )
    if (!r) return
    ui.toast(r.summary)
    onDone(r)
  }

  if (!weapon)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty">No weapon in the viewer’s right hand (Equipment).</div>
        </div>
      </div>
    )
  if (error)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty">{error}</div>
        </div>
      </div>
    )
  if (!view)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty">Reading {weapon.name}’s moves…</div>
        </div>
      </div>
    )

  const w = view.weapon
  const currentSkill = view.skills.find((k) => k.id === w.skill)
  const pickedSkill = skill ? view.skills.find((k) => String(k.id) === skill) : currentSkill
  return (
    <div className="panel moveset">
      <div className="panel-head">
        <div className="panel-title">{w.name}’s moveset</div>
        <div className="dim moveset-about" title="Changes apply to this weapon only, with all its affinities">
          {w.className}:{' '}
          {view.own ? (
            <>
              own moves in <span className="mono">a{view.own.category}</span>, the rest its class’s
            </>
          ) : (
            <>
              its class’s moves (<span className="mono">{categoryLabel(w.category)}</span>)
            </>
          )}
          {w.affinities > 1 ? `, ${w.affinities} affinities` : ''}
        </div>
      </div>
      <div className="panel-body moveset-body">
        <div className="moveset-slots">
          {view.slots.map((slot) => (
            <SlotRow
              key={slot.key}
              slot={slot}
              spells={view.spells}
              value={picks[slot.key] ?? ''}
              onChange={(v) => setPicks((p) => ({ ...p, [slot.key]: v }))}
              like={likes[slot.key] ?? ''}
              onLike={(v) => setLikes((l) => ({ ...l, [slot.key]: v }))}
              grip={grips[slot.key] ?? ''}
              onGrip={(v) =>
                setGrips((g) => {
                  const next = { ...g }
                  if (v) next[slot.key] = v
                  else delete next[slot.key]
                  return next
                })
              }
              onPlay={onPlay}
            />
          ))}
        </div>

        <div className="moveset-sections">
          <div className="moveset-section">
            <div
              className="moveset-label"
              title="How it's held, walks, guards, jumps and rides, and how it changes grip: one of the game's stances (EquipParamWeapon wepmotionOneHandId / wepmotionBothHandId, each a category of those animations). Its attacks stay as they are."
            >
              Stance and grip change
            </div>
            <StanceRow
              kind="one"
              label="One-handed"
              hint="Held in one hand: standing, walking, guarding"
              list={view.stances.one}
              now={view.stance.one}
              original={view.stance.originalOne}
              value={stanceOne}
              onChange={setStanceOne}
              onPlay={onPlay}
            />
            <StanceRow
              kind="both"
              label="Two-handed"
              hint="Taken in both hands (the 1H → 2H swap), and held so"
              list={view.stances.both}
              now={view.stance.both}
              original={view.stance.originalBoth}
              value={stanceBoth}
              onChange={setStanceBoth}
              onPlay={onPlay}
            />
          </div>

          <div className="moveset-section">
            <div className="moveset-label">Hits</div>
            <label
              className="row"
              title="Motion values, damage type (thrusts pierce), stagger: as on the weapon the moves come from. Every weapon has the same hit points (tip, middle, grip), so they land along this one."
            >
              <input type="radio" checked={hits === 'source'} onChange={() => setHits('source')} />
              Like on the weapon the moves come from
            </label>
            <label
              className="row"
              title="The moves hit with this weapon's own attacks for those buttons (its motion values and damage type)."
            >
              <input type="radio" checked={hits === 'own'} onChange={() => setHits('own')} />
              Like this weapon’s own attacks
            </label>
          </div>

          <div className="moveset-section">
            <div className="moveset-label">Skill</div>
            <div className="moveset-slot">
              <select value={skill} onChange={(e) => setSkill(e.target.value)}>
                <option value="">Keep: {w.skillName || 'none'}</option>
                <optgroup label="Stances (hold, then R1 or R2)">
                  {view.skills
                    .filter((k) => k.stance)
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Other skills">
                  {view.skills
                    .filter((k) => !k.stance)
                    .map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.name}
                      </option>
                    ))}
                </optgroup>
              </select>
              <button
                className="ghost icon"
                disabled={!pickedSkill?.animation}
                title={
                  pickedSkill?.animation ? `Play it in the viewer (${pickedSkill.animation})` : 'No animation to show'
                }
                onClick={() => pickedSkill?.animation && onPlay(pickedSkill.animation)}
              >
                <IconPlay size={14} />
              </button>
            </div>
          </div>

          <div className="moveset-section">
            <div className="moveset-label">Effect on its attacks</div>
            <div className="moveset-slot">
              <select value={effect} onChange={(e) => setEffect(e.target.value)}>
                <option value="">
                  {view.shown ? `Keep: ${view.shown.name || `effect ${view.shown.effect}`}` : 'None'}
                </option>
                {view.shown && <option value="none">None any more</option>}
                {view.effects.length > 0 && (
                  <optgroup label={`From its skill, ${w.skillName}`}>
                    {view.effects.map((e) => (
                      <option key={`${e.animation}#${e.event}`} value={`${e.animation}#${e.event}`}>
                        {e.name || `Effect ${e.effect}`} ({e.length.toFixed(1)} s)
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                className="ghost icon"
                disabled={!effect || effect === 'none'}
                title="Play the skill animation it comes from"
                onClick={() => effect && effect !== 'none' && onPlay(effect.split('#')[0])}
              >
                <IconPlay size={14} />
              </button>
            </div>
            {!view.effects.length && !view.shown && (
              <div
                className="faint moveset-note"
                title="Make a boss’s move its skill first (Enemies → Make it a skill): its effect, fitted to the weapon, shows up here."
              >
                Its skill spawns no effect.
              </div>
            )}
            {effect && effect !== 'none' && (
              <div className="moveset-checks">
                {view.slots.map((s) => (
                  <label key={s.key} className="row">
                    <input
                      type="checkbox"
                      checked={effectSlots.includes(s.key)}
                      onChange={(e) =>
                        setEffectSlots((l) => (e.target.checked ? [...l, s.key] : l.filter((k) => k !== s.key)))
                      }
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            )}
            <label
              className="row"
              title="A copy of Unseen Blade's effect, always on while it's held in the right hand: its own model doesn't show, its hits still land."
            >
              <input type="checkbox" checked={hide ?? view.hidden} onChange={(e) => setHide(e.target.checked)} />
              Hide the weapon itself (it still hits)
            </label>
          </div>
        </div>

        <div className="row moveset-actions">
          <button className="primary" disabled={!changed} onClick={apply}>
            Apply to {w.name}
          </button>
          {changed && (
            <button
              className="ghost"
              onClick={() => {
                setPicks({})
                setLikes({})
                setSkill('')
                setEffect('')
                setHide(null)
                setStanceOne('')
                setStanceBoth('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotRow({
  slot,
  spells,
  value,
  onChange,
  like,
  onLike,
  grip,
  onGrip,
  onPlay,
}: {
  slot: MovesetSlotView
  spells: MovesetSpell[]
  value: Pick
  onChange: (v: Pick) => void
  like: string
  onLike: (v: string) => void
  grip: MovesetGrip | ''
  onGrip: (v: MovesetGrip | '') => void
  onPlay: (animation: string) => void
}) {
  // Each class's standard moves, then the weapons of that class with moves of their own.
  const groups = useMemo(() => {
    const m = new Map<string, MovesetSource[]>()
    for (const s of slot.sources) {
      const l = m.get(s.className) ?? []
      l.push(s)
      m.set(s.className, l)
    }
    return [...m]
  }, [slot])
  // Spells by group (this project's first); and one spell for each way of casting, for "cast like".
  const spellGroups = useMemo(() => {
    const m = new Map<string, MovesetSpell[]>()
    for (const s of spells) m.set(s.group, [...(m.get(s.group) ?? []), s])
    return [...m]
  }, [spells])
  const castWays = useMemo(() => {
    const m = new Map<number, MovesetSpell>()
    for (const s of spells) if (s.group !== 'This project' && !m.has(s.castCategory)) m.set(s.castCategory, s)
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [spells])
  const spell = value.startsWith(SPELL) ? spells.find((s) => s.id === Number(value.slice(SPELL.length))) : undefined
  const likeSpell = spell && like ? spells.find((s) => s.id === Number(like)) : undefined
  const picked = value && value !== 'class' && !spell ? slot.sources.find((s) => String(s.id) === value) : null
  const shown = spell
    ? (likeSpell ?? spell).animation
    : picked
      ? (grip === 'two' && picked.animationTwo) || picked.animation
      : value === 'class'
        ? slot.original
        : slot.now
  // Attacks an enemy's move made (Enemies → Make it… → an attack), e.g. "Two-handed R1, 1st: Margit’s golden-sword combo (a000_003035)".
  const enemyOwners = [...new Set(slot.enemy.map((l) => /: (.+?)’s /.exec(l)?.[1]).filter((x): x is string => !!x))]
  const keep = !slot.cast && slot.enemy.length ? `${enemyOwners.join(' and ') || 'An enemy'}’s moves` : slot.fromName
  return (
    <div className={`moveset-slot${value ? ' changed' : ''}`}>
      <div className="moveset-slot-name" title={slot.hint}>
        <span>{slot.label}</span>
        <span className="faint">{slot.hint}</span>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Keep: {keep}</option>
        {(slot.from !== null || slot.cast || slot.enemy.length > 0) && <option value="class">Back to its own</option>}
        {groups.map(([cls, list]) => (
          <optgroup key={cls} label={cls}>
            {list.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
        {slot.canCast &&
          spellGroups.map(([group, list]) => (
            <optgroup
              key={group}
              label={`Cast a spell: ${group === 'This project' ? 'this project’s' : group.toLowerCase()}`}
            >
              {list.map((s) => (
                <option key={s.id} value={`${SPELL}${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
      <button
        className="ghost icon"
        disabled={!shown}
        title={shown ? `Play it in the viewer (${shown})` : 'Nothing to show'}
        onClick={() => shown && onPlay(shown)}
      >
        <IconPlay size={14} />
      </button>
      {!slot.cast && slot.enemy.length > 0 && (
        <div
          className="moveset-enemy faint"
          title="Made with Enemies → Make it… → an attack. Back to its own takes them off, with the behaviors only they use."
        >
          {slot.enemy.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      )}
      {slot.grips && value && !spell && (
        <div
          className="moveset-grip"
          title="Which of its moves change: those held in one hand, in both, or all of them. The others stay as they are."
        >
          <span className="faint">held</span>
          <select value={grip} onChange={(e) => onGrip(e.target.value as MovesetGrip | '')}>
            <option value="">One- and two-handed</option>
            <option value="one">One-handed</option>
            <option value="two">Two-handed</option>
          </select>
        </div>
      )}
      {spell && (
        <div
          className="moveset-cast"
          title="How the attacks look: the spell's own cast, or another spell's (Lightning Spear's throw). The bullet is the spell's either way; it flies from the weapon's tip (or the hand, for a cast made with the hand). No FP: a cast's stamina."
        >
          <span className="faint">cast like</span>
          <select value={like} onChange={(e) => onLike(e.target.value)}>
            <option value="">Its own cast</option>
            {castWays
              .filter((s) => s.castCategory !== spell.castCategory)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  )
}

/** A stance to hold it in: one of the game's, named by the classes held that way. */
function StanceRow({
  kind,
  label,
  hint,
  list,
  now,
  original,
  value,
  onChange,
  onPlay,
}: {
  kind: 'one' | 'both'
  label: string
  hint: string
  list: MovesetStance[]
  now: number
  original: number
  value: string
  onChange: (v: string) => void
  onPlay: (animation: string) => void
}) {
  const current = list.find((x) => x.id === now)
  const picked = value ? list.find((x) => String(x.id) === value) : current
  // Named by the classes held so; a category no weapon is held in yet goes by its name.
  const name = (x: MovesetStance | undefined, id: number) =>
    x?.label ? `like ${x.label} (${categoryLabel(id)})` : categoryLabel(id)
  return (
    <div className={`moveset-slot${value ? ' changed' : ''}`} data-stance={kind}>
      <div className="moveset-slot-name" title={hint}>
        <span>{label}</span>
        <span className="faint">{hint}</span>
      </div>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          Keep: {name(current, now)}
          {now === original ? ' (its own)' : ''}
        </option>
        {list
          .filter((x) => x.id !== now)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.id === original ? 'Back to its own: ' : ''}
              {name(x, x.id)}
            </option>
          ))}
      </select>
      <button
        className="ghost icon"
        disabled={!picked?.animation}
        title={picked?.animation ? `Play it in the viewer (${picked.animation})` : 'Nothing to show'}
        onClick={() => picked?.animation && onPlay(picked.animation)}
      >
        <IconPlay size={14} />
      </button>
    </div>
  )
}
