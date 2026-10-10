/**
 * Behaviour recipes: what a modder usually changes in the player's
 * behaviour script (action/script/c0000.hks, HavokScript), as data, turned
 * into Lua that is appended to the end of the script.
 *
 * Each recipe becomes part of a wrapper around one of the script's own
 * functions, defined after everything else, so it works on any version of
 * the script (the game's own, a community text, another mod's) and keeps
 * working after game updates:
 *
 *   do
 *       local base = ExecAttack
 *       if base then
 *           ExecAttack = function(r1, r2, l1, l2, b1, b2, ...)
 *               local ok, handled = pcall(function() ... end)
 *               if ok and handled == TRUE then return TRUE end
 *               return base(r1, r2, l1, l2, b1, b2, ...)
 *           end
 *       end
 *   end
 *
 * Facts the generated code respects (checked against the game's script):
 *   - TRUE and FALSE are the script's numbers 1 and 0 (Lua treats 0 as true):
 *     every test compares with == TRUE, and functions return TRUE / FALSE;
 *   - numbers are 32-bit floats: ids above 16,777,216 aren't exact, so
 *     SpEffects a recipe tests are kept below that;
 *   - the script ends by making every unknown global a do-nothing function,
 *     so a recipe for a function the script doesn't define is left out
 *     (generateBlock's `has`) rather than wrapping a do-nothing one;
 *   - the game's scripts use the base library's setmetatable and ipairs and
 *     math.*, never rawget or pcall: the block relies only on pcall (and,
 *     were pcall missing, the do-nothing function stands in for it and the
 *     game's own behaviour runs);
 *   - env/act ids are written as numbers (the community's names for them
 *     changed between versions; the numbers don't): env 1116 a SpEffect is
 *     on, 345 a hand's weapon's special category (spAtkcategory), 1106 an
 *     input is pressed, 1007 is the local player, 234 precision aiming,
 *     404 / act 2025 the AI attack id handed on after a blend;
 *   - every recipe runs under pcall: an error falls back to the game's own
 *     behaviour instead of freezing the character.
 *
 * The techniques are the ones modders use: animation jumps and chains by
 * SpEffect, the two-hand button as a weapon transform, per-weapon special
 * attacks, combo lengths, skill types, dodges, guard.
 *
 * Credit: Clever (Sacred Arsenal, Moveset Modpack) and EldenRingHKS (ividyon,
 * Vawser, Exelot and others): the techniques were studied in their work;
 * Syyyke's moveset tutorial: Barbaric Roar's second heavy set for a SpEffect
 * of your own. Spellforge's code is its own; no script of theirs is copied.
 */

import {
  DODGE_LABELS,
  HEAVY_SET_EVENTS,
  HEAVY_SET_LABELS,
  hookOf,
  INPUT_LABELS,
  type Recipe,
  recipeProblems,
  SKILL_TYPE_FUNCTIONS,
  type SkillType,
  SPECIAL_ATTACK_SPEFFECT,
} from '../../shared/recipes.ts'

/* ------------------------------- generation ------------------------------ */
const I = '    '
const str = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
/** env(GetSpEffectID, n) == TRUE */
const spOn = (n: number) => `env(1116, ${n}) == TRUE`
/** env(GetEquipWeaponSpecialCategoryNumber, hand) == n */
const weaponIs = (hand: 'HAND_RIGHT' | 'HAND_LEFT', n: number) => `env(345, ${hand}) == ${n}`

/** A comment line from user text (no line breaks, no closing of anything). */
function comment(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim()
}

function describe(r: Recipe): string {
  switch (r.kind) {
    case 'jump':
      return `while SpEffect ${r.speffect} is on, ${INPUT_LABELS[r.input]} plays ${r.event}${r.window ? ` (window: ${r.window.animation})` : ''}`
    case 'chain':
      return `while SpEffect ${r.speffect} is on, go straight into ${r.event}${r.window ? ` (from ${r.window.animation})` : ''}`
    case 'heavySet':
      return `while SpEffect ${r.speffect} is on, the heavy attacks are ${HEAVY_SET_LABELS[r.set]} second set (030600…)`
    case 'handChange':
      return `weapons of category ${r.weapon}: the two-hand button plays ${r.oneHanded ?? 'the grip change'} one-handed, ${r.twoHanded ?? 'the grip change'} two-handed`
    case 'specialAttack':
      return `weapons of category ${r.weapon} have special attacks (the dodge button while charging R2, in SpEffect ${SPECIAL_ATTACK_SPEFFECT}'s window)`
    case 'comboLength':
      return `weapons of category ${r.weapon}: ${r.count} attacks in the ${r.grip === 'one' ? 'one-handed ' : r.grip === 'two' ? 'two-handed ' : ''}${r.dual ? 'powerstance' : 'R1'} combo`
    case 'skillType':
      return `skill type ${r.skill} (a${600 + r.skill}) is ${SKILL_TYPE_FUNCTIONS[r.as].label}`
    case 'dodge':
      return `weapons of category ${r.weapon} dodge ${typeof r.roll === 'number' ? `with EvasionWeightIndex ${r.roll}` : `like a ${DODGE_LABELS[r.roll]} load`}`
    case 'noGuard':
      return `weapons of category ${r.weapon} can’t guard${r.twoHandedOnly ? ' two-handed' : ''}`
    case 'code':
      return r.title || 'your own code'
  }
}

