/**
 * The syntax tree of HavokScript source (Lua 5.1 grammar), as the parser
 * builds it from text and the decompiler builds it from bytecode, and the
 * printer that turns it back into text.
 *
 * Positions (line, col; 1-based) are set by the parser; the decompiler sets
 * lines from the bytecode's line info where it has them. Strings are byte
 * strings (one char per byte). The printer writes 4-space indents and adds
 * parentheses only where Lua's operator priorities need them, so printed
 * code parses back into the same tree (which matters: a + (b + c) and
 * a + b + c compile differently).
 *
 * Credit: Lua 5.1 (Lua.org, PUC-Rio): the grammar, lexical rules and operator
 * priorities are its.
 */
import { formatFloat, quoteLuaString } from './disasm.ts'
import { KEYWORDS } from './lexer.ts'

export interface Pos {
  line?: number
  col?: number
}

export type Expr =
  | NilExpr
  | TrueExpr
  | FalseExpr
  | NumberExpr
  | StringExpr
  | VarargExpr
  | FunctionExpr
  | TableExpr
  | BinaryExpr
  | UnaryExpr
  | ParenExpr
  | NameExpr
  | IndexExpr
  | CallExpr
  | MethodCallExpr

export interface NilExpr extends Pos {
  kind: 'Nil'
}
export interface TrueExpr extends Pos {
  kind: 'True'
}
export interface FalseExpr extends Pos {
  kind: 'False'
}
export interface NumberExpr extends Pos {
  kind: 'Number'
  value: number
}
export interface StringExpr extends Pos {
  kind: 'String'
  /** Bytes, one char per byte. */
  value: string
}
export interface VarargExpr extends Pos {
  kind: 'Vararg'
}
export interface FunctionExpr extends Pos {
  kind: 'Function'
  params: string[]
  isVararg: boolean
  body: Block
  /** Line of `end`. */
  endLine?: number
}
export type TableItem = (
  | { kind: 'Positional'; value: Expr }
  | { kind: 'Named'; name: string; value: Expr }
  | { kind: 'Keyed'; key: Expr; value: Expr }
) & { line?: number }
export interface TableExpr extends Pos {
  kind: 'Table'
  items: TableItem[]
  /** Line of `}`. */
  endLine?: number
}
export type BinaryOp = 'or' | 'and' | '<' | '>' | '<=' | '>=' | '~=' | '==' | '..' | '+' | '-' | '*' | '/' | '%' | '^'
export type UnaryOp = 'not' | '-' | '#'
export interface BinaryExpr extends Pos {
  kind: 'Binary'
  op: BinaryOp
  left: Expr
  right: Expr
}
export interface UnaryExpr extends Pos {
  kind: 'Unary'
  op: UnaryOp
  operand: Expr
}
/** (expr): kept, since it truncates a call or ... to one value. */
export interface ParenExpr extends Pos {
  kind: 'Paren'
  expr: Expr
}
export interface NameExpr extends Pos {
  kind: 'Name'
  name: string
}
/** obj[key]; obj.name when the key is a string that is a valid name. */
export interface IndexExpr extends Pos {
  kind: 'Index'
  obj: Expr
  key: Expr
}
export interface CallExpr extends Pos {
  kind: 'Call'
  func: Expr
  args: Expr[]
}
export interface MethodCallExpr extends Pos {
  kind: 'MethodCall'
  obj: Expr
  name: string
  args: Expr[]
}

export type Stat =
  | LocalStat
  | LocalFunctionStat
  | FunctionStat
  | AssignStat
  | CallStat
  | DoStat
  | WhileStat
  | RepeatStat
  | IfStat
  | NumericForStat
  | GenericForStat
  | ReturnStat
  | BreakStat
  | CommentStat

export type Block = Stat[]

