/**
 * Compiles HavokScript source to bytecode the way the game's compiler does,
 * so a script compiled here is instruction-for-instruction what the game
 * would build from the same text (the hks suite recompiles every decompiled
 * retail function and compares).
 *
 * It is a single-pass port of Lua 5.1.5's lparser.c and lcode.c, with the
 * changes HavokScript makes, as hksc documents them and Elden Ring's scripts
 * confirm:
 *
 *   - reading a global is GETGLOBAL_MEM + DATA 20 k, where k is a pair of nil
 *     constants reserved for it at its first read in the function (a cache);
 *   - reading t[k] is GETTABLE + two DATA 0 0;
 *   - a closure's upvalues follow CLOSURE as DATA 1 reg (a local) or
 *     DATA 2 n (an upvalue of the enclosing function);
 *   - B is 8 bits; a constant B (an RK operand) sets the opcode's low bit,
 *     giving the _BK opcodes (EQ_BK, LT_BK, ADD_BK, SETTABLE_BK...);
 *   - LOADNIL at the start of a function is not skipped;
 *   - a `while` loop's backward jump gets the line of `while`;
 *   - names in localstat / for / parameter lists are read with a lookahead,
 *     which moves "the last line" (the line given to the next instruction)
 *     to the token after the name;
 *   - the function's debug name is built from its declaration ("a.b:c");
 *   - when a function is finished: GETTABLE with a string constant key
 *     becomes GETFIELD, other GETTABLEs GETTABLE_S; SETTABLE with a string
 *     constant key SETFIELD, others SETTABLE_S(_BK); CALL and TAILCALL become
 *     CALL_I / TAILCALL_I; then an instruction that isn't a jump target and
 *     uses the register the previous instruction (skipping DATA) just wrote
 *     takes its _R1 form (GETFIELD_R1, CALL_I_R1, TEST_R1, ...).
 *
 * Numbers are float32 (constant folding too). The main function is named
 * "(main chunk)" with source "@", as in retail files.
 *
 * Credit: Lua 5.1 (Lua.org, PUC-Rio; MIT, notice in THIRD_PARTY_NOTICES.txt):
 * this compiler is a port of its parser and code generator. hksc
 * (Jake-NotTheMuss): HavokScript's changes to them.
 */
import {
  ER_HKS_HEADER,
  ER_HKS_TYPES,
  type HksChunk,
  type HksConstant,
  type HksLocal,
  type HksProto,
} from './bytecode.ts'
import { HksSyntaxError, tokenize, tokenText, type Token } from './lexer.ts'
import {
  BITRK,
  FIELDS_PER_FLUSH,
  MAXARG_Bx,
  MAXARG_C,
  MAXARG_sBx,
  MAXINDEXRK,
  OP,
  OP_INFO,
  argA,
  argBx,
  argC,
  opOf,
} from './opcodes.ts'

export interface CompileOptions {
  /** Source name stored on the main function (retail: "@"). */
  chunkName?: string
  /**
   * Globals to read as these numbers instead (for comparing community
   * texts, which name the game's env/act ids as globals, with retail code
   * that has the numbers).
   */
  constants?: ReadonlyMap<string, number>
}

// expdesc kinds (lparser.h)
const VVOID = 0
const VNIL = 1
const VTRUE = 2
const VFALSE = 3
const VK = 4
const VKNUM = 5
const VLOCAL = 6
const VUPVAL = 7
const VGLOBAL = 8
const VINDEXED = 9
const VJMP = 10
const VRELOCABLE = 11
const VNONRELOC = 12
const VCALL = 13
const VVARARG = 14

const NO_JUMP = -1
const NO_REG = 0xff
const LUA_MULTRET = -1
const MAXSTACK = 250
const LUAI_MAXVARS = 200
const LUAI_MAXUPVALUES = 60
const LUAI_MAXCCALLS = 200

const VARARG_HASARG = 1
const VARARG_ISVARARG = 2
const VARARG_NEEDSARG = 4

// Binary operators (lcode.h order) and priorities.
const OPR_ADD = 0
const OPR_SUB = 1
const OPR_MUL = 2
const OPR_DIV = 3
const OPR_MOD = 4
const OPR_POW = 5
const OPR_CONCAT = 6
const OPR_NE = 7
const OPR_EQ = 8
const OPR_LT = 9
const OPR_LE = 10
const OPR_GT = 11
const OPR_GE = 12
const OPR_AND = 13
const OPR_OR = 14
const OPR_NOBINOPR = 15
const OPR_MINUS = 0
const OPR_NOT = 1
const OPR_LEN = 2
const OPR_NOUNOPR = 3
const PRIORITY: [number, number][] = [
  [6, 6],
  [6, 6],
  [7, 7],
  [7, 7],
  [7, 7],
  [10, 9],
  [5, 4],
  [3, 3],
  [3, 3],
  [3, 3],
  [3, 3],
  [3, 3],
  [3, 3],
  [2, 2],
  [1, 1],
]
const UNARY_PRIORITY = 8
const BINOPR: Record<string, number> = {
  '+': OPR_ADD,
  '-': OPR_SUB,
  '*': OPR_MUL,
  '/': OPR_DIV,
  '%': OPR_MOD,
  '^': OPR_POW,
  '..': OPR_CONCAT,
  '~=': OPR_NE,
  '==': OPR_EQ,
  '<': OPR_LT,
  '<=': OPR_LE,
  '>': OPR_GT,
  '>=': OPR_GE,
  and: OPR_AND,
  or: OPR_OR,
}

interface ExpDesc {
  k: number
  info: number
  aux: number
  nval: number
  t: number
  f: number
}

const newExp = (): ExpDesc => ({ k: VVOID, info: 0, aux: 0, nval: 0, t: NO_JUMP, f: NO_JUMP })
function initExp(e: ExpDesc, k: number, info: number) {
  e.k = k
  e.info = info
  e.t = e.f = NO_JUMP
}
const hasjumps = (e: ExpDesc) => e.t !== e.f
const hasmultret = (k: number) => k === VCALL || k === VVARARG
const isnumeral = (e: ExpDesc) => e.k === VKNUM && e.t === NO_JUMP && e.f === NO_JUMP

interface BlockCnt {
  previous: BlockCnt | null
  breaklist: number
  nactvar: number
  upval: boolean
  isbreakable: boolean
}

class FuncState {
  prev: FuncState | null = null
  code: number[] = []
  lineinfo: number[] = []
  k: HksConstant[] = []
  p: HksProto[] = []
  locvars: HksLocal[] = []
  upvalueNames: string[] = []
  upvalues: { k: number; info: number }[] = []
  actvar: number[] = []
  /** Constant lookup (addk's table). */
  h = new Map<string, number>()
  /** Global name constant -> its memo slot pair. */
  memo = new Map<number, number>()
  bl: BlockCnt | null = null
  pc = 0
  lasttarget = -1
  jpc = NO_JUMP
  freereg = 0
  nk = 0
  nactvar = 0
  numparams = 0
  isVararg = 0
  maxstacksize = 2
  nups = 0
  linedefined = 0
  lastlinedefined = 0
  source: string | null = null
  name: string | null = null
}