/**
 * Plays a behaviour event: on the whole body, or for a half-body event (an
 * Event_… table of the game's: the upper and lower body apart, with their
 * default states, like a crossbow reload) the way the game plays those.
 */
function fire(event: string, halfBlend: Map<string, string> | undefined, blend: string): string {
  const table = halfBlend?.get(event)
  return table ? `ExecEventHalfBlend(${table}, ${blend})` : `ExecEventAllBody(${str(event)})`
}

/**
 * The body of ExecAttack's wrapper: chains first (they act at once), then
 * second heavy sets, then input jumps (a jump of R2 wins over a heavy set).
 */
function attackBody(rs: Recipe[], halfBlend?: Map<string, string>): string[] {
  const out: string[] = []
  for (const r of rs) {
    if (r.kind !== 'chain') continue
    out.push(`-- ${comment(describe(r))}${r.note ? ` (${comment(r.note)})` : ''}`)
    out.push(
      `if ${spOn(r.speffect)} then`,
      `${I}${fire(r.event, halfBlend, 'blend_type or ALLBODY')}`,
      `${I}act(2025, env(404))`,
      `${I}return TRUE`,
      'end',
    )
  }
  for (const r of rs) {
    if (r.kind !== 'heavySet') continue
    // As the game's own code does for Barbaric Roar and War Cry: the set to play, then each heavy
    // attack's event swapped for the second set's (the game's checks then find none of their SpEffects).
    out.push(`-- ${comment(describe(r))}${r.note ? ` (${comment(r.note)})` : ''}`)
    out.push(`if ${spOn(r.speffect)} then`, `${I}SetVariable("AttackRightHeavySpecialType", ${r.set})`)
    for (const input of ['r2', 'b2']) {
      const pairs = HEAVY_SET_EVENTS.filter(([from]) =>
        from.startsWith(input === 'r2' ? 'W_AttackRight' : 'W_AttackBoth'),
      )
      pairs.forEach(([from, to], i) =>
        out.push(`${I}${i ? 'elseif' : 'if'} ${input} == ${str(from)} then`, `${I}${I}${input} = ${str(to)}`),
      )
      out.push(`${I}end`)
    }
    out.push('end')
  }
  for (const r of rs) {
    if (r.kind !== 'jump') continue
    out.push(`-- ${comment(describe(r))}${r.note ? ` (${comment(r.note)})` : ''}`)
    out.push(`if ${spOn(r.speffect)} then`, `${I}${r.input} = ${str(r.event)}`, 'end')
  }
  out.push('return FALSE')
  return out
}

