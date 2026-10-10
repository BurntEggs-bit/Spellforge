/**
 * Parses HavokScript source into a syntax tree (ast.ts): Lua 5.1's grammar,
 * as the game's compiler accepts it, with Lua's own error messages prefixed
 * by line:column ("12:5: 'end' expected (to close 'if' at line 10) near
 * 'else'"). Spellforge checks edited scripts with it before saving: a broken
 * c0000.hks fails silently in game.
 *
 * The rules follow lparser.c: `return` and `break` end a block, `...` only
 * inside a vararg function, `break` only inside a loop, a call's ( must be
 * on the same line as the called expression ("ambiguous syntax"), only
 * names, fields and indexes can be assigned to. HavokScript's structure
 * syntax (hstructure, hmake) is reserved and not supported; Elden Ring's
 * scripts don't use it. Limits that only the code generator sees (registers,
 * locals, upvalues) are checked by compileHks.
 *
 * Credit: Lua 5.1 (Lua.org, PUC-Rio): the grammar, lexical rules and operator
 * priorities are its.
 */
import type { Block, Chunk, Expr, FunctionExpr, IfClause, Stat, TableItem, BinaryOp, UnaryOp, CallExpr } from './ast.ts'
import { HksSyntaxError, tokenize, tokenText, type Token } from './lexer.ts'

