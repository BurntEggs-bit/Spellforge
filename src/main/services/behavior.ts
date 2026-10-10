/**
 * The player's behaviour script (action/script/c0000.hks): the recipes the
 * project gives it (src/core/behavior/recipes.ts), the script they're
 * appended to, and checks before it's written.
 *
 * The script written is a base plus Spellforge's block at its end:
 *   - the project's own text script, when it has one (another mod's, a
 *     community script, a hand edit): kept as it is, Spellforge's block
 *     replaced each save;
 *   - else the game's own script, decompiled from the installed game
 *     (src/core/formats/hks/decompile.ts), so it matches the game version.
 * The game compiles a text c0000.hks itself when it loads it. Before
 * writing, the whole text is parsed and compiled with Spellforge's own HKS
 * compiler: a script that doesn't compile is never written (in game it
 * leaves the character standing, unable to act).
 *
 * The recipes are kept in .spellforge/behaviour.json; Update from game
 * decompiles the new game's script and appends the same block again.
 *
 * Credit: EldenRingHKS (ividyon, Vawser, Exelot and others): its curated
 * c0000.hks is recognised as a source, and studied for the recipes; it isn't
 * shipped.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Project } from '../../core/project/project.ts'
import { readHks, isHksBytecode } from '../../core/formats/hks/bytecode.ts'
import { decompileHks } from '../../core/formats/hks/decompile.ts'
import { checkHksSyntax, parseHks } from '../../core/formats/hks/parser.ts'
import { HksSyntaxError } from '../../core/formats/hks/lexer.ts'
import { compileHks } from '../../core/formats/hks/compile.ts'
import { disassembleHks } from '../../core/formats/hks/disasm.ts'
import { compareWithGame, idNameClashes } from '../../core/formats/hks/compare.ts'
import {
  BLOCK_BEGIN,
  SKILL_TYPE_TABLES,
  definedFunctions,
  generateBlock,
  stripBlock,
  withBlock,
} from '../../core/behavior/recipes.ts'
import { hookOf, recipeProblems, type Recipe } from '../../shared/recipes.ts'
import { lintHks, scriptContext, type ScriptContext } from '../../core/behavior/lint.ts'
import type * as A from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'

const BEHAVIOUR_RECORD = '.spellforge/behaviour.json'
const SCRIPT = 'action/script/c0000.hks'
/** The game's constants and shared tables (TRUE, HAND_RIGHT, the Event_… tables), loaded before c0000.hks. */
const COMMON_DEFINE = 'action/script/common_define.hks'
/** The title a script checked in the editor is generated under (to find its lines in the whole script). */
const CHECK_TITLE = '__spellforge_check__'

interface Record {
  recipes: Recipe[]
  /**
   * 'game': the script was made from the game's own (decompiled): it's made
   * again from the installed game's each save, so a game update brings the
   * game's new script with the same recipes on it.
   */
  base?: 'game'
  /** The new skill types the written script gives table entries (see skillTypeEntries). */
  skillTypes?: number[]
}

export interface BehaviourHost {
  project: Project
  /** Where decompiled game scripts are cached (by the game file's fingerprint). */
  cacheDir: string
  /** Behaviour event names the game knows (action/eventnameid.txt), and the animation id each plays. */
  slots(): A.BehaviourSlot[]
  /** Every behaviour event name the game knows (action/eventnameid.txt). */
  events(): Set<string>
  /** Skill types (swordArtsTypeNew) the project's skills use and no game skill does, sorted. */
  skillTypes(): number[]
}

export class BehaviourService {
  private host: BehaviourHost
  private record: Record | null = null
  private dirty = false
  /** The base text and where it came from (read once). */
  private base: { text: string; source: A.BehaviourStatus['source']; functions: Set<string> } | null = null
  private slotCache: A.BehaviourSlot[] | null = null
  /** What the game's scripts define and use, for checking scripts users write (lint.ts). */
  private ctx: ScriptContext | null = null
  /** Whether the skill code in use reads the per-skill-type tables unchecked (see skillTablesUnchecked). */
  private unchecked: boolean | null = null

  constructor(host: BehaviourHost) {
    this.host = host
  }

  private load(): Record {
    if (this.record) return this.record
    try {
      this.record = JSON.parse(
        fs.readFileSync(path.join(this.host.project.config.modDir, BEHAVIOUR_RECORD), 'utf8'),
      ) as Record
      if (!Array.isArray(this.record.recipes)) this.record = { recipes: [] }
    } catch {
      this.record = { recipes: [] }
    }
    return this.record
  }

