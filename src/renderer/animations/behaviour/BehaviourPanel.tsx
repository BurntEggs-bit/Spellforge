/**
 * Behaviour (the player's c0000.hks, HavokScript): what the game does with
 * inputs, set up as recipes instead of edited code. Each recipe is a form
 * (an animation jump, a chain, the two-hand button as a weapon transform,
 * special attacks, combo length, a skill's type, a dodge, no guard, or
 * your own code); Spellforge writes them as wrappers at the end of the
 * script and checks the whole script compiles before saving.
 *
 * The techniques are the ones Clever's movesets use (Sacred Arsenal, the
 * Moveset Modpack) and the community's EldenRingHKS documents; the code is
 * Spellforge's own.
 *
 * Credit: Clever (Sacred Arsenal, Moveset Modpack) and EldenRingHKS (ividyon,
 * Vawser, Exelot and others): the techniques the recipes use.
 */
import { useEffect, useState } from 'react'
import type {
  BehaviourComparison,
  BehaviourPreview,
  BehaviourSkill,
  BehaviourSlot,
  BehaviourStatus,
  BehaviourWeapon,
  Recipe,
} from '../../../shared/api.ts'
import { call } from '../../lib/ipc.ts'
import { useUi } from '../../shared/ui.tsx'
import { MenuButton } from '../../shared/menu.tsx'
import { animationIdText } from '../../../shared/animIds.ts'
import {
  INPUT_LABELS,
  type RecipeWindow,
  DODGE_LABELS,
  HEAVY_SET_LABELS,
  SKILL_TYPE_FUNCTIONS,
  SPECIAL_ATTACK_SPEFFECT,
} from '../../../shared/recipes.ts'
import { snapToFrame, toFrames, toSeconds } from '../../../shared/frames.ts'
import { randomId } from '../../../shared/format.ts'
import { ScriptWorkspace, type CodeRecipe } from './ScriptWorkspace.tsx'
import { type Kind, KINDS } from './recipeKinds.ts'
import { RecipeEditor } from './RecipeEditor.tsx'

/** Where the script Spellforge adds to comes from: a short label, and the details for its tooltip. */
const SOURCE_TEXT: Record<BehaviourStatus['source'], [string, string]> = {
  game: [
    'the game’s script',
    'Decompiled from the installed game’s own script, for your game version; Spellforge adds its part at the end',
  ],
  project: [
    'your project’s script',
    'Your project’s own text script, kept as it is; Spellforge adds its part at the end',
  ],
  community: [
    'EldenRingHKS',
    'The community’s EldenRingHKS script in your project; Spellforge adds its part at the end',
  ],
  'project-compiled': [
    'your project’s compiled script',
    'Your project’s compiled script, decompiled by Spellforge; Spellforge adds its part at the end',
  ],
  none: ['no script', 'No behaviour script found'],
}

/** A recipe in plain words (as the list shows it). */
function sentence(r: Recipe): string {
  switch (r.kind) {
    case 'jump':
      return `${r.window ? `In ${r.window.animation}, frames ${Math.round(toFrames(r.window.start))}–${Math.round(toFrames(r.window.end))}` : `While SpEffect ${r.speffect} is on`}: ${INPUT_LABELS[r.input]} plays ${eventLabel(r.event)}`
    case 'chain':
      return `${r.window ? `From ${r.window.animation} at frame ${Math.round(toFrames(r.window.start))}` : `While SpEffect ${r.speffect} is on`}: straight into ${eventLabel(r.event)}`
    case 'handChange':
      return `Weapons of category a${r.weapon}: the two-hand button plays ${r.oneHanded ? eventLabel(r.oneHanded) : 'the grip change'} one-handed, ${r.twoHanded ? eventLabel(r.twoHanded) : 'the grip change'} two-handed${r.forms?.length ? ` (+${r.forms.length} form)` : ''}`
    case 'specialAttack':
      return `Weapons of category a${r.weapon} have special attacks (the dodge button while charging R2)${r.windows?.length ? `, windows in ${r.windows.map((w) => w.animation).join(', ')}` : ''}`
    case 'heavySet':
      return `While SpEffect ${r.speffect} is on: R2 plays ${HEAVY_SET_LABELS[r.set]} heavy attacks (030600)`
    case 'comboLength':
      return `Weapons of category a${r.weapon}: ${r.count} attacks in the ${r.grip === 'one' ? 'one-handed ' : r.grip === 'two' ? 'two-handed ' : ''}${r.dual ? 'powerstance' : 'R1'} chain`
    case 'skillType':
      return `Skill a${600 + r.skill} is ${SKILL_TYPE_FUNCTIONS[r.as].label}`
    case 'dodge':
      return `Weapons of category a${r.weapon} roll ${typeof r.roll === 'number' ? `with your own roll ${r.roll}` : `like a ${DODGE_LABELS[r.roll]} load`}`
    case 'noGuard':
      return `Weapons of category a${r.weapon} can’t guard${r.twoHandedOnly ? ' when two-handed' : ''}`
    case 'code':
      return r.title || 'Your own code'
  }
}

