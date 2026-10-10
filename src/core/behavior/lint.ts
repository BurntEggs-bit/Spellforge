/**
 * Checks for the scripts users write in the Behaviour tab's script editor,
 * beyond what the compiler refuses: the mistakes the game's behaviour script
 * makes easy, from facts read in the game's own scripts (c0000.hks and
 * common_define.hks, decompiled):
 *
 *   - TRUE and FALSE are the numbers 1 and 0, and Lua counts 0 as true:
 *     `if env(…) then` or `if IsSomething() then` is always taken, `== true`
 *     never matches, and the game's code compares results with `== TRUE`;
 *   - an unknown global isn't an error: the script ends with a catch-all
 *     that makes it a do-nothing function, so a misspelt name fails quietly;
 *   - numbers are 32-bit floats: above 16,777,216 not every whole number
 *     exists, so an id up there becomes another;
 *   - env / act ids and behaviour events (W_…) the game doesn't use;
 *   - a definition of one of the game's functions replaces it (game updates
 *     no longer reach it): wrapping it keeps the game's code.
 *
 * What the checks know comes from the game's scripts (scriptContext): the
 * names they define, the ones they use without defining (the engine's:
 * env, act, hkbFireEvent…), the functions that answer TRUE / FALSE, their
 * env / act ids, the Event_… tables of half-body events, and the behaviour
 * graph's event names.
 */
import type { Block, Chunk, Expr, FunctionExpr, Stat } from '../formats/hks/ast.ts'

export interface ScriptContext {
  /** Functions the game's script defines as globals. */
  functions: Set<string>
  /** Every global the game's scripts assign: functions, tables, constants (TRUE, HAND_RIGHT, Event_…). */
  globals: Set<string>
  /** Globals the game's scripts use without assigning them: the engine's (env, act, hkbFireEvent…) and Lua's (math, setmetatable…). */
  engine: Set<string>
  /** Functions of the game's scripts that answer TRUE or FALSE. */
  predicates: Set<string>
  /** env / act ids the game's script uses. */
  envIds: Set<number>
  actIds: Set<number>
  /** Behaviour events the graph has (action/eventnameid.txt); empty: not checked. */
  events: Set<string>
  /** Half-body events and the Event_… table the game plays each with. */
  halfBlend: Map<string, string>
  /** Each function's parameters, for wrapping one. */
  params: Map<string, string[]>
}

export interface ScriptProblem {
  line: number
  col: number
  /** Characters underlined from col. */
  length: number
  severity: 'error' | 'warning' | 'info'
  message: string
}

/**
 * Lua 5.1's base library and math: the game's scripts call setmetatable,
 * ipairs and math.* (so the base library is there); the rest of it comes
 * with it. string, table, os, io and debug may not.
 */
const BASE_LIBRARY = new Set([
  '_G',
  'assert',
  'error',
  'getmetatable',
  'ipairs',
  'next',
  'pairs',
  'pcall',
  'print',
  'rawequal',
  'rawget',
  'rawset',
  'select',
  'setmetatable',
  'tonumber',
  'tostring',
  'type',
  'unpack',
  'xpcall',
  'math',
])

/** Where an expression starts in the text (its leftmost token). */
function startOf(e: Expr): { line: number; col: number } {
  switch (e.kind) {
    case 'Call':
      return startOf(e.func)
    case 'MethodCall':
    case 'Index':
      return startOf(e.obj)
    case 'Binary':
      return startOf(e.left)
    default:
      return { line: e.line ?? 1, col: e.col ?? 1 }
  }
}

/** The name a call calls, when it's a plain global name (or null). */
const calleeName = (e: Expr): string | null => (e.kind === 'Call' && e.func.kind === 'Name' ? e.func.name : null)

/**
 * Walks a chunk with its local names in scope, calling `visit` for each
 * statement and expression (with whether a name is local where it's used).
 */
interface WalkHooks {
  stat?: (s: Stat, w: Walker) => void
  expr?: (e: Expr, w: Walker) => void
  /** A condition (if, elseif, while, until, and / or / not operands). */
  cond?: (e: Expr, w: Walker) => void
  func?: (name: string | null, f: FunctionExpr, w: Walker) => void
}