export interface LocalStat extends Pos {
  kind: 'Local'
  names: string[]
  exprs: Expr[]
}
export interface LocalFunctionStat extends Pos {
  kind: 'LocalFunction'
  name: string
  func: FunctionExpr
}
/** function a.b.c() / function a.b:m() */
export interface FunctionStat extends Pos {
  kind: 'FunctionStat'
  /** The name and its fields: ['a', 'b', 'c']. */
  path: string[]
  /** Method name after `:` (adds the `self` parameter). */
  method: string | null
  func: FunctionExpr
}
export interface AssignStat extends Pos {
  kind: 'Assign'
  targets: Expr[]
  exprs: Expr[]
}
export interface CallStat extends Pos {
  kind: 'CallStat'
  call: CallExpr | MethodCallExpr
}
export interface DoStat extends Pos {
  kind: 'Do'
  body: Block
  /** Line of `end`. */
  endLine?: number
}
export interface WhileStat extends Pos {
  kind: 'While'
  cond: Expr
  body: Block
  endLine?: number
}
export interface RepeatStat extends Pos {
  kind: 'Repeat'
  body: Block
  cond: Expr
}
export interface IfClause extends Pos {
  cond: Expr
  body: Block
}
export interface IfStat extends Pos {
  kind: 'If'
  clauses: IfClause[]
  orelse: Block | null
  /** Line of `end`. */
  endLine?: number
}
export interface NumericForStat extends Pos {
  kind: 'NumericFor'
  var: string
  start: Expr
  limit: Expr
  step: Expr | null
  body: Block
  endLine?: number
}
export interface GenericForStat extends Pos {
  kind: 'GenericFor'
  names: string[]
  exprs: Expr[]
  body: Block
  endLine?: number
}
export interface ReturnStat extends Pos {
  kind: 'Return'
  exprs: Expr[]
}
export interface BreakStat extends Pos {
  kind: 'Break'
}
/** A comment line (only the decompiler makes these; the parser drops comments). */
export interface CommentStat extends Pos {
  kind: 'Comment'
  text: string
}

export interface Chunk {
  body: Block
}

export const isName = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) && !KEYWORDS.has(s)

// Lua 5.1 operator priorities (lparser.c): left and right binding power.
const PRIORITY: Record<BinaryOp, [number, number]> = {
  '+': [6, 6],
  '-': [6, 6],
  '*': [7, 7],
  '/': [7, 7],
  '%': [7, 7],
  '^': [10, 9],
  '..': [5, 4],
  '==': [3, 3],
  '~=': [3, 3],
  '<': [3, 3],
  '<=': [3, 3],
  '>': [3, 3],
  '>=': [3, 3],
  and: [2, 2],
  or: [1, 1],
}
const UNARY_PRIORITY = 8

export interface PrintOptions {
  indent?: string
  /** A blank line around top-level function definitions. */
  blankLinesBetweenFunctions?: boolean
  /**
   * Put statements (and functions' `end`) on the lines their `line` /
   * `endLine` say, with blank lines in between, where the output hasn't
   * already passed them: decompiled code then keeps the original layout and
   * line numbers.
   */
  preserveLines?: boolean
}

/** A number as Lua source: the shortest float32 text; infinities as a literal that overflows to them. */
function numberText(v: number): string {
  if (v === Infinity) return '1e39'
  if (v === -Infinity) return '-1e39'
  return formatFloat(v)
}

/** Is this printed as a unary expression (for priorities)? Negative numbers are. */
const isUnaryLike = (e: Expr) => e.kind === 'Unary' || (e.kind === 'Number' && (e.value < 0 || Object.is(e.value, -0)))

/** The line an expression's first token is on, where known. */
export function firstLine(e: Expr): number | undefined {
  switch (e.kind) {
    case 'Binary':
      return firstLine(e.left) ?? e.line
    case 'Call':
      return firstLine(e.func) ?? e.line
    case 'MethodCall':
    case 'Index':
      return firstLine(e.obj) ?? e.line
    case 'Paren':
      return e.line ?? firstLine(e.expr)
    case 'Unary':
      return e.line ?? firstLine(e.operand)
    default:
      return e.line
  }
}

export class Printer {
  out: string[] = []
  indentUnit: string
  level = 0
  /** Named functions printed (function / local function statements), with their output lines. */
  functions: { name: string; line: number; endLine: number }[] = []
  blankLines: boolean
  preserveLines: boolean
  /** Line of out[0] minus one (out is a function expression's own buffer while one is printed). */
  lineBase = 0
  /** While a statement's text is built: the line its text so far ends on. */
  cur = 1