// Instruction fields; B is 9 bits (spilling into the opcode's low bit) on _BK-capable opcodes.
const isBK = (op: number) => OP_INFO[op]?.format === 'ABC' && OP_INFO[op].b === 'RK'
const testTMode = (op: number) => OP_INFO[op]?.test === true
const CREATE_ABC = (o: number, a: number, b: number, c: number) => ((o << 25) | (b << 17) | (c << 8) | a) >>> 0
const CREATE_ABx = (o: number, a: number, bx: number) => ((o << 25) | (bx << 8) | a) >>> 0
const GETARG_B = (i: number) => (i >>> 17) & (isBK(i >>> 25) ? 0x1ff : 0xff)
const GETARG_sBx = (i: number) => argBx(i) - MAXARG_sBx
function SETARG_A(i: number, a: number) {
  return ((i & ~0xff) | (a & 0xff)) >>> 0
}
function SETARG_B(i: number, b: number) {
  const mask = (isBK(i >>> 25) ? 0x1ff : 0xff) << 17
  return ((i & ~mask) | ((b << 17) & mask)) >>> 0
}
function SETARG_C(i: number, c: number) {
  return ((i & ~(0x1ff << 8)) | ((c & 0x1ff) << 8)) >>> 0
}
function SETARG_Bx(i: number, bx: number) {
  return ((i & ~(0x1ffff << 8)) | ((bx & 0x1ffff) << 8)) >>> 0
}
const SETARG_sBx = (i: number, sbx: number) => SETARG_Bx(i, sbx + MAXARG_sBx)
function SET_OPCODE(i: number, o: number) {
  const old = i >>> 25
  if (isBK(old)) o |= old & 1
  return ((i & 0x1ffffff) | (o << 25)) >>> 0
}

/** luaO_int2fb: a table size as "floating point byte" (eeeeexxx). */
function int2fb(x: number): number {
  let e = 0
  while (x >= 16) {
    x = (x + 1) >>> 1
    e++
  }
  if (x < 8) return x
  return ((e + 1) << 3) | (x - 8)
}

const f32 = Math.fround

// Opcodes whose result register the next instruction can use as R1, and the R1 forms.
const MAKE_R1 = new Set<number>([
  OP.GETFIELD,
  OP.GETGLOBAL,
  OP.MOVE,
  OP.SELF,
  OP.GETUPVAL,
  OP.NEWTABLE,
  OP.SETUPVAL_R1,
  OP.GETFIELD_R1,
  OP.NEWSTRUCT,
  OP.GETFIELD_MM,
  OP.GETGLOBAL_MEM,
])
const R1_FORM: Record<number, [number, 'A' | 'B']> = {
  [OP.GETFIELD]: [OP.GETFIELD_R1, 'B'],
  [OP.TEST]: [OP.TEST_R1, 'A'],
  [OP.CALL_I]: [OP.CALL_I_R1, 'A'],
  [OP.SETFIELD]: [OP.SETFIELD_R1, 'A'],
  [OP.TAILCALL_I]: [OP.TAILCALL_I_R1, 'A'],
  [OP.SETUPVAL]: [OP.SETUPVAL_R1, 'A'],
  [OP.NOT]: [OP.NOT_R1, 'B'],
}

/** The rewrite HavokScript applies to a finished function (opcode specialisation, then R1 forms). */
function specialize(code: number[], k: HksConstant[]) {
  for (let i = 0; i < code.length; i++) {
    const ins = code[i]
    const op = opOf(ins)
    if (op === OP.GETTABLE) {
      const c = argC(ins)
      if (!(c & BITRK) || k[c & ~BITRK].type !== 'string') code[i] = SET_OPCODE(ins, OP.GETTABLE_S)
      else code[i] = SETARG_C(SET_OPCODE(ins, OP.GETFIELD), c & ~BITRK)
    } else if (op === OP.SETTABLE || op === OP.SETTABLE_BK) {
      const b = GETARG_B(ins)
      if (!(b & BITRK) || k[b & ~BITRK].type !== 'string') code[i] = SET_OPCODE(ins, OP.SETTABLE_S)
      else code[i] = CREATE_ABC(OP.SETFIELD, argA(ins), b & ~BITRK, argC(ins))
    } else if (op === OP.CALL) code[i] = SET_OPCODE(ins, OP.CALL_I)
    else if (op === OP.TAILCALL) code[i] = SET_OPCODE(ins, OP.TAILCALL_I)
  }
  // Basic block leaders: jump targets and the instructions after jumps/tests.
  const leader = new Uint8Array(code.length + 2)
  for (let i = 0; i < code.length; i++) {
    const op = opOf(code[i])
    if (testTMode(op) || (op === OP.LOADBOOL && argC(code[i]) !== 0)) {
      leader[i + 1] = 1
      leader[i + 2] = 1
    } else if (op === OP.JMP || op === OP.FORLOOP || op === OP.FORPREP) {
      leader[i + 1] = 1
      const t = i + 1 + GETARG_sBx(code[i])
      if (t >= 0 && t < leader.length) leader[t] = 1
    }
  }
  for (let i = 1; i < code.length; i++) {
    if (leader[i]) continue
    let p = i - 1
    let prev = code[p]
    while (opOf(prev) === OP.DATA && p > 0) prev = code[--p]
    if (!MAKE_R1.has(opOf(prev))) continue
    const r1 = R1_FORM[opOf(code[i])]
    if (r1 && ((r1[1] === 'A' && argA(prev) === argA(code[i])) || (r1[1] === 'B' && argA(prev) === GETARG_B(code[i]))))
      code[i] = SET_OPCODE(code[i], r1[0])
  }
}

class Compiler {
  toks: Token[]
  ti = -1
  t!: Token
  lookahead: Token | null = null
  linenumber = 1
  lastline = 1
  fs!: FuncState
  nCcalls = 0
  /** Name parts of the function being declared (funcname / local function). */
  nameParts: string[] = []
  opts: CompileOptions

  constructor(source: string, opts: CompileOptions) {
    this.toks = tokenize(source)
    this.opts = opts
  }

  // ---- lexer state (llex.c's luaX_next / luaX_lookahead) ----

  next() {
    this.lastline = this.linenumber
    if (this.lookahead) {
      this.t = this.lookahead
      this.lookahead = null
      this.ti++
    } else {
      this.ti = Math.min(this.ti + 1, this.toks.length - 1)
      this.t = this.toks[this.ti]
      this.linenumber = this.t.endLine
    }
  }

  peek(): Token {
    if (!this.lookahead) {
      this.lookahead = this.toks[Math.min(this.ti + 1, this.toks.length - 1)]
      this.linenumber = this.lookahead.endLine
    }
    return this.lookahead
  }

  error(msg: string, tok: Token = this.t): never {
    throw new HksSyntaxError(`${msg} near '${tokenText(tok)}'`, tok.line, tok.col)
  }

  is(v: string) {
    return (this.t.type === 'op' || this.t.type === 'keyword') && this.t.value === v
  }

  testnext(v: string) {
    if (!this.is(v)) return false
    this.next()
    return true
  }

  check(v: string) {
    if (!this.is(v)) this.error(`'${v}' expected`)
  }

  checknext(v: string) {
    this.check(v)
    this.next()
  }

  checkMatch(what: string, who: string, line: number) {
    if (this.testnext(what)) return
    if (line === this.linenumber) this.error(`'${what}' expected`)
    this.error(`'${what}' expected (to close '${who}' at line ${line})`)
  }

  strCheckname(): string {
    if (this.t.type !== 'name') {
      if (this.t.type === 'keyword' && (this.t.value === 'hstructure' || this.t.value === 'hmake'))
        this.error(`'${this.t.value}' is reserved in HavokScript`)
      this.error("'<name>' expected")
    }
    const v = this.t.value
    this.next()
    return v
  }

  /** str_peekname + luaX_lookahead + luaX_next, as HavokScript reads declared names. */
  peekedName(): string {
    if (this.t.type !== 'name') this.strCheckname()
    const v = this.t.value
    if (this.peek().type === 'op' && this.peek().value === ':')
      this.error('typed variables (HavokScript structures) are not supported')
    this.next()
    return v
  }

  enterlevel() {
    if (++this.nCcalls > LUAI_MAXCCALLS) this.error('chunk has too many syntax levels')
  }

  leavelevel() {
    this.nCcalls--
  }

  // ---- lcode.c ----

  code(i: number, line: number): number {
    const fs = this.fs
    this.dischargejpc()
    fs.code[fs.pc] = i
    fs.lineinfo[fs.pc] = line
    return fs.pc++
  }

  codeABC(o: number, a: number, b: number, c: number) {
    return this.code(CREATE_ABC(o, a, b, c), this.lastline)
  }