  /**
   * The script the recipes are appended to: the project's own text (without
   * Spellforge's block), else the game's compiled script decompiled.
   */
  private baseScript(): NonNullable<BehaviourService['base']> {
    if (this.base) return this.base
    const { project } = this.host
    const where = project.resolve(SCRIPT)
    if (!where) throw new Error('Neither the project nor the game has action/script/c0000.hks')
    const file = project.read(SCRIPT).data
    let text: string
    let source: A.BehaviourStatus['source']
    if (where.source === 'project' && this.load().base === 'game') {
      // Made from the game's own: the installed game's, decompiled again.
      text = this.decompiled(project.readGame(SCRIPT), 'game')
      source = 'game'
    } else if (where.source === 'project' && !isHksBytecode(file)) {
      text = stripBlock(file.toString('utf8').replace(/^\uFEFF/, ''))
      source = text.includes('Curated at: https://github.com/ividyon/EldenRingHKS') ? 'community' : 'project'
    } else {
      text = this.decompiled(file, where.source === 'project' ? 'project' : 'game')
      source = where.source === 'project' ? 'project-compiled' : 'game'
    }
    this.base = { text, source, functions: definedFunctions(text) }
    return this.base
  }

  /** A compiled script as text (cached by its bytes' size and a sample, so a game update decompiles again). */
  private decompiled(file: Buffer, tag: string, name = 'c0000'): string {
    const key = `${tag}-${file.length}-${file.readUInt32LE(Math.min(file.length - 4, 0x1000))}-${file.readUInt32LE(Math.max(0, file.length - 4))}`
    const cached = path.join(this.host.cacheDir, `${name}-${key}.hks.txt`)
    try {
      if (fs.existsSync(cached)) return fs.readFileSync(cached, 'utf8')
    } catch {
      /* decompile again */
    }
    const text = decompileHks(readHks(file)).text
    try {
      fs.mkdirSync(this.host.cacheDir, { recursive: true })
      fs.writeFileSync(cached, text)
    } catch {
      /* caching is only a speed-up */
    }
    return text
  }

  /** The events recipes can play: the behaviour graph's states that play an animation id. */
  slots(): A.BehaviourSlot[] {
    return (this.slotCache ??= this.host.slots())
  }

  /**
   * What the game's scripts define and use (the base script and the game's
   * common_define.hks, parsed): for checking scripts users write, and the
   * half-body events recipes play with ExecEventHalfBlend.
   */
  context(): ScriptContext {
    if (this.ctx) return this.ctx
    const chunks = []
    try {
      chunks.push(parseHks(this.baseScript().text))
    } catch {
      /* a base that doesn't parse: checked without it */
    }
    try {
      const { project } = this.host
      const file = project.read(COMMON_DEFINE).data
      const where = project.resolve(COMMON_DEFINE)?.source === 'project' ? 'project' : 'game'
      chunks.push(
        parseHks(
          isHksBytecode(file)
            ? this.decompiled(file, where, 'common_define')
            : file.toString('utf8').replace(/^\uFEFF/, ''),
        ),
      )
    } catch {
      /* without the game's constants */
    }
    let events = new Set<string>()
    try {
      events = this.host.events()
    } catch {
      /* events not checked */
    }
    this.ctx = scriptContext(chunks, events)
    return this.ctx
  }

  /** Names for the script editor's colours and the wrap template (each function's parameters). */
  names(): A.HksNames {
    const c = this.context()
    return {
      functions: [...c.functions].sort().map((name) => ({ name, params: c.params.get(name) ?? [] })),
      constants: [...c.globals].filter((n) => !c.functions.has(n)).sort(),
      engine: [...c.engine].sort(),
      halfBlend: Object.fromEntries(c.halfBlend),
    }
  }

