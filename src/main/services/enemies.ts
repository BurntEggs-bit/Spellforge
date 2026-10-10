/**
 * Characters other than the player (chr/cXXXX: enemies, bosses, NPCs,
 * creatures): who they are, what their moves do, and the events of each
 * move. Read-only: nothing here writes files.
 *
 * A character's files: cXXXX.anibnd holds its skeleton and its TAE (the
 * events of every animation, ids like 2003027 = a002_003027); the motions
 * are in cXXXX_divNN.anibnd; cXXXX.chrbnd is the model with its dummy polys;
 * sfx/sfxbnd_cXXXX holds the effects only it uses.
 *
 * Who uses a model isn't stored with it: NpcParam row ids follow it by
 * convention (21300000 and up are c2130, Margit). A move's events reach the
 * params through the character's behavior rows: BehaviorParam
 * 200,000,000 + variation * 1000 + judge, the variation being its NpcParam
 * row's behaviorVariationId; those point at AtkParam_Npc attacks, bullets
 * and SpEffects.
 */
import type { Project } from '../../core/project/project.ts'
import type { ParamDatabase } from '../../core/params/paramDb.ts'
import { readBnd4 } from '../../core/formats/bnd4.ts'
import { dcxDecompress } from '../../core/formats/dcx.ts'
import { readTaeFile, type ParamSizes, type TaeFile, type TaeFileAnimation } from '../../core/formats/taeFile.ts'
import { readFlver, type FlverDummy } from '../../core/formats/flver.ts'
import { decodeEvent, eventSummary, groupOf, type TaeTemplate } from '../../core/animation/animations.ts'
import { loadItemTable } from '../../core/project/text.ts'
import type * as A from '../../shared/api.ts'
import { OPEN_EVENT_END } from '../../shared/api.ts'
import { behaviorRowFor } from '../../core/params/behaviorIds.ts'
import { animationNameOfFullId, fullAnimationId, parseAnimationName } from '../../shared/animIds.ts'
import { BoundedMap } from '../../shared/collections.ts'
import { fileNameOf } from '../../core/formats/paths.ts'

export interface EnemyHost {
  effectName(id: number): string
  /** The effect is in the common bundles (any character can show it). */
  commonEffect(id: number): boolean
  template: TaeTemplate
  sizes: ParamSizes
}

/** An animation's number in a character's TAE (the category kept in the id: a002_003027 is 2003027). */
function enemyAnimId(name: string): number {
  const parsed = parseAnimationName(name)
  if (!parsed) throw new Error(`Not an animation name: ${name}`)
  return fullAnimationId(parsed.category, parsed.id)
}

/** c2130 -> 2130; NpcParam 21300000 -> c2130. */
const chrNumber = (chr: string) => Number(chr.slice(1))
const chrOfNpc = (id: number) => `c${String(Math.floor(id / 10000)).padStart(4, '0')}`

export class EnemyService {
  private project: Project
  private db: ParamDatabase
  private host: EnemyHost
  private listCache: A.EnemyListItem[] | null = null
  private names: Map<number, string> | null = null
  private taes = new BoundedMap<string, TaeFile>(6)
  private dummyCache = new Map<string, { dummies: FlverDummy[]; bones: { name: string; parent: number }[] }>()

  constructor(project: Project, db: ParamDatabase, host: EnemyHost) {
    this.project = project
    this.db = db
    this.host = host
  }

  /* ---------------------------------- list ---------------------------------- */

  private npcNames(): Map<number, string> {
    if (!this.names) this.names = loadItemTable(this.project, 'NpcName')
    return this.names
  }

  /** NpcParam rows by model. */
  private npcsByChr(): Map<string, number[]> {
    const out = new Map<string, number[]>()
    let rows: { id: number }[] = []
    try {
      rows = this.db.get('NpcParam').param.rows
    } catch {
      /* no NpcParam */
    }
    for (const r of rows) {
      if (r.id < 10000) continue
      const c = chrOfNpc(r.id)
      const l = out.get(c) ?? []
      l.push(r.id)
      out.set(c, l)
    }
    return out
  }

  /** A row's in-game name (NpcName via nameId), else its row name without location notes. */
  private npcName(id: number): { game: string; row: string } {
    const nameId = this.db.num('NpcParam', id, 'nameId')
    const game = nameId > 0 ? (this.npcNames().get(nameId) ?? '') : ''
    const row = this.db
      .rowName('NpcParam', id)
      .replace(/\s*[-–]\s*.*$/, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .replace(/^\[[^\]]*\]\s*/, '')
      .trim()
    return { game, row }
  }

