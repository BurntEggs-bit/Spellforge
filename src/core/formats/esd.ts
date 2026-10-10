/**
 * ESD (EzState): the game's talk scripts (script/talk/<map>.talkesdbnd.dcx,
 * one t<id>.esd per NPC or object dialogue), read just far enough to see
 * what they do: their commands and the expressions their conditions test.
 * Elden Ring's are the long format ("fsSL", 64-bit offsets); layout as
 * SoulsFormats documents it:
 *
 *   header (0x6C): magic, then i32s: 1, version x2, 0x54, data size, 6,
 *     0x48, 1, state group size, state group count, state size (0x48),
 *     state count, condition size (0x38), condition count, command size
 *     (0x18), command count, arg size (0x10), arg count, condition
 *     offsets offset/count, name offset/length, unknown offsets.
 *   data (from 0x6C, all offsets relative to it): i32 1, four i32s, i32 0,
 *     then i64 state groups offset, ...; the state groups (0x20 each), then
 *     every state (0x48: i64 id, conditions offset/count, entry, exit and
 *     while commands offset/count), then every condition (0x38: i64 target
 *     state, pass commands offset/count, subconditions offset/count,
 *     evaluator offset/length).
 *   command (0x18): i32 bank, i32 id, i64 args offset, i64 args count; each
 *     arg (0x10) an expression's offset and length.
 *
 * Expressions are stack bytecode: 0x00-0x7F push (byte - 64), 0x80 push
 * f32, 0x81 push f64, 0x82 push i32, 0x84-0x8A call a function (its id
 * pushed first) with 0-6 arguments, 0x8C-0x9A operators, 0xA5 a UTF-16
 * string, 0xA1 the end.
 *
 * Credit: SoulsFormats (TKGP; GPL-3.0, read as documentation only) documents
 * the ESD layout.
 */

export interface EsdCommand {
  bank: number
  id: number
  args: Buffer[]
}

export interface EsdScript {
  commands: EsdCommand[]
  /** Every condition's expression. */
  evaluators: Buffer[]
}

const DATA = 0x6c

export function readEsd(b: Buffer): EsdScript {
  const magic = b.toString('latin1', 0, 4)
  if (magic !== 'fsSL')
    throw new Error(magic === 'fSSL' ? 'Only 64-bit (fsSL) talk scripts are supported' : 'Not an ESD file')
  const groupCount = b.readInt32LE(0x28)
  const stateCount = b.readInt32LE(0x30)
  const conditionCount = b.readInt32LE(0x38)
  const q = (o: number) => Number(b.readBigInt64LE(o))
  const groupsAt = DATA + q(DATA + 0x18)
  const statesAt = groupsAt + groupCount * 0x20
  const conditionsAt = statesAt + stateCount * 0x48
  const commands: EsdCommand[] = []
  const evaluators: Buffer[] = []
  const readCommands = (offset: number, count: number) => {
    if (offset < 0) return
    for (let i = 0; i < count; i++) {
      const o = DATA + offset + i * 0x18
      const argsAt = q(o + 8)
      const args: Buffer[] = []
      for (let k = 0; k < q(o + 16); k++) {
        const a = DATA + argsAt + k * 0x10
        const at = DATA + q(a)
        args.push(b.subarray(at, at + q(a + 8)))
      }
      commands.push({ bank: b.readInt32LE(o), id: b.readInt32LE(o + 4), args })
    }
  }
  for (let s = 0; s < stateCount; s++) {
    const o = statesAt + s * 0x48
    for (let k = 0; k < 3; k++) readCommands(q(o + 24 + k * 16), q(o + 32 + k * 16))
  }
  for (let c = 0; c < conditionCount; c++) {
    const o = conditionsAt + c * 0x38
    readCommands(q(o + 8), q(o + 16))
    const len = q(o + 48)
    if (len > 0) evaluators.push(b.subarray(DATA + q(o + 40), DATA + q(o + 40) + len))
  }
  return { commands, evaluators }
}

/**
 * ShopLineupParam ranges a talk script opens: its commands of bank 1 with two
 * constant row ids (100000-999999, a range under 5000 rows), OpenRegularShop
 * (1:22) and the game's other shop menus (1:111, Enia's remembrance
 * exchange, ...). A shop lists only the rows between the two.
 */
export function esdShopRanges(script: EsdScript): { from: number; to: number; command: number }[] {
  const out: { from: number; to: number; command: number }[] = []
  for (const c of script.commands) {
    if (c.bank !== 1 || c.args.length !== 2) continue
    const [from, to] = c.args.map(esdConstant)
    if (from === null || to === null || from < 100000 || to > 999999 || to < from || to - from >= 5000) continue
    out.push({ from, to, command: c.id })
  }
  return out
}

/** An expression that is just a number. */
export function esdConstant(expr: Buffer): number | null {
  if (expr.length >= 5 && expr[0] === 0x82) return expr.readInt32LE(1)
  if (expr.length >= 1 && expr[0] <= 0x7f) return expr[0] - 64
  return null
}

/** The function calls an expression makes whose function id is a constant: id and arguments (null when not a constant). */
export function esdCalls(expr: Buffer): { fn: number; args: (number | null)[] }[] {
  const stack: (number | null)[] = []
  const out: { fn: number; args: (number | null)[] }[] = []
  for (let i = 0; i < expr.length;) {
    const op = expr[i]
    if (op <= 0x7f) {
      stack.push(op - 64)
      i++
    } else if (op === 0x80) {
      stack.push(null)
      i += 5
    } else if (op === 0x81) {
      stack.push(null)
      i += 9
    } else if (op === 0x82) {
      stack.push(i + 5 <= expr.length ? expr.readInt32LE(i + 1) : null)
      i += 5
    } else if (op >= 0x84 && op <= 0x8a) {
      const n = op - 0x84
      const args = stack.splice(Math.max(0, stack.length - n), n)
      const fn = stack.pop()
      if (typeof fn === 'number') out.push({ fn, args })
      stack.push(null)
      i++
    } else if (op === 0xa5) {
      let j = i + 1
      while (j + 1 < expr.length && expr.readUInt16LE(j) !== 0) j += 2
      stack.push(null)
      i = j + 2
    } else if (op === 0xa1) break
    else {
      // Binary operators take two values and leave one.
      if (op >= 0x8c && op <= 0x9a) {
        stack.pop()
        stack.pop()
        stack.push(null)
      }
      i++
    }
  }
  return out
}
