/**
 * Decompiles HavokScript bytecode into source text that compiles back to the
 * same instructions (compileHks, and so the game's compiler): the hks suite
 * decompiles every retail script, recompiles it and compares each function.
 *
 * The scripts keep their debug info, which settles most of what a Lua
 * decompiler has to guess: every local's name, register and scope (start and
 * end instruction), upvalue names and function names. So the output declares
 * the same locals in the same places (with do ... end where a scope ends
 * early), uses `function Name()` where the function was named that way, and
 * `local function` likewise.
 *
 * Per function:
 *   - instructions are normalised (_BK, _R1, _S/_N, GETFIELD, CALL_I...
 *     variants folded into GETTABLE, SETTABLE, CALL...; DATA belongs to the
 *     instruction before it);
 *   - expressions are rebuilt by folding: a value written to a temporary
 *     register waits there until an instruction consumes it; a write to a
 *     local's register is an assignment; locals are declared where their
 *     scope starts, from the values waiting in their registers; stores made
 *     while values still wait are one multiple assignment;
 *   - control flow follows the compiler's patterns: a test (EQ/LT/LE/TEST)
 *     plus JMP is one condition unit; an if's units jump to the then-block
 *     (true) or past it (false), a then-block ending in a JMP has an else;
 *     loops come from FORPREP/FORLOOP, TFORLOOP and backward jumps; a jump
 *     the compiler threaded through a following JMP (an if at the end of a
 *     then-block jumps straight to the outer if's end) counts as a jump to
 *     where that JMP goes;
 *   - and/or/not conditions are rebuilt by finding, for a run of units, the
 *     split into `L and R` / `L or R` whose jump targets agree (De Morgan:
 *     `not (a and b)` comes out as `not a or not b`, which compiles the
 *     same); a nested if that compiles like `and` is folded into it. and/or
 *     used as values (TESTSET, TEST on the result register, LOADBOOL pairs)
 *     the same way, with the value written where the jumps meet;
 *   - where more than one structure fits the jumps, the likelier one is tried
 *     first and the next one if its blocks don't decompile.
 *
 * Numbers are float32 and print as the shortest text that reads back as the
 * same float. A function that can't be decompiled is written as an empty
 * stub with a comment saying why, and reported in `failures`.
 */
import type { HksChunk, HksConstant, HksProto } from './bytecode.ts'
import { BITRK, OP, OP_INFO, OP_NAMES, argA, argB, argBx, argC, opOf } from './opcodes.ts'
import {
  Printer,
  firstLine,
  isName,
  type BinaryOp,
  type Block,
  type Expr,
  type FunctionExpr,
  type Stat,
  type TableItem,
} from './ast.ts'

export interface DecompileResult {
  text: string
  /** Named functions in the text (function / local function statements) and their lines. */
  functions: { name: string; line: number; endLine: number }[]
  /** Functions that couldn't be decompiled (written as stubs). */
  failures: { name: string; reason: string }[]
}

class DecompileError extends Error {}
const fail = (msg: string): never => {
  throw new DecompileError(msg)
}

// ---- instructions ----

interface Ins {
  op: number
  a: number
  /** B, with BITRK set when it is a constant (the _BK forms, SETFIELD's key). */
  b: number
  /** C, with BITRK set when it is a constant. */
  c: number
  bx: number
  sbx: number
}

/** One instruction with its variants folded into the base opcode. */
function decode(i: number): Ins {
  let op = opOf(i)
  const a = argA(i)
  let b = argB(i)
  let c = argC(i)
  const bx = argBx(i)
  switch (op) {
    case OP.EQ_BK:
    case OP.LT_BK:
    case OP.LE_BK:
    case OP.ADD_BK:
    case OP.SUB_BK:
    case OP.MUL_BK:
    case OP.DIV_BK:
    case OP.MOD_BK:
    case OP.POW_BK:
      op -= 1
      b |= BITRK
      break
    case OP.SETTABLE_BK:
    case OP.SETTABLE_S_BK:
    case OP.SETTABLE_N_BK:
    case OP.SETFIELD:
    case OP.SETFIELD_R1:
      op = OP.SETTABLE
      b |= BITRK
      break
    case OP.SETTABLE_S:
    case OP.SETTABLE_N:
      op = OP.SETTABLE
      break
    case OP.GETFIELD:
    case OP.GETFIELD_R1:
    case OP.GETFIELD_MM:
      op = OP.GETTABLE
      c |= BITRK
      break
    case OP.GETTABLE_S:
    case OP.GETTABLE_N:
      op = OP.GETTABLE
      break
    case OP.CALL_I:
    case OP.CALL_I_R1:
    case OP.CALL_C:
    case OP.CALL_M:
      op = OP.CALL
      break
    case OP.TAILCALL_I:
    case OP.TAILCALL_I_R1:
    case OP.TAILCALL_C:
    case OP.TAILCALL_M:
      op = OP.TAILCALL
      break
    case OP.GETGLOBAL_MEM:
      op = OP.GETGLOBAL
      break
    case OP.TEST_R1:
      op = OP.TEST
      break
    case OP.NOT_R1:
      op = OP.NOT
      break
    case OP.SETUPVAL_R1:
      op = OP.SETUPVAL
      break
  }
  return { op, a, b, c, bx, sbx: bx - 0xffff }
}

const isTestOp = (op: number) => op === OP.EQ || op === OP.LT || op === OP.LE || op === OP.TEST || op === OP.TESTSET
const isK = (x: number) => (x & BITRK) !== 0
const ARITH: Record<number, BinaryOp> = {
  [OP.ADD]: '+',
  [OP.SUB]: '-',
  [OP.MUL]: '*',
  [OP.DIV]: '/',
  [OP.MOD]: '%',
  [OP.POW]: '^',
}

/** Does the instruction write register r? */
function writes(ins: Ins, r: number): boolean {
  switch (ins.op) {
    case OP.LOADNIL:
      return r >= ins.a && r <= (ins.b & 0xff)
    case OP.CALL:
      return ins.c === 0 ? r >= ins.a : r >= ins.a && r <= ins.a + ins.c - 2
    case OP.VARARG:
      return ins.b === 0 ? r >= ins.a : r >= ins.a && r <= ins.a + ins.b - 2
    case OP.SELF:
      return r === ins.a || r === ins.a + 1
    case OP.SETGLOBAL:
    case OP.SETTABLE:
    case OP.SETUPVAL:
    case OP.JMP:
    case OP.RETURN:
    case OP.TAILCALL:
    case OP.SETLIST:
    case OP.CLOSE:
    case OP.DATA:
    case OP.EQ:
    case OP.LT:
    case OP.LE:
    case OP.TEST:
      return false
    default:
      return r === ins.a
  }
}

// ---- locals ----

interface Local {
  name: string
  reg: number
  start: number
  end: number
}

/**
 * Each local's register: its depth in the stack of live locals when it
 * starts. A local that ends exactly where an empty-scoped one starts is
 * either still live or just gone; the instruction before tells which (it
 * wrote the new local's register).
 */
function assignLocals(f: HksProto, code: Ins[]): Local[] {
  const raw = f.debug?.locals ?? []
  const out: Local[] = []
  const stack: Local[] = []
  for (let i = 0; i < raw.length;) {
    let j = i + 1
    while (j < raw.length && raw[j].start === raw[i].start) j++
    const s = raw[i].start
    const groupLen = j - i
    const allEmpty = raw.slice(i, j).every((l) => l.end === l.start)
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (top.end < s) {
        stack.pop()
        continue
      }
      if (top.end === s) {
        if (!allEmpty) {
          stack.pop()
          continue
        }
        let p = s - 1
        while (p > 0 && code[p].op === OP.DATA) p--
        const w = code[p]
        // (A table constructor's last instruction fills the table rather than writing its register.)
        const r = stack.length + groupLen - 1
        if (w && (writes(w, r) || ((w.op === OP.SETTABLE || w.op === OP.SETLIST) && w.a === r))) break
        stack.pop()
        continue
      }
      break
    }
    for (let k = i; k < j; k++) {
      const l: Local = { name: raw[k].name, reg: stack.length, start: raw[k].start, end: raw[k].end }
      out.push(l)
      stack.push(l)
    }
    i = j
  }
  return out
}

// ---- values waiting in registers ----

interface TableBuild {
  reg: number
  /** Line of NEWTABLE. */
  line?: number
  /** Items in source order; { reg } are list items not yet stored by SETLIST. */
  items: (TableItem | { reg: number })[]
  placed: Set<number>
  endLine?: number
}

interface Pend {
  e: Expr
  /** All results (CALL C=0, VARARG B=0). */
  open?: boolean
  /** Base of a call/vararg with this many results (2 or more). */
  nres?: number
  /** One of the extra results of the multiple-result value based at this register. */
  cont?: number
  /** A call/vararg cut to one result. */
  single?: boolean
  /** SELF's function slot: e is the object, selfName the method. */
  selfName?: string
  /** SELF's object slot. */
  selfObj?: boolean
  table?: TableBuild
  /** From LOADNIL. */
  nil?: boolean
  /** A closure: the child's debug name. */
  fnName?: string | null
  /** Taken from a temporary register (vs. written straight into a variable). */
  temp?: boolean
  /** The first instruction of the code that computed it. */
  from?: number
  /** A local's value copied into a temporary. */
  moved?: boolean
}

class State {
  p: (Pend | undefined)[] = []

