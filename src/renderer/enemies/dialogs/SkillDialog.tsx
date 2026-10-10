/**
 * Make it a skill (or one of a weapon's attacks): the weapon, names, how the
 * motion fits you, where its hits and effects happen on you, and what it makes.
 */
import { useMemo, useState, useEffect } from 'react'
import type {
  EnemyView,
  EnemyMove,
  RetargetOptionsView,
  EnemySkillResult,
  EnemySkillPlan,
  EnemySkillRequest,
} from '../../../shared/api.ts'
import { errorMessage } from '../../../shared/errors.ts'
import { call } from '../../lib/ipc.ts'
import { useUi, InActiveWindow } from '../../shared/ui.tsx'
import { useEquipmentLists } from '../../viewer/equipment.ts'
import { formatSize, plural } from '../../../shared/format.ts'
import { plainName } from '../names.ts'
import { SoundLoaderNote } from './SoundLoaderNote.tsx'
import { StepsChoice } from './StepsChoice.tsx'
import { ModalShell } from '../../shared/Modal.tsx'

export function SkillDialog({
  view,
  move,
  fit,
  version,
  onClose,
  onDone,
}: {
  view: EnemyView
  move: EnemyMove
  fit: RetargetOptionsView
  version: number
  onClose: () => void
  onDone: (r: EnemySkillResult, weapon: number) => void
}) {
  const ui = useUi()
  const lists = useEquipmentLists(false, version)
  const weapons = useMemo(
    () =>
      (lists?.weapons ?? [])
        .slice()
        .sort((a, b) => Number(b.project) - Number(a.project) || a.name.localeCompare(b.name)),
    [lists],
  )
  const [weapon, setWeapon] = useState<number | null>(null)
  useEffect(() => {
    if (weapon === null && weapons.length) setWeapon(weapons[0].id)
  }, [weapons])
  const main = move.actions.find((a) => a.kind !== 'speffect' && plainName(a.name))
  const moveName = main ? plainName(main.name) : move.name
  const [name, setName] = useState(`${view.name}’s ${moveName}`)
  const [description, setDescription] = useState(
    `${view.name}’s ${moveName}, learned by the one who wields this weapon.`,
  )
  const [motion, setMotion] = useState<RetargetOptionsView>(fit)
  const [effectSize, setEffectSize] = useState<'enemy' | 'player'>('enemy')
  const [dummies, setDummies] = useState<Record<string, number>>({})
  /** Bullet events made to fire another of the character's bullets (by its judge). */
  const [bullets, setBullets] = useState<Record<string, number>>({})
  /** What the move becomes: '' the weapon's skill, else one of its attacks (EnemyAttackTarget key). */
  const [target, setTarget] = useState('')
  /** An R1 split into steps, one per press: where it's cut (seconds into the move), or null. */
  const [steps, setSteps] = useState<number[] | null>(null)
  const [stepsText, setStepsText] = useState('')
  const [plan, setPlan] = useState<EnemySkillPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const req = (): EnemySkillRequest => ({
    chr: view.chr,
    animation: move.name,
    variation: view.variation,
    weapon: weapon!,
    name,
    description,
    motion,
    effectSize,
    dummies,
    bullets,
    ...(target ? { attack: target, ...(steps?.length ? { steps } : {}) } : {}),
  })
  useEffect(() => {
    if (weapon === null) return
    let live = true
    const t = setTimeout(() => {
      call('enemy:skillPlan', req())
        .then((p) => {
          if (!live) return
          setPlan(p)
          setError(null)
        })
        .catch((e) => live && setError(errorMessage(e)))
    }, 200)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [
    weapon,
    target,
    motion.mirror,
    motion.upright,
    motion.travel,
    effectSize,
    JSON.stringify(dummies),
    JSON.stringify(bullets),
    JSON.stringify(steps),
  ])

  const make = async () => {
    if (weapon === null) return
    const r = await ui.run(target ? `Making ${moveName} an attack` : `Making ${name}`, () =>
      call('enemy:makeSkill', req()),
    )
    if (r) onDone(r, weapon)
  }
  const w = weapons.find((x) => x.id === weapon)
  const asAttack = target ? (plan?.attackTargets ?? []).find((x) => x.key === target) : undefined
  const traveled = plan ? plan.distance * plan.scale * motion.travel : 0
  return (
    <InActiveWindow>
      <ModalShell onClose={onClose} className="enemy-dialog">
        <header>
          <h2 className="grow">
            Make {view.name}’s {moveName} {target ? 'an attack' : 'a skill'}
          </h2>
        </header>
        <div className="body">
          <div className="dim">
            {target
              ? 'An attack of your weapon, in moves of its own (other weapons of its kind keep theirs): the motion fitted to you, its attacks, bullets, effects and sounds brought over, the attack’s combo, cancel and recovery timing kept.'
              : 'A skill of your weapon: the motion fitted to you, its attacks, bullets, effects and sounds brought over.'}
          </div>
          <div className="form-grid">
            <label>Weapon</label>
            <select
              value={weapon ?? ''}
              onChange={(e) => {
                setWeapon(Number(e.target.value))
                setTarget('')
              }}
            >
              {[
                ['Your weapons', weapons.filter((x) => x.project)],
                ['Every weapon', weapons.filter((x) => !x.project)],
              ].map(([label, group]) =>
                (group as typeof weapons).length ? (
                  <optgroup key={label as string} label={label as string}>
                    {(group as typeof weapons).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} ({x.id})
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            <label>Make it</label>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value)
                setSteps(null)
                setStepsText('')
              }}
              title="Its skill (L2), or one of its attacks: each R1 of its combo, its heavy attack, running, roll and backstep attacks, guard counter, one-handed or two-handed"
            >
              <option value="">Its skill (L2)</option>
              {(['One-handed', 'Two-handed'] as const).map((g) => {
                const list = (plan?.attackTargets ?? []).filter((x) => x.group === g)
                return list.length ? (
                  <optgroup key={g} label={`Or one of its attacks, ${g.toLowerCase()}`}>
                    {list.map((x) => (
                      <option key={x.key} value={x.key}>
                        {x.label} ({x.group.toLowerCase()})
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
            </select>
            {target && /-r1-\d+$/.test(target) && plan && plan.cuts.length > 0 && (
              <>
                <label title="Each part of the move becomes one press of R1: this R1, then the next ones">Steps</label>
                <StepsChoice
                  plan={plan}
                  target={target}
                  steps={steps}
                  text={stepsText}
                  onText={setStepsText}
                  onSteps={(v) => {
                    setSteps(v)
                    setStepsText(v ? v.map((t) => t.toFixed(2)).join(', ') : '')
                  }}
                />
              </>
            )}
            {!target && (
              <>
                <label>Skill name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
                <label>Description</label>
                <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
              </>
            )}
          </div>
          <h3>Motion</h3>
          <div className="enemy-options">
            <label className="row">
              <input
                type="checkbox"
                checked={motion.mirror}
                onChange={(e) => setMotion({ ...motion, mirror: e.target.checked })}
              />
              <span>
                Mirror it{' '}
                <span className="faint">
                  {move.hand === 'left'
                    ? `(${view.name} makes it with the left hand: mirrored, it’s your weapon hand)`
                    : '(swap left and right)'}
                </span>
              </span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={motion.upright}
                onChange={(e) => setMotion({ ...motion, upright: e.target.checked })}
              />
              <span>
                Stand upright <span className="faint">(your own posture instead of {view.name}’s)</span>
              </span>
            </label>
            <label className="row">
              Travel
              <select value={motion.travel} onChange={(e) => setMotion({ ...motion, travel: Number(e.target.value) })}>
                <option value={1}>for your size</option>
                <option value={1.5}>×1.5</option>
                <option value={2}>×2</option>
                {plan && plan.scale > 0 && <option value={+(1 / plan.scale).toFixed(3)}>as far as {view.name}</option>}
              </select>
              {plan && <span className="faint">{traveled.toFixed(1)} m</span>}
            </label>
          </div>
          <h3>Effects and hits</h3>
          <div className="enemy-options">
            <label className="row">
              <input type="radio" checked={effectSize === 'enemy'} onChange={() => setEffectSize('enemy')} />
              <span>
                {view.name}’s size <span className="faint">(as big as in the fight)</span>
              </span>
            </label>
            <label className="row">
              <input type="radio" checked={effectSize === 'player'} onChange={() => setEffectSize('player')} />
              <span>
                Your size{' '}
                <span className="faint">
                  {plan ? `(×${plan.scale.toFixed(2)}: scaled copies of the effects, hits and bullets)` : ''}
                </span>
              </span>
            </label>
          </div>
          {error && <div className="version-note warn">{error}</div>}
          {plan && (
            <>
              <h3>Where things happen on you</h3>
              <table className="plan enemy-dummies">
                <tbody>
                  {plan.dummies.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.id}</td>
                      <td className="faint">
                        on {view.name}’s {d.bone}
                      </td>
                      <td>
                        <select
                          value={dummies[d.id] ?? d.to}
                          onChange={(e) => setDummies({ ...dummies, [d.id]: Number(e.target.value) })}
                        >
                          {!d.options.some((o) => o.value === d.to) && <option value={d.to}>{d.toLabel}</option>}
                          {d.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>What it makes</h3>
              <ul className="enemy-list">
                {plan.attack ? (
                  <li>
                    {asAttack?.group ?? plan.attack.group} {plan.attack.label}:{' '}
                    <span className="mono">{plan.attack.animations.join(', ')}</span>, starting as{' '}
                    {w?.name ?? 'the weapon'}’s own (its combo, cancel and recovery windows), with {view.name}’s motion
                    fitted to you (×{plan.scale.toFixed(2)}), in moves of its own
                  </li>
                ) : (
                  <li>
                    Skill animations <span className="mono">{plan.animations.join(', ')}</span>: a copy of{' '}
                    {plan.baseSkill.name}’s (FP use, recovery, cancels), with {view.name}’s motion fitted to you (×
                    {plan.scale.toFixed(2)})
                  </li>
                )}
                {plan.attacks.map((a) => (
                  <li key={`a${a.judge}`}>
                    Attack <b>{plainName(a.name) || a.atk}</b>: yours, its damage counting for you (judge {a.newJudge})
                  </li>
                ))}
                {plan.bullets.map((b) => (
                  <li key={`b${b.judge}`}>
                    Bullet{' '}
                    <select
                      className="enemy-bullet"
                      value={b.bullet}
                      title={`Which of ${view.name}’s bullets this fires: the move’s own, or any other of his (its whole chain comes along: the bullets it becomes and drops)`}
                      onChange={(e) => setBullets({ ...bullets, [b.judge]: Number(e.target.value) })}
                    >
                      {!view.spells.some((s) => s.bullet === b.bullet) && (
                        <option value={b.bullet}>{plainName(b.name) || `Bullet ${b.bullet}`}</option>
                      )}
                      {view.spells.map((s) => (
                        <option key={s.bullet} value={s.bullet}>
                          {plainName(s.name) || `Bullet ${s.bullet}`} ({s.bullet})
                        </option>
                      ))}
                    </select>
                    : a copy with its own attack (judge {b.newJudge})
                    {move.actions.some(
                      (x) => x.kind === 'bullet' && x.judge === b.judge && x.id !== null && x.id !== b.bullet,
                    )
                      ? ', instead of the move’s own'
                      : ''}
                  </li>
                ))}
                {plan.effects.length > 0 && (
                  <li>
                    {plural(plan.effects.length, 'effect')}
                    {plan.effects.some((e) => e.from) ? `, copied from ${view.name}’s own into the common effects` : ''}
                    {effectSize === 'player' ? ', scaled to you' : ''}
                  </li>
                )}
                {plan.sounds.events > 0 && (
                  <li>
                    {plural(plan.sounds.events, 'sound')}
                    {plan.sounds.bring
                      ? `: brought from ${view.name}’s sound bank into yours (${plan.sounds.bank}, +${formatSize(plan.sounds.bytes)})`
                      : ', all in your sound bank already'}
                  </li>
                )}
                {!plan.attack && (
                  <li>
                    A skill named <b>{name || '…'}</b>, set on {w?.name ?? 'the weapon'}
                    {plan.weapon.skillName ? ` (instead of ${plan.weapon.skillName})` : ''}
                  </li>
                )}
              </ul>
              {plan.dropped.length > 0 && (
                <>
                  <h3>Stays behind</h3>
                  <ul className="enemy-list faint">
                    {plan.dropped.map((d, i) => (
                      <li key={i}>
                        {d.what}: {d.why}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {plan.notes.map((n, i) => (
                <div key={i} className="faint" style={{ fontSize: 12 }}>
                  {n}
                </div>
              ))}
              {plan.sounds.bring > 0 && <SoundLoaderNote />}
            </>
          )}
        </div>
        <footer>
          <span className="grow" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!plan || weapon === null || (!target && !name.trim())} onClick={make}>
            {target ? 'Make the attack' : 'Make the skill'}
          </button>
        </footer>
      </ModalShell>
    </InActiveWindow>
  )
}