  /**
   * A script being written in the editor, checked: its syntax, Spellforge's
   * checks (lint.ts), compiled alone (Spellforge's compiler, as the game
   * compiles a text script: a listing of its instructions), and compiled
   * with the whole script (the base, Spellforge's part and the project's
   * other scripts, this one as it is now in place of `id`).
   */
  check(code: string, id?: string): A.HksCheck {
    const t0 = performance.now()
    const problems: A.HksProblem[] = []
    const fromError = (e: unknown, source: A.HksProblem['source']): boolean => {
      if (!(e instanceof HksSyntaxError)) return false
      problems.push({ line: e.line, col: e.col, length: 1, severity: 'error', message: e.reason, source })
      return true
    }
    let chunk = null
    try {
      chunk = parseHks(code)
    } catch (e) {
      if (!fromError(e, 'syntax')) throw e
    }
    let compiled: A.HksCheck['compiled'] = null
    if (chunk) {
      for (const p of lintHks(chunk, this.context(), code)) problems.push({ ...p, source: 'check' })
      try {
        const c = compileHks(code)
        let functions = 0
        let instructions = 0
        const walk = (f: typeof c.main) => {
          functions++
          instructions += f.code.length
          f.children.forEach(walk)
        }
        walk(c.main)
        const listing = disassembleHks(c)
        compiled = {
          functions,
          instructions,
          listing: listing.length > 200_000 ? `${listing.slice(0, 200_000)}\n…` : listing,
        }
      } catch (e) {
        if (!fromError(e, 'compile'))
          problems.push({
            line: 1,
            col: 1,
            length: 1,
            severity: 'error',
            message: errorMessage(e),
            source: 'compile',
          })
      }
    }
    // With the whole script.
    let whole: string | null = null
    if (!problems.some((p) => p.severity === 'error')) {
      try {
        const base = this.baseScript()
        const others = this.load().recipes.filter((r) => r.id !== id)
        const mine: Recipe = { id: id ?? CHECK_TITLE, kind: 'code', title: CHECK_TITLE, code }
        const { text: block } = generateBlock(
          [...others, mine],
          (fn) => base.functions.has(fn),
          this.context().halfBlend,
          this.wantedSkillTypes(),
        )
        const full = withBlock(base.text, block)
        try {
          compileHks(full)
        } catch (e) {
          if (!(e instanceof HksSyntaxError)) throw e
          // Lines of this code in the whole script: after its header.
          const header = full.split('\n').indexOf(`-- Your code: ${CHECK_TITLE}`) + 1
          const n = code.replace(/\r\n/g, '\n').split('\n').length
          if (header > 0 && e.line > header && e.line <= header + n)
            problems.push({
              line: e.line - header,
              col: e.col,
              length: 1,
              severity: 'error',
              message: `${e.reason} (with the whole script)`,
              source: 'compile',
            })
          else
            whole = `The whole script doesn’t compile, at its line ${e.line}: ${e.reason} (another script or behaviour)`
        }
      } catch (e) {
        whole = errorMessage(e)
      }
    }
    problems.sort((a, b) => a.line - b.line || a.col - b.col)
    return {
      problems,
      compiles: !problems.some((p) => p.severity === 'error') && !whole,
      whole,
      compiled,
      ms: Math.round(performance.now() - t0),
    }
  }

  status(): A.BehaviourStatus {
    const rec = this.load()
    let base: BehaviourService['base'] = null
    let problem: string | null = null
    try {
      base = this.baseScript()
    } catch (e) {
      problem = errorMessage(e)
    }
    const events = new Set(this.slots().map((s) => s.event))
    let halfBlend: Map<string, string> | undefined
    try {
      halfBlend = this.context().halfBlend
    } catch {
      halfBlend = undefined
    }
    const recipes = rec.recipes.map((r) => {
      const problems = recipeProblems(r, events, halfBlend)
      const fn = hookOf(r)
      if (fn && base && !base.functions.has(fn)) problems.push(`The script has no ${fn}: this can’t work on it`)
      return { recipe: r, problems }
    })
    return {
      source: base?.source ?? 'none',
      functions: base?.functions.size ?? 0,
      lines: base ? base.text.split('\n').length : 0,
      recipes,
      dirty: this.dirty,
      written: this.host.project.resolve(SCRIPT)?.source === 'project',
      problem,
    }
  }

  recipes(): Recipe[] {
    return this.load().recipes
  }

  /** Adds or replaces a recipe (by id). */
  setRecipe(r: Recipe): A.BehaviourStatus {
    const rec = this.load()
    const i = rec.recipes.findIndex((x) => x.id === r.id)
    if (i >= 0) rec.recipes[i] = r
    else rec.recipes.push(r)
    this.dirty = true
    return this.status()
  }

  deleteRecipe(id: string): A.BehaviourStatus {
    const rec = this.load()
    rec.recipes = rec.recipes.filter((x) => x.id !== id)
    this.dirty = true
    return this.status()
  }

  /** New skill types the project's skills use (the host's answer; none when it can't tell). */
  skillTypes(): number[] {
    try {
      return this.host.skillTypes()
    } catch {
      return []
    }
  }

