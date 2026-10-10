/** Every `Credit:` line in the code names someone in src/shared/credits.ts, and CREDITS.md lists them all. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { CREDITS } from '../src/shared/credits.ts'

const ROOT = path.resolve(import.meta.dirname, '..')

/** `Credit:` paragraphs in source files: the marker line and the comment lines after it. */
function creditLines(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue
    const file = path.join(entry.parentPath, entry.name)
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!/^\s*(\*|\/\/)\s*Credit:/.test(line)) return
      let text = line
      for (let k = i + 1; k < lines.length && /^\s*\*\s*\S/.test(lines[k]) && !/^\s*\*\//.test(lines[k]); k++)
        text += ' ' + lines[k]
      out.push({ file: path.relative(ROOT, file), text })
    })
  }
  return out
}

test('every Credit: line names a credited work', () => {
  const lines = creditLines(path.join(ROOT, 'src'))
  assert.ok(lines.length > 20, 'the code credits its sources')
  for (const { file, text } of lines) {
    if (file.endsWith(path.join('shared', 'credits.ts'))) continue
    const named = CREDITS.filter((c) => text.includes(c.name))
    assert.ok(named.length > 0, `${file}: "${text.trim()}" names nothing in src/shared/credits.ts`)
  }
})

test('CREDITS.md lists every credit (npm run credits writes it)', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8')
  for (const c of CREDITS) assert.ok(md.includes(`**${c.url ? `[${c.name}]` : c.name}`), `CREDITS.md lacks ${c.name}`)
})

test('every credit says who and what', () => {
  for (const c of CREDITS) {
    assert.ok(c.by.trim() && c.use.trim() && c.kinds.length, `${c.name} needs by, use and a kind`)
  }
})