class Walker {
  scopes: Set<string>[] = [new Set()]
  /** Inside a function body (not the chunk's top level). */
  depth = 0
  private on: WalkHooks
  constructor(on: WalkHooks) {
    this.on = on
  }
  isLocal(n: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(n)) return true
    return false
  }
  declare(n: string) {
    this.scopes[this.scopes.length - 1].add(n)
  }
  block(b: Block, names: string[] = []) {
    this.scopes.push(new Set(names))
    for (const s of b) this.stat(s)
    this.scopes.pop()
  }
  fn(f: FunctionExpr, name: string | null, self = false) {
    this.on.func?.(name, f, this)
    this.depth++
    this.block(f.body, [...(self ? ['self'] : []), ...f.params, ...(f.isVararg ? ['arg'] : [])])
    this.depth--
  }
  stat(s: Stat) {
    this.on.stat?.(s, this)
    switch (s.kind) {
      case 'Local':
        s.exprs.forEach((e) => this.expr(e))
        s.names.forEach((n) => this.declare(n))
        return
      case 'LocalFunction':
        this.declare(s.name)
        this.fn(s.func, s.name)
        return
      case 'FunctionStat':
        if (s.path.length > 1 && !this.isLocal(s.path[0]))
          this.expr({ kind: 'Name', name: s.path[0], line: s.line, col: s.col })
        this.fn(s.func, s.path.length === 1 && !s.method ? s.path[0] : null, !!s.method)
        return
      case 'Assign':
        s.exprs.forEach((e) => this.expr(e))
        s.targets.forEach((t) => {
          if (t.kind !== 'Name') this.expr(t)
        })
        return
      case 'CallStat':
        this.expr(s.call)
        return
      case 'Do':
        this.block(s.body)
        return
      case 'While':
        this.condition(s.cond)
        this.block(s.body)
        return
      case 'Repeat':
        // The condition sees the body's locals.
        this.scopes.push(new Set())
        for (const x of s.body) this.stat(x)
        this.condition(s.cond)
        this.scopes.pop()
        return
      case 'If':
        for (const c of s.clauses) {
          this.condition(c.cond)
          this.block(c.body)
        }
        if (s.orelse) this.block(s.orelse)
        return
      case 'NumericFor':
        this.expr(s.start)
        this.expr(s.limit)
        if (s.step) this.expr(s.step)
        this.block(s.body, [s.var])
        return
      case 'GenericFor':
        s.exprs.forEach((e) => this.expr(e))
        this.block(s.body, s.names)
        return
      case 'Return':
        s.exprs.forEach((e) => this.expr(e))
        return
      default:
        return
    }
  }
  /** A condition: its truthiness matters (and / or / not reach into it). */
  condition(e: Expr) {
    this.on.cond?.(e, this)
    if (e.kind === 'Binary' && (e.op === 'and' || e.op === 'or')) {
      // Each side is tested for truth; the walk of the sides happens in expr().
      this.on.expr?.(e, this)
      this.condition(e.left)
      this.condition(e.right)
      return
    }
    if (e.kind === 'Unary' && e.op === 'not') {
      this.on.expr?.(e, this)
      this.condition(e.operand)
      return
    }
    this.expr(e)
  }
  expr(e: Expr) {
    this.on.expr?.(e, this)
    switch (e.kind) {
      case 'Function':
        this.fn(e, null)
        return
      case 'Table':
        for (const it of e.items) {
          if (it.kind === 'Keyed') this.expr(it.key)
          this.expr(it.value)
        }
        return
      case 'Binary':
        if (e.op === 'and' || e.op === 'or') {
          this.condition(e.left)
          this.condition(e.right)
        } else {
          this.expr(e.left)
          this.expr(e.right)
        }
        return
      case 'Unary':
        if (e.op === 'not') this.condition(e.operand)
        else this.expr(e.operand)
        return
      case 'Paren':
        this.expr(e.expr)
        return
      case 'Index':
        this.expr(e.obj)
        this.expr(e.key)
        return
      case 'Call':
        this.expr(e.func)
        e.args.forEach((a) => this.expr(a))
        return
      case 'MethodCall':
        this.expr(e.obj)
        e.args.forEach((a) => this.expr(a))
        return
      default:
        return
    }
  }
}