const BINARY: Record<string, [number, number]> = {
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
const MAX_DEPTH = 200

interface FuncState {
  isVararg: boolean
  loops: number
}

class Parser {
  toks: Token[]
  p = 0
  t: Token
  fs: FuncState = { isVararg: true, loops: 0 }
  depth = 0

  constructor(source: string) {
    this.toks = tokenize(source)
    this.t = this.toks[0]
  }

  error(msg: string, tok: Token = this.t): never {
    throw new HksSyntaxError(`${msg} near '${tokenText(tok)}'`, tok.line, tok.col)
  }

  next() {
    if (this.t.type !== 'eof') this.t = this.toks[++this.p]
  }

  peek(): Token {
    return this.toks[Math.min(this.p + 1, this.toks.length - 1)]
  }

  is(value: string): boolean {
    return (this.t.type === 'op' || this.t.type === 'keyword') && this.t.value === value
  }

  test(value: string): boolean {
    if (!this.is(value)) return false
    this.next()
    return true
  }

  check(value: string) {
    if (!this.is(value)) this.error(`'${value}' expected`)
  }

  checkNext(value: string) {
    this.check(value)
    this.next()
  }

  checkMatch(what: string, who: string, line: number) {
    if (this.test(what)) return
    if (line === this.t.line) this.error(`'${what}' expected`)
    this.error(`'${what}' expected (to close '${who}' at line ${line})`)
  }

  name(): string {
    if (this.t.type !== 'name') {
      if (this.t.type === 'keyword' && (this.t.value === 'hstructure' || this.t.value === 'hmake'))
        this.error(`'${this.t.value}' is reserved in HavokScript`)
      this.error("'<name>' expected")
    }
    const v = this.t.value
    this.next()
    return v
  }

  enter() {
    if (++this.depth > MAX_DEPTH) this.error('chunk has too many syntax levels')
  }

  leave() {
    this.depth--
  }

  blockFollow(): boolean {
    if (this.t.type === 'eof') return true
    return (
      this.t.type === 'keyword' &&
      (this.t.value === 'else' || this.t.value === 'elseif' || this.t.value === 'end' || this.t.value === 'until')
    )
  }

  // chunk -> { stat [';'] }
  chunk(): Block {
    const body: Block = []
    this.enter()
    let last = false
    while (!last && !this.blockFollow()) {
      const s = this.statement()
      last = s.kind === 'Return' || s.kind === 'Break'
      body.push(s)
      this.test(';')
    }
    this.leave()
    return body
  }

  block(): Block {
    return this.chunk()
  }

  statement(): Stat {
    const line = this.t.line
    const col = this.t.col
    const pos = { line, col }
    if (this.t.type === 'keyword') {
      switch (this.t.value) {
        case 'if':
          return this.ifStat(pos)
        case 'while': {
          this.next()
          const cond = this.expr()
          this.checkNext('do')
          const body = this.loopBlock()
          this.checkMatch('end', 'while', line)
          return { kind: 'While', cond, body, ...pos }
        }
        case 'do': {
          this.next()
          const body = this.block()
          this.checkMatch('end', 'do', line)
          return { kind: 'Do', body, ...pos }
        }
        case 'for':
          return this.forStat(pos)
        case 'repeat': {
          this.next()
          const body = this.loopBlock()
          this.checkMatch('until', 'repeat', line)
          const cond = this.expr()
          return { kind: 'Repeat', body, cond, ...pos }
        }
        case 'function': {
          this.next()
          const path = [this.name()]
          let method: string | null = null
          while (this.test('.')) path.push(this.name())
          if (this.test(':')) method = this.name()
          const func = this.body(method !== null, line)
          return { kind: 'FunctionStat', path, method, func, ...pos }
        }
        case 'local': {
          this.next()
          if (this.test('function')) {
            const name = this.name()
            const func = this.body(false, this.t.line)
            return { kind: 'LocalFunction', name, func, ...pos }
          }
          const names: string[] = []
          do names.push(this.name())
          while (this.test(','))
          const exprs = this.test('=') ? this.exprList() : []
          return { kind: 'Local', names, exprs, ...pos }
        }
        case 'return': {
          this.next()
          const exprs = this.blockFollow() || this.is(';') ? [] : this.exprList()
          return { kind: 'Return', exprs, ...pos }
        }
        case 'break': {
          if (!this.fs.loops) this.error('no loop to break')
          this.next()
          return { kind: 'Break', ...pos }
        }
        case 'hstructure':
        case 'hmake':
          this.error('HavokScript structures are not supported')
      }
    }
    return this.exprStat(pos)
  }

  loopBlock(): Block {
    this.fs.loops++
    try {
      return this.block()
    } finally {
      this.fs.loops--
    }
  }

  ifStat(pos: { line: number; col: number }): Stat {
    const clauses: IfClause[] = []
    const clause = () => {
      const at = { line: this.t.line, col: this.t.col }
      this.next()
      const cond = this.expr()
      this.checkNext('then')
      clauses.push({ cond, body: this.block(), ...at })
    }
    clause()
    while (this.is('elseif')) clause()
    let orelse: Block | null = null
    if (this.test('else')) orelse = this.block()
    const endLine = this.t.line
    this.checkMatch('end', 'if', pos.line)
    return { kind: 'If', clauses, orelse, endLine, ...pos }
  }

  forStat(pos: { line: number; col: number }): Stat {
    this.next()
    const first = this.name()
    if (this.test('=')) {
      const start = this.expr()
      this.checkNext(',')
      const limit = this.expr()
      const step = this.test(',') ? this.expr() : null
      this.checkNext('do')
      const body = this.loopBlock()
      this.checkMatch('end', 'for', pos.line)
      return { kind: 'NumericFor', var: first, start, limit, step, body, ...pos }
    }
    if (this.is(',') || this.is('in')) {
      const names = [first]
      while (this.test(',')) names.push(this.name())
      this.checkNext('in')
      const exprs = this.exprList()
      this.checkNext('do')
      const body = this.loopBlock()
      this.checkMatch('end', 'for', pos.line)
      return { kind: 'GenericFor', names, exprs, body, ...pos }
    }
    this.error("'=' or 'in' expected")
  }

  exprStat(pos: { line: number; col: number }): Stat {
    const e = this.primaryExpr()
    // A call is a statement on its own (as in lparser.c: `f() = 1` fails at the '=').
    if (e.kind === 'Call' || e.kind === 'MethodCall') return { kind: 'CallStat', call: e, ...pos }
    const targets: Expr[] = [e]
    while (this.test(',')) targets.push(this.primaryExpr())
    for (const t of targets) if (t.kind !== 'Name' && t.kind !== 'Index') this.error('syntax error')
    this.checkNext('=')
    const exprs = this.exprList()
    return { kind: 'Assign', targets, exprs, ...pos }
  }

  exprList(): Expr[] {
    const list = [this.expr()]
    while (this.test(',')) list.push(this.expr())
    return list
  }

  body(isMethod: boolean, line: number): FunctionExpr {
    const pos = { line, col: this.t.col }
    this.checkNext('(')
    const params: string[] = isMethod ? ['self'] : []
    let isVararg = false
    if (!this.is(')')) {
      do {
        if (this.is('...')) {
          this.next()
          isVararg = true
          break
        }
        if (this.t.type !== 'name') this.error("'<name>' or '...' expected")
        params.push(this.name())
      } while (this.test(','))
    }
    this.checkNext(')')
    const saved = this.fs
    this.fs = { isVararg, loops: 0 }
    const body = this.chunk()
    this.fs = saved
    const endLine = this.t.line
    this.checkMatch('end', 'function', line)
    return { kind: 'Function', params, isVararg, body, endLine, ...pos }
  }

  primaryExpr(): Expr {
    // prefixexp -> NAME | '(' expr ')'
    let e: Expr
    const start = this.t
    if (this.t.type === 'name') {
      e = { kind: 'Name', name: this.t.value, line: start.line, col: start.col }
      this.next()
    } else if (this.is('(')) {
      const line = this.t.line
      this.next()
      const inner = this.expr()
      this.checkMatch(')', '(', line)
      e = { kind: 'Paren', expr: inner, line: start.line, col: start.col }
    } else this.error('unexpected symbol')
    for (;;) {
      const t = this.t
      if (this.is('.')) {
        this.next()
        const nameTok = this.t
        const name = this.name()
        e = {
          kind: 'Index',
          obj: e,
          key: { kind: 'String', value: name, line: nameTok.line, col: nameTok.col },
          line: t.line,
          col: t.col,
        }
      } else if (this.is('[')) {
        this.next()
        const key = this.expr()
        this.checkNext(']')
        e = { kind: 'Index', obj: e, key, line: t.line, col: t.col }
      } else if (this.is(':')) {
        this.next()
        const name = this.name()
        const args = this.callArgs()
        e = { kind: 'MethodCall', obj: e, name, args, line: t.line, col: t.col }
      } else if (this.is('(') || this.is('{') || this.t.type === 'string') {
        const args = this.callArgs()
        e = { kind: 'Call', func: e, args, line: t.line, col: t.col } satisfies CallExpr
      } else return e
    }
  }

  callArgs(): Expr[] {
    const t = this.t
    if (this.t.type === 'string') {
      this.next()
      return [{ kind: 'String', value: t.value, line: t.line, col: t.col }]
    }
    if (this.is('{')) return [this.table()]
    if (this.is('(')) {
      // The previous token must be on the same line as (.
      const prev = this.toks[this.p - 1]
      if (prev && prev.endLine !== t.line) this.error('ambiguous syntax (function call x new statement)')
      this.next()
      if (this.test(')')) return []
      const args = this.exprList()
      this.checkMatch(')', '(', t.line)
      return args
    }
    this.error('function arguments expected')
  }

  table(): Expr {
    const start = this.t
    const line = this.t.line
    this.checkNext('{')
    const items: TableItem[] = []
    while (!this.is('}')) {
      if (this.t.type === 'name' && this.peek().type === 'op' && this.peek().value === '=') {
        const name = this.name()
        this.next()
        items.push({ kind: 'Named', name, value: this.expr() })
      } else if (this.is('[')) {
        this.next()
        const key = this.expr()
        this.checkNext(']')
        this.checkNext('=')
        items.push({ kind: 'Keyed', key, value: this.expr() })
      } else items.push({ kind: 'Positional', value: this.expr() })
      if (!this.test(',') && !this.test(';')) break
    }
    this.checkMatch('}', '{', line)
    return { kind: 'Table', items, line: start.line, col: start.col }
  }

  simpleExpr(): Expr {
    const t = this.t
    const pos = { line: t.line, col: t.col }
    switch (t.type) {
      case 'number':
        this.next()
        return { kind: 'Number', value: t.num, ...pos }
      case 'string':
        this.next()
        return { kind: 'String', value: t.value, ...pos }
      case 'keyword':
        switch (t.value) {
          case 'nil':
            this.next()
            return { kind: 'Nil', ...pos }
          case 'true':
            this.next()
            return { kind: 'True', ...pos }
          case 'false':
            this.next()
            return { kind: 'False', ...pos }
          case 'function':
            this.next()
            return this.body(false, this.t.line)
        }
        break
      case 'op':
        if (t.value === '...') {
          if (!this.fs.isVararg) this.error("cannot use '...' outside a vararg function")
          this.next()
          return { kind: 'Vararg', ...pos }
        }
        if (t.value === '{') return this.table()
        break
    }
    return this.primaryExpr()
  }

  expr(limit = 0): Expr {
    this.enter()
    let e: Expr
    const t = this.t
    const uop =
      t.type === 'keyword' && t.value === 'not'
        ? 'not'
        : t.type === 'op' && (t.value === '-' || t.value === '#')
          ? t.value
          : null
    if (uop) {
      this.next()
      const operand = this.expr(UNARY_PRIORITY)
      e = { kind: 'Unary', op: uop as UnaryOp, operand, line: t.line, col: t.col }
    } else e = this.simpleExpr()
    for (;;) {
      const o = this.t
      const op =
        (o.type === 'op' || (o.type === 'keyword' && (o.value === 'and' || o.value === 'or'))) && BINARY[o.value]
          ? o.value
          : null
      if (!op || BINARY[op][0] <= limit) break
      this.next()
      const right = this.expr(BINARY[op][1])
      e = { kind: 'Binary', op: op as BinaryOp, left: e, right, line: o.line, col: o.col }
    }
    this.leave()
    return e
  }

  parseChunk(): Chunk {
    const body = this.chunk()
    if (this.t.type !== 'eof') this.error("'<eof>' expected")
    return { body }
  }
}

/** Parses a script; throws HksSyntaxError (with line and col) on the first error. */
export function parseHks(source: string): Chunk {
  return new Parser(source).parseChunk()
}

/** The first syntax error, or null if the script parses. */
export function checkHksSyntax(source: string): HksSyntaxError | null {
  try {
    parseHks(source)
    return null
  } catch (e) {
    if (e instanceof HksSyntaxError) return e
    throw e
  }
}
