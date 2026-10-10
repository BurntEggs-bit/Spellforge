/**
 * HavokScript instructions. Each is a 32-bit word (stored in the chunk's
 * byte order):
 *
 *   bits 31-25  opcode (7 bits)
 *   bits 24-17  B (8 bits)
 *   bits 16-8   C (9 bits; bit 8 set = constant index, "RK")
 *   bits 7-0    A (8 bits)
 *   bits 24-8   Bx (17 bits), sBx = Bx - 0xFFFF
 *
 * B has no constant bit, so the opcodes whose B may be a constant come in
 * pairs: EQ / EQ_BK, ADD / ADD_BK, SETTABLE / SETTABLE_BK..., where _BK means
 * B is a constant index. Table reads and writes are specialised by key
 * (GETFIELD / SETFIELD for string constants, _S / _N), calls by callee
 * (CALL_I for Lua functions; CALL_C and CALL_M are runtime rewrites), and an
 * instruction that reuses the register the previous one just wrote can be an
 * _R1 variant. GETGLOBAL is followed by a DATA instruction naming a pair of
 * nil constants (a per-function cache of the global's value).
 *
 * Every opcode that occurs in Elden Ring's scripts was checked against the
 * bytes.
 *
 * Credit: hksc (Jake-NotTheMuss; MIT, on Lua's terms): the numbering and
 * operand modes follow its lopcodes.def.
 */

export const OP = {
  GETFIELD: 0,
  TEST: 1,
  CALL_I: 2,
  CALL_C: 3,
  EQ: 4,
  EQ_BK: 5,
  GETGLOBAL: 6,
  MOVE: 7,
  SELF: 8,
  RETURN: 9,
  GETTABLE_S: 10,
  GETTABLE_N: 11,
  GETTABLE: 12,
  LOADBOOL: 13,
  TFORLOOP: 14,
  SETFIELD: 15,
  SETTABLE_S: 16,
  SETTABLE_S_BK: 17,
  SETTABLE_N: 18,
  SETTABLE_N_BK: 19,
  SETTABLE: 20,
  SETTABLE_BK: 21,
  TAILCALL_I: 22,
  TAILCALL_C: 23,
  TAILCALL_M: 24,
  LOADK: 25,
  LOADNIL: 26,
  SETGLOBAL: 27,
  JMP: 28,
  CALL_M: 29,
  CALL: 30,
  INTRINSIC_INDEX: 31,
  INTRINSIC_NEWINDEX: 32,
  INTRINSIC_SELF: 33,
  INTRINSIC_INDEX_LITERAL: 34,
  INTRINSIC_NEWINDEX_LITERAL: 35,
  INTRINSIC_SELF_LITERAL: 36,
  TAILCALL: 37,
  GETUPVAL: 38,
  SETUPVAL: 39,
  ADD: 40,
  ADD_BK: 41,
  SUB: 42,
  SUB_BK: 43,
  MUL: 44,
  MUL_BK: 45,
  DIV: 46,
  DIV_BK: 47,
  MOD: 48,
  MOD_BK: 49,
  POW: 50,
  POW_BK: 51,
  NEWTABLE: 52,
  UNM: 53,
  NOT: 54,
  LEN: 55,
  LT: 56,
  LT_BK: 57,
  LE: 58,
  LE_BK: 59,
  CONCAT: 60,
  TESTSET: 61,
  FORPREP: 62,
  FORLOOP: 63,
  SETLIST: 64,
  CLOSE: 65,
  CLOSURE: 66,
  VARARG: 67,
  TAILCALL_I_R1: 68,
  CALL_I_R1: 69,
  SETUPVAL_R1: 70,
  TEST_R1: 71,
  NOT_R1: 72,
  GETFIELD_R1: 73,
  SETFIELD_R1: 74,
  NEWSTRUCT: 75,
  DATA: 76,
  SETSLOTN: 77,
  SETSLOTI: 78,
  SETSLOT: 79,
  SETSLOTS: 80,
  SETSLOTMT: 81,
  CHECKTYPE: 82,
  CHECKTYPES: 83,
  GETSLOT: 84,
  GETSLOTMT: 85,
  SELFSLOT: 86,
  SELFSLOTMT: 87,
  GETFIELD_MM: 88,
  CHECKTYPE_D: 89,
  GETSLOT_D: 90,
  GETGLOBAL_MEM: 91,
} as const

export const OP_NAMES: string[] = []
for (const [k, v] of Object.entries(OP)) OP_NAMES[v] = k

/**
 * Operand modes, as in hksc's lopcodes.def: the instruction format and how
 * B and C read (R register, K constant, RK register or constant, U plain
 * number, N unused).
 */
export type ArgMode = 'R' | 'K' | 'RK' | 'U' | 'N'
export interface OpInfo {
  format: 'ABC' | 'ABx' | 'AsBx'
  /** A test: the next instruction is a JMP that it may skip. */
  test: boolean
  b: ArgMode
  c: ArgMode
  /** B is a constant index (the _BK opcodes). */
  bk: boolean
}

const abc = (b: ArgMode, c: ArgMode, test = false, bk = false): OpInfo => ({ format: 'ABC', test, b, c, bk })
const abx = (b: ArgMode): OpInfo => ({ format: 'ABx', test: false, b, c: 'N', bk: false })
const asbx: OpInfo = { format: 'AsBx', test: false, b: 'U', c: 'N', bk: false }