  codeABx(o: number, a: number, bx: number) {
    return this.code(CREATE_ABx(o, a, bx), this.lastline)
  }

  codeAsBx(o: number, a: number, sbx: number) {
    return this.codeABx(o, a, sbx + MAXARG_sBx)
  }

  fixline(line: number) {
    this.fs.lineinfo[this.fs.pc - 1] = line
  }

  nil(from: number, n: number) {
    const fs = this.fs
    if (fs.pc > fs.lasttarget && fs.pc !== 0) {
      const prev = fs.code[fs.pc - 1]
      if (opOf(prev) === OP.LOADNIL) {
        const pfrom = argA(prev)
        const pto = GETARG_B(prev)
        if (pfrom <= from && from <= pto + 1) {
          if (from + n - 1 > pto) fs.code[fs.pc - 1] = SETARG_B(prev, from + n - 1)
          return
        }
      }
    }
    this.codeABC(OP.LOADNIL, from, from + n - 1, 0)
  }

  jump(): number {
    const fs = this.fs
    const jpc = fs.jpc
    fs.jpc = NO_JUMP
    const j = { v: this.codeAsBx(OP.JMP, 0, NO_JUMP) }
    this.concat(j, jpc)
    return j.v
  }

  ret(first: number, nret: number) {
    this.codeABC(OP.RETURN, first, nret + 1, 0)
  }

  condjump(op: number, a: number, b: number, c: number): number {
    this.codeABC(op, a, b, c)
    return this.jump()
  }

  fixjump(pc: number, dest: number) {
    const offset = dest - (pc + 1)
    if (Math.abs(offset) > MAXARG_sBx) this.error('control structure too long')
    this.fs.code[pc] = SETARG_sBx(this.fs.code[pc], offset)
  }

  getlabel(): number {
    this.fs.lasttarget = this.fs.pc
    return this.fs.pc
  }

  getjump(pc: number): number {
    const offset = GETARG_sBx(this.fs.code[pc])
    return offset === NO_JUMP ? NO_JUMP : pc + 1 + offset
  }

  getjumpcontrol(pc: number): number {
    return pc >= 1 && testTMode(opOf(this.fs.code[pc - 1])) ? pc - 1 : pc
  }

  needValue(list: number): boolean {
    for (; list !== NO_JUMP; list = this.getjump(list)) {
      if (opOf(this.fs.code[this.getjumpcontrol(list)]) !== OP.TESTSET) return true
    }
    return false
  }

  patchtestreg(node: number, reg: number): boolean {
    const at = this.getjumpcontrol(node)
    const i = this.fs.code[at]
    if (opOf(i) !== OP.TESTSET) return false
    if (reg !== NO_REG && reg !== GETARG_B(i)) this.fs.code[at] = SETARG_A(i, reg)
    else this.fs.code[at] = CREATE_ABC(OP.TEST, GETARG_B(i), 0, argC(i))
    return true
  }

  removevalues(list: number) {
    for (; list !== NO_JUMP; list = this.getjump(list)) this.patchtestreg(list, NO_REG)
  }

  patchlistaux(list: number, vtarget: number, reg: number, dtarget: number) {
    while (list !== NO_JUMP) {
      const next = this.getjump(list)
      if (this.patchtestreg(list, reg)) this.fixjump(list, vtarget)
      else this.fixjump(list, dtarget)
      list = next
    }
  }

  dischargejpc() {
    const fs = this.fs
    this.patchlistaux(fs.jpc, fs.pc, NO_REG, fs.pc)
    fs.jpc = NO_JUMP
  }

  patchlist(list: number, target: number) {
    if (target === this.fs.pc) this.patchtohere(list)
    else this.patchlistaux(list, target, NO_REG, target)
  }

  patchtohere(list: number) {
    this.getlabel()
    const j = { v: this.fs.jpc }
    this.concat(j, list)
    this.fs.jpc = j.v
  }

  concat(l1: { v: number }, l2: number) {
    if (l2 === NO_JUMP) return
    if (l1.v === NO_JUMP) l1.v = l2
    else {
      let list = l1.v
      let next: number
      while ((next = this.getjump(list)) !== NO_JUMP) list = next
      this.fixjump(list, l2)
    }
  }

  checkstack(n: number) {
    const fs = this.fs
    const newstack = fs.freereg + n
    if (newstack > fs.maxstacksize) {
      if (newstack >= MAXSTACK) this.error('function or expression too complex')
      fs.maxstacksize = newstack
    }
  }

  reserveregs(n: number) {
    this.checkstack(n)
    this.fs.freereg += n
  }

  freereg(reg: number) {
    if (!(reg & BITRK) && reg >= this.fs.nactvar) this.fs.freereg--
  }

  freeexp(e: ExpDesc) {
    if (e.k === VNONRELOC) this.freereg(e.info)
  }

  addk(key: string, v: HksConstant): number {
    const fs = this.fs
    const idx = fs.h.get(key)
    if (idx !== undefined) return idx
    if (fs.nk > MAXARG_Bx) this.error('constant table overflow')
    fs.h.set(key, fs.nk)
    fs.k[fs.nk] = v
    return fs.nk++
  }

  stringK(s: string) {
    return this.addk('s' + s, { type: 'string', value: s })
  }

  numberK(r: number) {
    return this.addk('n' + (r === 0 ? 0 : r), { type: 'number', value: r })
  }

  boolK(b: boolean) {
    return this.addk(b ? 'T' : 'F', { type: 'boolean', value: b })
  }

  nilK() {
    return this.addk('nil', { type: 'nil' })
  }

  /** HavokScript's per-function cache for a global: two nil constants, reserved at its first read. */
  memoSlot(kslot: number): number {
    const fs = this.fs
    const m = fs.memo.get(kslot)
    if (m !== undefined) return m
    const slot = fs.nk
    fs.memo.set(kslot, slot)
    fs.k[fs.nk] = { type: 'nil' }
    fs.k[fs.nk + 1] = { type: 'nil' }
    fs.nk += 2
    return slot
  }

  setreturns(e: ExpDesc, nresults: number) {
    const fs = this.fs
    if (e.k === VCALL) fs.code[e.info] = SETARG_C(fs.code[e.info], nresults + 1)
    else if (e.k === VVARARG) {
      fs.code[e.info] = SETARG_B(fs.code[e.info], nresults + 1)
      fs.code[e.info] = SETARG_A(fs.code[e.info], fs.freereg)
      this.reserveregs(1)
    }
  }

  setmultret(e: ExpDesc) {
    this.setreturns(e, LUA_MULTRET)
  }

  setoneret(e: ExpDesc) {
    if (e.k === VCALL) {
      e.k = VNONRELOC
      e.info = argA(this.fs.code[e.info])
    } else if (e.k === VVARARG) {
      this.fs.code[e.info] = SETARG_B(this.fs.code[e.info], 2)
      e.k = VRELOCABLE
    }
  }

  dischargevars(e: ExpDesc) {
    switch (e.k) {
      case VLOCAL:
        e.k = VNONRELOC
        break
      case VUPVAL:
        e.info = this.codeABC(OP.GETUPVAL, 0, e.info, 0)
        e.k = VRELOCABLE
        break
      case VGLOBAL: {
        const k = e.info
        e.info = this.codeABx(OP.GETGLOBAL_MEM, 0, k)
        this.codeABx(OP.DATA, 20, this.memoSlot(k))
        e.k = VRELOCABLE
        break
      }
      case VINDEXED:
        this.freereg(e.aux)
        this.freereg(e.info)
        e.info = this.codeABC(OP.GETTABLE, 0, e.info, e.aux)
        e.k = VRELOCABLE
        this.codeABx(OP.DATA, 0, 0)
        this.codeABx(OP.DATA, 0, 0)
        break
      case VVARARG:
      case VCALL:
        this.setoneret(e)
        break
      default:
        break
    }
  }

