/**
 * Tokens of HavokScript source text: Lua 5.1's lexical rules (llex.c), as
 * the game's compiler applies them when it loads a plain-text .hks.
 *
 *   - names, the 21 Lua keywords plus HavokScript's reserved "hstructure"
 *     and "hmake" (its structure extension, which the scripts don't use);
 *   - numbers: decimal with optional fraction and exponent, or 0x hex; the
 *     value is a 32-bit float (HavokScript's lua_Number), so 0.1 and
 *     0.10000000149011612 are the same number;
 *   - strings in quotes (escapes \a \b \f \n \r \t \v \\ \" \' \ddd and a
 *     backslash-newline; any other escaped character stands for itself) or
 *     long brackets [[...]], [==[...]==] (a newline right after the opening
 *     bracket is dropped; [[ nested inside [[...]] is an error, as in 5.1);
 *   - comments: -- to the end of the line, or --[[ ... ]] / --[==[ ... ]==];
 *   - a UTF-8 byte order mark at the start is skipped, and so is a first
 *     line starting with # (as Lua's file loader does).
 *
 * String values are byte strings (one char per byte, latin1): characters
 * written literally in the source are stored as their UTF-8 bytes, \ddd
 * escapes as that byte. Lines count \n, \r, \r\n and \n\r as one break;
 * line and column numbers are 1-based, columns in characters.
 *
 * Credit: Lua 5.1 (Lua.org, PUC-Rio): the grammar, lexical rules and operator
 * priorities are its.
 */

export type TokenType = 'name' | 'keyword' | 'string' | 'number' | 'op' | 'eof'

export interface Token {
  type: TokenType
  /** Keyword or operator text, the name, the string's bytes, or the number as written. */
  value: string
  /** A number's value (float32). */
  num: number
  line: number
  col: number
  /** Line where the token ends (differs from line only for long strings). */
  endLine: number
  /** Offsets in the source text. */
  start: number
  end: number
}

export const KEYWORDS = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
  'hstructure',
  'hmake',
])

export class HksSyntaxError extends Error {
  line: number
  col: number
  /** The message without the position. */
  reason: string
  constructor(reason: string, line: number, col: number) {
    super(`${line}:${col}: ${reason}`)
    this.name = 'HksSyntaxError'
    this.reason = reason
    this.line = line
    this.col = col
  }
}

const SIMPLE_ESCAPES: Record<number, string> = {
  97: '\x07',
  98: '\b',
  102: '\f',
  110: '\n',
  114: '\r',
  116: '\t',
  118: '\v',
}

const isDigit = (c: number) => c >= 48 && c <= 57
const isAlpha = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
const isAlnum = (c: number) => isAlpha(c) || isDigit(c)
const isNewline = (c: number) => c === 10 || c === 13

/** Characters as UTF-8 bytes, kept one char per byte. */
function utf8Bytes(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(s)) return s
  return Buffer.from(s, 'utf8').toString('latin1')
}