  private nameOf(chr: string, npcs: number[]): { name: string; aliases: string[] } {
    const count = new Map<string, number>()
    const add = (n: string, w: number) => n && count.set(n, (count.get(n) ?? 0) + w)
    for (const id of npcs) {
      const { game, row } = this.npcName(id)
      // In-game names count more than row names.
      add(game, 3)
      add(row, 1)
    }
    const sorted = [...count].sort((a, b) => b[1] - a[1]).map(([n]) => n)
    return { name: sorted[0] ?? chr, aliases: sorted.slice(1, 6) }
  }

  list(): A.EnemyListItem[] {
    if (this.listCache) return this.listCache
    const byChr = this.npcsByChr()
    const out: A.EnemyListItem[] = []
    for (const file of this.project.list('chr', /^c\d{4}\.anibnd\.dcx$/i)) {
      const chr = fileNameOf(file).slice(0, 5).toLowerCase()
      if (chr === 'c0000') continue
      const npcs = byChr.get(chr) ?? []
      const { name, aliases } = this.nameOf(chr, npcs)
      out.push({
        chr,
        name,
        aliases,
        npcs: npcs.length,
        bundle: !!this.project.resolve(`sfx/sfxbnd_${chr}.ffxbnd.dcx`),
      })
    }
    // Named characters first, alphabetically; then the rest by model id.
    out.sort(
      (a, b) =>
        Number(a.name === a.chr) - Number(b.name === b.chr) ||
        (a.name === a.chr ? a.chr.localeCompare(b.chr) : a.name.localeCompare(b.name)),
    )
    this.listCache = out
    return out
  }

  /* ---------------------------------- TAE ----------------------------------- */

  tae(chr: string): TaeFile {
    const hit = this.taes.get(chr)
    if (hit) return hit
    const rel = `chr/${chr}.anibnd.dcx`
    if (!this.project.resolve(rel)) throw new Error(`${chr} has no animations`)
    const bnd = readBnd4(dcxDecompress(this.project.read(rel).data).data)
    const e = bnd.entries.find((x) => /\.tae$/i.test(x.name))
    if (!e) throw new Error(`${chr}.anibnd has no events (TAE)`)
    const tae = readTaeFile(e.data, this.host.sizes)
    this.taes.set(chr, tae)
    return tae
  }

  animation(chr: string, name: string): TaeFileAnimation {
    const id = enemyAnimId(name)
    const a = this.tae(chr).animations.find((x) => x.id === id)
    if (!a) throw new Error(`${chr} has no animation ${name}`)
    return a
  }

  /** The .hkx a character's animation plays (its own, or the one it borrows). */
  motionHkx(chr: string, name: string): string {
    const tae = this.tae(chr)
    let a = this.animation(chr, name)
    for (let hops = 0; hops < 8; hops++) {
      const f = a.file
      const ref = f.type === 1 ? f.a : f.a === 256 && f.b > 0 ? f.b : 0
      if (ref > 0) {
        const next = tae.animations.find((x) => x.id === ref)
        if (next && next !== a) {
          a = next
          continue
        }
        return `${animationNameOfFullId(ref)}.hkx`
      }
      return `${(f.name || `${animationNameOfFullId(a.id)}.hkt`).replace(/\.hk[tx]$/i, '')}.hkx`
    }
    return `${name}.hkx`
  }

  anim(chr: string, name: string): A.AnimationView {
    const anim = this.animation(chr, name)
    const t = this.host.template
    const events = anim.events.map((ev, index): A.AnimEventView => {
      const fields = decodeEvent(ev, t).map((f): A.AnimFieldView => ({
        ...f,
        linkLabel: this.linkLabel(f.link, f.value),
      }))
      return {
        index,
        type: ev.type,
        typeName: t.events[ev.type]?.name ?? `Event ${ev.type}`,
        known: !!t.events[ev.type],
        start: ev.start,
        end: ev.end,
        group: groupOf(anim, index),
        summary: eventSummary(fields),
        fields,
        raw: ev.params.toString('hex'),
      }
    })
    const f = anim.file
    const ref = f.type === 1 ? f.a : f.a === 256 && f.b > 0 ? f.b : 0
    return {
      name,
      category: Math.floor(anim.id / 1_000_000),
      id: anim.id,
      motion: f.type === 1 ? 'full' : ref ? 'motion' : 'own',
      motionFile: f.name,
      source: ref ? animationNameOfFullId(ref) : null,
      events,
      length: Math.max(0, ...anim.events.flatMap((e) => [e.start, e.end < OPEN_EVENT_END ? e.end : 0])),
      registration: 'unsupported',
      selectors: [],
      state: null,
    }
  }