/** The global names a statement list assigns at any depth (for "defined later in this code"). */
function assignedGlobals(chunk: Chunk): Set<string> {
  const out = new Set<string>()
  const w = new Walker({
    stat: (s, w) => {
      if (s.kind === 'FunctionStat' && s.path.length === 1 && !w.isLocal(s.path[0])) out.add(s.path[0])
      if (s.kind === 'Assign') for (const t of s.targets) if (t.kind === 'Name' && !w.isLocal(t.name)) out.add(t.name)
    },
  })
  w.block(chunk.body)
  return out
}

/** Does every `return` of this function's own body give TRUE or FALSE (and is there one)? */
function answersTrueFalse(f: FunctionExpr): boolean {
  let returns = 0
  let others = 0
  const visit = (b: Block) => {
    for (const s of b) {
      if (s.kind === 'Return') {
        returns++
        const e = s.exprs[0]
        if (s.exprs.length !== 1 || e.kind !== 'Name' || (e.name !== 'TRUE' && e.name !== 'FALSE')) others++
      } else if (s.kind === 'If') {
        s.clauses.forEach((c) => visit(c.body))
        if (s.orelse) visit(s.orelse)
      } else if (
        s.kind === 'Do' ||
        s.kind === 'While' ||
        s.kind === 'Repeat' ||
        s.kind === 'NumericFor' ||
        s.kind === 'GenericFor'
      )
        visit(s.body)
    }
  }
  visit(f.body)
  return returns > 0 && others === 0
}

/** What the checks know, from the game's scripts (parsed) and the behaviour graph's events. */
export function scriptContext(chunks: Chunk[], events: Set<string> = new Set()): ScriptContext {
  const ctx: ScriptContext = {
    functions: new Set(),
    globals: new Set(),
    engine: new Set(),
    predicates: new Set(),
    envIds: new Set(),
    actIds: new Set(),
    events,
    halfBlend: new Map(),
    params: new Map(),
  }
  const reads = new Set<string>()
  // Names the scripts call or index (env(…), math.abs…): the engine's, when they never define them.
  const used = new Set<string>()
  for (const chunk of chunks) {
    const w = new Walker({
      stat: (s, w) => {
        if (s.kind === 'FunctionStat' && s.path.length === 1 && !s.method && !w.isLocal(s.path[0])) {
          ctx.functions.add(s.path[0])
          ctx.globals.add(s.path[0])
          ctx.params.set(s.path[0], [...s.func.params, ...(s.func.isVararg ? ['...'] : [])])
          if (answersTrueFalse(s.func)) ctx.predicates.add(s.path[0])
        }
        if (s.kind === 'Assign')
          s.targets.forEach((t, i) => {
            if (t.kind !== 'Name' || w.isLocal(t.name)) return
            ctx.globals.add(t.name)
            const v = s.exprs[i]
            if (v?.kind === 'Function') {
              ctx.functions.add(t.name)
              ctx.params.set(t.name, [...v.params, ...(v.isVararg ? ['...'] : [])])
              if (answersTrueFalse(v)) ctx.predicates.add(t.name)
            }
            // Event_X = {"W_X", default states…}: a half-body event.
            const first = v?.kind === 'Table' ? v.items[0] : undefined
            if (t.name.startsWith('Event_') && first?.kind === 'Positional' && first.value.kind === 'String')
              ctx.halfBlend.set(first.value.value, t.name)
          })
      },
      expr: (e, w) => {
        if (e.kind === 'Name' && !w.isLocal(e.name)) reads.add(e.name)
        if ((e.kind === 'Call' || e.kind === 'Index') && (e.kind === 'Call' ? e.func : e.obj).kind === 'Name')
          used.add(((e.kind === 'Call' ? e.func : e.obj) as { name: string }).name)
        if (e.kind === 'MethodCall' && e.obj.kind === 'Name') used.add(e.obj.name)
        const callee = calleeName(e)
        if ((callee === 'env' || callee === 'act') && e.kind === 'Call' && e.args[0]?.kind === 'Number')
          (callee === 'env' ? ctx.envIds : ctx.actIds).add(e.args[0].value)
      },
    })
    w.block(chunk.body)
  }
  // Only what they call or index: other undefined names they read are slips of theirs (they read as the catch-all's function).
  for (const n of reads) if (!ctx.globals.has(n) && used.has(n)) ctx.engine.add(n)
  return ctx
}

