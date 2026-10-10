/**
 * Writes ABOUT.md and CREDITS.md (from src/shared/credits.ts, the list the
 * About page shows) and THIRD_PARTY_NOTICES.txt: the licence texts the app
 * owes, for the code it adapts, the data it ships, and every library inside
 * the built app (the main process's runtime dependencies and the packages
 * bundled into the UI).
 *
 *   npm run credits
 */
import fs from 'node:fs'
import path from 'node:path'
import { CREDITS, CREDIT_SECTIONS, GAME_NOTICE, GPL_NOTICE, LICENSE_NOTICE } from '../src/shared/credits.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}

/* --------------------------------- ABOUT.md --------------------------------- */

// The About page's notices, with what Spellforge is and where its credits are.
const about: string[] = [
  '# About Spellforge',
  '',
  'Spellforge is a free, open-source Windows editor for Elden Ring mods: weapons, spells, skills, bullets, effects, animations, behaviour scripts and every param. It reads the game straight from its Steam install and writes only into a mod project. It never writes to the game folder, has no network code and ships no game files.',
  '',
  '## Licence',
  '',
  LICENSE_NOTICE,
  '',
  'The licence text is [LICENSE](LICENSE); the others are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).',
  '',
  GPL_NOTICE,
  '',
  '## Credits',
  '',
  'Spellforge stands on the work of the souls modding community and of open-source projects. The About page (Help > About Spellforge) and [CREDITS.md](CREDITS.md) name everyone whose work it uses or learned from, and what for; code that follows someone’s work names it in a `Credit:` line.',
  '',
  '## The game',
  '',
  GAME_NOTICE,
  '',
]
fs.writeFileSync(path.join(ROOT, 'ABOUT.md'), about.join('\n'))

/* -------------------------------- CREDITS.md -------------------------------- */

const md: string[] = [
  '# Credits',
  '',
  'Spellforge stands on the work of the souls modding community and of open-source projects. Each is listed once, under the main way Spellforge uses it. Code that uses one names it in a `Credit:` line. The licence texts the app ships with are in THIRD_PARTY_NOTICES.txt.',
  '',
  LICENSE_NOTICE,
  '',
  GPL_NOTICE,
  '',
  `_${GAME_NOTICE}_`,
]
for (const [kind, title] of CREDIT_SECTIONS) {
  md.push('', `## ${title}`, '')
  for (const c of CREDITS.filter((x) => x.kinds[0] === kind)) {
    const name = c.url ? `[${c.name}](${c.url})` : c.name
    md.push(`- **${name}**, by ${c.by}${c.license ? ` (${c.license})` : ''}: ${c.use}`)
  }
}
md.push(
  '',
  '## Built with',
  '',
  'TypeScript, Vite, electron-vite, electron-builder, ESLint and Prettier (development only, not part of the app).',
  '',
)
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), md.join('\n'))

/* ---------------------------- THIRD_PARTY_NOTICES ---------------------------- */

const MIT = (copyright: string) => `${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`

const RULE = '='.repeat(78)
/** A paragraph wrapped at 78 columns, as the notices are. */
const wrap = (text: string): string[] => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > 78) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  return line ? [...lines, line] : lines
}
const notices: string[] = [
  'THIRD-PARTY NOTICES',
  '',
  'Spellforge includes or adapts the following works. Their licences require',
  'these notices to travel with the app and its source. Spellforge’s own code is',
  'released under the MIT No Attribution licence (LICENSE.txt), which asks no',
  'credit; the works below keep their own licences. The Electron runtime’s own',
  'notices are in LICENSE.electron.txt and LICENSES.chromium.html beside the app.',
  '',
  ...wrap(`No GPL code is among them. ${GPL_NOTICE}`),
]
const section = (title: string, body: string) => notices.push('', RULE, title, RULE, '', body.trim())
const file = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

// Code Spellforge adapts.
section(
  'Lua 5.1.5 (src/core/formats/hks/compile.ts is a port of lparser.c and lcode.c)',
  MIT('Copyright (C) 1994-2012 Lua.org, PUC-Rio.'),
)
section(
  'hksc (HavokScript opcode tables; "licensed under the same terms as Lua")',
  MIT('Copyright (C) 1994-2008 Lua.org, PUC-Rio.'),
)
section(
  'bcdec (src/core/formats/bc6h.ts is a port of its BC6H decoder; used under its MIT option)',
  MIT('Copyright (c) 2022 Sergii Kudlai'),
)
section(
  'ww2ogg and the Vorbis codebooks (src/core/formats/wemVorbis.ts; data/er/wwise)',
  file('data/er/wwise/COPYING-ww2ogg.txt'),
)
// Data Spellforge ships.
section('Smithbox (param definitions, names and lists in data/er)', file('data/er/LICENSE-Smithbox.txt'))
section('DS Anim Studio (the animation event template, data/er/tae-template.json)', file('data/er/LICENSE-DSAS.txt'))

// Libraries inside the built app: the main process's runtime dependencies and the UI's bundled packages.
interface Pkg {
  name: string
  version: string
  license?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dir: string
}
function readPkg(name: string, from: string): Pkg | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name, 'package.json')
    if (fs.existsSync(candidate))
      return { ...JSON.parse(fs.readFileSync(candidate, 'utf8')), dir: path.dirname(candidate) }
    if (path.dirname(dir) === dir) return null
  }
}
const included = new Map<string, Pkg>()
function include(name: string, from: string): void {
  const p = readPkg(name, from)
  if (!p || included.has(`${p.name}@${p.version}`)) return
  included.set(`${p.name}@${p.version}`, p)
  // Optional ones only when installed (a platform's native binary, say).
  for (const dep of Object.keys({ ...p.dependencies, ...p.optionalDependencies })) include(dep, p.dir)
}
for (const name of Object.keys(pkg.dependencies)) include(name, ROOT)
// What the UI imports from node_modules (bundled into the app by Vite).
const bare = new Set<string>()
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(e.name))
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/from '([^.'][^']*)'/g)) {
        const spec = m[1]
        bare.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])
      }
  }
}
walk(path.join(ROOT, 'src', 'renderer'))
for (const name of [...bare].sort()) include(name, ROOT)

for (const p of [...included.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const licenseFile = fs.readdirSync(p.dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  const text = licenseFile
    ? fs.readFileSync(path.join(p.dir, licenseFile), 'utf8').replace(/\r\n/g, '\n')
    : `Licensed under ${p.license ?? 'the terms in its package'} (the package includes no licence file).`
  section(`${p.name} ${p.version} (${p.license ?? 'licence in package'})`, text)
}
notices.push('')
fs.writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'))
console.log(
  `Wrote ABOUT.md, CREDITS.md (${CREDITS.length} credits) and THIRD_PARTY_NOTICES.txt (${included.size} libraries).`,
)
