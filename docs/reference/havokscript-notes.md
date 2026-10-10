# HavokScript behaviour scripts (.hks) — format and compiler notes

Facts verified against the installed game's 414 scripts (`action/script/`,
1.17) while building `src/core/formats/hks/`. hksc (Jake-NotTheMuss, MIT; github.com/Jake-NotTheMuss/hksc), a
reimplementation of the HavokScript compiler, documents the same layout
and code generation; Lua 5.1.5's lparser.c/lcode.c are the base.

## Files

- `action/script/c0000.hks` is the player (1.27 MB, 1389 functions),
  `c0000_talk.hks` talk/gestures, `common_define.hks` shared constants
  and tables (TRUE = 1, FALSE = 0, HAND_*, WEAPON_CATEGORY_*), `c9997.hks`
  the common enemy logic, `c8000.hks` Torrent, `cXXXX.hks` per character.
  All are compiled bytecode; the game also loads a plain-text `.hks` from a
  mod folder and compiles it itself.
- Every script keeps full debug info: line numbers, local names and scopes,
  upvalue names, function names. No struct definitions.

## Layout (big-endian)

- Header, 14 bytes: `1B 4C 75 61` "\x1bLua", version `51`, format `0E`,
  endianness `00` (big), sizeof int `04`, size_t `08`, instruction `04`,
  lua_Number `04` (float32), integral `00`, compatibility bits `03`
  (global memoization + structures), shared-state `00`.
- Type table: int count (13), then per type int id, int name size, name +
  NUL: TNIL, TBOOLEAN, TLIGHTUSERDATA, TNUMBER, TSTRING, TTABLE, TFUNCTION,
  TUSERDATA, TTHREAD, TIFUNCTION, TCFUNCTION, TUI64, TSTRUCT (ids 0-12).