  discharge2reg(e: ExpDesc, reg: number) {
    const fs = this.fs
    this.dischargevars(e)
    switch (e.k) {
      case VNIL:
        this.nil(reg, 1)
        break
      case VFALSE:
      case VTRUE:
        this.codeABC(OP.LOADBOOL, reg, e.k === VTRUE ? 1 : 0, 0)
        break
      case VK:
        this.codeABx(OP.LOADK, reg, e.info)
        break
      case VKNUM:
        this.codeABx(OP.LOADK, reg, this.numberK(e.nval))
        break
      case VRELOCABLE:
        fs.code[e.info] = SETARG_A(fs.code[e.info], reg)
        break
      case VNONRELOC:
        if (reg !== e.info) this.codeABC(OP.MOVE, reg, e.info, 0)
        break
      default:
        return
    }
    e.info = reg
    e.k = VNONRELOC
  }

  discharge2anyreg(e: ExpDesc) {
    if (e.k !== VNONRELOC) {
      this.reserveregs(1)
      this.discharge2reg(e, this.fs.freereg - 1)
    }
  }

  codeLabel(a: number, b: number, jump: number) {
    this.getlabel()
    return this.codeABC(OP.LOADBOOL, a, b, jump)
  }

  exp2reg(e: ExpDesc, reg: number) {
    this.discharge2reg(e, reg)
    if (e.k === VJMP) {
      const t = { v: e.t }
      this.concat(t, e.info)
      e.t = t.v
    }
    if (hasjumps(e)) {
      let pf = NO_JUMP
      let pt = NO_JUMP
      if (this.needValue(e.t) || this.needValue(e.f)) {
        const fj = e.k === VJMP ? NO_JUMP : this.jump()
        pf = this.codeLabel(reg, 0, 1)
        pt = this.codeLabel(reg, 1, 0)
        this.patchtohere(fj)
      }
      const final = this.getlabel()
      this.patchlistaux(e.f, final, reg, pf)
      this.patchlistaux(e.t, final, reg, pt)
    }
    e.f = e.t = NO_JUMP
    e.info = reg
    e.k = VNONRELOC
  }

  exp2nextreg(e: ExpDesc) {
    this.dischargevars(e)
    this.freeexp(e)
    this.reserveregs(1)
    this.exp2reg(e, this.fs.freereg - 1)
  }

  exp2anyreg(e: ExpDesc): number {
    this.dischargevars(e)
    if (e.k === VNONRELOC) {
      if (!hasjumps(e)) return e.info
      if (e.info >= this.fs.nactvar) {
        this.exp2reg(e, e.info)
        return e.info
      }
    }
    this.exp2nextreg(e)
    return e.info
  }

  exp2val(e: ExpDesc) {
    if (hasjumps(e)) this.exp2anyreg(e)
    else this.dischargevars(e)
  }

  exp2RK(e: ExpDesc): number {
    this.exp2val(e)
    switch (e.k) {
      case VKNUM:
      case VTRUE:
      case VFALSE:
      case VNIL:
        if (this.fs.nk <= MAXINDEXRK) {
          e.info = e.k === VNIL ? this.nilK() : e.k === VKNUM ? this.numberK(e.nval) : this.boolK(e.k === VTRUE)
          e.k = VK
          return e.info | BITRK
        }
        break
      case VK:
        if (e.info <= MAXINDEXRK) return e.info | BITRK
        break
      default:
        break
    }
    return this.exp2anyreg(e)
  }

  storevar(v: ExpDesc, ex: ExpDesc) {
    switch (v.k) {
      case VLOCAL:
        this.freeexp(ex)
        this.exp2reg(ex, v.info)
        return
      case VUPVAL: {
        const e = this.exp2anyreg(ex)
        this.codeABC(OP.SETUPVAL, e, v.info, 0)
        break
      }
      case VGLOBAL: {
        const e = this.exp2anyreg(ex)
        this.codeABx(OP.SETGLOBAL, e, v.info)
        break
      }
      case VINDEXED: {
        const e = this.exp2RK(ex)
        this.codeABC(OP.SETTABLE, v.info, v.aux, e)
        break
      }
      default:
        break
    }
    this.freeexp(ex)
  }

  self(e: ExpDesc, key: ExpDesc) {
    this.exp2anyreg(e)
    this.freeexp(e)
    const func = this.fs.freereg
    this.reserveregs(2)
    this.codeABC(OP.SELF, func, e.info, this.exp2RK(key))
    this.freeexp(key)
    e.info = func
    e.k = VNONRELOC
  }

  invertjump(e: ExpDesc) {
    const at = this.getjumpcontrol(e.info)
    const i = this.fs.code[at]
    this.fs.code[at] = SETARG_A(i, argA(i) ? 0 : 1)
  }

  jumponcond(e: ExpDesc, cond: number): number {
    if (e.k === VRELOCABLE) {
      const ie = this.fs.code[e.info]
      if (opOf(ie) === OP.NOT) {
        this.fs.pc--
        return this.condjump(OP.TEST, GETARG_B(ie), 0, cond ? 0 : 1)
      }
    }
    this.discharge2anyreg(e)
    this.freeexp(e)
    return this.condjump(OP.TESTSET, NO_REG, e.info, cond)
  }

  goiftrue(e: ExpDesc) {
    let pc: number
    this.dischargevars(e)
    switch (e.k) {
      case VK:
      case VKNUM:
      case VTRUE:
        pc = NO_JUMP
        break
      case VFALSE:
        pc = this.jump()
        break
      case VJMP:
        this.invertjump(e)
        pc = e.info
        break
      default:
        pc = this.jumponcond(e, 0)
        break
    }
    const f = { v: e.f }
    this.concat(f, pc)
    e.f = f.v
    this.patchtohere(e.t)
    e.t = NO_JUMP
  }

  goiffalse(e: ExpDesc) {
    let pc: number
    this.dischargevars(e)
    switch (e.k) {
      case VNIL:
      case VFALSE:
        pc = NO_JUMP
        break
      case VTRUE:
        pc = this.jump()
        break
      case VJMP:
        pc = e.info
        break
      default:
        pc = this.jumponcond(e, 1)
        break
    }
    const t = { v: e.t }
    this.concat(t, pc)
    e.t = t.v
    this.patchtohere(e.f)
    e.f = NO_JUMP
  }

  codenot(e: ExpDesc) {
    this.dischargevars(e)
    switch (e.k) {
      case VNIL:
      case VFALSE:
        e.k = VTRUE
        break
      case VK:
      case VKNUM:
      case VTRUE:
        e.k = VFALSE
        break
      case VJMP:
        this.invertjump(e)
        break
      case VRELOCABLE:
      case VNONRELOC:
        this.discharge2anyreg(e)
        this.freeexp(e)
        e.info = this.codeABC(OP.NOT, 0, e.info, 0)
        e.k = VRELOCABLE
        break
      default:
        break
    }
    const temp = e.f
    e.f = e.t
    e.t = temp
    this.removevalues(e.f)
    this.removevalues(e.t)
  }

  indexed(t: ExpDesc, k: ExpDesc) {
    t.aux = this.exp2RK(k)
    t.k = VINDEXED
  }

  constfolding(op: number, e1: ExpDesc, e2: ExpDesc): boolean {
    if (!isnumeral(e1) || !isnumeral(e2)) return false
    const v1 = e1.nval
    const v2 = e2.nval
    let r: number
    switch (op) {
      case OP.ADD:
        r = f32(v1 + v2)
        break
      case OP.SUB:
        r = f32(v1 - v2)
        break
      case OP.MUL:
        r = f32(v1 * v2)
        break
      case OP.DIV:
        if (v2 === 0) return false
        r = f32(v1 / v2)
        break
      case OP.MOD:
        if (v2 === 0) return false
        r = f32(v1 - Math.floor(f32(v1 / v2)) * v2)
        break
      case OP.POW:
        r = f32(Math.pow(v1, v2))
        break
      case OP.UNM:
        r = -v1
        break
      case OP.LEN:
        return false
      default:
        return false
    }
    if (Number.isNaN(r)) return false
    e1.nval = r
    return true
  }