  clone(): State {
    const s = new State()
    s.p = this.p.map((x) =>
      x?.table ? { ...x, table: { ...x.table, items: x.table.items.slice(), placed: new Set(x.table.placed) } } : x,
    )
    return s
  }

  empty(): boolean {
    for (const x of this.p) if (x) return false
    return true
  }

  top(): number {
    for (let r = this.p.length - 1; r >= 0; r--) if (this.p[r]) return r
    return -1
  }
}

interface Ctx {
  /** End of the block: the instruction after it. */
  to: number
  /** Where a `break` jumps, or -1 outside loops. */
  brk: number
}

/** A test plus its JMP. */
interface Unit {
  /** First instruction of its operand code (its label for jumps from earlier units). */
  start: number
  /** The test instruction. */
  pc: number
  /** The instruction after its JMP. */
  end: number
  /** Where the JMP goes. */
  target: number
  ins: Ins
  /** Comparisons: the operands (B, C); TEST/TESTSET: the tested value. */
  left: Expr
  right?: Expr
  /** A comparison written with > / >= (the right operand was evaluated first). */
  swapped?: boolean
  /** The first instruction of its operands' code. */
  opStart: number
}

/** The last operand of an and/or value: no jump, just the value. */
interface ValueLeaf {
  value: Expr
}

interface IfShape {
  thenEnd: number
  elseStart: number
  elseEnd: number
  next: number
}

// Labels of an and/or value's exits: true (or the truthy value itself) and false.
const VTRUE = -1
const VFALSE = -2

const name = (n: string): Expr => ({ kind: 'Name', name: n })
const notExpr = (e: Expr): Expr => ({ kind: 'Unary', op: 'not', operand: e })

function constExpr(k: HksConstant | undefined): Expr {
  if (!k) return fail('constant out of range')
  switch (k.type) {
    case 'nil':
      return { kind: 'Nil' }
    case 'boolean':
      return { kind: k.value ? 'True' : 'False' }
    case 'number':
      return { kind: 'Number', value: k.value }
    case 'string':
      return { kind: 'String', value: k.value }
    default:
      return fail(`${k.type} constants can't be written in source`)
  }
}

class FuncDecompiler {
  f: HksProto
  code: Ins[]
  n: number
  K: HksConstant[]
  locals: Local[]
  byReg: Local[][] = []
  startsAt = new Map<number, Local[]>()
  /** Locals already declared (or parameters, loop variables). */
  claimed = new Set<Local>()
  upnames: string[]
  failures: { name: string; reason: string }[]
  /** A multiple assignment being collected (stores made while values still wait). */
  multi: { targets: Expr[]; values: Pend[] } | null = null
  /** Backward jumps by target: where loops start. */
  backJumps = new Map<number, number[]>()
  /** No and/or value starts at this pc (tried up to this barrier). */
  valueFail = new Map<number, number>()
  /** Units parsed from a clean state, by "pc,barrier". */
  unitMemo = new Map<string, { unit: Unit; st: State } | null>()
  /** Per constant: the first instruction using it. */
  firstRef: number[]
  /** Constants that are a global read's memo slots. */
  memoSlot: boolean[]
  /** `local a, b` statements without values: their LOADNIL's line. */
  nilLine = new Map<Stat, number>()
  /** While an instruction executes: the first instruction of the code behind the values it used. */
  curFrom = 0

  constructor(f: HksProto, failures: { name: string; reason: string }[]) {
    this.f = f
    this.failures = failures
    this.code = f.code.map(decode)
    this.n = f.code.length
    this.K = f.constants
    for (let j = 0; j < this.n; j++) {
      const i = this.code[j]
      if (i.op === OP.JMP && i.sbx < 0) {
        const t = j + 1 + i.sbx
        if (!this.backJumps.has(t)) this.backJumps.set(t, [])
        this.backJumps.get(t)!.push(j)
      }
    }
    // The first instruction using each constant (roughly when it was added).
    this.firstRef = new Array(this.K.length).fill(Infinity)
    this.memoSlot = new Array(this.K.length).fill(false)
    const ref = (k: number, pc: number) => {
      if (k >= 0 && k < this.K.length && pc < this.firstRef[k]) this.firstRef[k] = pc
    }
    this.code.forEach((i, pc) => {
      switch (i.op) {
        case OP.LOADK:
        case OP.SETGLOBAL:
          ref(i.bx, pc)
          break
        case OP.GETGLOBAL:
          ref(i.bx, pc)
          if (this.code[pc + 1]?.op === OP.DATA) {
            const m = this.code[pc + 1].bx
            ref(m, pc)
            ref(m + 1, pc)
            if (m + 1 < this.K.length) this.memoSlot[m] = this.memoSlot[m + 1] = true
          }
          break
        case OP.CLOSURE:
        case OP.JMP:
        case OP.FORPREP:
        case OP.FORLOOP:
        case OP.DATA:
          break
        default:
          if (isK(i.b)) ref(i.b & 0xff, pc)
          if (isK(i.c)) ref(i.c & 0xff, pc)
      }
    })
    this.locals = assignLocals(f, this.code)
    for (const l of this.locals) {
      ;(this.byReg[l.reg] ??= []).push(l)
      if (!this.startsAt.has(l.start)) this.startsAt.set(l.start, [])
      this.startsAt.get(l.start)!.push(l)
    }
    this.upnames = f.debug?.upvalueNames ?? []
    // Parameters (and the implicit `arg` of a vararg function) are declared by the header.
    const nparams = f.paramCount + (f.varargFlags & 1 ? 1 : 0)
    for (let i = 0; i < nparams && i < this.locals.length; i++) this.claimed.add(this.locals[i])
  }

  local(pc: number, r: number): Local | undefined {
    const list = this.byReg[r]
    if (!list) return undefined
    for (const l of list) if (l.start <= pc && pc < l.end) return l
    return undefined
  }

  /** Locals declared at pc by a statement (not hidden for-loop ones, not already declared). */
  declaredAt(pc: number): Local[] {
    return (this.startsAt.get(pc) ?? []).filter((l) => !this.claimed.has(l) && !l.name.startsWith('('))
  }

  rawOp(pc: number) {
    return opOf(this.f.code[pc])
  }

  /** An unconditional JMP (not the second half of a test). */
  isJump(pc: number): boolean {
    return this.code[pc]?.op === OP.JMP && !(pc > 0 && OP_INFO[this.rawOp(pc - 1)]?.test)
  }

  /** Where control really goes from pc, following unconditional jumps. */
  resolve(pc: number): number {
    let p = pc
    for (let guard = 0; guard < 64 && this.isJump(p); guard++) {
      const t = p + 1 + this.code[p].sbx
      if (t === p) return p
      p = t
    }
    return p
  }

  same(a: number, b: number): boolean {
    if (a === b) return true
    if (a < 0 || b < 0) return false
    return this.resolve(a) === this.resolve(b)
  }

  /** The instruction after pc and its DATA. */
  next(pc: number): number {
    let p = pc + 1
    while (p < this.n && this.code[p].op === OP.DATA) p++
    return p
  }

  /** The source line of instruction pc. */
  ln(pc: number): number | undefined {
    return this.f.debug?.lines[pc]
  }

  /** e with the line of instruction pc, unless it has one (a copy for shared names). */
  at<T extends Expr>(e: T, pc: number): T {
    return e.line !== undefined ? e : { ...e, line: this.ln(pc) }
  }

  /** Runs a structuring attempt; on failure undoes its side effects and returns null. */
  attempt<T>(fn: () => T): T | null {
    const claimed = new Set(this.claimed)
    const multi = this.multi
    try {
      return fn()
    } catch (e) {
      if (!(e instanceof DecompileError)) throw e
      this.claimed = claimed
      this.multi = multi
      return null
    }
  }

  // ---- registers ----

  take(pc: number, st: State, r: number): Pend {
    const l = this.local(pc, r)
    if (l) return { e: name(l.name) }
    const p = st.p[r]
    if (!p) return fail(`register ${r} is read at ${pc} before it is set`)
    st.p[r] = undefined
    if (p.from !== undefined && p.from < this.curFrom) this.curFrom = p.from
    return { ...p, temp: true }
  }

  read(pc: number, st: State, r: number): Expr {
    return this.single(this.take(pc, st, r))
  }

  readRK(pc: number, st: State, x: number): Expr {
    if (isK(x)) return constExpr(this.K[x & 0xff])
    return this.read(pc, st, x)
  }

  /** A waiting value as one expression. */
  single(p: Pend): Expr {
    if (p.cont !== undefined || p.nres) fail('a value with several results is used as one')
    if (p.open) fail('an open call is used as one value')
    if (p.selfName !== undefined || p.selfObj) fail('a method slot is used as a value')
    if (p.table) return this.closeTable(p.table)
    return p.e
  }

  closeTable(t: TableBuild): Expr {
    const items: TableItem[] = []
    for (const it of t.items) {
      if ('reg' in it) fail('table constructor has list items never stored')
      items.push(it as TableItem)
    }
    return { kind: 'Table', items, line: t.line, endLine: t.endLine }
  }

  write(pc: number, st: State, r: number, p: Pend, out: Stat[], valueReg: number) {
    const l = r !== valueReg ? this.local(pc, r) : undefined
    if (l) this.store(st, name(l.name), p, out, pc, true)
    else st.p[r] = { ...p, from: Math.min(p.from ?? Infinity, this.curFrom) }
  }