export const OP_INFO: OpInfo[] = [
  abc('R', 'K'), // GETFIELD
  abc('N', 'U', true), // TEST
  abc('U', 'U'), // CALL_I
  abc('U', 'U'), // CALL_C
  abc('RK', 'RK', true), // EQ
  abc('RK', 'RK', true, true), // EQ_BK
  abx('K'), // GETGLOBAL
  abc('R', 'N'), // MOVE
  abc('R', 'RK'), // SELF
  abc('U', 'N'), // RETURN
  abc('R', 'RK'), // GETTABLE_S
  abc('R', 'RK'), // GETTABLE_N
  abc('R', 'RK'), // GETTABLE
  abc('U', 'U'), // LOADBOOL
  abc('N', 'U', true), // TFORLOOP
  abc('K', 'RK'), // SETFIELD
  abc('RK', 'RK'), // SETTABLE_S
  abc('RK', 'RK', false, true), // SETTABLE_S_BK
  abc('RK', 'RK'), // SETTABLE_N
  abc('RK', 'RK', false, true), // SETTABLE_N_BK
  abc('RK', 'RK'), // SETTABLE
  abc('RK', 'RK', false, true), // SETTABLE_BK
  abc('U', 'U'), // TAILCALL_I
  abc('U', 'U'), // TAILCALL_C
  abc('U', 'U'), // TAILCALL_M
  abx('K'), // LOADK
  abc('R', 'N'), // LOADNIL
  abx('K'), // SETGLOBAL
  asbx, // JMP
  abc('U', 'U'), // CALL_M
  abc('U', 'U'), // CALL
  abc('U', 'U'), // INTRINSIC_INDEX
  abc('U', 'U'), // INTRINSIC_NEWINDEX
  abc('U', 'U'), // INTRINSIC_SELF
  abc('U', 'U'), // INTRINSIC_INDEX_LITERAL
  abc('U', 'U'), // INTRINSIC_NEWINDEX_LITERAL
  abc('U', 'U'), // INTRINSIC_SELF_LITERAL
  abc('U', 'U'), // TAILCALL
  abc('U', 'N'), // GETUPVAL
  abc('U', 'N'), // SETUPVAL
  abc('RK', 'RK'), // ADD
  abc('RK', 'RK', false, true), // ADD_BK
  abc('RK', 'RK'), // SUB
  abc('RK', 'RK', false, true), // SUB_BK
  abc('RK', 'RK'), // MUL
  abc('RK', 'RK', false, true), // MUL_BK
  abc('RK', 'RK'), // DIV
  abc('RK', 'RK', false, true), // DIV_BK
  abc('RK', 'RK'), // MOD
  abc('RK', 'RK', false, true), // MOD_BK
  abc('RK', 'RK'), // POW
  abc('RK', 'RK', false, true), // POW_BK
  abc('U', 'U'), // NEWTABLE
  abc('R', 'N'), // UNM
  abc('R', 'N'), // NOT
  abc('R', 'N'), // LEN
  abc('RK', 'RK', true), // LT
  abc('RK', 'RK', true, true), // LT_BK
  abc('RK', 'RK', true), // LE
  abc('RK', 'RK', true, true), // LE_BK
  abc('U', 'U'), // CONCAT
  abc('R', 'U', true), // TESTSET
  asbx, // FORPREP
  asbx, // FORLOOP
  abc('U', 'U'), // SETLIST
  abc('N', 'N'), // CLOSE
  abx('U'), // CLOSURE
  abc('U', 'N'), // VARARG
  abc('U', 'U'), // TAILCALL_I_R1
  abc('U', 'U'), // CALL_I_R1
  abc('U', 'N'), // SETUPVAL_R1
  abc('N', 'U', true), // TEST_R1
  abc('R', 'N'), // NOT_R1
  abc('R', 'K'), // GETFIELD_R1
  abc('K', 'RK'), // SETFIELD_R1
  abc('U', 'U'), // NEWSTRUCT
  abx('U'), // DATA
  abc('N', 'U'), // SETSLOTN
  abc('U', 'RK'), // SETSLOTI
  abc('U', 'RK'), // SETSLOT
  abc('U', 'R'), // SETSLOTS
  abc('U', 'RK'), // SETSLOTMT
  abx('U'), // CHECKTYPE
  abx('U'), // CHECKTYPES
  abc('R', 'U'), // GETSLOT
  abc('R', 'U'), // GETSLOTMT
  abc('R', 'U'), // SELFSLOT
  abc('R', 'U'), // SELFSLOTMT
  abc('R', 'K'), // GETFIELD_MM
  abx('U'), // CHECKTYPE_D
  abc('R', 'U'), // GETSLOT_D
  abx('K'), // GETGLOBAL_MEM
]

/** C's constant bit. */
export const BITRK = 0x100

export const MAXARG_C = 0x1ff
export const MAXARG_Bx = 0x1ffff
export const MAXARG_sBx = 0xffff
/** Largest constant index C can hold (bit 8 marks a constant). */
export const MAXINDEXRK = BITRK - 1
/** SETLIST's batch size (LFIELDS_PER_FLUSH). */
export const FIELDS_PER_FLUSH = 50

export const opOf = (i: number) => i >>> 25
export const argA = (i: number) => i & 0xff
export const argB = (i: number) => (i >>> 17) & 0xff
export const argC = (i: number) => (i >>> 8) & 0x1ff
export const argBx = (i: number) => (i >>> 8) & 0x1ffff
export const argSBx = (i: number) => ((i >>> 8) & 0x1ffff) - MAXARG_sBx

export const isK = (x: number) => (x & BITRK) !== 0
export const indexK = (x: number) => x & ~BITRK