  codearith(op: number, e1: ExpDesc, e2: ExpDesc) {
    if (this.constfolding(op, e1, e2)) return
    const o2 = op !== OP.UNM && op !== OP.LEN ? this.exp2RK(e2) : 0
    const o1 = this.exp2RK(e1)
    if (o1 > o2) {
      this.freeexp(e1)
      this.freeexp(e2)
    } else {
      this.freeexp(e2)
      this.freeexp(e1)
    }
    e1.info = this.codeABC(op, 0, o1, o2)
    e1.k = VRELOCABLE
  }

  codecomp(op: number, cond: number, e1: ExpDesc, e2: ExpDesc) {
    let o1 = this.exp2RK(e1)
    let o2 = this.exp2RK(e2)
    this.freeexp(e2)
    this.freeexp(e1)
    if (cond === 0 && op !== OP.EQ) {
      const temp = o1
      o1 = o2
      o2 = temp
      cond = 1
    }
    e1.info = this.condjump(op, cond, o1, o2)
    e1.k = VJMP
  }

  prefix(op: number, e: ExpDesc) {
    const e2 = newExp()
    e2.k = VKNUM
    switch (op) {
      case OPR_MINUS:
        if (!isnumeral(e)) this.exp2anyreg(e)
        this.codearith(OP.UNM, e, e2)
        break
      case OPR_NOT:
        this.codenot(e)
        break
      case OPR_LEN:
        this.exp2anyreg(e)
        this.codearith(OP.LEN, e, e2)
        break
    }
  }

  infix(op: number, v: ExpDesc) {
    switch (op) {
      case OPR_AND:
        this.goiftrue(v)
        break
      case OPR_OR:
        this.goiffalse(v)
        break
      case OPR_CONCAT:
        this.exp2nextreg(v)
        break
      case OPR_ADD:
      case OPR_SUB:
      case OPR_MUL:
      case OPR_DIV:
      case OPR_MOD:
      case OPR_POW:
        if (!isnumeral(v)) this.exp2RK(v)
        break
      default:
        this.exp2RK(v)
        break
    }
  }

  posfix(op: number, e1: ExpDesc, e2: ExpDesc) {
    switch (op) {
      case OPR_AND: {
        this.dischargevars(e2)
        const f = { v: e2.f }
        this.concat(f, e1.f)
        e2.f = f.v
        Object.assign(e1, e2)
        break
      }
      case OPR_OR: {
        this.dischargevars(e2)
        const t = { v: e2.t }
        this.concat(t, e1.t)
        e2.t = t.v
        Object.assign(e1, e2)
        break
      }
      case OPR_CONCAT: {
        this.exp2val(e2)
        if (e2.k === VRELOCABLE && opOf(this.fs.code[e2.info]) === OP.CONCAT) {
          this.freeexp(e1)
          this.fs.code[e2.info] = SETARG_B(this.fs.code[e2.info], e1.info)
          e1.k = VRELOCABLE
          e1.info = e2.info
        } else {
          this.exp2nextreg(e2)
          this.codearith(OP.CONCAT, e1, e2)
        }
        break
      }
      case OPR_ADD:
        this.codearith(OP.ADD, e1, e2)
        break
      case OPR_SUB:
        this.codearith(OP.SUB, e1, e2)
        break
      case OPR_MUL:
        this.codearith(OP.MUL, e1, e2)
        break
      case OPR_DIV:
        this.codearith(OP.DIV, e1, e2)
        break
      case OPR_MOD:
        this.codearith(OP.MOD, e1, e2)
        break
      case OPR_POW:
        this.codearith(OP.POW, e1, e2)
        break
      case OPR_EQ:
        this.codecomp(OP.EQ, 1, e1, e2)
        break
      case OPR_NE:
        this.codecomp(OP.EQ, 0, e1, e2)
        break
      case OPR_LT:
        this.codecomp(OP.LT, 1, e1, e2)
        break
      case OPR_LE:
        this.codecomp(OP.LE, 1, e1, e2)
        break
      case OPR_GT:
        this.codecomp(OP.LT, 0, e1, e2)
        break
      case OPR_GE:
        this.codecomp(OP.LE, 0, e1, e2)
        break
    }
  }

  setlist(base: number, nelems: number, tostore: number) {
    const c = Math.floor((nelems - 1) / FIELDS_PER_FLUSH) + 1
    const b = tostore === LUA_MULTRET ? 0 : tostore
    if (c <= MAXARG_C) this.codeABC(OP.SETLIST, base, b, c)
    else {
      if (c > MAXARG_Bx) this.error('table constructor has too many items')
      this.codeABC(OP.SETLIST, base, b, 0)
      this.codeABx(OP.DATA, 0, c)
    }
    this.fs.freereg = base + 1
  }

  // ---- lparser.c ----

  getlocvar(i: number): HksLocal {
    return this.fs.locvars[this.fs.actvar[i]]
  }

  checklimit(v: number, l: number, what: string) {
    if (v > l) this.error(`too many ${what} (limit is ${l}) in ${this.fs.prev ? 'function' : 'main function'}`)
  }

  registerlocalvar(name: string): number {
    const fs = this.fs
    fs.locvars.push({ name, start: 0, end: 0 })
    return fs.locvars.length - 1
  }

  newLocalvar(name: string, n: number) {
    const fs = this.fs
    this.checklimit(fs.nactvar + n + 1, LUAI_MAXVARS, 'local variables')
    fs.actvar[fs.nactvar + n] = this.registerlocalvar(name)
  }

  adjustlocalvars(nvars: number) {
    const fs = this.fs
    fs.nactvar += nvars
    for (; nvars; nvars--) this.getlocvar(fs.nactvar - nvars).start = fs.pc
  }

  removevars(tolevel: number) {
    const fs = this.fs
    while (fs.nactvar > tolevel) this.getlocvar(--fs.nactvar).end = fs.pc
  }

  indexupvalue(fs: FuncState, name: string, v: ExpDesc): number {
    for (let i = 0; i < fs.nups; i++) {
      if (fs.upvalues[i].k === v.k && fs.upvalues[i].info === v.info) return i
    }
    if (fs.nups + 1 > LUAI_MAXUPVALUES) this.error(`too many upvalues (limit is ${LUAI_MAXUPVALUES})`)
    fs.upvalueNames[fs.nups] = name
    fs.upvalues[fs.nups] = { k: v.k, info: v.info }
    return fs.nups++
  }

  searchvar(fs: FuncState, n: string): number {
    for (let i = fs.nactvar - 1; i >= 0; i--) if (fs.locvars[fs.actvar[i]].name === n) return i
    return -1
  }

  markupval(fs: FuncState, level: number) {
    let bl = fs.bl
    while (bl && bl.nactvar > level) bl = bl.previous
    if (bl) bl.upval = true
  }

  singlevaraux(fs: FuncState | null, n: string, v: ExpDesc, base: boolean): number {
    if (!fs) {
      initExp(v, VGLOBAL, NO_REG)
      return VGLOBAL
    }
    const idx = this.searchvar(fs, n)
    if (idx >= 0) {
      initExp(v, VLOCAL, idx)
      if (!base) this.markupval(fs, idx)
      return VLOCAL
    }
    if (this.singlevaraux(fs.prev, n, v, false) === VGLOBAL) return VGLOBAL
    v.info = this.indexupvalue(fs, n, v)
    v.k = VUPVAL
    return VUPVAL
  }

  singlevar(v: ExpDesc): string {
    const name = this.strCheckname()
    if (this.singlevaraux(this.fs, name, v, true) === VGLOBAL) {
      const num = this.noSubst ? undefined : this.opts.constants?.get(name)
      const t = this.t
      const prefix = (t.type === 'op' && ['.', '[', ':', '(', '{'].includes(t.value)) || t.type === 'string'
      if (num !== undefined && !prefix) {
        initExp(v, VKNUM, 0)
        v.nval = f32(num)
      } else v.info = this.stringK(name)
    }
    this.noSubst = false
    return name
  }