function handChangeBody(rs: Recipe[], halfBlend?: Map<string, string>): string[] {
  const out: string[] = [
    '-- Only the player pressing the two-hand button (other code changing grip goes on as usual).',
    'if is_force ~= FALSE or env(1007) ~= TRUE or c_HasActionRequest == FALSE or env(234) == TRUE then',
    `${I}return FALSE`,
    'end',
    'local side = nil',
    'if env(1106, ACTION_ARM_CHANGE_STYLE_R) == TRUE and env(1108, ACTION_ARM_R1) < 100 then',
    `${I}side = HAND_RIGHT`,
    'elseif env(1106, ACTION_ARM_CHANGE_STYLE_L) == TRUE and env(1108, ACTION_ARM_L1) < 100 then',
    `${I}side = HAND_LEFT`,
    'end',
    'if side == nil then',
    `${I}return FALSE`,
    'end',
    'local both = c_Style == HAND_RIGHT_BOTH or c_Style == HAND_LEFT_BOTH',
    'local played = FALSE',
  ]
  for (const r of rs) {
    if (r.kind !== 'handChange') continue
    out.push(`-- ${comment(describe(r))}${r.note ? ` (${comment(r.note)})` : ''}`)
    out.push(`if played == FALSE and env(345, side) == ${r.weapon} then`)
    const play = (event: string, indent: string) => [
      `${indent}${fire(event, halfBlend, 'blend_type')}`,
      `${indent}played = TRUE`,
    ]
    const pick = (one: string | null, two: string | null, indent: string) => {
      const lines: string[] = []
      if (one !== null && two !== null)
        lines.push(
          `${indent}if both then`,
          ...play(two, indent + I),
          `${indent}else`,
          ...play(one, indent + I),
          `${indent}end`,
        )
      else if (two !== null) lines.push(`${indent}if both then`, ...play(two, indent + I), `${indent}end`)
      else if (one !== null) lines.push(`${indent}if not both then`, ...play(one, indent + I), `${indent}end`)
      return lines
    }
    const forms = r.forms ?? []
    if (forms.length) {
      forms.forEach((f, k) => {
        out.push(`${I}${k === 0 ? 'if' : 'elseif'} ${spOn(f.speffect)} then`, ...pick(f.oneHanded, f.twoHanded, I + I))
      })
      out.push(`${I}else`, ...pick(r.oneHanded, r.twoHanded, I + I), `${I}end`)
    } else out.push(...pick(r.oneHanded, r.twoHanded, I))
    out.push('end')
  }
  out.push(
    'if played == FALSE then',
    `${I}return FALSE`,
    'end',
    '-- What the game does after playing an action.',
    'act(2025, env(404))',
    'SetAIActionState()',
    'return TRUE',
  )
  return out
}

/**
 * A wrapper: the recipes' code under pcall, then (unless it handled the call)
 * the script's own function. The function is read straight from the global
 * (the block only wraps functions the script defines; the game's own scripts
 * use no rawget, so the block doesn't either).
 */
function wrapper(fn: string, params: string[], body: string[], mode: 'handled' | 'after' | 'answer'): string[] {
  const p = [...params, '...'].join(', ')
  const out = [`do`, `${I}local base = ${fn}`, `${I}if base then`, `${I}${I}${fn} = function(${p})`]
  const inner = (lines: string[], depth: number) => lines.map((l) => (l ? I.repeat(depth) + l : l))
  if (mode === 'handled') {
    // The recipes act first: TRUE means they did (the call is answered), else the game's own code runs.
    out.push(`${I}${I}${I}local ok, handled = pcall(function()`, ...inner(body, 4), `${I}${I}${I}end)`)
    out.push(
      `${I}${I}${I}if ok and handled == TRUE then`,
      `${I}${I}${I}${I}return TRUE`,
      `${I}${I}${I}end`,
      `${I}${I}${I}return base(${p})`,
    )
  } else if (mode === 'answer') {
    // The recipes answer for their weapons (a value), else the game's own answer.
    out.push(`${I}${I}${I}local ok, value = pcall(function()`, ...inner(body, 4), `${I}${I}${I}end)`)
    out.push(
      `${I}${I}${I}if ok and value ~= nil then`,
      `${I}${I}${I}${I}return value`,
      `${I}${I}${I}end`,
      `${I}${I}${I}return base(${p})`,
    )
  } else {
    // The game's own code first, then the recipes adjust what it set.
    out.push(
      `${I}${I}${I}local result = base(${p})`,
      `${I}${I}${I}pcall(function()`,
      ...inner(body, 4),
      `${I}${I}${I}end)`,
      `${I}${I}${I}return result`,
    )
  }
  out.push(`${I}${I}end`, `${I}end`, `end`)
  return out
}

/**
 * Entries in the game's per-skill-type tables (common_define.hks) for skill
 * types no game skill uses. The game's skill code reads them unchecked:
 * GetSwordArtsDiffCategory takes `#SwordArtsCategory[type]` (types below 300
 * outside 170-254, 272 and 275) and GetSwordArtsPutOppositeWeapon
 * `SwordArtPutOppositeWeapon[type][n]`, so with no entry L2 errors before the
 * skill plays. The values are Lion's Claw's (type 0), the default base skill:
 * the default variant only, and the hand it puts away. Plain statements (no
 * pcall, which the game's scripts never call): only written when the base
 * scripts define both tables (BehaviourService checks).
 */