  constructor(opts: PrintOptions = {}) {
    this.indentUnit = opts.indent ?? '    '
    this.blankLines = opts.blankLinesBetweenFunctions ?? false
    this.preserveLines = opts.preserveLines ?? false
  }

  /** The line the next emitted line will have. */
  get line() {
    return this.lineBase + this.out.length + 1
  }

  /** Blank lines up to `line`, if preserving lines and not past it. */
  padTo(line: number | undefined) {
    if (!this.preserveLines || line === undefined) return
    while (this.line < line) this.out.push('')
  }

  /** Line breaks (and a deeper indent) to reach `line` inside a statement, if preserving lines and it's later. */
  brk(line: number | undefined): string {
    if (!this.preserveLines || line === undefined || line <= this.cur) return ''
    let s = ''
    while (this.cur < line) {
      s += '\n'
      this.cur++
    }
    return s + this.indentUnit.repeat(this.level + 1)
  }

  emit(text: string) {
    if (this.inlinePrefix !== null) {
      this.out.push(this.inlinePrefix + text)
      this.inlinePrefix = null
    } else this.out.push(this.indentUnit.repeat(this.level) + text)
  }

  /** The next statement continues the last line (it was on the same source line). */
  inlinePrefix: string | null = null

  /** Emits possibly multi-line text at the current indent. */
  emitLines(text: string) {
    const lines = text.split('\n')
    this.emit(lines[0])
    for (let k = 1; k < lines.length; k++) this.out.push(lines[k])
  }

  /** Starts building a statement's text (on the next output line). */
  begin() {
    this.cur = this.line
  }

  expr(e: Expr): string {
    switch (e.kind) {
      case 'Nil':
        return 'nil'
      case 'True':
        return 'true'
      case 'False':
        return 'false'
      case 'Number':
        return numberText(e.value)
      case 'String':
        return quoteLuaString(e.value)
      case 'Vararg':
        return '...'
      case 'Function':
        return this.functionExpr(e)
      case 'Table':
        return this.table(e)
      case 'Binary': {
        const [l, r] = PRIORITY[e.op]
        const left = this.needsParensLeft(e.left, l) ? `(${this.expr(e.left)})` : this.expr(e.left)
        // A break goes after the operator: the left operand's code is emitted once the operator
        // is read, so it has the operator's line.
        const b = this.brk(firstLine(e.right))
        const right = this.needsParensRight(e.right, r) ? `(${this.expr(e.right)})` : this.expr(e.right)
        return `${left} ${e.op}${b || ' '}${right}`
      }
      case 'Unary': {
        const o = e.operand
        let operand = this.expr(o)
        if ((o.kind === 'Binary' && PRIORITY[o.op][0] <= UNARY_PRIORITY) || (e.op === '-' && operand.startsWith('-')))
          operand = `(${operand})`
        return e.op === 'not' ? `not ${operand}` : `${e.op}${operand}`
      }
      case 'Paren':
        return `(${this.expr(e.expr)})`
      case 'Name':
        return e.name
      case 'Index': {
        const obj = this.prefix(e.obj)
        if (e.key.kind === 'String' && isName(e.key.value)) return `${obj}.${e.key.value}`
        return `${obj}[${this.expr(e.key)}]`
      }
      case 'Call': {
        const f = this.prefix(e.func)
        return `${f}(${this.list(e.args)})`
      }
      case 'MethodCall': {
        const o = this.prefix(e.obj)
        return `${o}:${e.name}(${this.list(e.args)})`
      }
    }
  }

  /** Comma-separated expressions, broken before any that starts on a later source line. */
  list(es: Expr[]): string {
    let s = ''
    es.forEach((e, k) => {
      const b = this.brk(firstLine(e))
      s += (k ? ',' : '') + (b || (k ? ' ' : '')) + this.expr(e)
    })
    return s
  }

  /** A prefix expression (callee, indexed object): anything but a name, index or call needs parentheses. */
  prefix(e: Expr): string {
    if (e.kind === 'Name' || e.kind === 'Index' || e.kind === 'Call' || e.kind === 'MethodCall' || e.kind === 'Paren')
      return this.expr(e)
    return `(${this.expr(e)})`
  }