  store(st: State, target: Expr, p: Pend, out: Stat[], pc = -1, isLocal = false) {
    if (p.table && p.table.endLine === undefined && pc >= 0) p.table.endLine = this.ln(pc)
    if (this.multi) {
      this.multi.targets.push(target)
      this.multi.values.push(p)
      if (st.empty()) {
        const m = this.multi
        this.multi = null
        out.push(this.assign(m.targets.slice().reverse(), m.values.slice().reverse()))
      }
      return
    }
    // Values still waiting: the first store of a multiple assignment (they go last to first).
    if (!st.empty()) {
      this.multi = { targets: [target], values: [p] }
      return
    }
    // A value that went through a temporary it didn't need: an assignment whose last target was
    // the value itself (`t.x, v = v, v`: the compiler drops v = v). Any self-assignment does.
    const local = isLocal
    if (p.temp && (p.moved || (local && !p.single && !p.table && p.e.kind !== 'Call' && p.e.kind !== 'MethodCall'))) {
      const self = p.moved ? p.e : target
      out.push(this.assign([target, self], [p, { e: self }]))
      return
    }
    out.push(this.assign([target], [p]))
  }

  /**
   * The expressions of an explist whose values ended in registers: the
   * extra results of a multiple-result call folded into it, the nils the
   * compiler padded missing values with dropped, and a last call cut to one
   * result parenthesised where it would otherwise give several.
   */
  explist(vals: Pend[], nvars: number): Expr[] {
    const list = vals.filter((v) => v.cont === undefined)
    while (list.length > 1 && list[list.length - 1].nil && list[list.length - 1].temp) list.pop()
    return list.map((v, k) => {
      if (v.open) fail('open call in an assignment')
      if (v.table) return this.closeTable(v.table)
      if (v.single && k === list.length - 1 && list.length < nvars) return { kind: 'Paren', expr: v.e } as Expr
      return v.e
    })
  }

  assign(targets: Expr[], vals: Pend[]): Stat {
    // function a.b.c() / function a.b:c(): a closure stored under its own debug name.
    if (targets.length === 1 && vals.length === 1 && vals[0].fnName) {
      const fn = vals[0].e as FunctionExpr
      const path = this.funcPath(targets[0])
      if (path) {
        if (vals[0].fnName === path.join('.')) return { kind: 'FunctionStat', path, method: null, func: fn }
        if (
          path.length > 1 &&
          vals[0].fnName === path.slice(0, -1).join('.') + ':' + path[path.length - 1] &&
          fn.params[0] === 'self'
        )
          return {
            kind: 'FunctionStat',
            path: path.slice(0, -1),
            method: path[path.length - 1],
            func: { ...fn, params: fn.params.slice(1) },
          }
      }
    }
    return { kind: 'Assign', targets, exprs: this.explist(vals, targets.length) }
  }

  funcPath(t: Expr): string[] | null {
    if (t.kind === 'Name') return [t.name]
    if (t.kind === 'Index' && t.key.kind === 'String' && isName(t.key.value)) {
      const p = this.funcPath(t.obj)
      return p ? [...p, t.key.value] : null
    }
    return null
  }

  upname(b: number): string {
    const n = this.upnames[b]
    if (n === undefined) return fail(`upvalue ${b} has no name`)
    return n
  }

  globalName(bx: number): string {
    const k = this.K[bx]
    if (!k || k.type !== 'string' || !isName(k.value)) return fail(`global name constant ${bx} isn't a name`)
    return k.value
  }

  // ---- one instruction (no control flow) ----

  /**
   * Executes a plain instruction on st; statements it completes go to out.
   * Writes to valueReg stay values even if it is a local's register (the
   * register an and/or value is being built in). False if it isn't one.
   */
  exec(pc: number, st: State, out: Stat[], valueReg = -1): boolean {
    const i = this.code[pc]
    this.curFrom = pc
    switch (i.op) {
      case OP.MOVE: {
        const moved = !!this.local(pc, i.b)
        const p = this.take(pc, st, i.b)
        this.write(
          pc,
          st,
          i.a,
          { ...p, e: this.at(p.e, pc), temp: moved ? undefined : true, moved: moved || undefined },
          out,
          valueReg,
        )
        return true
      }
      case OP.LOADK:
        this.write(pc, st, i.a, { e: this.at(constExpr(this.K[i.bx]), pc) }, out, valueReg)
        return true
      case OP.LOADBOOL:
        if (i.c !== 0) return false
        this.write(pc, st, i.a, { e: this.at({ kind: i.b ? 'True' : 'False' }, pc) }, out, valueReg)
        return true
      case OP.LOADNIL:
        for (let r = i.a; r <= (i.b & 0xff); r++)
          this.write(pc, st, r, { e: this.at({ kind: 'Nil' }, pc), nil: true }, out, valueReg)
        return true
      case OP.GETUPVAL:
        this.write(pc, st, i.a, { e: this.at(name(this.upname(i.b)), pc) }, out, valueReg)
        return true
      case OP.GETGLOBAL:
        this.write(pc, st, i.a, { e: this.at(name(this.globalName(i.bx)), pc) }, out, valueReg)
        return true
      case OP.GETTABLE: {
        const key = this.readRK(pc, st, i.c)
        const obj = this.read(pc, st, i.b)
        this.write(pc, st, i.a, { e: this.at({ kind: 'Index', obj, key }, pc) }, out, valueReg)
        return true
      }
      case OP.SETGLOBAL:
        this.store(st, name(this.globalName(i.bx)), this.take(pc, st, i.a), out, pc)
        return true
      case OP.SETUPVAL:
        this.store(st, name(this.upname(i.b)), this.take(pc, st, i.a), out, pc)
        return true
      case OP.SETTABLE: {
        const tp = !this.local(pc, i.a) ? st.p[i.a] : undefined
        if (tp?.table) {
          // An item of a table constructor.
          const value = this.readRK(pc, st, i.c)
          const key = this.readRK(pc, st, i.b)
          this.tableItem(st, tp.table, key, value, this.ln(pc))
          return true
        }
        const vp: Pend = isK(i.c) ? { e: constExpr(this.K[i.c & 0xff]) } : this.take(pc, st, i.c)
        const key = this.readRK(pc, st, i.b)
        const obj = this.read(pc, st, i.a)
        this.store(st, { kind: 'Index', obj, key }, vp, out, pc)
        return true
      }
      case OP.NEWTABLE:
        this.write(
          pc,
          st,
          i.a,
          {
            e: this.at({ kind: 'Table', items: [] }, pc),
            table: { reg: i.a, items: [], placed: new Set(), line: this.ln(pc) },
          },
          out,
          valueReg,
        )
        return true
      case OP.SETLIST:
        this.setlist(pc, st, i)
        return true
      case OP.SELF: {
        const key = this.readRK(pc, st, i.c)
        if (key.kind !== 'String' || !isName(key.value)) return fail(`SELF at ${pc} with a key that isn't a name`)
        const obj = this.read(pc, st, i.b)
        st.p[i.a] = { e: obj, selfName: key.value, from: this.curFrom }
        st.p[i.a + 1] = { e: obj, selfObj: true, from: this.curFrom }
        return true
      }
      case OP.ADD:
      case OP.SUB:
      case OP.MUL:
      case OP.DIV:
      case OP.MOD:
      case OP.POW: {
        const left = this.readRK(pc, st, i.b)
        const right = this.readRK(pc, st, i.c)
        this.write(pc, st, i.a, { e: this.at({ kind: 'Binary', op: ARITH[i.op], left, right }, pc) }, out, valueReg)
        return true
      }
      case OP.UNM:
      case OP.NOT:
      case OP.LEN: {
        const operand = this.read(pc, st, i.b)
        const op = i.op === OP.UNM ? '-' : i.op === OP.NOT ? 'not' : '#'
        this.write(
          pc,
          st,
          i.a,
          { e: { kind: 'Unary', op, operand, line: firstLine(operand) ?? this.ln(pc) } },
          out,
          valueReg,
        )
        return true
      }
      case OP.CONCAT: {
        // a .. b .. c is right-associative: one CONCAT over consecutive registers.
        const parts: Expr[] = []
        for (let r = i.b; r <= i.c; r++) parts.push(this.read(pc, st, r))
        let e = parts[parts.length - 1]
        for (let k = parts.length - 2; k >= 0; k--) e = { kind: 'Binary', op: '..', left: parts[k], right: e }
        this.write(pc, st, i.a, { e }, out, valueReg)
        return true
      }
      case OP.CALL: {
        const call = this.call(pc, st, i)
        if (i.c === 1) {
          if (this.multi) fail('call statement inside an assignment')
          out.push({ kind: 'CallStat', call: call as Extract<Expr, { kind: 'Call' | 'MethodCall' }> })
        } else this.results(pc, st, i.a, i.c, call, out, valueReg)
        return true
      }
      case OP.VARARG:
        this.results(pc, st, i.a, i.b, this.at({ kind: 'Vararg' }, pc), out, valueReg)
        return true
      case OP.CLOSURE: {
        const child = this.f.children[i.bx]
        if (!child) return fail(`CLOSURE at ${pc}: no function ${i.bx}`)
        this.write(
          pc,
          st,
          i.a,
          { e: decompileFunction(child, this.failures), fnName: child.debug?.name ?? null },
          out,
          valueReg,
        )
        return true
      }
      case OP.CLOSE:
      case OP.DATA:
        return true
      default:
        return false
    }
  }