  /**
   * Whether the skill code in use reads the per-skill-type tables unchecked:
   * GetSwordArtsDiffCategory and GetSwordArtsPutOppositeWeapon as the base
   * script defines them, else as common_define.hks does. The game's read them
   * unchecked; the community's EldenRingHKS checks for absent entries (ivi:
   * "sanity check for absent entries (custom Sword Arts)"), and needs none.
   */
  private skillTablesUnchecked(): boolean {
    if (this.unchecked !== null) return this.unchecked
    let common = ''
    try {
      const { project } = this.host
      const file = project.read(COMMON_DEFINE).data
      const where = project.resolve(COMMON_DEFINE)?.source === 'project' ? 'project' : 'game'
      common = isHksBytecode(file)
        ? this.decompiled(file, where, 'common_define')
        : file.toString('utf8').replace(/^\uFEFF/, '')
    } catch {
      /* without common_define: judged by the base script alone */
    }
    const text = (fn: string) => this.functionText(fn) ?? functionTextIn(common, fn) ?? ''
    const checked = (fn: string, table: string) => new RegExp(`${table}\\[[^\\]]+\\]\\s*[~=]=\\s*nil`).test(text(fn))
    this.unchecked = !(
      checked('GetSwordArtsDiffCategory', 'SwordArtsCategory') &&
      checked('GetSwordArtsPutOppositeWeapon', 'SwordArtPutOppositeWeapon')
    )
    return this.unchecked
  }

  /**
   * The new skill types the block gives entries: all of them when the skill
   * code reads the tables unchecked and the base scripts define the tables
   * (the game's do), else none (written as plain statements, they'd stop the
   * script on a table that isn't there).
   */
  private wantedSkillTypes(): number[] {
    const types = this.skillTypes()
    if (!types.length || !this.skillTablesUnchecked()) return []
    const globals = this.context().globals
    return SKILL_TYPE_TABLES.every((t) => globals.has(t)) ? types : []
  }

  /** New skill types the written script has no entries for yet (written by the next save). */
  missingSkillTypes(): number[] {
    const have = new Set(this.load().skillTypes ?? [])
    return this.wantedSkillTypes().filter((t) => !have.has(t))
  }

  /** The script must be written again: recipes changed, or the new skill types it needs entries for did. */
  private needsWrite(): boolean {
    if (this.dirty) return true
    const have = this.load().skillTypes ?? []
    const want = this.wantedSkillTypes()
    return have.length !== want.length || want.some((t, i) => t !== have[i])
  }

  /** The block Spellforge appends, and the whole script checked: does it parse and compile? */
  preview(): A.BehaviourPreview {
    const base = this.baseScript()
    const { text: block, skipped } = generateBlock(
      this.load().recipes,
      (fn) => base.functions.has(fn),
      this.context().halfBlend,
      this.wantedSkillTypes(),
    )
    const full = withBlock(base.text, block)
    const syntax = checkHksSyntax(full)
    let compiles: string | null = null
    if (!syntax) {
      try {
        compileHks(full)
      } catch (e) {
        compiles = errorMessage(e)
      }
    }
    return {
      block,
      skipped: skipped.map((s) => ({ id: s.recipe.id, why: s.why })),
      error: syntax ? `Line ${syntax.line}, column ${syntax.col}: ${syntax.reason}` : compiles,
      lines: full.split('\n').length,
      blockStartsAt: full.split('\n').indexOf(block.split('\n')[0]) + 1,
    }
  }

  /**
   * The project's script compared with the installed game's own compiled
   * script, function by function (compiled with Spellforge's compiler): what
   * a community or mod script changed, and what it lacks from the game's
   * newer version.
   */
  compare(): A.BehaviourComparison {
    const { project } = this.host
    const text = this.baseScript().text
    const retail = readHks(project.readGame(SCRIPT))
    const list = compareWithGame(text, retail)
    const names = (status: string) =>
      list.filter((x) => x.status === status && x.name !== '(main chunk)').map((x) => x.name)
    const head = text.slice(0, 2000)
    const v = /Version\s+(\d+)/i.exec(head)
    const er = /(?:ER|ELDEN RING)\s*(?:version\s*|v)?(\d+\.\d+(?:\.\d+)?)/i.exec(head)
    return {
      version: v || er ? `${v ? `community v${v[1]}` : 'a script'}${er ? `, for ER ${er[1]}` : ''}` : null,
      same: list.filter((x) => x.status === 'same').length,
      constants: list.filter((x) => x.status === 'constants').length,
      different: names('different'),
      missing: names('missing'),
      extra: names('extra'),
      clashes: idNameClashes(text, retail),
    }
  }