  /** Set while reading an assignment target, whose name is never a substituted constant. */
  noSubst = false

  adjustAssign(nvars: number, nexps: number, e: ExpDesc) {
    let extra = nvars - nexps
    if (hasmultret(e.k)) {
      extra++
      if (extra < 0) extra = 0
      this.setreturns(e, extra)
      if (extra > 1) this.reserveregs(extra - 1)
    } else {
      if (e.k !== VVOID) this.exp2nextreg(e)
      if (extra > 0) {
        const reg = this.fs.freereg
        this.reserveregs(extra)
        this.nil(reg, extra)
      }
    }
  }

  enterblock(bl: BlockCnt, isbreakable: boolean) {
    const fs = this.fs
    bl.breaklist = NO_JUMP
    bl.isbreakable = isbreakable
    bl.nactvar = fs.nactvar
    bl.upval = false
    bl.previous = fs.bl
    fs.bl = bl
  }

  leaveblock() {
    const fs = this.fs
    const bl = fs.bl!
    fs.bl = bl.previous
    this.removevars(bl.nactvar)
    if (bl.upval) this.codeABC(OP.CLOSE, bl.nactvar, 0, 0)
    fs.freereg = fs.nactvar
    this.patchtohere(bl.breaklist)
  }

  newBlock(): BlockCnt {
    return { previous: null, breaklist: NO_JUMP, nactvar: 0, upval: false, isbreakable: false }
  }

  pushclosure(func: FuncState, v: ExpDesc) {
    const fs = this.fs
    fs.p.push(this.finish(func))
    initExp(v, VRELOCABLE, this.codeABx(OP.CLOSURE, 0, fs.p.length - 1))
    for (let i = 0; i < func.nups; i++)
      this.codeABx(OP.DATA, func.upvalues[i].k === VLOCAL ? 1 : 2, func.upvalues[i].info)
  }

  openFunc(): FuncState {
    const fs = new FuncState()
    fs.prev = this.fs ?? null
    if (fs.prev) {
      const name = this.nameParts.join('')
      fs.name = name.length ? name.slice(0, 511) : null
      this.nameParts = []
    } else {
      fs.name = '(main chunk)'
      fs.source = this.opts.chunkName ?? '@'
    }
    this.fs = fs
    return fs
  }

  closeFunc() {
    const fs = this.fs
    this.removevars(0)
    this.ret(0, 0)
    specialize(fs.code, fs.k)
    this.fs = fs.prev!
  }

  /** The finished function as a prototype. */
  finish(fs: FuncState): HksProto {
    return {
      upvalueCount: fs.nups,
      paramCount: fs.numparams,
      varargFlags: fs.isVararg,
      maxStack: fs.maxstacksize,
      code: fs.code,
      constants: fs.k,
      debug: {
        lines: fs.lineinfo,
        locals: fs.locvars,
        upvalueNames: fs.upvalueNames,
        lineDefined: fs.linedefined,
        lastLineDefined: fs.lastlinedefined,
        source: fs.source,
        name: fs.name,
      },
      children: fs.p,
    }
  }

  // ---- grammar ----

  field(v: ExpDesc, part: string | null) {
    const key = newExp()
    this.exp2anyreg(v)
    this.next()
    const name = this.strCheckname()
    initExp(key, VK, this.stringK(name))
    if (part !== null) this.nameParts.push(part + name)
    this.indexed(v, key)
  }

  yindex(v: ExpDesc) {
    this.next()
    this.expr(v)
    this.exp2val(v)
    this.checknext(']')
  }

  recfield(cc: ConsControl) {
    const fs = this.fs
    const reg = fs.freereg
    const key = newExp()
    const val = newExp()
    if (this.t.type === 'name') {
      this.checklimit(cc.nh, 0x7fffffff, 'items in a constructor')
      initExp(key, VK, this.stringK(this.strCheckname()))
    } else this.yindex(key)
    cc.nh++
    this.checknext('=')
    const rkkey = this.exp2RK(key)
    this.expr(val)
    const rkval = this.exp2RK(val)
    this.codeABC(OP.SETTABLE, cc.t.info, rkkey, rkval)
    fs.freereg = reg
  }

  closelistfield(cc: ConsControl) {
    if (cc.v.k === VVOID) return
    this.exp2nextreg(cc.v)
    cc.v.k = VVOID
    if (cc.tostore === FIELDS_PER_FLUSH) {
      this.setlist(cc.t.info, cc.na, cc.tostore)
      cc.tostore = 0
    }
  }

  lastlistfield(cc: ConsControl) {
    if (cc.tostore === 0) return
    if (hasmultret(cc.v.k)) {
      this.setmultret(cc.v)
      this.setlist(cc.t.info, cc.na, LUA_MULTRET)
      cc.na--
    } else {
      if (cc.v.k !== VVOID) this.exp2nextreg(cc.v)
      this.setlist(cc.t.info, cc.na, cc.tostore)
    }
  }

  listfield(cc: ConsControl) {
    this.expr(cc.v)
    cc.na++
    cc.tostore++
  }

  constructor_(t: ExpDesc) {
    const fs = this.fs
    const line = this.linenumber
    const pc = this.codeABC(OP.NEWTABLE, 0, 0, 0)
    const cc: ConsControl = { v: newExp(), t, nh: 0, na: 0, tostore: 0 }
    initExp(t, VRELOCABLE, pc)
    initExp(cc.v, VVOID, 0)
    this.exp2nextreg(t)
    this.checknext('{')
    do {
      if (this.is('}')) break
      this.closelistfield(cc)
      if (this.t.type === 'name') {
        const la = this.peek()
        if (!(la.type === 'op' && la.value === '=')) this.listfield(cc)
        else this.recfield(cc)
      } else if (this.is('[')) this.recfield(cc)
      else this.listfield(cc)
    } while (this.testnext(',') || this.testnext(';'))
    this.checkMatch('}', '{', line)
    this.lastlistfield(cc)
    fs.code[pc] = SETARG_B(fs.code[pc], int2fb(cc.na))
    fs.code[pc] = SETARG_C(fs.code[pc], int2fb(cc.nh))
  }

  parlist() {
    const fs = this.fs
    let nparams = 0
    fs.isVararg = 0
    if (!this.is(')')) {
      do {
        if (this.t.type === 'name') {
          const name = this.peekedName()
          this.newLocalvar(name, nparams++)
        } else if (this.is('...')) {
          this.next()
          this.newLocalvar('arg', nparams++)
          fs.isVararg = VARARG_HASARG | VARARG_NEEDSARG
          fs.isVararg |= VARARG_ISVARARG
        } else this.error("'<name>' or '...' expected")
      } while (!fs.isVararg && this.testnext(','))
    }
    this.adjustlocalvars(nparams)
    fs.numparams = fs.nactvar - (fs.isVararg & VARARG_HASARG)
    this.reserveregs(fs.nactvar)
  }

  body(e: ExpDesc, needself: boolean, line: number) {
    const fs = this.openFunc()
    fs.linedefined = line
    this.checknext('(')
    if (needself) {
      this.newLocalvar('self', 0)
      this.adjustlocalvars(1)
    }
    this.parlist()
    this.checknext(')')
    this.chunk()
    fs.lastlinedefined = this.linenumber
    this.checkMatch('end', 'function', line)
    this.closeFunc()
    this.pushclosure(fs, e)
  }

  explist1(v: ExpDesc): number {
    let n = 1
    this.expr(v)
    while (this.testnext(',')) {
      this.exp2nextreg(v)
      this.expr(v)
      n++
    }
    return n
  }