  /** Events of a move as stored, for the clipboard: they paste into the player's animations as they are. */
  copyEvents(chr: string, name: string, indices: number[]): A.AnimClipboardEvent[] {
    const anim = this.animation(chr, name)
    const t = this.host.template
    return [...new Set(indices)]
      .filter((i) => anim.events[i])
      .sort((a, b) => a - b)
      .map((i) => {
        const ev = anim.events[i]
        return {
          type: ev.type,
          unk: ev.unk,
          start: ev.start,
          end: ev.end,
          params: ev.params.toString('hex'),
          typeName: t.events[ev.type]?.name ?? `Event ${ev.type}`,
        }
      })
  }

  private linkLabel(link: A.AnimFieldView['link'], value: number): string | undefined {
    if (!link || value <= 0) return undefined
    if (link === 'effect') return this.host.effectName(value) || undefined
    if (link === 'speffect') return this.db.rowName('SpEffectParam', value) || undefined
    return undefined
  }

  /* ------------------------------- behaviors -------------------------------- */

  /** The BehaviorParam row a judge means for a behavior variation, or null. */
  behaviorRow(judge: number, variation: number): number | null {
    return behaviorRowFor(this.db, 'BehaviorParam', judge, variation)
  }

  /** What a behavior row does: an attack, a bullet or a SpEffect. */
  behaviorTarget(row: number): { kind: 'attack' | 'bullet' | 'speffect'; id: number } | null {
    const refType = this.db.num('BehaviorParam', row, 'refType')
    const refId = this.db.num('BehaviorParam', row, 'refId')
    if (refId <= 0) return null
    if (refType === 0) return { kind: 'attack', id: refId }
    if (refType === 1) return { kind: 'bullet', id: refId }
    if (refType === 2) return { kind: 'speffect', id: refId }
    return null
  }

  /** The variation a character's moves resolve with: its named NPC rows' most common one. */
  defaultVariation(chr: string): number {
    const rows = this.npcsByChr().get(chr) ?? []
    const count = new Map<number, number>()
    for (const id of rows) {
      const v = this.db.num('NpcParam', id, 'behaviorVariationId')
      if (v <= 0) continue
      const named = !!this.npcName(id).game
      count.set(v, (count.get(v) ?? 0) + (named ? 3 : 1))
    }
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chrNumber(chr) * 10
  }