  /** A function of the script, as text (its whole definition), for reading. */
  functionText(name: string): string | null {
    return functionTextIn(this.baseScript().text, name)
  }

  /** The script's functions, for browsing: names in file order. */
  functionNames(): string[] {
    const text = this.baseScript().text
    return [...text.matchAll(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map((m) => m[1])
  }

  /** Text search through the script: matching lines (up to `limit`). */
  search(query: string, limit = 200): { line: number; text: string }[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: { line: number; text: string }[] = []
    const lines = this.baseScript().text.split('\n')
    for (let i = 0; i < lines.length && out.length < limit; i++)
      if (lines[i].toLowerCase().includes(q)) out.push({ line: i + 1, text: lines[i].trim().slice(0, 200) })
    return out
  }

  dirtyFiles(): string[] {
    return this.needsWrite() ? [SCRIPT, BEHAVIOUR_RECORD] : []
  }

  /**
   * Writes the script (base + block) and the record, after checking the
   * whole script parses and compiles. With no recipes and no new skill types
   * left, a script that was only the game's own (decompiled) isn't needed:
   * the record is kept, the script is written without a block (the game's
   * behaviour).
   */
  save(): string[] {
    if (!this.needsWrite()) return []
    const p = this.preview()
    if (p.error) throw new Error(`The behaviour script doesn’t compile, so it wasn’t written: ${p.error}`)
    const base = this.baseScript()
    const recs = this.load().recipes
    const types = this.wantedSkillTypes()
    const blockTypes = types
    const written: string[] = []
    const { project } = this.host
    if (recs.length || blockTypes.length || project.resolve(SCRIPT)?.source === 'project') {
      const full =
        recs.length || blockTypes.length ? withBlock(base.text, p.block) : `${base.text.replace(/\s+$/, '')}\n`
      written.push(project.writeProjectFile(SCRIPT, Buffer.from(full, 'utf8')))
      if (base.source === 'game') this.load().base = 'game'
    }
    this.load().skillTypes = types
    written.push(project.writeProjectFile(BEHAVIOUR_RECORD, Buffer.from(JSON.stringify(this.load(), null, 1))))
    this.dirty = false
    return written
  }

  /** Whether the project's script already has Spellforge's block (it was written by this feature). */
  hasBlock(): boolean {
    const r = this.host.project.resolve(SCRIPT)
    if (r?.source !== 'project') return false
    const b = this.host.project.read(SCRIPT).data
    return !isHksBytecode(b) && b.toString('utf8').includes(BLOCK_BEGIN)
  }

  /** Forgets the base (the project's script changed on disk, or the game updated). */
  reset(): void {
    this.base = null
    this.slotCache = null
    this.ctx = null
    this.unchecked = null
  }

  /** The script is made from the game's own (so a game update brings the new one). */
  followsGame(): boolean {
    return this.load().base === 'game'
  }

  /**
   * After a game update: a script made from the game's own is made again
   * from the new game's (written by the next save). Returns whether it will.
   */
  updateFromGame(): boolean {
    if (this.load().base !== 'game' || this.host.project.resolve(SCRIPT)?.source !== 'project') return false
    this.reset()
    this.dirty = true
    return true
  }
}

/** A function's whole definition in a script's text (from its line to the `end` at its indentation), or null. */
function functionTextIn(text: string, name: string): string | null {
  const re = new RegExp(`^(\\s*)function\\s+${name.replace(/[^A-Za-z0-9_]/g, '')}\\s*\\(`, 'm')
  const m = re.exec(text)
  if (!m) return null
  const start = m.index
  const indent = m[1].replace(/\n/g, '')
  const endRe = new RegExp(`^${indent}end\\b`, 'gm')
  endRe.lastIndex = start + m[0].length
  const e = endRe.exec(text)
  return text.slice(start, e ? e.index + e[0].length : Math.min(text.length, start + 4000)).replace(/^\n+/, '')
}

/** Parses action/eventnameid.txt ("N = \"W_Name\"" lines) into its event names. */
export function eventNames(buf: Buffer): Set<string> {
  const out = new Set<string>()
  for (const m of buf.toString('utf8').matchAll(/^\s*\d+\s*=\s*"([^"]+)"/gm)) out.add(m[1])
  return out
}