function skillTypeEntries(types: number[]): string[] {
  const out = ['-- The game’s skill code reads these tables unchecked: without an entry, L2 does nothing.']
  for (const t of types) {
    out.push(`if SwordArtsCategory[${t}] == nil then`, `${I}SwordArtsCategory[${t}] = {0}`, 'end')
    out.push(
      `if SwordArtPutOppositeWeapon[${t}] == nil then`,
      `${I}SwordArtPutOppositeWeapon[${t}] = {TRUE, FALSE, TRUE}`,
      'end',
    )
  }
  return out
}

/** The per-skill-type tables skillTypeEntries fills (defined by the game's common_define.hks). */
export const SKILL_TYPE_TABLES = ['SwordArtsCategory', 'SwordArtPutOppositeWeapon']

export const BLOCK_BEGIN = '-- [Spellforge behaviours: begin] -----------------------------------'
export const BLOCK_END = '-- [Spellforge behaviours: end] -------------------------------------'

/**
 * The block appended to the script for these recipes (those switched on),
 * one wrapper per hooked function. `has` says which functions the base
 * script defines: recipes for a missing one are left out (and reported), and
 * so are recipes with a problem (a combo of 12 attacks, an id the script's
 * numbers can't hold), which would write something wrong.
 * `halfBlend`: the game's half-body events and their Event_… tables, played
 * the way the game plays those.
 */