  /** The results of a call/vararg: count+1 as in CALL's C (0 = all). */
  results(pc: number, st: State, a: number, count: number, e: Expr, out: Stat[], valueReg: number) {
    const from = this.curFrom
    if (count === 0) st.p[a] = { e, open: true, from }
    else if (count === 2) this.write(pc, st, a, { e, single: true }, out, valueReg)
    else {
      st.p[a] = { e, nres: count - 1, from }
      for (let r = a + 1; r <= a + count - 2; r++) st.p[r] = { e, cont: a, from }
    }
  }

  tableItem(st: State, t: TableBuild, key: Expr, value: Expr, line: number | undefined) {
    // List items waiting in registers above the table come before this one.
    for (let r = t.reg + 1; r < st.p.length; r++) {
      if (st.p[r] && !t.placed.has(r)) {
        t.items.push({ reg: r })
        t.placed.add(r)
      }
    }
    if (value.kind === 'Table' && value.endLine === undefined) value.endLine = line
    const first = firstLine(key) ?? firstLine(value) ?? line
    if (key.kind === 'String' && isName(key.value)) t.items.push({ kind: 'Named', name: key.value, value, line: first })
    else t.items.push({ kind: 'Keyed', key, value, line: first })
  }

  setlist(pc: number, st: State, i: Ins) {
    const tp = st.p[i.a]
    if (!tp?.table) return fail(`SETLIST at ${pc} without a table`)
    let last = i.a + i.b
    if (i.b === 0) {
      last = st.top()
      if (last <= i.a || !st.p[last]?.open) fail(`SETLIST at ${pc}: no open value`)
    }
    const t = tp.table
    for (let r = i.a + 1; r <= last; r++) {
      if (!t.placed.has(r)) {
        t.items.push({ reg: r })
        t.placed.add(r)
      }
    }
    for (let k = 0; k < t.items.length; k++) {
      const it = t.items[k]
      if (!('reg' in it)) continue
      const p = st.p[it.reg]
      if (!p) return fail(`SETLIST at ${pc}: item register ${it.reg} is empty`)
      st.p[it.reg] = undefined
      let v: Expr
      if (p.open) {
        if (it.reg !== last) fail('open value inside a table')
        v = p.e
      } else if (p.single && it.reg === last && i.b !== 0) v = { kind: 'Paren', expr: p.e }
      else v = this.single(p)
      t.items[k] = { kind: 'Positional', value: v, line: firstLine(v) }
    }
    t.placed.clear()
    // The last SETLIST has the line of }.
    t.endLine = this.ln(pc)
  }

  call(pc: number, st: State, i: Ins): Expr {
    const args: Expr[] = []
    const fp = st.p[i.a]
    const method = !this.local(pc, i.a) && fp?.selfName !== undefined
    let last = i.a + i.b - 1
    if (i.b === 0) {
      last = st.top()
      if (last <= i.a || !st.p[last]?.open) fail(`call at ${pc} with open arguments but no open value`)
    }
    for (let r = i.a + 1 + (method ? 1 : 0); r <= last; r++) {
      const p = this.take(pc, st, r)
      if (p.open) {
        if (r !== last) fail('open value inside arguments')
        args.push(p.e)
      } else if (p.single && r === last && i.b !== 0) args.push({ kind: 'Paren', expr: p.e })
      else args.push(this.single(p))
    }
    if (method) {
      if (!st.p[i.a + 1]?.selfObj) fail(`method call at ${pc} without its object`)
      st.p[i.a + 1] = undefined
      st.p[i.a] = undefined
      if (fp!.from !== undefined && fp!.from < this.curFrom) this.curFrom = fp!.from
      return { kind: 'MethodCall', obj: fp!.e, name: fp!.selfName!, args, line: this.ln(pc) }
    }
    return { kind: 'Call', func: this.read(pc, st, i.a), args, line: this.ln(pc) }
  }

  ret(pc: number, st: State, i: Ins): Stat {
    if (this.multi) fail('return inside an assignment')
    const exprs: Expr[] = []
    let last = i.a + i.b - 2
    if (i.b === 0) {
      last = st.top()
      if (last < i.a || !st.p[last]?.open) fail(`return at ${pc} with open values but none waiting`)
    }
    for (let r = i.a; r <= last; r++) {
      const p = this.take(pc, st, r)
      if (p.open) {
        if (r !== last) fail('open value inside return values')
        exprs.push(p.e)
      } else if (p.single && r === last && i.b !== 0) exprs.push({ kind: 'Paren', expr: p.e })
      else exprs.push(this.single(p))
    }
    return { kind: 'Return', exprs }
  }

  // ---- units ----

  /** The test at pc whose operands wait in st: consumes them. */
  unitAt(pc: number, st: State, start: number): Unit {
    const i = this.code[pc]
    const j = this.code[pc + 1]
    if (!j || j.op !== OP.JMP) return fail(`test at ${pc} isn't followed by a jump`)
    let opStart = start >= 0 ? start : Infinity
    // The operand registers (a comparison's A is its flag, not a register).
    const operands = i.op === OP.TEST ? [i.a] : i.op === OP.TESTSET ? [i.b] : [i.b, i.c]
    for (const r of operands)
      if (!isK(r) && !this.local(pc, r) && st.p[r]?.from !== undefined) opStart = Math.min(opStart, st.p[r]!.from!)
    const u: Unit = {
      start,
      pc,
      end: pc + 2,
      target: pc + 2 + j.sbx,
      ins: i,
      left: { kind: 'Nil' },
      opStart: opStart === Infinity ? -1 : opStart,
    }
    if (i.op === OP.TEST) u.left = this.read(pc, st, i.a)
    else if (i.op === OP.TESTSET) u.left = this.read(pc, st, i.b)
    else {
      // The first operand is evaluated first (lower register); LT/LE with it in C were written > / >=.
      const bTemp = !isK(i.b) && !this.local(pc, i.b)
      const cTemp = !isK(i.c) && !this.local(pc, i.c)
      u.left = this.readRK(pc, st, i.b)
      u.right = this.readRK(pc, st, i.c)
      if (i.op !== OP.EQ) {
        if (bTemp && cTemp) u.swapped = i.c < i.b
        else if (isK(i.b) && isK(i.c)) {
          // Two constants: the one added first was the first operand (strings when read, others when used).
          u.swapped = (i.c & 0xff) < (i.b & 0xff)
        } else {
          u.swapped = cTemp || (isK(i.b) && !isK(i.c))
          // A constant and a computed value: a first operand's constant is added before the second
          // operand is read, so it comes before the constants that value's code adds.
          // A global read's memo slots are always new there, the surest clock (a name may have been
          // added before its first use, as the target of `g = 1 < g`).
          const k = isK(i.b) ? i.b & 0xff : isK(i.c) ? i.c & 0xff : -1
          if (k >= 0 && u.opStart >= 0 && (bTemp || cTemp)) {
            let min = Infinity
            let minMemo = Infinity
            for (let j = 0; j < this.K.length; j++) {
              if (j === k || this.firstRef[j] < u.opStart || this.firstRef[j] >= pc) continue
              if (j < min) min = j
              if (this.memoSlot[j] && j < minMemo) minMemo = j
            }
            const m = minMemo !== Infinity ? minMemo : min
            if (m !== Infinity) u.swapped = isK(i.c) ? k < m : k > m
          }
        }
      }
    }
    return u
  }

  /**
   * One unit from pc on: plain expression code (and/or values in it folded),
   * then a test. Null if a statement, a declaration, control flow or the
   * barrier comes first. labels: where earlier units jump; an and/or value
   * with one of them inside isn't one (that test is a unit of its own).
   */
  unitFrom(pc: number, st: State, barrier: number, labels: number[] = []): { unit: Unit; st: State } | null {
    const inside = labels.filter((l) => l > pc && l < barrier)
    if (!st.empty()) return this.unitFromState(pc, st, barrier, inside)
    const key = `${pc},${barrier},${inside.join(',')}`
    if (!this.unitMemo.has(key)) this.unitMemo.set(key, this.unitFromState(pc, st, barrier, inside))
    const r = this.unitMemo.get(key)!
    return r && { unit: r.unit, st: r.st.clone() }
  }

  unitFromState(pc: number, st: State, barrier: number, labels: number[]): { unit: Unit; st: State } | null {
    let s = st.clone()
    const out: Stat[] = []
    const savedMulti = this.multi
    this.multi = null
    try {
      for (let p = pc; ;) {
        if (p >= barrier || p >= this.n || this.declaredAt(p).length) return null
        const i = this.code[p]
        if (isTestOp(i.op)) {
          const s2 = s.clone()
          const v = this.tryValue(p, s2, barrier, null)
          if (v !== null && !labels.some((l) => l > p && l < v)) {
            s = s2
            p = v
            continue
          }
          return { unit: this.unitAt(p, s, pc), st: s }
        }
        if (
          i.op === OP.JMP ||
          i.op === OP.RETURN ||
          i.op === OP.TAILCALL ||
          i.op === OP.FORPREP ||
          i.op === OP.FORLOOP ||
          i.op === OP.TFORLOOP
        )
          return null
        if (!this.exec(p, s, out) || out.length || this.multi) return null
        p = this.next(p)
      }
    } catch (e) {
      if (e instanceof DecompileError) return null
      throw e
    } finally {
      this.multi = savedMulti
    }
  }

  /** The units of a condition from `first` on, as many as parse (each from a clean state). */
  unitChain(first: Unit, limit: number): Unit[] {
    const units = [first]
    for (;;) {
      const last = units[units.length - 1]
      const r = this.unitFrom(
        last.end,
        new State(),
        limit,
        units.map((u) => u.target),
      )
      if (!r || !r.st.empty()) break
      units.push(r.unit)
    }
    return units
  }