/** A number literal as written in the source (the parsed value is already a 32-bit float). */
function writtenNumber(
  lines: string[] | null,
  line: number | undefined,
  col: number | undefined,
): { text: string; value: number } | null {
  if (!lines || !line || !col) return null
  const m = /^(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)/.exec(
    (lines[line - 1] ?? '').slice(col - 1),
  )
  return m ? { text: m[1], value: Number(m[1]) } : null
}

const TRUTHY_NOTE = 'gives 0 or 1 (the game’s FALSE and TRUE), and Lua counts 0 as true, so this is always taken'

/**
 * Checks a script's parsed code against what the game's scripts are (see
 * the file's comment). `source`: its text, for numbers as written.
 */
export function lintHks(chunk: Chunk, ctx: ScriptContext, source?: string): ScriptProblem[] {
  const out: ScriptProblem[] = []
  const lines = source !== undefined ? source.replace(/\r\n?/g, '\n').split('\n') : null
  const add = (
    at: { line?: number; col?: number },
    length: number,
    severity: ScriptProblem['severity'],
    message: string,
  ) => out.push({ line: at.line ?? 1, col: at.col ?? 1, length: Math.max(1, length), severity, message })
  const own = assignedGlobals(chunk)
  const unknownSeen = new Map<string, number>()
  const w = new Walker({
    stat: (s, w) => {
      // Definitions of the game's functions and globals.
      if (
        s.kind === 'FunctionStat' &&
        s.path.length === 1 &&
        !s.method &&
        !w.isLocal(s.path[0]) &&
        ctx.functions.has(s.path[0])
      )
        add(
          { line: s.line, col: s.col },
          8,
          'info',
          `This replaces the game’s ${s.path[0]}: game updates won’t reach it. To change only part of what it does, wrap it instead (Insert ▸ Wrap a game function).`,
        )
      if (s.kind === 'Assign')
        s.targets.forEach((t, i) => {
          if (t.kind !== 'Name' || w.isLocal(t.name)) return
          const v = s.exprs[i]
          if (ctx.functions.has(t.name)) {
            const wraps = v?.kind === 'Function'
            if (!wraps)
              add(
                t,
                t.name.length,
                'warning',
                `${t.name} is one of the game’s functions: this replaces it with something that isn’t a function.`,
              )
          } else if (ctx.globals.has(t.name) && !/^g_|^c_/.test(t.name))
            add(
              t,
              t.name.length,
              'warning',
              `${t.name} is set by the game’s script (used all through it): changing it changes the game’s behaviour everywhere.`,
            )
          else if (ctx.engine.has(t.name) || BASE_LIBRARY.has(t.name))
            add(
              t,
              t.name.length,
              'warning',
              `${t.name} is one of the game’s (or Lua’s) own functions: this replaces it.`,
            )
        })
      // Lua's true / false where the game expects TRUE / FALSE.
      if (
        s.kind === 'Return' &&
        w.depth > 0 &&
        s.exprs.length === 1 &&
        (s.exprs[0].kind === 'True' || s.exprs[0].kind === 'False')
      )
        add(
          s.exprs[0],
          s.exprs[0].kind === 'True' ? 4 : 5,
          'warning',
          `The game’s code checks answers with == TRUE: return ${s.exprs[0].kind === 'True' ? 'TRUE' : 'FALSE'} (the numbers 1 and 0), not ${s.exprs[0].kind === 'True' ? 'true' : 'false'}.`,
        )
    },
    cond: (e) => {
      const callee = calleeName(e)
      if (callee === 'env') add(startOf(e), 3, 'warning', `env(…) ${TRUTHY_NOTE}: compare it, env(…) == TRUE.`)
      else if (callee && ctx.predicates.has(callee))
        add(startOf(e), callee.length, 'warning', `${callee}() ${TRUTHY_NOTE}: write ${callee}(…) == TRUE.`)
      else if (e.kind === 'Name' && (e.name === 'TRUE' || e.name === 'FALSE'))
        add(
          e,
          e.name.length,
          'warning',
          `${e.name} is a number (${e.name === 'TRUE' ? 1 : 0}), and Lua counts any number as true: this condition is always taken.`,
        )
    },
    expr: (e, w) => {
      switch (e.kind) {
        case 'Name': {
          if (
            w.isLocal(e.name) ||
            own.has(e.name) ||
            ctx.globals.has(e.name) ||
            ctx.engine.has(e.name) ||
            BASE_LIBRARY.has(e.name)
          )
            return
          const n = (unknownSeen.get(e.name) ?? 0) + 1
          unknownSeen.set(e.name, n)
          if (n <= 3)
            add(
              e,
              e.name.length,
              'warning',
              `${e.name} isn’t defined in the game’s scripts or this one. The script’s catch-all turns an unknown name into a do-nothing function, so a misspelt name fails without an error.`,
            )
          return
        }
        case 'Number': {
          const w = writtenNumber(lines, e.line, e.col)
          const v = w ? w.value : e.value
          if (Number.isInteger(v) && Math.abs(v) > 16_777_216)
            add(
              e,
              w?.text.length ?? String(v).length,
              'warning',
              `The game’s numbers are 32-bit floats: above 16,777,216 not every whole number exists${Math.fround(v) !== v ? `, and ${w?.text ?? v} becomes ${Math.fround(v)}` : ''}. Keep ids the script tests below that.`,
            )
          return
        }
        case 'Binary': {
          if (
            (e.op === '==' || e.op === '~=') &&
            [e.left, e.right].some((x) => x.kind === 'True' || x.kind === 'False')
          ) {
            const b = [e.left, e.right].find((x) => x.kind === 'True' || x.kind === 'False')!
            add(
              b,
              b.kind === 'True' ? 4 : 5,
              'warning',
              `The game’s answers are the numbers TRUE (1) and FALSE (0), never Lua’s true / false: compare with ${b.kind === 'True' ? 'TRUE' : 'FALSE'}.`,
            )
          }
          return
        }
        case 'Call': {
          const callee = calleeName(e)
          const first = e.args[0]
          if ((callee === 'env' || callee === 'act') && first?.kind === 'Number') {
            const known = callee === 'env' ? ctx.envIds : ctx.actIds
            if (known.size && !known.has(first.value))
              add(
                first,
                String(first.value).length,
                'info',
                `${callee}(${first.value}, …) isn’t used anywhere in the game’s script: check the id.`,
              )
          }
          // Half-body events played on the whole body.
          for (const a of e.args)
            if (
              a.kind === 'String' &&
              (callee === 'ExecEventAllBody' || callee === 'ExecEvent') &&
              ctx.halfBlend.has(a.value) &&
              (!ctx.events.size || ctx.events.has(a.value))
            )
              add(
                a,
                a.value.length + 2,
                'info',
                `${a.value} is a half-body event: the game plays it with ExecEventHalfBlend(${ctx.halfBlend.get(a.value)}, blend_type), the upper and lower body apart.`,
              )
          return
        }
        case 'String': {
          // Events by name, wherever they're written (passed, or kept in a variable like ExecAttack's r1).
          if (/^W_[A-Za-z0-9_]+$/.test(e.value) && ctx.events.size && !ctx.events.has(e.value))
            add(
              e,
              e.value.length + 2,
              'warning',
              `The behaviour graph has no event ${e.value}: playing an unknown event can crash the game.`,
            )
          return
        }
        default:
          return
      }
    },
  })
  w.block(chunk.body)
  return out.sort((a, b) => a.line - b.line || a.col - b.col)
}