  /** A move's behavior events (attacks, bullets, SpEffects) and effects. */
  move(chr: string, name: string, variation: number): A.EnemyMove {
    const anim = this.animation(chr, name)
    const t = this.host.template
    const actions: A.EnemyMoveAction[] = []
    const effects = new Map<number, A.EnemyMove['effects'][number]>()
    anim.events.forEach((ev, index) => {
      const fields = decodeEvent(ev, t)
      const judge = fields.find((f) => f.name === 'BehaviorJudgeID')?.value
      if ((ev.type === 1 || ev.type === 2) && judge !== undefined && judge >= 0) {
        const row = this.behaviorRow(judge, variation)
        const target = row !== null ? this.behaviorTarget(row) : null
        const kind = target?.kind ?? (ev.type === 2 ? 'bullet' : 'attack')
        const param = kind === 'attack' ? 'AtkParam_Npc' : kind === 'bullet' ? 'Bullet' : 'SpEffectParam'
        const id = target?.id ?? null
        actions.push({
          event: index,
          start: ev.start,
          kind,
          judge,
          behavior: row,
          id,
          name: id !== null && this.db.hasRow(param, id) ? this.db.rowName(param, id) : '',
        })
      }
      for (const f of fields) {
        if (f.link !== 'effect' || f.value <= 0 || effects.has(f.value)) continue
        effects.set(f.value, {
          id: f.value,
          name: this.host.effectName(f.value),
          common: this.host.commonEffect(f.value),
        })
      }
    })
    const length = Math.max(0, ...anim.events.flatMap((e) => [e.start, e.end < OPEN_EVENT_END ? e.end : 0]))
    const label = (a: A.EnemyMoveAction) =>
      a.name.replace(/^\[[^\]]*\]\s*/, '') ||
      `${a.kind === 'bullet' ? 'Bullet' : a.kind === 'attack' ? 'Attack' : 'SpEffect'} ${a.id ?? `judge ${a.judge}`}`
    const parts = [...new Set(actions.filter((a) => a.kind !== 'speffect').map(label))]
    if (effects.size) parts.push(`${effects.size} effect${effects.size === 1 ? '' : 's'}`)
    const kind: A.EnemyMove['kind'] = actions.some((a) => a.kind === 'bullet')
      ? 'spell'
      : actions.some((a) => a.kind === 'attack')
        ? 'attack'
        : 'other'
    return {
      name,
      length,
      actions,
      effects: [...effects.values()],
      summary: parts.join(', '),
      kind,
      hand: this.handOf(chr, anim, actions),
    }
  }

  /**
   * The hand a move is made with: where its effects, bullets and hits are
   * (dummy polys on bones under L_Hand or R_Hand), or null.
   */
  private handOf(chr: string, anim: TaeFileAnimation, actions: A.EnemyMoveAction[]): 'left' | 'right' | null {
    let model: { dummies: FlverDummy[]; bones: { name: string; parent: number }[] }
    try {
      model = this.dummies(chr)
    } catch {
      return null
    }
    const ids = new Set<number>()
    for (const ev of anim.events)
      for (const f of decodeEvent(ev, this.host.template))
        if (/^DummyPoly(ID|Blade\w*ID)$/i.test(f.name) && f.value > 0) ids.add(f.value)
    for (const a of actions) {
      if (a.kind !== 'attack' || a.id === null) continue
      for (let k = 0; k < 16; k++)
        for (const f of [`hit${k}_DmyPoly1`, `hit${k}_DmyPoly2`])
          if (this.db.num('AtkParam_Npc', a.id, f) > 0) ids.add(this.db.num('AtkParam_Npc', a.id, f))
    }
    let left = 0
    let right = 0
    for (const id of ids) {
      const d = model.dummies.find((x) => x.id === id)
      for (let b = d?.attachBone ?? -1, n = 0; b >= 0 && n < 64; b = model.bones[b].parent, n++) {
        const name = model.bones[b].name
        if (name === 'L_Hand') left++
        if (name === 'R_Hand') right++
        if (/_Hand$/.test(name)) break
      }
    }
    return left > right ? 'left' : right > left ? 'right' : null
  }

  view(chr: string, variation?: number): A.EnemyView {
    const rows = this.npcsByChr().get(chr) ?? []
    const v = variation ?? this.defaultVariation(chr)
    const npcs = rows.map((id) => {
      const masks: number[] = []
      for (let k = 0; k < 32; k++) if (this.db.num('NpcParam', id, `modelDispMask${k}`)) masks.push(k)
      const n = this.npcName(id)
      return {
        id,
        name: n.game || this.db.rowName('NpcParam', id) || `NPC ${id}`,
        variation: this.db.num('NpcParam', id, 'behaviorVariationId'),
        masks,
      }
    })
    const moves = this.tae(chr).animations.map((a) => this.move(chr, animationNameOfFullId(a.id), v))
    const spells = new Map<number, A.EnemySpell>()
    for (const m of moves)
      for (const a of m.actions) {
        if (a.kind !== 'bullet' || a.id === null || !this.db.hasRow('Bullet', a.id)) continue
        const hit = spells.get(a.id)
        if (hit) {
          if (!hit.moves.includes(m.name)) hit.moves.push(m.name)
          continue
        }
        const atk = this.db.num('Bullet', a.id, 'atkId_Bullet')
        const effect = this.db.num('Bullet', a.id, 'sfxId_Bullet')
        spells.set(a.id, {
          bullet: a.id,
          name: this.db.rowName('Bullet', a.id),
          attack: atk > 0 ? atk : null,
          effect: effect > 0 ? effect : null,
          effectName: effect > 0 ? this.host.effectName(effect) : '',
          moves: [m.name],
        })
      }
    const { name } = this.nameOf(chr, rows)
    const bundle = `sfx/sfxbnd_${chr}.ffxbnd.dcx`
    return {
      chr,
      name,
      npcs,
      variation: v,
      moves,
      spells: [...spells.values()],
      bundle: this.project.resolve(bundle) ? bundle : null,
    }
  }

  /* --------------------------------- model ---------------------------------- */

  /** The model's dummy polys and FLVER bones (for mapping them onto the player). */
  dummies(chr: string): { dummies: FlverDummy[]; bones: { name: string; parent: number }[] } {
    const hit = this.dummyCache.get(chr)
    if (hit) return hit
    const bnd = readBnd4(dcxDecompress(this.project.read(`chr/${chr}.chrbnd.dcx`).data).data)
    const e = bnd.entries.find((x) => /\.flver$/i.test(x.name))
    if (!e) throw new Error(`${chr}.chrbnd has no model`)
    const fl = readFlver(e.data)
    const out = { dummies: fl.dummies, bones: fl.bones.map((b) => ({ name: b.name, parent: b.parent })) }
    this.dummyCache.set(chr, out)
    return out
  }
}