  // ---- and/or trees ----

  /** E such that the unit jumps iff E is truthy (onTrue) or falsy. */
  leaf(u: Unit, onTrue: boolean): Expr {
    const i = u.ins
    if (i.op === OP.TEST || i.op === OP.TESTSET)
      return (i.c !== 0) === onTrue
        ? this.at(u.left, u.pc)
        : { ...notExpr(u.left), line: firstLine(u.left) ?? this.ln(u.pc) }
    const jumpIfTrue = i.a !== 0
    const line = this.ln(u.pc)
    if (i.op === OP.EQ)
      return { kind: 'Binary', op: jumpIfTrue === onTrue ? '==' : '~=', left: u.left, right: u.right!, line }
    const op: BinaryOp = i.op === OP.LT ? (u.swapped ? '>' : '<') : u.swapped ? '>=' : '<='
    const cmp: Expr = u.swapped
      ? { kind: 'Binary', op, left: u.right!, right: u.left, line }
      : { kind: 'Binary', op, left: u.left, right: u.right!, line }
    return jumpIfTrue === onTrue ? cmp : { ...notExpr(cmp), line }
  }

  /**
   * The and/or tree of leaves [i, j) that sends true to t and false to f.
   * jumpLabel/fallLabel: where leaf k's jump and fall-through go; startOf(k):
   * leaf k's label; valueOk(k, onTrue): may leaf k jump on true / on false.
   * The root is the last split that fits, so chains come out
   * left-associative (as Lua parses `a and b and c`).
   */
  tree(
    leaves: (Unit | ValueLeaf)[],
    jumpLabel: (k: number) => number,
    fallLabel: (k: number) => number,
    startOf: (k: number) => number,
    valueOk: (k: number, onTrue: boolean) => boolean,
    i: number,
    j: number,
    t: number,
    f: number,
    memo: Map<string, Expr | null>,
  ): Expr | null {
    const key = `${i},${j},${t},${f}`
    if (memo.has(key)) return memo.get(key)!
    let res: Expr | null = null
    if (j - i === 1) {
      const l = leaves[i]
      if ('value' in l) res = t < 0 && f < 0 ? l.value : null
      else {
        const jl = jumpLabel(i)
        const fl = fallLabel(i)
        // When both exits are the same place, the jump is the false one (as goiftrue leaves it).
        if (this.same(jl, f) && this.same(fl, t) && valueOk(i, false)) res = this.leaf(l, false)
        else if (this.same(jl, t) && this.same(fl, f) && valueOk(i, true)) res = this.leaf(l, true)
      }
    } else {
      for (let k = j - 1; k > i && !res; k--) {
        const sk = startOf(k)
        for (const op of ['and', 'or'] as const) {
          const lt = op === 'and' ? sk : t
          const lf = op === 'and' ? f : sk
          // Every jump out of [i, k) must go to lt or lf.
          let ok = true
          for (let m = i; m < k && ok; m++) {
            if ('value' in leaves[m]) ok = false
            else {
              const jl = jumpLabel(m)
              let internal = false
              for (let q = m + 1; q < k && !internal; q++) internal = jl === startOf(q)
              if (!internal && !this.same(jl, lt) && !this.same(jl, lf)) ok = false
            }
          }
          if (!ok) continue
          const r = this.tree(leaves, jumpLabel, fallLabel, startOf, valueOk, k, j, t, f, memo)
          if (!r) continue
          const l = this.tree(leaves, jumpLabel, fallLabel, startOf, valueOk, i, k, lt, lf, memo)
          if (!l) continue
          res = { kind: 'Binary', op, left: l, right: r }
          break
        }
      }
    }
    memo.set(key, res)
    return res
  }

  /** The condition of units[0..k) that falls through to t when true and jumps to f when false. */
  condition(units: Unit[], k: number, t: number, f: number): Expr | null {
    // TESTSET assigns as it tests: only ever part of an and/or value.
    for (let m = 0; m < k; m++) if (units[m].ins.op === OP.TESTSET) return null
    return this.tree(
      units.slice(0, k),
      (m) => units[m].target,
      (m) => (m + 1 < k ? units[m + 1].start : t),
      (m) => (m < k ? units[m].start : t),
      () => true,
      0,
      k,
      t,
      f,
      new Map(),
    )
  }

  // ---- and/or as values ----

  /**
   * At a test at pc whose operands wait in st: if it starts an and/or value
   * (its jumps meeting where the value sits in one register), folds it into
   * st and returns the pc after it. When that register is a live local the
   * value is assigned to it, a statement put in out (null: not allowed
   * here). Else null, st unchanged.
   */
  tryValue(pc: number, st: State, barrier: number, out: Stat[] | null): number | null {
    const failed = this.valueFail.get(pc)
    if (failed !== undefined && barrier <= failed) return null
    if (this.notValue(pc)) {
      this.valueFail.set(pc, Infinity)
      return null
    }
    const saved = this.multi
    this.multi = null
    let r: ReturnType<FuncDecompiler['valueRegion']> = null
    try {
      r = this.valueRegion(pc, st, barrier)
    } catch (e) {
      if (!(e instanceof DecompileError)) throw e
    } finally {
      this.multi = saved
    }
    if (!r) {
      this.valueFail.set(pc, Math.max(failed ?? -Infinity, barrier))
      return null
    }
    const l = this.local(pc, r.reg)
    if (l) {
      // x = a and b, x a live local: an assignment (statements only; the first store of
      // a multiple assignment if values still wait).
      if (!out) return null
      st.p = r.st.p
      this.store(st, name(l.name), { e: r.e }, out, r.final - 1, true)
      return r.final
    }
    st.p = r.st.p
    st.p[r.reg] = { e: r.e, from: r.from >= 0 ? r.from : undefined }
    return r.final
  }

  /** Cheap check: statements before the first jump's target mean this test isn't part of a value. */
  notValue(pc0: number): boolean {
    const j = this.code[pc0 + 1]
    if (!j || j.op !== OP.JMP) return true
    const t0 = pc0 + 2 + j.sbx
    if (t0 <= pc0 + 1) return true
    for (let p = pc0 + 2; p < t0 && p < this.n; p++) {
      const i = this.code[p]
      switch (i.op) {
        case OP.SETGLOBAL:
        case OP.SETUPVAL:
        case OP.RETURN:
        case OP.TAILCALL:
        case OP.FORPREP:
        case OP.FORLOOP:
        case OP.TFORLOOP:
        case OP.CLOSE:
          return true
        case OP.CALL:
          if (i.c === 1) return true
          break
        case OP.JMP:
          if (this.isJump(p) && !(this.code[p + 1]?.op === OP.LOADBOOL && this.code[p + 1].c === 1)) return true
          break
      }
      if ((this.startsAt.get(p) ?? []).some((l) => !l.name.startsWith('(') && l.start !== 0)) return true
    }
    return false
  }