/** A number as Lua 5.1's luaO_str2d reads it, as a float32; NaN when malformed. */
function parseLuaNumber(text: string): number {
  const t = text.trim()
  if (/^0[xX][0-9a-fA-F]+$/.test(t)) return Math.fround(parseInt(t.slice(2), 16))
  if (/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Math.fround(parseFloat(t))
  return NaN
}

/** Short text of a token for messages ("near 'x'"). */
export function tokenText(t: Token): string {
  if (t.type === 'eof') return '<eof>'
  if (t.type === 'string') return t.value.length > 40 ? t.value.slice(0, 37) + '...' : t.value
  return t.value
}

export function tokenize(source: string): Token[] {
  const s = source
  const n = s.length
  const out: Token[] = []
  let i = 0
  let line = 1
  let lineStart = 0

  const err = (msg: string, at = i, atLine = line, atLineStart = lineStart): never => {
    throw new HksSyntaxError(msg, atLine, at - atLineStart + 1)
  }

  // Skips one line break (\n, \r, \r\n or \n\r) at i.
  const newline = () => {
    const c = s.charCodeAt(i)
    i++
    const d = s.charCodeAt(i)
    if (isNewline(d) && d !== c) i++
    line++
    lineStart = i
  }

  if (s.charCodeAt(0) === 0xfeff) i = 1
  if (s.charCodeAt(i) === 35) while (i < n && !isNewline(s.charCodeAt(i))) i++

  // [=*[ at i: the level (number of =), or -1 if it isn't a long bracket.
  const longBracket = (at: number): number => {
    let j = at + 1
    let level = 0
    while (s.charCodeAt(j) === 61) {
      level++
      j++
    }
    return s.charCodeAt(j) === 91 ? level : -1
  }

  // Reads a long string/comment whose opening bracket (level) starts at i; returns its contents.
  const readLong = (level: number, what: 'string' | 'comment'): string => {
    const startLine = line
    const startCol = i - lineStart + 1
    i += level + 2
    if (isNewline(s.charCodeAt(i))) newline()
    let chunkStart = i
    let text = ''
    for (;;) {
      if (i >= n)
        throw new HksSyntaxError(`unfinished long ${what} (started at line ${startLine})`, startLine, startCol)
      const c = s.charCodeAt(i)
      if (c === 93) {
        // ]=*]
        let j = i + 1
        let l = 0
        while (s.charCodeAt(j) === 61) {
          l++
          j++
        }
        if (l === level && s.charCodeAt(j) === 93) {
          text += s.slice(chunkStart, i)
          i = j + 1
          return text
        }
        i++
      } else if (c === 91) {
        const l = longBracket(i)
        if (l === level && level === 0) err('nesting of [[...]] is deprecated')
        i++
      } else if (isNewline(c)) {
        text += s.slice(chunkStart, i) + '\n'
        newline()
        chunkStart = i
      } else i++
    }
  }

  const push = (type: TokenType, value: string, start: number, startLine: number, startLineStart: number, num = 0) => {
    out.push({ type, value, num, line: startLine, col: start - startLineStart + 1, endLine: line, start, end: i })
  }

  while (i < n) {
    const c = s.charCodeAt(i)
    if (isNewline(c)) {
      newline()
      continue
    }
    if (c === 32 || c === 9 || c === 11 || c === 12) {
      i++
      continue
    }
    const start = i
    const startLine = line
    const startLineStart = lineStart
    // Comments.
    if (c === 45 && s.charCodeAt(i + 1) === 45) {
      i += 2
      if (s.charCodeAt(i) === 91) {
        const level = longBracket(i)
        if (level >= 0) {
          readLong(level, 'comment')
          continue
        }
      }
      while (i < n && !isNewline(s.charCodeAt(i))) i++
      continue
    }
    if (isAlpha(c)) {
      while (i < n && isAlnum(s.charCodeAt(i))) i++
      const word = s.slice(start, i)
      push(KEYWORDS.has(word) ? 'keyword' : 'name', word, start, startLine, startLineStart)
      continue
    }
    if (isDigit(c) || (c === 46 && isDigit(s.charCodeAt(i + 1)))) {
      // As read_numeral: digits and dots, an exponent with optional sign, then any alnum/_ (which make it malformed).
      while (i < n && (isDigit(s.charCodeAt(i)) || s.charCodeAt(i) === 46)) i++
      const e = s.charCodeAt(i)
      if (e === 69 || e === 101) {
        i++
        const sign = s.charCodeAt(i)
        if (sign === 43 || sign === 45) i++
      }
      while (i < n && isAlnum(s.charCodeAt(i))) i++
      const text = s.slice(start, i)
      const v = parseLuaNumber(text)
      if (Number.isNaN(v)) err(`malformed number near '${text}'`, start, startLine, startLineStart)
      push('number', text, start, startLine, startLineStart, v)
      continue
    }
    if (c === 34 || c === 39) {
      i++
      let val = ''
      let chunkStart = i
      for (;;) {
        if (i >= n) err('unfinished string', start, startLine, startLineStart)
        const d = s.charCodeAt(i)
        if (d === c) break
        if (isNewline(d)) err('unfinished string', start, startLine, startLineStart)
        if (d === 92) {
          val += utf8Bytes(s.slice(chunkStart, i))
          i++
          const e = s.charCodeAt(i)
          if (i >= n) err('unfinished string', start, startLine, startLineStart)
          if (SIMPLE_ESCAPES[e] !== undefined) {
            val += SIMPLE_ESCAPES[e]
            i++
          } else if (isNewline(e)) {
            val += '\n'
            newline()
          } else if (isDigit(e)) {
            let v = 0
            let k = 0
            while (k < 3 && isDigit(s.charCodeAt(i))) {
              v = v * 10 + s.charCodeAt(i) - 48
              i++
              k++
            }
            if (v > 255) err('escape sequence too large')
            val += String.fromCharCode(v)
          } else {
            // \\, \", \' and any other character: itself.
            const ch = String.fromCodePoint(s.codePointAt(i)!)
            val += utf8Bytes(ch)
            i += ch.length
          }
          chunkStart = i
          continue
        }
        i++
      }
      val += utf8Bytes(s.slice(chunkStart, i))
      i++
      push('string', val, start, startLine, startLineStart)
      continue
    }
    if (c === 91) {
      const level = longBracket(i)
      if (level >= 0) {
        const text = readLong(level, 'string')
        push('string', utf8Bytes(text), start, startLine, startLineStart)
        continue
      }
      if (s.charCodeAt(i + 1) === 61) err("invalid long string delimiter near '[='")
      i++
      push('op', '[', start, startLine, startLineStart)
      continue
    }
    // Operators, longest first.
    const three = s.slice(i, i + 3)
    if (three === '...') {
      i += 3
      push('op', three, start, startLine, startLineStart)
      continue
    }
    const two = s.slice(i, i + 2)
    if (two === '..' || two === '==' || two === '~=' || two === '<=' || two === '>=') {
      i += 2
      push('op', two, start, startLine, startLineStart)
      continue
    }
    if ('+-*/%^#<>=(){}];:,.~'.includes(s[i])) {
      i++
      push('op', s[i - 1], start, startLine, startLineStart)
      continue
    }
    const cp = s.codePointAt(i)!
    err(`unexpected symbol near '${String.fromCodePoint(cp)}'`)
  }
  out.push({ type: 'eof', value: '<eof>', num: 0, line, col: i - lineStart + 1, endLine: line, start: n, end: n })
  return out
}