/** The behaviour events by name, once the panel has loaded them (for the list's sentences). */
let slotsById: Map<string, BehaviourSlot> = new Map()

/** A behaviour event as its animation id and short name ("030000 (AttackRightLight1)"), or its name. */
function eventLabel(event: string): string {
  const s = slotsById.get(event)
  return s ? `${animationIdText(s.animId)} (${event.replace(/^W_/, '')})` : event
}

export function BehaviourPanel({
  current,
  category,
  version,
  onEdited,
  onOpenAnimation,
  clockTime,
}: {
  /** The animation open on the page: windows are made in it. */
  current: string | null
  category: number | null
  version: number
  onEdited: () => void
  onOpenAnimation: (name: string) => void
  /** The playhead (seconds), for "from here" windows. */
  clockTime: () => number
}) {
  const ui = useUi()
  const [status, setStatus] = useState<BehaviourStatus | null>(null)
  const [preview, setPreview] = useState<BehaviourPreview | null>(null)
  const [slots, setSlots] = useState<BehaviourSlot[]>([])
  const [weapons, setWeapons] = useState<BehaviourWeapon[]>([])
  const [skills, setSkills] = useState<BehaviourSkill[]>([])
  const [editing, setEditing] = useState<Recipe | null>(null)
  /** The script editor, open on a script, a new one, Spellforge's part or a game function. */
  const [workspace, setWorkspace] = useState<Parameters<typeof ScriptWorkspace>[0]['start'] | null>(null)
  const [comparison, setComparison] = useState<BehaviourComparison | null>(null)
  const compare = () =>
    ui.run('Comparing with the game’s own script', async () => {
      setComparison(await call('behaviour:compare', undefined))
    })
  const load = async () => {
    try {
      const st = await call('behaviour:status', undefined)
      setStatus(st)
      if (st.source !== 'none') setPreview(await call('behaviour:preview', undefined))
    } catch (e) {
      ui.error(e)
    }
  }
  useEffect(() => {
    load()
    call('behaviour:slots', undefined)
      .then((s) => {
        slotsById = new Map(s.map((x) => [x.event, x]))
        setSlots(s)
      })
      .catch(() => {})
    call('behaviour:weapons', undefined)
      .then(setWeapons)
      .catch(() => {})
    call('behaviour:skills', undefined)
      .then(setSkills)
      .catch(() => {})
  }, [version])

  const start = (kind: Kind) =>
    kind === 'code' ? setWorkspace({ kind: 'new' }) : setEditing(blank(kind, current, clockTime(), weapons, category))
  const save = async (r: Recipe, makeWindow: boolean, specialWindows: RecipeWindow[] = []) => {
    try {
      let recipe = r
      // A window in an animation: a marker SpEffect and its event (made once).
      if ((r.kind === 'jump' || r.kind === 'chain') && makeWindow && r.window) {
        const w = await call('behaviour:window', {
          animation: r.window.animation,
          start: r.window.start,
          end: r.window.end,
          name: `${r.kind === 'jump' ? 'jump to' : 'chain into'} ${r.event.replace(/^W_/, '')}`,
        })
        recipe = { ...r, speffect: w.speffect }
      }
      // The two-hand button's follow-ups: a marker SpEffect and its event in each window (made once).
      if (r.kind === 'handChange' && r.forms?.some((f) => f.window && !f.speffect)) {
        const forms = []
        for (const f of r.forms) {
          if (f.window && !f.speffect) {
            const w = await call('behaviour:window', {
              animation: f.window.animation,
              start: f.window.start,
              end: f.window.end,
              name: `two-hand button: ${(f.oneHanded ?? f.twoHanded ?? '').replace(/^W_/, '')}`,
            })
            forms.push({ ...f, speffect: w.speffect })
          } else forms.push(f)
        }
        recipe = { ...r, forms }
      }
      // Special attacks: the game's own window (SpEffect 100290) in the weapon's charged R2 animations.
      if (r.kind === 'specialAttack' && specialWindows.length) {
        for (const w of specialWindows)
          await call('behaviour:window', {
            animation: w.animation,
            start: w.start,
            end: w.end,
            name: 'special attack',
            speffect: SPECIAL_ATTACK_SPEFFECT,
          })
        recipe = { ...r, windows: [...(r.windows ?? []), ...specialWindows] }
      }
      const st = await call('behaviour:set', { recipe })
      setStatus(st)
      setPreview(await call('behaviour:preview', undefined))
      setEditing(null)
      onEdited()
    } catch (e) {
      ui.error(e)
    }
  }
  const remove = async (id: string) => {
    const st = await call('behaviour:delete', { id })
    setStatus(st)
    setPreview(await call('behaviour:preview', undefined))
    onEdited()
  }
  const saveScript = async (r: CodeRecipe) => {
    const st = await call('behaviour:set', { recipe: r })
    setStatus(st)
    setPreview(await call('behaviour:preview', undefined))
    onEdited()
  }
  const toggle = async (r: Recipe) => {
    const st = await call('behaviour:set', { recipe: { ...r, off: !r.off } })
    setStatus(st)
    setPreview(await call('behaviour:preview', undefined))
    onEdited()
  }

  if (!status)
    return (
      <div className="panel">
        <div className="panel-body">
          <div className="empty">Reading the behaviour script…</div>
        </div>
      </div>
    )
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="row">
          <div className="panel-title grow">
            Behaviour <span className="faint">c0000.hks</span>
          </div>
          {status.source !== 'game' && status.source !== 'none' && (
            <button
              className="ghost icon"
              onClick={compare}
              title="Compile your script and compare each function with the installed game’s own: what it changed, what it’s missing from the game’s newer version"
            >
              Compare with the game
            </button>
          )}
          <button
            className="ghost icon"
            onClick={() => setWorkspace({ kind: 'part' })}
            title="The script editor: write scripts of your own (checked as you type), read and search the game’s script, see what Spellforge adds"
          >
            Script editor…
          </button>
          <MenuButton
            label="+ Add ▾"
            className="primary"
            width={340}
            items={KINDS.map((k) => ({ label: k.label, hint: k.hint, run: () => start(k.kind) }))}
          />
        </div>
        <div
          className="dim"
          style={{ fontSize: 12 }}
          title={`${SOURCE_TEXT[status.source][1]}. Saved with the project as text (mod/action/script/c0000.hks); F5 reloads it in the running game.`}
        >
          {SOURCE_TEXT[status.source][0]}
          {status.functions ? `, ${status.functions.toLocaleString()} functions` : ''}
          {preview ? (
            preview.error ? (
              <span className="warn-text">; doesn’t compile: {preview.error}</span>
            ) : (
              <span className="ok-text">, compiles</span>
            )
          ) : null}
        </div>
        {status.problem && <div className="warn">{status.problem}</div>}
        {comparison && <ComparisonBox c={comparison} onClose={() => setComparison(null)} />}
      </div>
      <div className="panel-body behaviour-body">
        {editing && (
          <RecipeEditor
            recipe={editing}
            slots={slots}
            weapons={weapons}
            skills={skills}
            current={current}
            category={category}
            clockTime={clockTime}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
        {!editing && !status.recipes.some(({ recipe: r }) => r.kind !== 'code') && (
          <div className="empty">No behaviours.</div>
        )}
        {status.recipes
          .filter(({ recipe: r }) => r.kind !== 'code')
          .map(({ recipe: r, problems }) => (
            <div key={r.id} className={`recipe-card${r.off ? ' off' : ''}${problems.length ? ' bad' : ''}`}>
              <div className="row">
                <span className="recipe-kind">{KINDS.find((k) => k.kind === r.kind)?.label}</span>
                <span className="grow" />
                <label className="row faint" style={{ fontSize: 12 }} title="Off: kept here, left out of the script">
                  <input type="checkbox" checked={!r.off} onChange={() => toggle(r)} /> on
                </label>
                <button
                  className="ghost icon"
                  onClick={() => (r.kind === 'code' ? setWorkspace({ kind: 'script', id: r.id }) : setEditing(r))}
                >
                  Edit
                </button>
                <button
                  className="ghost icon"
                  onClick={() => remove(r.id)}
                  title="Remove (its marker SpEffect and event stay; delete them in Params / the timeline if you like)"
                >
                  ✕
                </button>
              </div>
              <div className="recipe-text">{sentence(r)}</div>
              {(r.kind === 'jump' || r.kind === 'chain') && r.window && (
                <button
                  className="ref-link"
                  onClick={() => onOpenAnimation(r.window!.animation)}
                  title={`Its AddSpEffect ${r.speffect} event turns this on`}
                >
                  {r.window.animation}, SpEffect {r.speffect}
                </button>
              )}
              {r.note && (
                <div className="faint" style={{ fontSize: 11.5 }}>
                  {r.note}
                </div>
              )}
              {problems.map((p) => (
                <div key={p} className="warn" style={{ fontSize: 12 }}>
                  {p}
                </div>
              ))}
              {preview?.skipped.some((s) => s.id === r.id) && (
                <div className="warn">Left out: {preview.skipped.find((s) => s.id === r.id)!.why}</div>
              )}
            </div>
          ))}
        <div className="scripts-section">
          <div className="scripts-section-head">
            <span className="recipe-kind grow">Your scripts</span>
            <button
              className="ghost icon"
              onClick={() => setWorkspace({ kind: 'new' })}
              title="Write HKS of your own: checked as you type by Spellforge’s compiler, errors shown in the code"
            >
              + Write a script
            </button>
          </div>
          {!status.recipes.some(({ recipe: r }) => r.kind === 'code') && (
            <div className="faint" style={{ fontSize: 12 }}>
              None.
            </div>
          )}
          {status.recipes
            .filter(({ recipe: r }) => r.kind === 'code')
            .map(({ recipe: r, problems }) => (
              <div key={r.id} className={`recipe-card${r.off ? ' off' : ''}${problems.length ? ' bad' : ''}`}>
                <div className="row">
                  <span className="recipe-text grow">{(r as CodeRecipe).title || 'Untitled'}</span>
                  <span className="faint" style={{ fontSize: 11.5 }}>
                    {(r as CodeRecipe).code.split('\n').length} lines
                  </span>
                  <label className="row faint" style={{ fontSize: 12 }} title="Off: kept here, left out of the script">
                    <input type="checkbox" checked={!r.off} onChange={() => toggle(r)} /> on
                  </label>
                  <button className="ghost icon" onClick={() => setWorkspace({ kind: 'script', id: r.id })}>
                    Edit
                  </button>
                </div>
                {problems.map((p) => (
                  <div key={p} className="warn" style={{ fontSize: 12 }}>
                    {p}
                  </div>
                ))}
              </div>
            ))}
        </div>
        <div className="faint behaviour-credit">
          Techniques after Clever (Sacred Arsenal, Moveset Modpack) and the community’s EldenRingHKS (ividyon, Vawser,
          Exelot and others); Spellforge writes its own code.
        </div>
      </div>
      {workspace && (
        <ScriptWorkspace
          preview={preview}
          scripts={status.recipes.map(({ recipe }) => recipe).filter((r): r is CodeRecipe => r.kind === 'code')}
          start={workspace}
          onSave={saveScript}
          onDelete={remove}
          onClose={() => setWorkspace(null)}
        />
      )}
    </div>
  )
}

/** What the project's script changes compared with the game's own, and what it's missing. */
function ComparisonBox({ c, onClose }: { c: BehaviourComparison; onClose: () => void }) {
  const list = (names: string[]) =>
    names.length > 14 ? `${names.slice(0, 14).join(', ')} and ${names.length - 14} more` : names.join(', ')
  const outdated = c.missing.length > 0
  return (
    <div className={`compare-box${outdated ? ' outdated' : ''}`}>
      <div className="row">
        <b className="grow">
          {c.version ? `Your script: ${c.version}.` : 'Your script'} Against the installed game’s own:
        </b>
        <button className="ghost icon" onClick={onClose}>
          ✕
        </button>
      </div>
      <div>
        {(c.same + c.constants).toLocaleString()} functions the same
        {c.constants ? ` (${c.constants.toLocaleString()} only with the community’s names for ids)` : ''}.
      </div>
      {c.different.length > 0 && (
        <div>
          <b>{c.different.length} compile differently</b> (changed by FromSoftware since the script was made, by a mod,
          or just written another way in the community’s clean-up): <span className="mono">{list(c.different)}</span>
        </div>
      )}
      {c.missing.length > 0 && (
        <div className="warn-text">
          <b>{c.missing.length} missing</b>: the game has them and this script doesn’t (newer than the script; things
          that need them, like DLC weapons or skills, may not work): <span className="mono">{list(c.missing)}</span>
        </div>
      )}
      {c.extra.length > 0 && (
        <div>
          <b>{c.extra.length} only in this script</b>: <span className="mono">{list(c.extra)}</span>
        </div>
      )}
      {c.clashes.length > 0 && (
        <div className="warn-text">
          <b>Name clash</b>: <span className="mono">{c.clashes.join(', ')}</span> is both a function and an id’s name in
          this script: whichever comes last replaces the other.
        </div>
      )}
      {outdated && (
        <div className="faint" style={{ fontSize: 11.5 }}>
          Up to date: move this script out of mod/action/script, reopen the project (the game’s own is used) and add
          your changes as behaviours.
        </div>
      )}
    </div>
  )
}

/** A new recipe of a kind, filled in from where the user is (the animation open, the playhead, the project's weapon). */
function blank(
  kind: Kind,
  current: string | null,
  t: number,
  weapons: BehaviourWeapon[],
  category: number | null,
): Recipe {
  const id = randomId()
  // The weapon whose animation is open (what the user is looking at), else the project's first.
  const open = category !== null && weapons.some((w) => w.category === category) ? category : null
  const weapon =
    open ??
    weapons.find((w) => w.project)?.category ??
    (category !== null && category >= 50 ? category : (weapons[0]?.category ?? 0))
  const window = current
    ? {
        animation: current,
        start: Math.max(0, snapToFrame(t)),
        end: Math.max(0, snapToFrame(t)) + toSeconds(10),
      }
    : undefined
  switch (kind) {
    case 'jump':
      return { id, kind, speffect: 0, input: 'r1', event: 'W_AttackRightLight2', window }
    case 'chain':
      return { id, kind, speffect: 0, event: 'W_AttackRightLight2', window }
    case 'handChange':
      return { id, kind, weapon, oneHanded: 'W_AttackCrossbowRightEmpty', twoHanded: 'W_AttackCrossbowRightReload' }
    case 'specialAttack':
      return { id, kind, weapon }
    case 'heavySet':
      return { id, kind, speffect: 0, set: 0 }
    case 'comboLength':
      return { id, kind, weapon, dual: false, count: 5 }
    case 'skillType':
      return { id, kind, skill: 26, as: 'stance' }
    case 'dodge':
      return { id, kind, weapon, roll: 'LIGHT' }
    case 'noGuard':
      return { id, kind, weapon, twoHandedOnly: true }
    case 'code':
      return { id, kind, title: 'My change', code: '-- Lua run at the end of the script\n' }
  }
}