  /**
   * An and/or value from the test at pc0: its units (all jumping forward to
   * later units, to where the value is complete, or to the LOADBOOL false /
   * true pair), then the code of its last operand writing the register.
   */
  valueRegion(
    pc0: number,
    st: State,
    outerBarrier: number,
  ): { final: number; reg: number; e: Expr; st: State; from: number } | null {
    let s = st.clone()
    const units: Unit[] = [this.unitAt(pc0, s, -1000)]
    // Other values waiting: this is inside a larger statement (an expression, not an if).
    const inside = !s.empty()
    let tail: { pf: number; pt: number; final: number; reg: number } | null = null
    let vStart = -1
    let vEnd = -1
    for (;;) {
      if (units.some((u) => u.target <= u.pc)) return null
      const maxT = Math.max(...units.map((u) => u.target))
      tail = this.loadboolTail(maxT)
      const final = tail ? tail.final : maxT
      if (final > outerBarrier) return null
      const p = units[units.length - 1].end
      // The last operand ends at the JMP over the LOADBOOLs (or, a comparison, at them).
      let barrier = final
      // (That jump goes on with the jump at final when one follows: luaK_jump takes pending jumps along.)
      if (tail)
        barrier =
          this.isJump(tail.pf - 1) && tail.pf - 1 >= p && this.same(tail.pf + this.code[tail.pf - 1].sbx, final)
            ? tail.pf - 1
            : tail.pf
      if (p > barrier) return null
      if (p === barrier) {
        // A comparison last; or a last operand that needs no code (the target local itself: x = a and x).
        if (!(tail && p === tail.pf)) {
          vStart = p
          vEnd = p
        }
        break
      }
      const r = this.unitFrom(
        p,
        s,
        barrier,
        units.map((u) => u.target),
      )
      if (r) {
        s = r.st
        units.push(r.unit)
        continue
      }
      vStart = p
      vEnd = barrier
      break
    }
    const final = tail ? tail.final : Math.max(...units.map((u) => u.target))
    let reg = -1
    const testset = units.find((u) => u.ins.op === OP.TESTSET)
    if (tail) reg = tail.reg
    else if (testset) reg = testset.ins.a
    else if (vEnd > vStart) {
      let q = vEnd - 1
      while (q > vStart && this.code[q].op === OP.DATA) q--
      reg = this.code[q].a
    }
    if (reg < 0) return null
    // Jumps to the end carry the tested value: TESTSET into reg, or TEST on reg itself.
    for (const u of units) {
      const valueJump = u.ins.op === OP.TESTSET ? u.ins.a === reg : u.ins.op === OP.TEST && u.ins.a === reg
      if (u.target === final ? !valueJump : u.ins.op === OP.TESTSET) return null
    }
    // `if x then x = v end` on a live local reads better as an if (unless a jump follows: an if's
    // exit would have been threaded on through it, a value's jumps go to it).
    if (!tail && !inside && !units.some((u) => u.ins.op === OP.TESTSET) && this.local(pc0, reg) && !this.isJump(final))
      return null
    let value: Expr | null = null
    if (vStart >= 0) {
      const out: Stat[] = []
      const waiting = s.p.map((x) => !!x)
      let p = vStart
      while (p < vEnd) {
        if (this.declaredAt(p).length) return null
        const i = this.code[p]
        if (isTestOp(i.op)) {
          const v = this.tryValue(p, s, vEnd, null)
          if (v === null) return null
          p = v
          continue
        }
        if (i.op === OP.JMP || i.op === OP.RETURN || i.op === OP.TAILCALL || i.op === OP.FORPREP || i.op === OP.FORLOOP)
          return null
        if (!this.exec(p, s, out, reg) || out.length || this.multi) return null
        p = this.next(p)
      }
      if (p !== vEnd) return null
      // It wrote only the value's register (LOADNIL a..b for several locals is not a value).
      if (s.p.some((x, r) => !!x && !waiting[r] && r !== reg)) return null
      if (vStart === vEnd) {
        // No code: the value already in the register, a local's (x = a and x).
        const l = this.local(units[units.length - 1].pc, reg)
        if (!l) return null
        value = name(l.name)
      } else {
        if (!s.p[reg]) return null
        value = this.single(s.p[reg]!)
        s.p[reg] = undefined
      }
    } else if (!tail || units[units.length - 1].end !== tail.pf) return null
    const leaves: (Unit | ValueLeaf)[] = [...units]
    if (value) leaves.push({ value })
    const startOf = (k: number) => (k < units.length ? units[k].start : vStart)
    const valueJump = (u: Unit) => u.target === final && (u.ins.op === OP.TEST || u.ins.op === OP.TESTSET)
    const jumpLabel = (k: number) => {
      const u = units[k]
      if (valueJump(u)) return u.ins.c ? VTRUE : VFALSE
      if (tail && u.target === tail.pt) return VTRUE
      if (tail && u.target === tail.pf) return VFALSE
      return u.target
    }
    const fallLabel = (k: number) => (k + 1 < leaves.length ? startOf(k + 1) : tail ? VFALSE : -3)
    const valueOk = (k: number, onTrue: boolean) => {
      const u = units[k]
      // A value jump keeps the value as it is; a TEST jumping to true/false is `not x` / `x` as a boolean.
      if (valueJump(u)) return (u.ins.c !== 0) === onTrue
      if (u.ins.op === OP.TEST && (u.target === tail?.pt || u.target === tail?.pf)) return (u.ins.c !== 0) !== onTrue
      return true
    }
    const e = this.tree(leaves, jumpLabel, fallLabel, startOf, valueOk, 0, leaves.length, VTRUE, VFALSE, new Map())
    if (!e) return null
    // (Its code starts with its first operand's, or at the first test when that operand is a local.)
    return { final, reg, e, st: s, from: units[0].opStart >= 0 ? units[0].opStart : pc0 }
  }

  /** LOADBOOL r 0 1 / LOADBOOL r 1 0 next to label t: the false and true labels of a value. */
  loadboolTail(t: number): { pf: number; pt: number; final: number; reg: number } | null {
    const isF = (p: number) => this.code[p]?.op === OP.LOADBOOL && this.code[p].b === 0 && this.code[p].c === 1
    const isT = (p: number, r: number) =>
      this.code[p]?.op === OP.LOADBOOL && this.code[p].b === 1 && this.code[p].c === 0 && this.code[p].a === r
    for (const pf of [t - 2, t - 1, t])
      if (pf >= 0 && isF(pf) && isT(pf + 1, this.code[pf].a))
        return { pf, pt: pf + 1, final: pf + 2, reg: this.code[pf].a }
    return null
  }

  // ---- blocks ----

  /**
   * The statements of [from, to). head/headBack: at the enclosing loop's own
   * start only loops ending before headBack start there (an inner repeat;
   * none for a `while true` body whose ifs jump back to its start). untilHead: this is a repeat body; a
   * condition jumping back there and ending at `to` is its until-condition,
   * returned in until.cond.
   */
  block(
    from: number,
    to: number,
    outer: Ctx,
    opts: { head?: number; headBack?: number; untilHead?: number; until?: { cond: Expr | null } } = {},
  ): Block {
    const ctx: Ctx = { to, brk: outer.brk }
    const out: Stat[] = []
    const st = new State()
    const scopes: { l: Local; at: number }[] = []
    let pc = from
    // Statements get the source line of their instructions: those since the last statement boundary.
    let stmtStart = from
    let marked = 0
    for (;;) {
      this.markLines(out, marked, stmtStart, pc)
      // A scope ending before the block does (apart from its own CLOSE) was a do ... end.
      const inside = pc < to && !this.onlyClose(pc, to, scopes[0]?.l.reg)
      let changed = out.length
      // Locals declared here above ones ending here: those were still live (all end together).
      const top = scopes[scopes.length - 1]?.l
      const lateClose = !!top && top.end === pc && this.declaredAt(pc).some((l) => l.reg > top.reg)
      if (inside && !lateClose) changed = Math.min(changed, this.closeScopes(scopes, out, pc))
      this.declare(pc, st, out, scopes)
      // (the declaration's line first: closing its scope right away may need it)
      this.markLines(out, changed, stmtStart, pc)
      if (inside) changed = Math.min(changed, this.closeScopes(scopes, out, pc))
      this.markLines(out, changed, stmtStart, pc)
      marked = out.length
      if (st.empty() && !this.multi) stmtStart = pc
      if (pc >= to) break
      const i = this.code[pc]
      if (st.empty() && !this.multi) {
        const next = this.loop(pc, pc === opts.head ? Math.min(to, opts.headBack ?? -1) : to, out)
        if (next >= 0) {
          pc = next
          continue
        }
      }
      if (isTestOp(i.op)) {
        const v = this.tryValue(pc, st, Infinity, out)
        if (v !== null) {
          pc = v
          continue
        }
        if (this.multi) fail(`condition at ${pc} inside an assignment`)
        // Its operand code started at the statement start (nothing jumps to a condition's first unit).
        const first = this.unitAt(pc, st, stmtStart)
        if (!st.empty()) fail(`condition at ${pc} with other values waiting`)
        const chain = this.unitChain(first, to)
        if (opts.untilHead !== undefined) {
          // The until-condition: jumps back to the loop's start when false, ends the block.
          const k = chain.findIndex((u) => u.end === to)
          const cond = k >= 0 ? this.condition(chain, k + 1, to, opts.untilHead) : null
          if (cond) {
            opts.until!.cond = cond
            for (const { l } of scopes) if (l.end !== to) fail(`local ${l.name} outlives its repeat (${from}-${to})`)
            // `break` / `return` may end the body right before until: no do ... end needed.
            const last = out[out.length - 1]
            if (
              last?.kind === 'Do' &&
              last.body.length === 1 &&
              (last.body[0].kind === 'Break' || last.body[0].kind === 'Return')
            )
              out[out.length - 1] = last.body[0]
            this.splitLocals(out)
            return out
          }
        }
        pc = this.ifStat(chain, out, ctx)
        continue
      }
      switch (i.op) {
        case OP.JMP: {
          const t = pc + 1 + i.sbx
          if (this.code[t]?.op === OP.TFORLOOP && st.top() >= 0) {
            pc = this.forIn(pc, t, st, out)
            continue
          }
          if (!st.empty()) fail(`jump at ${pc} with values waiting`)
          if (ctx.brk >= 0 && this.same(t, ctx.brk)) {
            // `break` must end a block: one in the middle was written do break end.
            pc = this.next(pc)
            out.push(pc < to ? { kind: 'Do', body: [{ kind: 'Break' }] } : { kind: 'Break' })
            continue
          }
          if (t > pc && t <= to) {
            // if false then ... end
            out.push({
              kind: 'If',
              clauses: [{ cond: { kind: 'False' }, body: this.block(pc + 1, t, ctx) }],
              orelse: null,
            })
            pc = t
            continue
          }
          return fail(`unexpected jump at ${pc} to ${t}`)
        }
        case OP.FORPREP:
          pc = this.forNum(pc, st, out)
          continue
        case OP.RETURN: {
          const s = this.ret(pc, st, i)
          pc = this.next(pc)
          out.push(pc < to ? { kind: 'Do', body: [s] } : s)
          continue
        }
        case OP.TAILCALL: {
          const s: Stat = { kind: 'Return', exprs: [this.call(pc, st, i)] }
          pc = this.next(pc)
          if (this.code[pc]?.op === OP.RETURN) pc = this.next(pc)
          out.push(pc < to ? { kind: 'Do', body: [s] } : s)
          continue
        }
        default:
          if (!this.exec(pc, st, out))
            fail(`can't decompile ${OP_NAMES[this.rawOp(pc)] ?? 'opcode ' + this.rawOp(pc)} at ${pc}`)
          pc = this.next(pc)
      }
    }
    if (this.multi) fail(`assignment not finished at ${to}`)
    if (!st.empty()) fail(`values left waiting at the end of a block (${from}-${to})`)
    if (opts.untilHead !== undefined) fail(`repeat at ${from} has no until-condition`)
    // The block's locals end with it (a structure that says otherwise is the wrong one).
    for (const { l } of scopes)
      if (l.end > to || (l.end < to && !this.onlyClose(l.end, to, scopes[0].l.reg)))
        fail(`local ${l.name} outlives its block (${from}-${to})`)
    this.splitLocals(out)
    return out
  }

