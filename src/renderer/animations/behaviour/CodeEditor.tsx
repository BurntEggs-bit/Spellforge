/**
 * The script editor's code box: a textarea over a highlighted copy of its text
 * (same font and metrics), so typing, selection and undo are the browser's own.
 * Tab and Shift+Tab indent, Enter keeps the indent (one deeper after a block
 * opens; "end" steps back), Ctrl+/ comments lines in or out, Ctrl+S saves; the
 * gutter marks each line's worst problem.
 */
import { useRef, useMemo, useEffect, useImperativeHandle } from 'react'
import type { HksProblem } from '../../../shared/api.ts'
import { type NameSets, highlight } from './hksHighlight.ts'

export interface CodeEditorHandle {
  /** Inserts text at the caret (or replaces the selection), undoable. */
  insert(text: string): void
  /** Moves the caret to a line and column and scrolls it into view. */
  reveal(line: number, col: number): void
}

/** One level of indent. */
const INDENT = '    '

/** Opens a block: the next line goes one level deeper. */
const opensBlock = (line: string) =>
  /(\bthen|\bdo|\belse|\brepeat|\bfunction\s*[A-Za-z0-9_.:]*\s*\([^)]*\)|[{(])\s*(--.*)?$/.test(
    line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""'),
  )

export function CodeEditor({
  value,
  onChange,
  problems = [],
  names,
  readOnly = false,
  onSave,
  handle,
  minHeight = 260,
}: {
  value: string
  onChange?: (v: string) => void
  problems?: HksProblem[]
  names: NameSets | null
  readOnly?: boolean
  onSave?: () => void
  handle?: { current: CodeEditorHandle | null }
  minHeight?: number
}) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const pre = useRef<HTMLPreElement>(null)
  const gutter = useRef<HTMLDivElement>(null)
  const html = useMemo(() => highlight(value, names, problems), [value, names, problems])
  const lineCount = value.split('\n').length
  const byLine = useMemo(() => {
    const m = new Map<number, HksProblem>()
    const rank = { error: 3, warning: 2, info: 1 }
    for (const p of problems) if (!m.has(p.line) || rank[p.severity] > rank[m.get(p.line)!.severity]) m.set(p.line, p)
    return m
  }, [problems])

  const sync = () => {
    const t = ta.current
    if (!t) return
    if (pre.current) {
      pre.current.scrollTop = t.scrollTop
      pre.current.scrollLeft = t.scrollLeft
    }
    if (gutter.current) gutter.current.scrollTop = t.scrollTop
  }
  useEffect(sync, [html])

  /** Replaces the selection with text (undoable through the browser's own history). */
  const insertText = (text: string) => {
    const t = ta.current
    if (!t || readOnly) return
    t.focus()
    if (!document.execCommand('insertText', false, text)) {
      t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end')
      onChange?.(t.value)
    }
  }
  useImperativeHandle(handle, () => ({
    insert: insertText,
    reveal: (line, col) => {
      const t = ta.current
      if (!t) return
      const lines = t.value.split('\n')
      let pos = 0
      for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1
      pos += Math.max(0, Math.min(col - 1, (lines[line - 1] ?? '').length))
      t.focus()
      t.setSelectionRange(pos, pos)
      // The line in the middle.
      const lh = parseFloat(getComputedStyle(t).lineHeight) || 19
      t.scrollTop = Math.max(0, (line - 1) * lh - t.clientHeight / 2)
      sync()
    },
  }))

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave?.()
      return
    }
    if (readOnly) return
    const { selectionStart: a, selectionEnd: b, value: v } = t
    const lineStart = v.lastIndexOf('\n', a - 1) + 1
    if (e.key === 'Tab') {
      e.preventDefault()
      const multi = v.slice(a, b).includes('\n')
      if (!multi && !e.shiftKey) return insertText(INDENT)
      // Indent or outdent the selected lines.
      const endLine = v.indexOf('\n', Math.max(a, b - 1))
      const to = endLine < 0 ? v.length : endLine
      const lines = v.slice(lineStart, to).split('\n')
      const changed = lines.map((l) => (e.shiftKey ? l.replace(/^( {1,4}|\t)/, '') : INDENT + l)).join('\n')
      t.setSelectionRange(lineStart, to)
      insertText(changed)
      t.setSelectionRange(lineStart, lineStart + changed.length)
      return
    }
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const line = v.slice(lineStart, a)
      const indent = /^[ \t]*/.exec(line)![0]
      insertText('\n' + indent + (opensBlock(line) ? INDENT : ''))
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault()
      const endLine = v.indexOf('\n', Math.max(a, b - 1))
      const to = endLine < 0 ? v.length : endLine
      const lines = v.slice(lineStart, to).split('\n')
      const commented = lines.every((l) => !l.trim() || /^\s*--/.test(l))
      const changed = lines
        .map((l) => (!l.trim() ? l : commented ? l.replace(/^(\s*)-- ?/, '$1') : l.replace(/^(\s*)/, '$1-- ')))
        .join('\n')
      t.setSelectionRange(lineStart, to)
      insertText(changed)
      return
    }
    // "end" typed on a line of its own goes back one level.
    if (e.key === 'd' && /^\s+en$/.test(v.slice(lineStart, a)) && a === b) {
      const cur = v.slice(lineStart, a)
      if (cur.startsWith(INDENT)) {
        e.preventDefault()
        t.setSelectionRange(lineStart, a)
        insertText(cur.slice(INDENT.length) + 'd')
      }
    }
  }

  return (
    <div className={`code-editor${readOnly ? ' read-only' : ''}`} style={{ minHeight }}>
      <div className="code-gutter" ref={gutter} aria-hidden>
        {Array.from({ length: lineCount }, (_, i) => {
          const p = byLine.get(i + 1)
          return (
            <div
              key={i}
              className={p ? `g-${p.severity}` : ''}
              title={p ? `${p.line}:${p.col} ${p.message}` : undefined}
            >
              {i + 1}
            </div>
          )
        })}
        <div className="code-gutter-pad" />
      </div>
      <div className="code-area">
        <pre ref={pre} className="code-hl mono" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        <textarea
          ref={ta}
          className="code-input mono"
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          wrap="off"
          onChange={(e) => onChange?.(e.target.value)}
          onScroll={sync}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  )
}
