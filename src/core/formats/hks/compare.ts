/**
 * What a text .hks changes compared with the game's compiled script: each
 * top-level function compiled from the text is compared with the retail
 * function of the same name (instructions, constants, parameters, upvalues,
 * stack size and nested functions; not line numbers or local names).
 *
 * Community texts name the game's env/act ids as globals assigned at the end
 * of the file (`GetSpEffectID = 1116`) where the game's code has the bare
 * number. So a function that only matches once those names are read as
 * their numbers is "constants" (unchanged in effect), not "different". A
 * name is read as its number only if the retail script doesn't use it as a
 * real global; a second pass reads every such name as a number, for texts
 * that reuse a real global's name for an id (v18's SetTurnSpeed is both a
 * function and act 2004). Globals the game itself defines (TRUE, FALSE,
 * HAND_RIGHT...) stay globals: retail reads them as globals too.
 *
 * Statuses: same (identical code), constants (identical once the named ids
 * are numbers), different, missing (in the game, not in the text), extra (in
 * the text only). "(main chunk)" compares the file's top-level code.
 */
import { compileHks } from './compile.ts'
import type { HksChunk, HksConstant, HksProto } from './bytecode.ts'
import { OP, argBx, opOf } from './opcodes.ts'
import { parseHks } from './parser.ts'
import type { Expr } from './ast.ts'

export type FunctionStatus = 'same' | 'constants' | 'different' | 'missing' | 'extra'

export interface FunctionComparison {
  /** Debug name ("ExecEvent", "Foo:Bar"); a repeated name gets " (2)"...; unnamed functions "(anonymous)". */
  name: string
  status: FunctionStatus
  /** For different: where it first differs. */
  detail?: string
}

const sameConstant = (a: HksConstant, b: HksConstant) =>
  a.type === b.type && ('value' in a ? a.value === (b as typeof a).value : true)

/** Why two functions differ (null if they compile to the same thing). */
export function protoDifference(a: HksProto, b: HksProto): string | null {
  if (a.paramCount !== b.paramCount || a.varargFlags !== b.varargFlags) return 'parameters'
  if (a.upvalueCount !== b.upvalueCount) return 'upvalues'
  const n = Math.min(a.code.length, b.code.length)
  for (let i = 0; i < n; i++) if (a.code[i] !== b.code[i]) return `instruction ${i}`
  if (a.code.length !== b.code.length) return `${a.code.length} vs ${b.code.length} instructions`
  if (a.constants.length !== b.constants.length) return 'constants'
  for (let i = 0; i < a.constants.length; i++) if (!sameConstant(a.constants[i], b.constants[i])) return `constant ${i}`
  if (a.maxStack !== b.maxStack) return 'stack size'
  if (a.children.length !== b.children.length) return 'nested functions'
  for (let i = 0; i < a.children.length; i++) {
    const d = protoDifference(a.children[i], b.children[i])
    if (d) return `nested function ${i}: ${d}`
  }
  return null
}

/** Top-level functions by name (repeats numbered in order). */
function byName(main: HksProto): Map<string, HksProto> {
  const seen = new Map<string, number>()
  const out = new Map<string, HksProto>()
  for (const c of main.children) {
    const base = c.debug?.name ?? '(anonymous)'
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    out.set(k === 1 ? base : `${base} (${k})`, c)
  }
  return out
}

/** Global names a chunk reads or assigns anywhere. */
function globalsUsed(p: HksProto, out = new Set<string>()): Set<string> {
  for (const i of p.code) {
    const op = opOf(i)
    if (op === OP.GETGLOBAL || op === OP.GETGLOBAL_MEM || op === OP.SETGLOBAL) {
      const k = p.constants[argBx(i)]
      if (k?.type === 'string') out.add(k.value)
    }
  }
  for (const c of p.children) globalsUsed(c, out)
  return out
}

/** Top-level `Name = <number>` assignments of a text. */
function numberedNames(text: string): Map<string, number> {
  const names = new Map<string, number>()
  const num = (e: Expr): number | null => {
    if (e.kind === 'Number') return e.value
    if (e.kind === 'Unary' && e.op === '-' && e.operand.kind === 'Number') return -e.operand.value
    return null
  }
  for (const s of parseHks(text).body) {
    if (s.kind !== 'Assign') continue
    s.targets.forEach((t, i) => {
      const v = s.exprs[i] ? num(s.exprs[i]) : null
      if (t.kind === 'Name' && v !== null) names.set(t.name, v)
    })
  }
  return names
}

/**
 * Names a text assigns a number to that it (or the game's script) also uses
 * as a function: after loading, the global holds whichever came last, so
 * either the function's callers or the id's users break. v18's
 * `SetTurnSpeed = 2004` (an act id) replaces the SetTurnSpeed function its
 * other code calls.
 */
export function idNameClashes(text: string, retail: HksChunk): string[] {
  const numbered = numberedNames(text)
  const functions = new Set<string>()
  for (const s of parseHks(text).body)
    if (s.kind === 'FunctionStat' && s.path.length === 1 && !s.method) functions.add(s.path[0])
  for (const c of retail.main.children) if (c.debug?.name) functions.add(c.debug.name)
  return [...numbered.keys()].filter((n) => functions.has(n))
}

/**
 * Compares a text script with the game's compiled one, function by function
 * (game order, then the text's extra functions). Throws HksSyntaxError if
 * the text doesn't compile.
 */
export function compareWithGame(text: string, retail: HksChunk): FunctionComparison[] {
  const numbered = numberedNames(text)
  const retailGlobals = globalsUsed(retail.main)
  const ids = new Map([...numbered].filter(([n]) => !retailGlobals.has(n)))
  const plain = compileHks(text)
  const withIds = ids.size ? compileHks(text, { constants: ids }) : plain
  const withAll = numbered.size > ids.size ? compileHks(text, { constants: numbered }) : withIds

  const R = byName(retail.main)
  const A = byName(plain.main)
  const B = byName(withIds.main)
  const C = byName(withAll.main)
  const result: FunctionComparison[] = []
  const judge = (name: string, r: HksProto, a: HksProto, b?: HksProto, c?: HksProto) => {
    const d = protoDifference(r, a)
    if (!d) return result.push({ name, status: 'same' })
    if ((b && !protoDifference(r, b)) || (c && !protoDifference(r, c)))
      return result.push({ name, status: 'constants' })
    result.push({ name, status: 'different', detail: d })
  }
  // The top-level code itself (its functions are compared on their own).
  const top = (p: HksProto): HksProto => ({ ...p, children: [] })
  judge('(main chunk)', top(retail.main), top(plain.main), top(withIds.main), top(withAll.main))
  for (const [name, r] of R) {
    const a = A.get(name)
    if (!a) result.push({ name, status: 'missing' })
    else judge(name, r, a, B.get(name), C.get(name))
  }
  for (const name of A.keys()) if (!R.has(name)) result.push({ name, status: 'extra' })
  return result
}