export function generateBlock(
  recipes: Recipe[],
  has?: (fn: string) => boolean,
  halfBlend?: Map<string, string>,
  skillTypes: number[] = [],
): { text: string; skipped: { recipe: Recipe; why: string }[] } {
  const on = recipes.filter((r) => !r.off)
  const skipped: { recipe: Recipe; why: string }[] = []
  const usable = on.filter((r) => {
    const fn = hookOf(r)
    if (fn && has && !has(fn)) {
      skipped.push({ recipe: r, why: `the script has no ${fn}` })
      return false
    }
    const wrong = recipeProblems(r, undefined, halfBlend)
    if (wrong.length) {
      skipped.push({ recipe: r, why: wrong[0] })
      return false
    }
    return true
  })
  const lines: string[] = [
    BLOCK_BEGIN,
    '-- Made by Spellforge from the behaviours listed in the app: edit them there, not here.',
    '-- Each wraps one of the script’s functions; an error in one falls back to the game’s own behaviour.',
    '-- Techniques after Clever (Sacred Arsenal, Moveset Modpack) and the community EldenRingHKS.',
  ]
  const of = (kind: Recipe['kind']) => usable.filter((r) => r.kind === kind)
  const section = (title: string, body: string[]) => lines.push('', `-- ${title}`, ...body)

  if (skillTypes.length)
    section(`Skill types no game skill uses (${skillTypes.join(', ')})`, skillTypeEntries(skillTypes))

  const attack = [...of('chain'), ...of('heavySet'), ...of('jump')]
  if (attack.length)
    section(
      'Animation jumps, chains and heavy sets (by SpEffect)',
      wrapper(
        'ExecAttack',
        ['r1', 'r2', 'l1', 'l2', 'b1', 'b2', 'is_guard', 'blend_type'],
        attackBody(attack, halfBlend),
        'handled',
      ),
    )
  const hands = of('handChange')
  if (hands.length)
    section(
      'The two-hand button',
      wrapper('ExecHandChange', ['hand', 'is_force', 'blend_type'], handChangeBody(hands, halfBlend), 'handled'),
    )
  const special = of('specialAttack') as Extract<Recipe, { kind: 'specialAttack' }>[]
  if (special.length) {
    const body = ['local h = HAND_RIGHT', 'if c_Style == HAND_LEFT_BOTH then', `${I}h = HAND_LEFT`, 'end']
    for (const r of special)
      body.push(`-- ${comment(describe(r))}`, `if env(345, h) == ${r.weapon} then`, `${I}return TRUE`, 'end')
    body.push('return nil')
    section('Special attacks', wrapper('IsEnableSpecialAttack', ['hand'], body, 'answer'))
  }
  for (const dual of [false, true]) {
    const combos = (of('comboLength') as Extract<Recipe, { kind: 'comboLength' }>[]).filter((r) => r.dual === dual)
    if (!combos.length) continue
    const body: string[] = ['local h = hand', 'if h == nil then', `${I}h = HAND_RIGHT`, 'end']
    // Two-handed: held in both hands (c_Style, as the game's own checks); a grip's own first.
    const both = '(c_Style == HAND_RIGHT_BOTH or c_Style == HAND_LEFT_BOTH)'
    const byGrip = [...combos].sort((x, y) => Number(!!y.grip) - Number(!!x.grip))
    for (const r of byGrip)
      body.push(
        `-- ${comment(describe(r))}`,
        `if env(345, h) == ${r.weapon}${r.grip === 'two' ? ` and ${both}` : r.grip === 'one' ? ` and not ${both}` : ''} then`,
        `${I}return ${r.count}`,
        'end',
      )
    body.push('return nil')
    section(
      dual ? 'Powerstance combo lengths' : 'Combo lengths',
      wrapper(dual ? 'GetDualAttackMaxNumber' : 'GetAttackMaxNumber', ['hand'], body, 'answer'),
    )
  }
  const skills = of('skillType') as Extract<Recipe, { kind: 'skillType' }>[]
  for (const as of Object.keys(SKILL_TYPE_FUNCTIONS) as SkillType[]) {
    const list = skills.filter((r) => r.as === as)
    if (!list.length) continue
    const body = list.flatMap((r) => [
      `-- ${comment(describe(r))}`,
      `if arts_id == ${r.skill} then`,
      `${I}return TRUE`,
      'end',
    ])
    body.push('return nil')
    section(
      `Skills that are ${SKILL_TYPE_FUNCTIONS[as].label}`,
      wrapper(SKILL_TYPE_FUNCTIONS[as].fn, ['arts_id'], body, 'answer'),
    )
  }
  const dodges = of('dodge') as Extract<Recipe, { kind: 'dodge' }>[]
  if (dodges.length) {
    const body: string[] = []
    for (const r of dodges)
      body.push(
        `-- ${comment(describe(r))}`,
        `if ${weaponIs('HAND_RIGHT', r.weapon)} then`,
        `${I}SetVariable("EvasionWeightIndex", ${typeof r.roll === 'number' ? r.roll : `EVASION_WEIGHT_INDEX_${r.roll}`})`,
        'end',
      )
    section('Dodges', wrapper('SetWeightIndex', [], body, 'after'))
  }
  const guards = of('noGuard') as Extract<Recipe, { kind: 'noGuard' }>[]
  if (guards.length) {
    // The weapon that would guard: the left one held one-handed, else the one held in both hands (as the game decides).
    const body: string[] = ['local h = HAND_LEFT', 'if c_Style == HAND_RIGHT_BOTH then', `${I}h = HAND_RIGHT`, 'end']
    for (const r of guards) {
      body.push(`-- ${comment(describe(r))}`)
      body.push(
        `if env(345, h) == ${r.weapon}${r.twoHandedOnly ? ' and (c_Style == HAND_RIGHT_BOTH or c_Style == HAND_LEFT_BOTH)' : ''} then`,
        `${I}return FALSE`,
        'end',
      )
    }
    body.push('return nil')
    section('Guarding', wrapper('IsEnableGuard', [], body, 'answer'))
  }
  for (const r of of('code') as Extract<Recipe, { kind: 'code' }>[]) {
    section(`Your code: ${comment(r.title || 'untitled')}`, r.code.replace(/\r\n/g, '\n').split('\n'))
  }
  lines.push('', BLOCK_END)
  return { text: lines.join('\n') + '\n', skipped }
}

/**
 * A script with the block at its end: before a final top-level `return`
 * when it has one (the community's v7 scripts end with one, and Lua allows
 * nothing after it).
 */
export function withBlock(base: string, block: string): string {
  const text = base.replace(/\s+$/, '')
  const m = /\n(return[ \t]*(?:--[^\n]*)?)$/.exec(text)
  if (m) return `${text.slice(0, m.index)}\n\n${block}\n${m[1]}\n`
  return `${text}\n\n${block}`
}

/** The script without Spellforge's block (what it had before, or the base it was made from). */
export function stripBlock(text: string): string {
  const a = text.indexOf(BLOCK_BEGIN)
  if (a < 0) return text
  const b = text.indexOf(BLOCK_END, a)
  if (b < 0) return text.slice(0, a).replace(/\s+$/, '\n')
  return (text.slice(0, a) + text.slice(b + BLOCK_END.length)).replace(/\n{3,}$/, '\n\n').replace(/\s+$/, '\n')
}

/** The global functions a script defines (`function Name(` at the start of a line, and `Name = function(`). */
export function definedFunctions(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)) out.add(m[1])
  for (const m of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*function\s*\(/gm)) out.add(m[1])
  return out
}