  /**
   * `local a, b` (no values) whose LOADNIL is on a line before the next
   * statement's: the token after the first name was there, so the source
   * had `local a` then `local b` (the second LOADNIL merged into the first).
   */
  splitLocals(list: Stat[]) {
    for (let k = 0; k < list.length; k++) {
      const s = list[k]
      if (s.kind === 'Do') this.splitLocals(s.body)
      const x = this.nilLine.get(s)
      if (s.kind !== 'Local' || x === undefined || s.names.length < 2 || s.exprs.length) continue
      const y = list[k + 1]?.line
      if (y === undefined || y <= x) continue
      list.splice(
        k,
        1,
        { kind: 'Local', names: [s.names[0]], exprs: [], line: Math.max(1, x - 1) },
        { kind: 'Local', names: s.names.slice(1), exprs: [], line: x },
      )
      k++
    }
  }

  /** Source lines for statements from out[from] on that have none: the first line of instructions [a, b). */
  markLines(out: Stat[], from: number, a: number, b: number) {
    for (let k = from; k < out.length; k++) {
      const s = out[k]
      if (s.line !== undefined) continue
      if (s.kind === 'Do') {
        const first = s.body.find((x) => x.line !== undefined)?.line
        if (first !== undefined) s.line = Math.max(1, first - 1)
        continue
      }
      let line = Infinity
      const lines = this.f.debug?.lines
      if (lines) for (let p = a; p < b; p++) if (lines[p] < line) line = lines[p]
      // A function's CLOSURE has the line of its `end`; the statement starts where the function does.
      const fns: Expr[] =
        s.kind === 'Local' || s.kind === 'Assign'
          ? s.exprs
          : s.kind === 'LocalFunction' || s.kind === 'FunctionStat'
            ? [s.func]
            : []
      for (const e of fns)
        if (e.kind === 'Function' && e.line !== undefined && e.line > 0 && e.line < line) line = e.line
      // repeat / while true have no instruction of their own: the keyword was on the line before the body.
      if (s.kind === 'Repeat' || (s.kind === 'While' && s.cond.kind === 'True')) {
        const first = s.body.find((x) => x.line !== undefined)?.line
        if (first !== undefined && first < line) line = first
        if (line !== Infinity) line = Math.max(1, line - 1)
      }
      // `local a, b` alone: its LOADNIL has the line of the token after it (HavokScript reads the names
      // with a lookahead), typically the next line's.
      if (s.kind === 'Local' && !s.exprs.length && line !== Infinity) {
        this.nilLine.set(s, line)
        line = Math.max(1, line - 1)
      }
      if (line !== Infinity) s.line = line
      if (s.kind === 'If') {
        if (s.clauses[0].line === undefined) s.clauses[0].line = s.line
      }
    }
  }

  /**
   * Only CLOSE instructions (the block's own closing of upvalues) from pc to
   * `to`. base: the block's first local's register; a CLOSE above it closes
   * an inner block (a do ... end ending there).
   */
  onlyClose(pc: number, to: number, base?: number): boolean {
    for (let p = pc; p < to; p++)
      if (this.code[p].op !== OP.CLOSE || (base !== undefined && this.code[p].a > base)) return false
    return true
  }

  /** Locals of this block whose scope ends at pc: wraps their statements in do ... end; returns where it is (or out.length). */
  closeScopes(scopes: { l: Local; at: number }[], out: Stat[], pc: number): number {
    let at = -1
    while (scopes.length && scopes[scopes.length - 1].l.end === pc) at = scopes.pop()!.at
    if (at < 0) return out.length
    // `do` needs a line before its first statement: if the statement before is on it, the block
    // began earlier (statements that declare no local can move in).
    for (;;) {
      const first = out[at].line
      const prev = out[at - 1]
      if (
        at === 0 ||
        first === undefined ||
        prev.line === undefined ||
        prev.line < first - 1 ||
        prev.kind === 'Local' ||
        prev.kind === 'LocalFunction'
      )
        break
      at--
    }
    const body = out.splice(at)
    // A `return` / `break` that had to be wrapped in do ... end now ends this block anyway.
    const last = body[body.length - 1]
    if (
      last?.kind === 'Do' &&
      last.body.length === 1 &&
      (last.body[0].kind === 'Break' || last.body[0].kind === 'Return')
    )
      body[body.length - 1] = last.body[0]
    out.push({ kind: 'Do', body })
    return at
  }

  /** Declares the locals starting at pc, from the values waiting in their registers. */
  declare(pc: number, st: State, out: Stat[], scopes: { l: Local; at: number }[]) {
    const group = this.declaredAt(pc)
    if (!group.length) return
    if (this.multi) fail(`declaration at ${pc} inside an assignment`)
    group.sort((a, b) => a.reg - b.reg)
    for (let k = 1; k < group.length; k++)
      if (group[k].reg !== group[0].reg + k) fail(`locals at ${pc} aren't in consecutive registers`)
    const vals: Pend[] = []
    for (const l of group) {
      let p = st.p[l.reg]
      if (!p) {
        // local x after a LOADNIL the compiler merged it into.
        const prev = this.code[pc - 1]
        if (prev?.op === OP.LOADNIL && l.reg >= prev.a && l.reg <= (prev.b & 0xff))
          p = { e: { kind: 'Nil' }, nil: true }
        else return fail(`local ${l.name} at ${pc} has no value`)
      }
      st.p[l.reg] = undefined
      vals.push({ ...p, temp: true })
      this.claimed.add(l)
    }
    const at = out.length
    if (group.length === 1 && vals[0].fnName === group[0].name)
      out.push({ kind: 'LocalFunction', name: group[0].name, func: vals[0].e as FunctionExpr })
    else {
      const exprs = this.explist(vals, group.length)
      // local a, b (all nil) rather than local a, b = nil
      out.push({ kind: 'Local', names: group.map((l) => l.name), exprs: vals.every((v) => v.nil) ? [] : exprs })
    }
    for (const l of group) scopes.push({ l, at })
  }

  // ---- if ----

  /**
   * An if from its condition units: the longest run of units that makes a
   * valid condition and blocks (more units = a nested if folded into `and`,
   * which compiles the same). Returns the pc after it.
   */
  ifStat(chain: Unit[], out: Stat[], ctx: Ctx): number {
    // An if's jumps were threaded on through any jump at their target; a unit jumping to a jump
    // is an and/or value's (`x = x or y`), so runs without such units come first.
    const toJump = (k: number) => chain.slice(0, k).some((u) => u.target > u.pc && this.isJump(u.target))
    const order: number[] = []
    for (let k = chain.length; k >= 1; k--) if (!toJump(k)) order.push(k)
    for (let k = chain.length; k >= 1; k--) if (toJump(k)) order.push(k)
    for (const k of order) {
      const T = chain[k - 1].end
      const F = chain[k - 1].target
      const shapes = this.ifShapes(T, F, ctx)
      if (!shapes.length) continue
      const cond = this.condition(chain, k, T, F)
      if (!cond) continue
      for (const r of shapes) {
        const res = this.attempt(() => ({
          thenBody: this.block(T, r.thenEnd, ctx),
          orelse: r.elseStart >= 0 ? this.block(r.elseStart, r.elseEnd, ctx) : null,
        }))
        if (!res) continue
        const { thenBody, orelse } = res
        if (r.elseStart >= 0) {
          const last = thenBody[thenBody.length - 1]
          if (
            last &&
            (last.kind === 'If' ||
              last.kind === 'While' ||
              last.kind === 'NumericFor' ||
              last.kind === 'GenericFor' ||
              last.kind === 'Do')
          )
            last.endLine ??= this.ln(r.thenEnd)
        }
        if (orelse?.length === 1 && orelse[0].kind === 'If') {
          // else if ... -> elseif
          const inner = orelse[0]
          if (inner.clauses[0].line === undefined) inner.clauses[0].line = inner.line
          out.push({ kind: 'If', clauses: [{ cond, body: thenBody }, ...inner.clauses], orelse: inner.orelse })
        } else out.push({ kind: 'If', clauses: [{ cond, body: thenBody }], orelse })
        return r.next
      }
    }
    return fail(`can't structure the condition at ${chain[0].pc}`)
  }

  /**
   * Where an if with then-block start T and false jump F ends, and its else
   * part: the shapes that fit, likeliest first (a then-block ending in a jump
   * out of the loop is a `break` rather than the jump over an else).
   */
  ifShapes(T: number, F: number, ctx: Ctx): IfShape[] {
    const noElse = (end: number): IfShape => ({ thenEnd: end, elseStart: -1, elseEnd: -1, next: end })
    if (F === T) return [noElse(T)]
    // An empty then-block whose false jump was threaded on through the jump right after it (`break`).
    const empty = this.isJump(T) && this.same(F, T) ? [noElse(T)] : []
    return [...empty, ...this.ifShapesFrom(T, F, ctx)]
  }