  funcargs(f: ExpDesc) {
    const fs = this.fs
    const args = newExp()
    const line = this.linenumber
    if (this.is('(')) {
      if (line !== this.lastline) this.error('ambiguous syntax (function call x new statement)')
      this.next()
      if (this.is(')')) args.k = VVOID
      else {
        this.explist1(args)
        this.setmultret(args)
      }
      this.checkMatch(')', '(', line)
    } else if (this.is('{')) this.constructor_(args)
    else if (this.t.type === 'string') {
      initExp(args, VK, this.stringK(this.t.value))
      this.next()
    } else this.error('function arguments expected')
    const base = f.info
    let nparams: number
    if (hasmultret(args.k)) nparams = LUA_MULTRET
    else {
      if (args.k !== VVOID) this.exp2nextreg(args)
      nparams = fs.freereg - (base + 1)
    }
    initExp(f, VCALL, this.codeABC(OP.CALL, base, nparams + 1, 2))
    this.fixline(line)
    fs.freereg = base + 1
  }

  prefixexp(v: ExpDesc) {
    if (this.is('(')) {
      const line = this.linenumber
      this.next()
      this.expr(v)
      this.checkMatch(')', '(', line)
      this.dischargevars(v)
      return
    }
    if (this.t.type === 'name') {
      this.singlevar(v)
      return
    }
    this.error('unexpected symbol')
  }

  primaryexp(v: ExpDesc) {
    this.prefixexp(v)
    for (;;) {
      if (this.is('.')) this.field(v, null)
      else if (this.is('[')) {
        const key = newExp()
        this.exp2anyreg(v)
        this.yindex(key)
        this.indexed(v, key)
      } else if (this.is(':')) {
        const key = newExp()
        this.next()
        initExp(key, VK, this.stringK(this.strCheckname()))
        this.self(v, key)
        this.funcargs(v)
      } else if (this.is('(') || this.is('{') || this.t.type === 'string') {
        this.exp2nextreg(v)
        this.funcargs(v)
      } else return
    }
  }

  simpleexp(v: ExpDesc) {
    const t = this.t
    if (t.type === 'number') {
      initExp(v, VKNUM, 0)
      v.nval = t.num
    } else if (t.type === 'string') initExp(v, VK, this.stringK(t.value))
    else if (this.is('nil')) initExp(v, VNIL, 0)
    else if (this.is('true')) initExp(v, VTRUE, 0)
    else if (this.is('false')) initExp(v, VFALSE, 0)
    else if (this.is('...')) {
      const fs = this.fs
      if (!fs.isVararg) this.error("cannot use '...' outside a vararg function")
      fs.isVararg &= ~VARARG_NEEDSARG
      initExp(v, VVARARG, this.codeABC(OP.VARARG, 0, 1, 0))
    } else if (this.is('{')) {
      this.constructor_(v)
      return
    } else if (this.is('function')) {
      this.next()
      this.body(v, false, this.linenumber)
      return
    } else {
      this.primaryexp(v)
      return
    }
    this.next()
  }

  getunopr(): number {
    if (this.is('not')) return OPR_NOT
    if (this.is('-')) return OPR_MINUS
    if (this.is('#')) return OPR_LEN
    return OPR_NOUNOPR
  }

  getbinopr(): number {
    if (this.t.type !== 'op' && !(this.t.type === 'keyword' && (this.t.value === 'and' || this.t.value === 'or')))
      return OPR_NOBINOPR
    return BINOPR[this.t.value] ?? OPR_NOBINOPR
  }

  subexpr(v: ExpDesc, limit: number): number {
    this.enterlevel()
    const uop = this.getunopr()
    if (uop !== OPR_NOUNOPR) {
      this.next()
      this.subexpr(v, UNARY_PRIORITY)
      this.prefix(uop, v)
    } else this.simpleexp(v)
    let op = this.getbinopr()
    while (op !== OPR_NOBINOPR && PRIORITY[op][0] > limit) {
      const v2 = newExp()
      this.next()
      this.infix(op, v)
      const nextop = this.subexpr(v2, PRIORITY[op][1])
      this.posfix(op, v, v2)
      op = nextop
    }
    this.leavelevel()
    return op
  }

  expr(v: ExpDesc) {
    this.subexpr(v, 0)
  }

  blockFollow(): boolean {
    if (this.t.type === 'eof') return true
    return (
      this.t.type === 'keyword' &&
      (this.t.value === 'else' || this.t.value === 'elseif' || this.t.value === 'end' || this.t.value === 'until')
    )
  }

  block() {
    const bl = this.newBlock()
    this.enterblock(bl, false)
    this.chunk()
    this.leaveblock()
  }

  checkConflict(lh: LHS | null, v: ExpDesc) {
    const fs = this.fs
    const extra = fs.freereg
    let conflict = false
    for (; lh; lh = lh.prev) {
      if (lh.v.k === VINDEXED) {
        if (lh.v.info === v.info) {
          conflict = true
          lh.v.info = extra
        }
        if (lh.v.aux === v.info) {
          conflict = true
          lh.v.aux = extra
        }
      }
    }
    if (conflict) {
      this.codeABC(OP.MOVE, fs.freereg, v.info, 0)
      this.reserveregs(1)
    }
  }

  assignment(lh: LHS, nvars: number) {
    const e = newExp()
    if (!(VLOCAL <= lh.v.k && lh.v.k <= VINDEXED)) this.error('syntax error')
    if (this.testnext(',')) {
      const nv: LHS = { prev: lh, v: newExp() }
      this.noSubst = true
      this.primaryexp(nv.v)
      if (nv.v.k === VLOCAL) this.checkConflict(lh, nv.v)
      this.checklimit(nvars, LUAI_MAXCCALLS - this.nCcalls, 'variables in assignment')
      this.assignment(nv, nvars + 1)
    } else {
      this.checknext('=')
      const nexps = this.explist1(e)
      if (nexps !== nvars) {
        this.adjustAssign(nvars, nexps, e)
        if (nexps > nvars) this.fs.freereg -= nexps - nvars
      } else {
        this.setoneret(e)
        this.storevar(lh.v, e)
        return
      }
    }
    initExp(e, VNONRELOC, this.fs.freereg - 1)
    this.storevar(lh.v, e)
  }

  cond(): number {
    const v = newExp()
    this.expr(v)
    if (v.k === VNIL) v.k = VFALSE
    this.goiftrue(v)
    return v.f
  }

  breakstat(tok: Token = this.t) {
    const fs = this.fs
    let bl = fs.bl
    let upval = false
    while (bl && !bl.isbreakable) {
      upval ||= bl.upval
      bl = bl.previous
    }
    if (!bl) this.error('no loop to break', tok)
    if (upval) this.codeABC(OP.CLOSE, bl.nactvar, 0, 0)
    const l = { v: bl.breaklist }
    this.concat(l, this.jump())
    bl.breaklist = l.v
  }

  whilestat(line: number) {
    const bl = this.newBlock()
    this.next()
    const whileinit = this.getlabel()
    const condexit = this.cond()
    this.enterblock(bl, true)
    this.checknext('do')
    this.block()
    this.patchlist(this.jump(), whileinit)
    this.fixline(line)
    this.checkMatch('end', 'while', line)
    this.leaveblock()
    this.patchtohere(condexit)
  }

  repeatstat(line: number) {
    const repeatInit = this.getlabel()
    const bl1 = this.newBlock()
    const bl2 = this.newBlock()
    this.enterblock(bl1, true)
    this.enterblock(bl2, false)
    this.next()
    this.chunk()
    this.checkMatch('until', 'repeat', line)
    const condexit = this.cond()
    if (!bl2.upval) {
      this.leaveblock()
      this.patchlist(condexit, repeatInit)
    } else {
      this.breakstat()
      this.patchtohere(condexit)
      this.leaveblock()
      this.patchlist(this.jump(), repeatInit)
    }
    this.leaveblock()
  }

