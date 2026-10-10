/**
 * A readable listing of compiled HavokScript, in the style of `luac -l`:
 * per function its header (name, lines, parameters, upvalues, stack), then
 * one line per instruction with its source line, operands and what they
 * refer to (constants, jump targets, local and upvalue names), then the
 * constants, locals and upvalues. Used for Spellforge's bytecode view and for
 * debugging the decompiler and compiler.
 */
import type { HksChunk, HksConstant, HksProto } from './bytecode.ts'
import { OP, OP_INFO, OP_NAMES, argA, argB, argBx, argC, argSBx, indexK, isK, opOf } from './opcodes.ts'

function constantText(k: HksConstant | undefined): string {
  if (!k) return '?'
  switch (k.type) {
    case 'nil':
      return 'nil'
    case 'boolean':
      return String(k.value)
    case 'number':
      return formatFloat(k.value)
    case 'string':
      return quoteLuaString(k.value)
    case 'lightuserdata':
      return `${k.value}i`
    case 'ui64':
      return `${k.value}ull`
  }
}

/**
 * The shortest decimal that reads back as the same float32 (0.1, not
 * 0.10000000149011612); integers plainly.
 */
export function formatFloat(v: number): string {
  if (Number.isNaN(v)) return '(0/0)'
  if (v === Infinity) return '(1/0)'
  if (v === -Infinity) return '(-1/0)'
  if (Object.is(v, -0)) return '-0'
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v)
  const f = Math.fround(v)
  for (let p = 1; p <= 17; p++) {
    const s = f.toPrecision(p)
    if (Math.fround(Number(s)) === f) return normalizeNumber(s)
  }
  return String(f)
}

/** toPrecision's output without exponent noise or trailing zeros. */
function normalizeNumber(s: string): string {
  const n = Number(s)
  // Plain notation when it's not absurdly long.
  if (Math.abs(n) >= 1e-6 && Math.abs(n) < 1e21) {
    let t = String(n)
    if (/e/i.test(t)) t = n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '')
    return t
  }
  return String(n)
}

/** A Lua string literal for a byte string (one char per byte). */
export function quoteLuaString(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0x22) out += '\\"'
    else if (c === 0x5c) out += '\\\\'
    else if (c === 0x0a) out += '\\n'
    else if (c === 0x0d) out += '\\r'
    else if (c === 0x09) out += '\\t'
    else if (c === 0x07) out += '\\a'
    else if (c === 0x08) out += '\\b'
    else if (c === 0x0c) out += '\\f'
    else if (c === 0x0b) out += '\\v'
    else if (c < 0x20 || c >= 0x7f) {
      // A decimal escape; padded to 3 digits when a digit follows.
      const next = s.charCodeAt(i + 1)
      out += '\\' + (next >= 0x30 && next <= 0x39 ? String(c).padStart(3, '0') : String(c))
    } else out += s[i]
  }
  return out + '"'
}

/** The name of the local in register reg at pc: live locals stack up in register order. */
function localAt(f: HksProto, reg: number, pc: number): string | null {
  const locals = f.debug?.locals
  if (!locals) return null
  let n = 0
  for (const l of locals) {
    if (l.start <= pc && pc < l.end) {
      if (n === reg) return l.name
      n++
    }
  }
  return null
}

/**
 * One function: a header line (name, lines, parameters, upvalues, stack
 * size, counts), then per instruction its pc, [source line], opcode,
 * operands as stored (A B C, A Bx or A sBx) and notes (constants, jump
 * targets, names), then its constants, locals and upvalue names.
 */
function disassembleProto(f: HksProto, title = 'function'): string {
  const out: string[] = []
  const d = f.debug
  const name = d?.name ?? '?'
  out.push(
    `${title} ${name} (lines ${d?.lineDefined ?? '?'}-${d?.lastLineDefined ?? '?'}): ${f.paramCount} params${f.varargFlags ? ` + vararg(${f.varargFlags})` : ''}, ${f.upvalueCount} upvalues, ${f.maxStack} slots, ${f.code.length} instructions, ${f.constants.length} constants, ${f.children.length} functions`,
  )
  const kText = (x: number) => constantText(f.constants[x])
  for (let pc = 0; pc < f.code.length; pc++) {
    const i = f.code[pc]
    const op = opOf(i)
    const info = OP_INFO[op]
    const a = argA(i)
    const b = argB(i)
    const c = argC(i)
    let ops: string
    const notes: string[] = []
    if (!info) ops = `0x${i.toString(16).padStart(8, '0')}`
    else if (info.format === 'ABx') {
      ops = `${a} ${argBx(i)}`
      if (info.b === 'K') notes.push(kText(argBx(i)))
    } else if (info.format === 'AsBx') {
      ops = `${a} ${argSBx(i)}`
      notes.push(`to ${pc + 1 + argSBx(i)}`)
    } else {
      ops = `${a} ${b} ${c}`
      if (info.b === 'K' || (info.bk && info.b === 'RK')) notes.push(kText(b))
      if (info.c === 'K') notes.push(kText(c))
      else if (info.c === 'RK' && isK(c)) notes.push(kText(indexK(c)))
    }
    switch (op) {
      case OP.GETUPVAL:
      case OP.SETUPVAL:
      case OP.SETUPVAL_R1:
        if (d?.upvalueNames[b] !== undefined) notes.push(d.upvalueNames[b])
        break
      case OP.CLOSURE: {
        const child = f.children[argBx(i)]
        notes.push(child?.debug?.name ?? `function ${argBx(i)}`)
        break
      }
      case OP.MOVE: {
        const l = localAt(f, b, pc)
        if (l) notes.push(l)
        break
      }
      default:
        break
    }
    const line = d?.lines[pc]
    out.push(
      `  ${String(pc).padStart(5)}  [${line ?? '-'}]`.padEnd(16) +
        `${OP_NAMES[op] ?? `OP${op}`}`.padEnd(16) +
        ops +
        (notes.length ? `    ; ${notes.join('  ')}` : ''),
    )
  }
  if (f.constants.length)
    out.push(`  constants (${f.constants.length}): ` + f.constants.map((k, n) => `K${n}=${constantText(k)}`).join(' '))
  if (d?.locals.length)
    out.push(`  locals (${d.locals.length}): ` + d.locals.map((l) => `${l.name} ${l.start}-${l.end}`).join(', '))
  if (d?.upvalueNames.length) out.push(`  upvalues (${d.upvalueNames.length}): ` + d.upvalueNames.join(', '))
  return out.join('\n')
}

/** The whole chunk, parents before children. */
export function disassembleHks(chunk: HksChunk): string {
  const out: string[] = []
  const walk = (f: HksProto, path: string) => {
    out.push(disassembleProto(f, path ? `function [${path}]` : 'main'))
    out.push('')
    f.children.forEach((c, n) => walk(c, path ? `${path}.${n}` : String(n)))
  }
  walk(chunk.main, '')
  return out.join('\n')
}