  ifShapesFrom(T: number, F: number, ctx: Ctx): IfShape[] {
    const noElse = (end: number): IfShape => ({ thenEnd: end, elseStart: -1, elseEnd: -1, next: end })
    if (F > T && F <= ctx.to) {
      const shapes: IfShape[] = [noElse(F)]
      const e = F - 1
      if (e >= T && this.isJump(e)) {
        const E = e + 1 + this.code[e].sbx
        let withElse: IfShape | null = null
        if (E >= F && E <= ctx.to) withElse = { thenEnd: e, elseStart: F, elseEnd: E, next: E }
        else if (this.same(E, ctx.to)) withElse = { thenEnd: e, elseStart: F, elseEnd: ctx.to, next: ctx.to }
        if (withElse) {
          if (ctx.brk >= 0 && this.same(E, ctx.brk)) shapes.push(withElse)
          else shapes.unshift(withElse)
        }
      }
      // Or the false jump was threaded on through a jump after the if (`if c then return end break`
      // at the end of a repeat body): the then-block ends at that jump.
      for (let x = F - 1; x > T; x--) if (this.isJump(x) && this.same(x, F)) shapes.push(noElse(x))
      return shapes
    }
    // The false jump was threaded on past the end of this block.
    const shapes: IfShape[] = this.same(F, ctx.to) ? [noElse(ctx.to)] : []
    // Or through an else that starts with a jump (else break): find the then-block's escape jump.
    for (let e = ctx.to - 1; e >= T; e--) {
      if (!this.isJump(e) || !this.same(e + 1, F)) continue
      const E = e + 1 + this.code[e].sbx
      if (E > e && E <= ctx.to) shapes.push({ thenEnd: e, elseStart: e + 1, elseEnd: E, next: E })
      else if (this.same(E, ctx.to)) shapes.push({ thenEnd: e, elseStart: e + 1, elseEnd: ctx.to, next: ctx.to })
      break
    }
    // Or through a jump after the if (`if c then ... end break`): the then-block ends at that jump.
    for (let x = ctx.to - 1; x > T; x--) if (this.isJump(x) && this.same(x, F)) shapes.push(noElse(x))
    return shapes
  }

  // ---- loops ----

  /** A while or repeat loop starting at pc (a backward jump to it): its statement, and the pc after. -1 if none. */
  loop(pc: number, to: number, out: Stat[]): number {
    // The farthest jump back here ends the loop; nearer ones may be an inner loop's or part of its
    // until-condition (`until a and b` jumps back twice): tried in that order.
    const backs = (this.backJumps.get(pc) ?? []).filter((j) => j < to).sort((x, y) => y - x)
    for (const back of backs) {
      const stats: Stat[] = []
      const next = this.attempt(() =>
        this.isJump(back) ? this.whileStat(pc, back, stats) : this.repeatStat(pc, back, stats),
      )
      if (next !== null) {
        out.push(...stats)
        return next
      }
    }
    return -1
  }

  whileStat(pc: number, back: number, out: Stat[]): number {
    const exit = back + 1
    const ctx: Ctx = { to: back, brk: exit }
    const r = this.unitFrom(pc, new State(), back)
    if (r && r.st.empty()) {
      const chain = this.unitChain(r.unit, back)
      for (let k = chain.length; k >= 1; k--) {
        const u = chain[k - 1]
        if (!this.same(u.target, exit)) continue
        const cond = this.condition(chain, k, u.end, u.target)
        if (!cond) continue
        const body = this.attempt(() => this.block(u.end, back, ctx))
        if (!body) continue
        out.push({ kind: 'While', cond, body })
        return exit
      }
    }
    // while true: jumps back to the start from inside are the ends of ifs, not another loop (if that
    // works). But an if with nothing in it was the until of a repeat filling the loop.
    const before = new Set(this.claimed)
    const asIfs = this.attempt(() => this.block(pc, back, ctx, { head: pc, headBack: -1 }))
    const emptyIf = (b: Block) => b.some((s) => s.kind === 'If' && !s.orelse && s.clauses.every((c) => !c.body.length))
    let body: Block
    if (asIfs && !emptyIf(asIfs)) body = asIfs
    else {
      const afterIfs = this.claimed
      this.claimed = new Set(before)
      const asLoops = asIfs
        ? this.attempt(() => this.block(pc, back, ctx, { head: pc, headBack: back }))
        : this.block(pc, back, ctx, { head: pc, headBack: back })
      if (asLoops) body = asLoops
      else {
        this.claimed = afterIfs
        body = asIfs!
      }
    }
    // Its jump back has the line of `while`.
    out.push({ kind: 'While', cond: { kind: 'True' }, body, line: this.ln(back) })
    return exit
  }

  repeatStat(pc: number, back: number, out: Stat[]): number {
    const exit = back + 1
    const until = { cond: null as Expr | null }
    const body = this.block(pc, exit, { to: exit, brk: exit }, { untilHead: pc, until, head: pc, headBack: back })
    out.push({ kind: 'Repeat', body, cond: until.cond! })
    return exit
  }

  forNum(pc: number, st: State, out: Stat[]): number {
    const i = this.code[pc]
    const a = i.a
    const loopEnd = pc + 1 + i.sbx
    if (this.code[loopEnd]?.op !== OP.FORLOOP) fail(`FORPREP at ${pc} doesn't jump to a FORLOOP`)
    // The control values wait in a..a+2 (their hidden locals start at FORPREP itself).
    const control = (r: number) => {
      const p = st.p[r]
      if (!p) return fail(`for at ${pc}: register ${r} is empty`)
      st.p[r] = undefined
      return this.single(p)
    }
    const step = control(a + 2)
    const limit = control(a + 1)
    const start = control(a)
    if (!st.empty()) fail(`for at ${pc} with other values waiting`)
    const v = (this.startsAt.get(pc + 1) ?? []).find((l) => l.reg === a + 3 && !this.claimed.has(l))
    if (!v) return fail(`for at ${pc} has no loop variable`)
    this.claimed.add(v)
    const body = this.block(pc + 1, loopEnd, { to: loopEnd, brk: loopEnd + 1 })
    // A step of 1 is the default (and compiles the same).
    const one = step.kind === 'Number' && step.value === 1
    out.push({ kind: 'NumericFor', var: v.name, start, limit, step: one ? null : step, body })
    return loopEnd + 1
  }

  forIn(pc: number, tfor: number, st: State, out: Stat[]): number {
    const t = this.code[tfor]
    const a = t.a
    const vals: Pend[] = []
    for (let r = a; r <= a + 2; r++) {
      const p = st.p[r]
      if (!p) return fail(`for-in at ${pc}: register ${r} is empty`)
      st.p[r] = undefined
      vals.push({ ...p, temp: true })
    }
    if (!st.empty()) fail(`for-in at ${pc} with other values waiting`)
    const exprs = this.explist(vals, 3)
    const vars = (this.startsAt.get(pc + 1) ?? [])
      .filter((l) => l.reg >= a + 3 && !this.claimed.has(l))
      .sort((x, y) => x.reg - y.reg)
    if (vars.length !== t.c) fail(`for-in at ${pc}: ${vars.length} variables, expected ${t.c}`)
    for (const l of vars) this.claimed.add(l)
    const body = this.block(pc + 1, tfor, { to: tfor, brk: tfor + 2 })
    out.push({ kind: 'GenericFor', names: vars.map((l) => l.name), exprs, body })
    return tfor + 2
  }

  run(): FunctionExpr {
    const f = this.f
    // The last instruction is the RETURN every function ends with.
    const body = this.block(0, this.n - 1, { to: this.n - 1, brk: -1 })
    // The main chunk's closing RETURN has the line of the file's last token: a last statement's `end`.
    const last = body[body.length - 1]
    if (
      !f.debug?.lineDefined &&
      last &&
      (last.kind === 'If' ||
        last.kind === 'While' ||
        last.kind === 'NumericFor' ||
        last.kind === 'GenericFor' ||
        last.kind === 'Do')
    )
      last.endLine ??= this.ln(this.n - 1)
    return {
      kind: 'Function',
      params: this.locals.slice(0, f.paramCount).map((l) => l.name),
      isVararg: (f.varargFlags & 2) !== 0,
      body,
      line: f.debug?.lineDefined,
      endLine: f.debug?.lastLineDefined,
    }
  }
}

function decompileFunction(f: HksProto, failures: { name: string; reason: string }[]): FunctionExpr {
  const d = new FuncDecompiler(f, failures)
  try {
    return d.run()
  } catch (e) {
    if (!(e instanceof DecompileError)) throw e
    failures.push({ name: f.debug?.name ?? '(anonymous)', reason: e.message })
    return {
      kind: 'Function',
      params: d.locals.slice(0, f.paramCount).map((l) => l.name),
      isVararg: (f.varargFlags & 2) !== 0,
      body: [{ kind: 'Comment', text: `Spellforge couldn't decompile this function: ${e.message}` }],
    }
  }
}

export interface DecompileOptions {
  /**
   * Keep the original line numbers (from the debug info): statements on
   * their source lines, with blank lines where the source had comments or
   * spacing. Recompiled, the text then gives the same line info as retail.
   * Default true; false packs the code with a blank line between functions.
   */
  preserveLines?: boolean
}

/** Decompiles a chunk to source text. */
export function decompileHks(chunk: HksChunk, opts: DecompileOptions = {}): DecompileResult {
  const failures: { name: string; reason: string }[] = []
  const main = decompileFunction(chunk.main, failures)
  const preserve = opts.preserveLines ?? true
  const p = new Printer({ preserveLines: preserve, blankLinesBetweenFunctions: !preserve })
  p.block(main.body)
  return { text: p.text(), functions: p.functions, failures }
}