  needsParensLeft(e: Expr, parentLeft: number): boolean {
    if (e.kind === 'Binary') return parentLeft > PRIORITY[e.op][1]
    if (isUnaryLike(e)) return parentLeft > UNARY_PRIORITY
    return false
  }

  needsParensRight(e: Expr, parentRight: number): boolean {
    if (e.kind === 'Binary') return !(PRIORITY[e.op][0] > parentRight)
    return false
  }

  tableItem(it: TableItem): string {
    if (it.kind === 'Positional') return this.expr(it.value)
    if (it.kind === 'Named') return `${it.name} = ${this.expr(it.value)}`
    return `[${this.expr(it.key)}] = ${this.expr(it.value)}`
  }

  table(t: TableExpr): string {
    if (!t.items.length) return '{}'
    if (this.preserveLines) {
      // Items on the lines they were on; `}` on its line.
      let s = '{'
      t.items.forEach((it, k) => {
        const b = this.brk(it.line ?? (it.kind === 'Keyed' ? firstLine(it.key) : firstLine(it.value)))
        s += (k ? ',' : '') + (b || (k ? ' ' : '')) + this.tableItem(it)
      })
      const b = this.brk(t.endLine)
      return s + (b ? b.slice(0, b.length - this.indentUnit.length) : '') + '}'
    }
    const flat = `{${t.items.map((it) => this.tableItem(it)).join(', ')}}`
    if (flat.length <= 100 && !flat.includes('\n')) return flat
    // Long tables over several lines, one level deeper; short items share lines.
    this.level++
    const items = t.items.map((it) => this.tableItem(it))
    this.level--
    const pad = this.indentUnit.repeat(this.level + 1)
    const lines: string[] = []
    const short = items.every((s) => s.length <= 24 && !s.includes('\n'))
    for (const s of items) {
      const last = lines.length - 1
      if (short && last >= 0 && lines[last].length + s.length + 2 <= 100) lines[last] += `, ${s}`
      else lines.push(pad + s)
    }
    return `{\n${lines.join(',\n')}\n${this.indentUnit.repeat(this.level)}}`
  }

  params(f: FunctionExpr): string {
    const p = [...f.params]
    if (f.isVararg) p.push('...')
    return p.join(', ')
  }

  /** An anonymous function, printed inline with its body indented one level deeper. */
  functionExpr(f: FunctionExpr): string {
    // A function that was all on one line (`function(p) return p end`) stays on one line.
    const oneLine =
      this.preserveLines && f.endLine !== undefined && f.endLine === this.cur && (!f.line || f.line === this.cur)
    const saved = this.out
    const savedLevel = this.level
    const savedBase = this.lineBase
    // Its header is on the line being built; the body follows.
    this.lineBase = this.cur
    this.out = []
    this.level = savedLevel + 1
    this.block(f.body)
    this.padTo(f.endLine)
    const body = this.out
    this.out = saved
    this.level = savedLevel
    this.lineBase = savedBase
    if (!body.length) return `function(${this.params(f)}) end`
    if (oneLine)
      return `function(${this.params(f)}) ${body
        .map((l) => l.trim())
        .filter((l) => l)
        .join(' ')} end`
    this.cur += body.length + 1
    return `function(${this.params(f)})\n${body.join('\n')}\n${this.indentUnit.repeat(savedLevel)}end`
  }

  funcBody(header: string, f: FunctionExpr, name: string) {
    const line = this.line
    this.emit(header)
    this.level++
    this.block(f.body)
    this.level--
    this.padTo(f.endLine)
    this.emit('end')
    this.functions.push({ name, line, endLine: this.line - 1 })
  }

  /** `keyword expr keyword2` on the current line(s). */
  head(before: string, e: Expr, after: string) {
    this.begin()
    this.emitLines(`${before}${this.expr(e)}${after}`)
  }

  body(b: Block) {
    this.level++
    this.block(b)
    this.level--
  }

