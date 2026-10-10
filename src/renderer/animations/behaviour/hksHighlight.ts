/**
 * HavokScript (Lua) as highlighted HTML: comments, strings, numbers, keywords,
 * the game's functions and constants, and the checker's problems underlined.
 */
import type { HksProblem } from '../../../shared/api.ts'
import { escapeHtml } from '../../../shared/format.ts'

/** Lua's keywords. */
const KEYWORDS = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'for',
  'function',
  'if',
  'in',
  'local',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'until',
  'while',
])

/** Literal values: Lua's, and the TRUE and FALSE the game's script uses. */
const LITERALS = new Set(['nil', 'true', 'false', 'TRUE', 'FALSE'])

/** Comments, strings, numbers, names, spaces, anything else (tolerant of unfinished code). */
const TOKEN =
  /(--\[(=*)\[[\s\S]*?(?:\]\2\]|$)|--[^\n]*)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|\[(=*)\[[\s\S]*?(?:\]\4\]|$))|(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([\s\S])/g

/** A run of one token's text and its highlight class. */
interface Seg {
  text: string
  cls: string
}

/** Names to colour apart: the game script's functions and constants, and the engine's (env, act…). */
export interface NameSets {
  functions: Set<string>
  constants: Set<string>
  engine: Set<string>
}

/** A token's highlight class (tk-…): comment, string, number, keyword, literal, engine call, function or constant. */
function classify(m: RegExpExecArray, names: NameSets | null): string {
  if (m[1]) return 'tk-c'
  if (m[3]) return 'tk-s'
  if (m[5]) return 'tk-n'
  const name = m[6]
  if (name) {
    if (KEYWORDS.has(name)) return 'tk-k'
    if (LITERALS.has(name)) return 'tk-b'
    if (names?.engine.has(name)) return 'tk-e'
    if (names?.functions.has(name)) return 'tk-f'
    if (names?.constants.has(name)) return 'tk-v'
    return ''
  }
  return ''
}

/** The code as highlighted HTML, its problems underlined. */
export function highlight(code: string, names: NameSets | null, problems: HksProblem[]): string {
  const lines: Seg[][] = [[]]
  TOKEN.lastIndex = 0
  for (let m = TOKEN.exec(code); m; m = TOKEN.exec(code)) {
    const cls = classify(m, names)
    m[0].split('\n').forEach((part, i) => {
      if (i > 0) lines.push([])
      if (part) lines[lines.length - 1].push({ text: part, cls })
    })
  }
  const marks = new Map<number, { from: number; to: number; sev: string }[]>()
  for (const p of problems) {
    const l = marks.get(p.line) ?? []
    l.push({ from: p.col - 1, to: p.col - 1 + Math.max(1, p.length), sev: p.severity })
    marks.set(p.line, l)
  }
  const rank: Record<string, number> = { error: 3, warning: 2, info: 1 }
  const sevAt = (ms: { from: number; to: number; sev: string }[], pos: number) =>
    ms.filter((x) => pos >= x.from && pos < x.to).sort((a, b) => rank[b.sev] - rank[a.sev])[0]?.sev
  return (
    lines
      .map((segs, i) => {
        const ms = marks.get(i + 1)
        if (!ms)
          return segs
            .map((s) => (s.cls ? `<span class="${s.cls}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text)))
            .join('')
        // Split the segments where marks start and end.
        let out = ''
        let at = 0
        for (const s of segs) {
          let k = 0
          while (k < s.text.length) {
            const sev = sevAt(ms, at + k)
            let end = k + 1
            while (end < s.text.length && sevAt(ms, at + end) === sev) end++
            const piece = escapeHtml(s.text.slice(k, end))
            const cls = [s.cls, sev ? `sq-${sev}` : ''].filter(Boolean).join(' ')
            out += cls ? `<span class="${cls}">${piece}</span>` : piece
            k = end
          }
          at += s.text.length
        }
        // A mark past the end of the line (an unexpected end of text): a visible spot.
        const past = ms.find((x) => x.from >= at)
        if (past) out += `<span class="sq-${past.sev}"> </span>`
        return out
      })
      .join('\n') + '\n'
  )
}