  exp1(): number {
    const e = newExp()
    this.expr(e)
    const k = e.k
    this.exp2nextreg(e)
    return k
  }

  forbody(base: number, line: number, nvars: number, isnum: boolean) {
    const bl = this.newBlock()
    this.adjustlocalvars(3)
    this.checknext('do')
    const prep = isnum ? this.codeAsBx(OP.FORPREP, base, NO_JUMP) : this.jump()
    this.enterblock(bl, false)
    this.adjustlocalvars(nvars)
    this.reserveregs(nvars)
    this.block()
    this.leaveblock()
    this.patchtohere(prep)
    const endfor = isnum ? this.codeAsBx(OP.FORLOOP, base, NO_JUMP) : this.codeABC(OP.TFORLOOP, base, 0, nvars)
    this.fixline(line)
    this.patchlist(isnum ? endfor : this.jump(), prep + 1)
  }

  fornum(varname: string, line: number) {
    const fs = this.fs
    const base = fs.freereg
    this.newLocalvar('(for index)', 0)
    this.newLocalvar('(for limit)', 1)
    this.newLocalvar('(for step)', 2)
    this.newLocalvar(varname, 3)
    this.checknext('=')
    this.exp1()
    this.checknext(',')
    this.exp1()
    if (this.testnext(',')) this.exp1()
    else {
      this.codeABx(OP.LOADK, fs.freereg, this.numberK(1))
      this.reserveregs(1)
    }
    this.forbody(base, line, 1, true)
  }

  forlist(indexname: string) {
    const fs = this.fs
    const e = newExp()
    let nvars = 0
    const base = fs.freereg
    this.newLocalvar('(for generator)', nvars++)
    this.newLocalvar('(for state)', nvars++)
    this.newLocalvar('(for control)', nvars++)
    this.newLocalvar(indexname, nvars++)
    while (this.testnext(',')) {
      const name = this.peekedName()
      this.newLocalvar(name, nvars++)
    }
    this.checknext('in')
    const line = this.linenumber
    this.adjustAssign(3, this.explist1(e), e)
    this.checkstack(3)
    this.forbody(base, line, nvars - 3, false)
  }

  forstat(line: number) {
    const bl = this.newBlock()
    this.enterblock(bl, true)
    this.next()
    const varname = this.peekedName()
    if (this.is('=')) this.fornum(varname, line)
    else if (this.is(',') || this.is('in')) this.forlist(varname)
    else this.error("'=' or 'in' expected")
    this.checkMatch('end', 'for', line)
    this.leaveblock()
  }

  testThenBlock(): number {
    this.next()
    const condexit = this.cond()
    this.checknext('then')
    this.block()
    return condexit
  }

  ifstat(line: number) {
    const escape = { v: NO_JUMP }
    let flist = this.testThenBlock()
    while (this.is('elseif')) {
      this.concat(escape, this.jump())
      this.patchtohere(flist)
      flist = this.testThenBlock()
    }
    if (this.is('else')) {
      this.concat(escape, this.jump())
      this.patchtohere(flist)
      this.next()
      this.block()
    } else this.concat(escape, flist)
    this.patchtohere(escape.v)
    this.checkMatch('end', 'if', line)
  }

  localfunc() {
    const fs = this.fs
    const v = newExp()
    const b = newExp()
    const name = this.strCheckname()
    this.newLocalvar(name, 0)
    this.nameParts = [name]
    initExp(v, VLOCAL, fs.freereg)
    this.reserveregs(1)
    this.adjustlocalvars(1)
    this.body(b, false, this.linenumber)
    this.storevar(v, b)
    this.getlocvar(fs.nactvar - 1).start = fs.pc
  }

  localstat() {
    let nvars = 0
    let nexps: number
    const e = newExp()
    do {
      const name = this.peekedName()
      this.newLocalvar(name, nvars++)
    } while (this.testnext(','))
    if (this.testnext('=')) nexps = this.explist1(e)
    else {
      e.k = VVOID
      nexps = 0
    }
    this.adjustAssign(nvars, nexps, e)
    this.adjustlocalvars(nvars)
  }

  funcname(v: ExpDesc): boolean {
    let needself = false
    this.nameParts = []
    const name = this.singlevarName(v)
    this.nameParts.push(name)
    while (this.is('.')) this.field(v, '.')
    if (this.is(':')) {
      needself = true
      this.field(v, ':')
    }
    return needself
  }

  /** singlevar for a function statement's name (never a substituted constant). */
  singlevarName(v: ExpDesc): string {
    const name = this.strCheckname()
    if (this.singlevaraux(this.fs, name, v, true) === VGLOBAL) v.info = this.stringK(name)
    return name
  }

  funcstat(line: number) {
    const v = newExp()
    const b = newExp()
    this.next()
    const needself = this.funcname(v)
    this.body(b, needself, line)
    this.storevar(v, b)
    this.fixline(line)
  }

  exprstat() {
    const fs = this.fs
    const v: LHS = { prev: null, v: newExp() }
    this.noSubst = true
    this.primaryexp(v.v)
    if (v.v.k === VCALL) fs.code[v.v.info] = SETARG_C(fs.code[v.v.info], 1)
    else this.assignment(v, 1)
  }

  retstat() {
    const fs = this.fs
    const e = newExp()
    let first: number
    let nret: number
    this.next()
    if (this.blockFollow() || this.is(';')) first = nret = 0
    else {
      nret = this.explist1(e)
      if (hasmultret(e.k)) {
        this.setmultret(e)
        if (e.k === VCALL && nret === 1) fs.code[e.info] = SET_OPCODE(fs.code[e.info], OP.TAILCALL)
        first = fs.nactvar
        nret = LUA_MULTRET
      } else if (nret === 1) first = this.exp2anyreg(e)
      else {
        this.exp2nextreg(e)
        first = fs.nactvar
      }
    }
    this.ret(first, nret)
  }

  statement(): boolean {
    const line = this.linenumber
    if (this.t.type === 'keyword') {
      switch (this.t.value) {
        case 'if':
          this.ifstat(line)
          return false
        case 'while':
          this.whilestat(line)
          return false
        case 'do':
          this.next()
          this.block()
          this.checkMatch('end', 'do', line)
          return false
        case 'for':
          this.forstat(line)
          return false
        case 'repeat':
          this.repeatstat(line)
          return false
        case 'function':
          this.funcstat(line)
          return false
        case 'local':
          this.next()
          if (this.testnext('function')) this.localfunc()
          else this.localstat()
          return false
        case 'return':
          this.retstat()
          return true
        case 'break': {
          const tok = this.t
          this.next()
          this.breakstat(tok)
          return true
        }
        case 'hstructure':
        case 'hmake':
          this.error('HavokScript structures are not supported')
      }
    }
    this.exprstat()
    return false
  }

  chunk() {
    let islast = false
    this.enterlevel()
    while (!islast && !this.blockFollow()) {
      islast = this.statement()
      this.testnext(';')
      this.fs.freereg = this.fs.nactvar
    }
    this.leavelevel()
  }

  main(): HksProto {
    const fs = this.openFunc()
    fs.isVararg = VARARG_ISVARARG
    this.next()
    this.chunk()
    if (this.t.type !== 'eof') this.error("'<eof>' expected")
    this.removevars(0)
    this.ret(0, 0)
    specialize(fs.code, fs.k)
    return this.finish(fs)
  }
}

interface ConsControl {
  v: ExpDesc
  t: ExpDesc
  nh: number
  na: number
  tostore: number
}

interface LHS {
  prev: LHS | null
  v: ExpDesc
}

/** Compiles a script into a chunk (writeHks makes the file). Throws HksSyntaxError on errors. */
export function compileHks(source: string, opts: CompileOptions = {}): HksChunk {
  const main = new Compiler(source, opts).main()
  return {
    header: { ...ER_HKS_HEADER },
    types: ER_HKS_TYPES.map((t) => ({ ...t })),
    main,
    structMarker: 1,
    structs: [],
  }
}