- Function, recursively (children after the parent's debug info):
  - int upvalue count, int parameter count, byte vararg flags (Lua 5.1:
    1 has `arg`, 2 is vararg, 4 needs `arg`; the main chunk 2, `(...)`
    functions 3 or 7), int max stack size;
  - size_t instruction count (8 bytes: DSLuaDecompiler reads it as an
    unknown int 0 plus the count), then `_` (0x5F) padding to a multiple of
    4 from the file start, then the instructions;
  - int constant count, then byte type + value: 0 nil, 1 boolean (byte),
    3 number (float), 4 string (size_t size including the NUL, bytes, NUL),
    2 light userdata (size_t), 11 ui64 (8 bytes). Retail uses 0, 1, 3, 4;
  - debug info: int 1 (0 = stripped, nothing more), int line count (= the
    instruction count), int local count, int upvalue name count, int first
    line, int last line, source (main chunk "@", others a null string:
    size 0), function name ("(main chunk)", "ExecEvent", "a.b:c", null for
    anonymous functions), the line of each instruction, the locals (name,
    int start pc, int end pc), the upvalue names;
  - int child count, the children.
- After the main function the structures section: int 1, struct
  prototypes (none in retail), a null string (size_t 0). So every retail
  file ends `00000001 00000000 00000000`.
- Every file reads and writes back byte-identical (`bytecode.ts`).

## Instructions

- 32 bits: opcode in bits 31-25, B 24-17 (8 bits), C 16-8 (9 bits, bit 8 =
  constant), A 7-0; Bx = bits 24-8 (17 bits), sBx = Bx - 0xFFFF.
  `LOADK R0, K1` = `0x32000100`.
- B has no constant bit of its own: a constant B (RK) is a 9-bit B whose
  top bit lands on the opcode's low bit, giving the odd `_BK` opcodes
  (EQ 4/EQ_BK 5, ADD 40/ADD_BK 41, LT 56/LT_BK 57, SETTABLE_S 16/_BK 17...).
- Opcodes (hksc's numbering, all used ones checked): GETFIELD 0, TEST 1,
  CALL_I 2, CALL_C 3, EQ 4, EQ_BK 5, GETGLOBAL 6, MOVE 7, SELF 8, RETURN 9,
  GETTABLE_S 10, GETTABLE_N 11, GETTABLE 12, LOADBOOL 13, TFORLOOP 14,
  SETFIELD 15, SETTABLE_S 16, SETTABLE_S_BK 17, SETTABLE_N 18,
  SETTABLE_N_BK 19, SETTABLE 20, SETTABLE_BK 21, TAILCALL_I 22,
  TAILCALL_C 23, TAILCALL_M 24, LOADK 25, LOADNIL 26, SETGLOBAL 27, JMP 28,
  CALL_M 29, CALL 30, INTRINSIC_* 31-36, TAILCALL 37, GETUPVAL 38,
  SETUPVAL 39, ADD..POW_BK 40-51, NEWTABLE 52, UNM 53, NOT 54, LEN 55,
  LT 56, LT_BK 57, LE 58, LE_BK 59, CONCAT 60, TESTSET 61, FORPREP 62,
  FORLOOP 63, SETLIST 64, CLOSE 65, CLOSURE 66, VARARG 67, TAILCALL_I_R1 68,
  CALL_I_R1 69, SETUPVAL_R1 70, TEST_R1 71, NOT_R1 72, GETFIELD_R1 73,
  SETFIELD_R1 74, NEWSTRUCT 75, DATA 76, SETSLOT* 77-81, CHECKTYPE* 82-83,
  GETSLOT* 84-85, SELFSLOT* 86-87, GETFIELD_MM 88, CHECKTYPE_D 89,
  GETSLOT_D 90, GETGLOBAL_MEM 91.
- Used by retail (counts over all 414 files): DATA 192,800,
  GETGLOBAL_MEM 191,101, LOADK 133,537, RETURN 108,661, CALL_I 102,629,
  JMP 76,169, EQ 72,855, SETGLOBAL 43,372, CLOSURE 40,591, MOVE 2,984,
  CALL_I_R1 2,171, NEWTABLE 1,422, SETLIST 997, GETTABLE_S 637,
  SETTABLE_S 619, SETFIELD 410, LE 344, LT_BK 301, LOADBOOL 301,
  SETTABLE_S_BK 293, ADD 284, MUL 251, GETFIELD_R1 209, SUB 173, LT 171,
  SELF 140, LE_BK 116, CONCAT 92, DIV 80, TEST 38, FORPREP 33, FORLOOP 33,
  UNM 33, LEN 32, MUL_BK 30, LOADNIL 23, TAILCALL_I 14, SUB_BK 12,
  GETUPVAL 11, TAILCALL_I_R1 9, DIV_BK 9, ADD_BK 5, SETUPVAL 5, VARARG 4,
  MOD 4, POW 2. Never: plain GETGLOBAL/GETFIELD/GETTABLE/SETTABLE/CALL,
  TESTSET, NOT, TFORLOOP, CLOSE, EQ_BK, CALL_C/M, intrinsics, struct ops.
  No while/repeat loops, no generic for, no backward JMP at all: control
  flow is if/elseif/else, numeric for, and/or.
- Semantics are Lua 5.1's (A B C as in lopcodes.h), with:
  - `GETGLOBAL_MEM A Bx` + `DATA 20 m`: R(A) = global K(Bx), cached in the
    two nil constants K(m), K(m+1);
  - `GETTABLE_S/GETFIELD A B C` + `DATA 0 0` + `DATA 0 0`;
  - `CLOSURE A Bx` + per upvalue `DATA 1 reg` (a local of this function)
    or `DATA 2 n` (this function's upvalue n), instead of MOVE/GETUPVAL;
  - `SETLIST A B 0` + `DATA 0 c` when the batch number doesn't fit in C;
  - `_R1` forms behave like their base opcode (see below).

## Code generation (what compile.ts reproduces)

- Lua 5.1.5's single-pass compiler, unchanged except:
  - a global read is GETGLOBAL_MEM + DATA 20 k, k = a pair of nil
    constants reserved at the global's first read in the function (after
    its name constant), shared by later reads: `ExecEvent`'s constants are
    "ResetRequest", nil, nil, "hkbFireEvent", nil, nil;
  - a table read t[k] is GETTABLE + two DATA 0 0;
  - CLOSURE's upvalues as DATA (above);
  - LOADNIL at pc 0 isn't skipped (5.1 drops it at a function's start);
  - a `while` loop's back JMP gets the line of `while` (fixline);
  - HavokScript reads the names in `local`, `for` and parameter lists with
    a lookahead (for its `name: type` syntax), which moves "the last line"
    to the token after the name: `local x` alone on line 5 followed by
    `f()` on line 6 gives a LOADNIL on line 6;
  - the function's debug name comes from its declaration: `function a.b:c`
    → "a.b:c", `local function f` → "f", anything else null;
  - when a function is finished: GETTABLE with a string constant key →
    GETFIELD (C = the constant), any other key → GETTABLE_S (also for
    numbers: `t[1]` is GETTABLE_S ... K); SETTABLE(_BK) with a string
    constant key → SETFIELD (B = the constant), else SETTABLE_S (keeping
    _BK); CALL → CALL_I, TAILCALL → TAILCALL_I; then an instruction that is
    not a jump target (leaders: after a test or a LOADBOOL that skips, after
    a JMP/FORPREP/FORLOOP and its target) and whose previous instruction
    (skipping DATA) is GETFIELD, GETGLOBAL(_MEM), MOVE, SELF, GETUPVAL,
    NEWTABLE, SETUPVAL_R1, GETFIELD_R1, NEWSTRUCT or GETFIELD_MM takes its
    R1 form when it uses that instruction's A: GETFIELD_R1 / NOT_R1 if its
    B is that register, CALL_I_R1, TAILCALL_I_R1, TEST_R1, SETFIELD_R1,
    SETUPVAL_R1 if its A is. `f()` after `GETGLOBAL_MEM R1 f` is
    `CALL_I_R1 1 1 1`; `math.abs` is `GETGLOBAL_MEM R2; GETFIELD_R1 2 2 K`.
- Numbers are float32 when read (0.001 and 0.0010000000474974513 are the
  same constant) and in constant folding (`0.1 + 0.2` folds to the float
  0.3). -0 and 0 share a constant.
- Things the source decides that show in the bytecode: `return f(x)` is a
  tail call (TAILCALL_I + RETURN A 0); retail often has `return (f(x))`
  (CALL_I C=2 + RETURN A 2), which the community texts drop. `x > 5` is
  `LT_BK 1 K(5) R(x)` (operands swapped, so _BK); `5 == x` would be EQ_BK
  (unused). `local t = {}; t.x = 1` vs `{x = 1}` differ in NEWTABLE's sizes.
- More than 255 constants (the main chunk has 1485): constants past 255
  can't be RK operands, so they're loaded into registers first (LOADK, and
  LOADBOOL for true/false: `GetVariable("IsLockon") == false` compiles to
  LOADBOOL + EQ in ExecAttack (over 255 constants) but EQ ... K(false) in
  small functions).
- Jumps the compiler threads: a JMP emitted while other jumps wait to be
  patched to "here" takes them over, so an if at the end of a then-block
  jumps straight to the end of the outer if, an if at the end of a while
  body to the loop start, and an if before `break` to the loop exit.

## Decompiling (decompile.ts)

- With the debug info nothing is guessed about variables: each local's
  register is its depth among the live locals when it starts (one starting
  just as another empty-scoped one ends: the instruction before tells which
  register it wrote), its scope ends where a block ends (or a `do ... end`
  is written there), parameters and `arg` are the first locals. Function
  names give `function a.b:c()` / `local function f()`.
- Expressions fold back from registers (temporaries are consumed once, in
  the order the compiler filled them); stores while temporaries remain are
  one multiple assignment, last target first; nils the compiler padded with
  (`a, b = 1`) and a one-result call at the end (`(f())`) are recognised.
- Conditions: units (test + JMP), the then-block's start (fall-through) and
  the false target; the and/or tree is the split of units whose jumps fit
  (`and`: the left part's jumps go to the right part's start or to false;
  `or`: to true or the right part's start), last split first so chains are
  left-associative. Negations come out in De Morgan form, which compiles to
  the same jumps; `x > y` vs `y < x` from which operand was loaded first
  (with a constant operand: whether the constant was added before the
  other operand's constants, a global read's two memo slots being the
  surest clock). A unit jumping to a JMP is an and/or value's (`x = x or
  y`): an if's jumps would have been threaded on through it.
  Several units in a row that fit one condition are one `and` (a nested if
  as the whole then-block compiles the same).
- Where shapes are ambiguous (an else jump vs a `break`, a nested if folded
  into `and` or not, `while true` with ifs jumping back to its start vs a
  repeat), the likelier one is tried first and the next if its blocks
  don't decompile.
- Line numbers: each statement and expression carries its instructions'
  lines; printed with `preserveLines` (the default) statements go on those
  lines (blank lines where the source had comments), an expression breaks
  where the source did (long conditions and argument lists), a statement
  that shared a line with the previous one (`if x then f()`) is written on
  it, and a block's `end` goes on the line the jump after it says. A
  broken binary expression keeps its operator at the end of the line (the
  left operand's code gets the operator's line). c0000 comes out at 25,142
  lines like the original.

## Results (the hks suite)

- 414/414 scripts read/write byte-identical.
- Decompile → parse → compile: 41,005/41,005 functions identical
  (instructions, constants, parameters, upvalues, stack size, children),
  c0000 1389/1389; debug info (function names, locals and scopes, upvalue
  names) identical for all; 974,004 of 974,007 instruction lines; 411 of
  414 files compile back byte-identical. The other three differ by one JMP
  line each: the source had `if true then A else B end` (no test: printed
  as `A; if false then B end`) or `do return x end` at the end of a
  then-block, which compile the same apart from that line.
- c0000: decompile ~70 ms, parse ~12 ms, compile ~20 ms; all 414 files
  ~0.6 s and ~0.2 s.
- Random programs (a fuzzer outside the repo: nested loops, breaks,
  and/or values, upvalues, methods, varargs, big tables), compiled,
  decompiled and compiled again: 10,000/10,000 give the same code, and all
  but 116 the same debug info. Those 116 are one pattern: `local a = x`
  followed by `do local b end`, whose LOADNILs merge so both declarations
  start at one instruction; they come out as one declaration with the
  wrong scope for `a` (cut down further, a `until a` right after then
  reads the wrong register: not seen in the game's scripts, still open).
  Line numbers differ in about a third of the random
  programs (unusual layouts: several `local x` without values in a row at
  a block's end, nested ifs written as one `and` condition), never in a
  way that changes code.
- All community texts parse (v7, v15, v17 copies in the projects, v18).
  v18 (for 1.17) compiled and compared with the game (compare.ts):
  c0000 592 functions identical, 702 identical once its env/act names are
  read as numbers, 94 different plus the main chunk (their edits: custom
  Ashes of War, spells, catalysts, removed `if false` blocks and
  parentheses, some renamed ids), 5 extra (GetSwordArtsDiffCategory,
  GetSwordArtsPutOppositeWeapon, GetMagicPutOppositeWeapon, Contains,
  IsWeaponCatalyst); c8000 33 + 61, 1 different (Move_onGenerate) plus the
  main chunk; c9997 581 + 353, 5 different plus the main chunk. Their compiled code matches
  the game's wherever the text is unchanged, which also confirms the
  compiler on hand-written text.
- v18 defines `SetTurnSpeed = 2004` (an act id) after `function
  SetTurnSpeed`: at load the number replaces the function, so its own
  calls `SetTurnSpeed(0)` (SetRollingTurnCondition...) fail in game.
  `idNameClashes` flags such names.