  /** `end` of a block: on its source line when known (appended if that's the line just printed). */
  end(line: number | undefined) {
    const prev = this.out[this.out.length - 1]
    if (
      this.preserveLines &&
      line !== undefined &&
      line === this.line - 1 &&
      prev?.trim() &&
      !prev.trimStart().startsWith('--')
    )
      this.out[this.out.length - 1] += ' end'
    else {
      this.padTo(line)
      this.emit('end')
    }
  }

  block(b: Block) {
    const isFn = (s: Stat) => s.kind === 'FunctionStat' || s.kind === 'LocalFunction'
    for (let k = 0; k < b.length; k++) {
      let inlined: string | null = null
      if (this.preserveLines) {
        // A statement that was on the same source line as the last one printed goes on that line too.
        const prev = this.out[this.out.length - 1]
        if (
          b[k].line !== undefined &&
          b[k].line === this.line - 1 &&
          prev?.trim() &&
          !prev.trimStart().startsWith('--')
        )
          inlined = this.inlinePrefix = this.out.pop()! + ' '
        else this.padTo(b[k].line)
      } else if (this.blankLines && this.level === 0 && k > 0 && (isFn(b[k]) || isFn(b[k - 1]))) this.out.push('')
      const start = this.out.length
      this.stat(b[k])
      // A statement starting with ( would read as a call of the previous line's expression: end that one with ;
      if (inlined !== null) {
        const rest = this.out[start].slice(inlined.length)
        if (k > 0 && rest.startsWith('(')) this.out[start] = `${inlined.trimEnd()}; ${rest}`
      } else if (k > 0 && this.out[start]?.trimStart().startsWith('(')) {
        let p = start - 1
        while (p >= 0 && this.out[p] === '') p--
        if (p >= 0) this.out[p] += ';'
      }
    }
  }

  stat(s: Stat) {
    this.begin()
    switch (s.kind) {
      case 'Local':
        if (s.exprs.length) this.emitLines(`local ${s.names.join(', ')} = ${this.list(s.exprs)}`)
        else this.emit(`local ${s.names.join(', ')}`)
        return
      case 'LocalFunction':
        this.funcBody(`local function ${s.name}(${this.params(s.func)})`, s.func, s.name)
        return
      case 'FunctionStat': {
        const name = s.path.join('.') + (s.method ? `:${s.method}` : '')
        this.funcBody(`function ${name}(${this.params(s.func)})`, s.func, name)
        return
      }
      case 'Assign': {
        const targets = this.list(s.targets)
        this.emitLines(`${targets} = ${this.list(s.exprs)}`)
        return
      }
      case 'CallStat':
        this.emitLines(this.expr(s.call))
        return
      case 'Do':
        this.emit('do')
        this.body(s.body)
        this.end(s.endLine)
        return
      case 'While':
        this.head('while ', s.cond, ' do')
        this.body(s.body)
        this.end(s.endLine)
        return
      case 'Repeat':
        this.emit('repeat')
        this.body(s.body)
        this.head('until ', s.cond, '')
        return
      case 'If':
        s.clauses.forEach((c, k) => {
          if (k) this.padTo(c.line)
          this.head(k ? 'elseif ' : 'if ', c.cond, ' then')
          this.body(c.body)
        })
        if (s.orelse) {
          this.emit('else')
          this.body(s.orelse)
        }
        this.end(s.endLine)
        return
      case 'NumericFor': {
        const parts = [s.start, s.limit]
        if (s.step) parts.push(s.step)
        this.emitLines(`for ${s.var} = ${this.list(parts)} do`)
        this.body(s.body)
        this.end(s.endLine)
        return
      }
      case 'GenericFor':
        this.emitLines(`for ${s.names.join(', ')} in ${this.list(s.exprs)} do`)
        this.body(s.body)
        this.end(s.endLine)
        return
      case 'Return':
        this.emitLines(s.exprs.length ? `return ${this.list(s.exprs)}` : 'return')
        return
      case 'Break':
        this.emit('break')
        return
      case 'Comment':
        for (const l of s.text.split('\n')) this.emit(`-- ${l}`)
        return
    }
  }

  text(): string {
    return this.out.join('\n') + '\n'
  }
}
