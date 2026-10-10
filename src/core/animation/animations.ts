/**
 * The player's animation events (chr/c0000.anibnd.dcx): one TAE file per
 * animation category (a053.tae holds every a053_XXXXXX animation), each event
 * decoded with DSAS's Elden Ring template (data/er/tae-template.json).
 *
 * Animation naming: "a" + 3-digit category + "_" + 6-digit animation id. The
 * category comes from the binder entry (id 5000000 + category, file aNN.tae /
 * aNNN.tae); the TAE's own id is 2000 + category in retail.
 *
 * Motion references, as the game's files use them:
 *   { type 0, a 0,   b -1 }              its own motion, the .hkt named in `name`
 *   { type 0, a 256, b category*1e6+id } another animation's motion (named in `name`)
 *   { type 1, a category*1e6+id }        everything (motion and events) from another animation
 * For type 0, `a` holds flags byte by byte (DS Anim Studio's names): bit 0
 * loops by default (a035_033260 has a = 1), bit 8 imports the motion of
 * animation `b` (a = 257 does both); c and d are always 0.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors; MIT): the event
 * template and the names of the event flags.
 */
import type { Bnd4, Bnd4Entry } from '../formats/bnd4.ts'
import {
  readTaeFile,
  writeTaeFile,
  type ParamSizes,
  type TaeFile,
  type TaeFileAnimation,
  type TaeFileEvent,
} from '../formats/taeFile.ts'
import { readTae } from '../formats/tae.ts'
import { animationName, categoryLabel, parseAnimationName } from '../../shared/animIds.ts'

export interface TemplateField {
  type: string
  name?: string
  offset: number
  assert?: string
  default?: string
  entries?: { name: string; value: number }[]
}

export interface TaeTemplate {
  events: Record<string, { name: string; size: number; fields: TemplateField[] }>
}

const TAE_DIR = 'N:\\GR\\data\\INTERROOT_win64\\chr\\c0000\\tae\\'
const TAE_ENTRY_BASE = 5_000_000

/** Category of a binder entry, from its file name (a53.tae, a053.tae, a129.tae). */
export function entryCategory(e: Bnd4Entry): number | null {
  const m = /[\\/]a(\d+)\.tae$/i.exec(e.name)
  return m ? Number(m[1]) : null
}

export type MotionKind = 'own' | 'motion' | 'full'

export interface MotionRef {
  kind: MotionKind
  /** Animation whose motion (or, for 'full', everything) this one uses. */
  source: string | null
  /** The .hkt name stored in the file. */
  file: string
}

export function motionOf(category: number, anim: TaeFileAnimation): MotionRef {
  const f = anim.file
  if (f.type === 1) return { kind: 'full', source: f.a > 0 ? fullName(f.a) : null, file: f.name }
  if ((f.a & IMPORTS_MOTION) !== 0 && f.b >= 0) return { kind: 'motion', source: fullName(f.b), file: f.name }
  return { kind: 'own', source: null, file: f.name || `${animationName(category, anim.id)}.hkt` }
}

/** Type 0 flags in `a`: plays looped by default, imports another animation's motion (`b`). */
export const LOOPS_BY_DEFAULT = 0x1
export const IMPORTS_MOTION = 0x100

/** The file reference for a motion: its own, another animation's, or everything from another animation. */
export function motionReference(
  kind: MotionKind,
  own: string,
  source: { name: string; file: string } | null,
  loop: boolean,
): TaeFileAnimation['file'] {
  const flags = loop ? LOOPS_BY_DEFAULT : 0
  if (kind === 'own' || !source) return { type: 0, name: `${own}.hkt`, a: flags, b: -1, c: 0n, d: 0n }
  const p = parseAnimationName(source.name)
  if (!p) throw new Error(`${source.name} isn’t an animation name`)
  const full = p.category * 1_000_000 + p.id
  if (kind === 'full') return { type: 1, name: '', a: full, b: 0, c: 0n, d: 0n }
  return { type: 0, name: source.file, a: flags | IMPORTS_MOTION, b: full, c: 0n, d: 0n }
}

/** 53030000 -> a053_030000 */
export function fullName(full: number): string {
  return animationName(Math.floor(full / 1_000_000), full % 1_000_000)
}

/* ------------------------------ event fields ----------------------------- */
const READ: Record<string, (b: Buffer, o: number) => number> = {
  s8: (b, o) => b.readInt8(o),
  u8: (b, o) => b.readUInt8(o),
  b: (b, o) => b.readUInt8(o),
  s16: (b, o) => b.readInt16LE(o),
  u16: (b, o) => b.readUInt16LE(o),
  s32: (b, o) => b.readInt32LE(o),
  u32: (b, o) => b.readUInt32LE(o),
  f32: (b, o) => b.readFloatLE(o),
  s64: (b, o) => Number(b.readBigInt64LE(o)),
  u64: (b, o) => Number(b.readBigUInt64LE(o)),
  f64: (b, o) => b.readDoubleLE(o),
}
const WRITE: Record<string, (b: Buffer, v: number, o: number) => void> = {
  s8: (b, v, o) => b.writeInt8(clampInt(v, -128, 127), o),
  u8: (b, v, o) => b.writeUInt8(clampInt(v, 0, 255), o),
  b: (b, v, o) => b.writeUInt8(v ? 1 : 0, o),
  s16: (b, v, o) => b.writeInt16LE(clampInt(v, -32768, 32767), o),
  u16: (b, v, o) => b.writeUInt16LE(clampInt(v, 0, 65535), o),
  s32: (b, v, o) => b.writeInt32LE(clampInt(v, -2147483648, 2147483647), o),
  u32: (b, v, o) => b.writeUInt32LE(clampInt(v, 0, 4294967295), o),
  f32: (b, v, o) => b.writeFloatLE(v, o),
  s64: (b, v, o) => b.writeBigInt64LE(BigInt(Math.trunc(v)), o),
  u64: (b, v, o) => b.writeBigUInt64LE(BigInt(Math.max(0, Math.trunc(v))), o),
  f64: (b, v, o) => b.writeDoubleLE(v, o),
}
export const FIELD_SIZE: Record<string, number> = {
  s8: 1,
  u8: 1,
  b: 1,
  s16: 2,
  u16: 2,
  s32: 4,
  u32: 4,
  f32: 4,
  s64: 8,
  u64: 8,
  f64: 8,
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(Number.isFinite(v) ? v : 0)))
}

export interface DecodedField {
  name: string
  type: string
  offset: number
  value: number
  /** Value labels from the template (enum-like fields). */
  entries?: { name: string; value: number }[]
  /** Reserved bytes the template expects to hold a fixed value. */
  reserved: boolean
  /** Where it links to: an effect, a SpEffect, a behaviour judge. */
  link?: 'effect' | 'speffect' | 'judge'
}

/** The template's fields with f32grad split into its two floats. */
export function flatFields(fields: TemplateField[]): TemplateField[] {
  const out: TemplateField[] = []
  for (const f of fields) {
    if (f.type === 'f32grad') {
      out.push({ ...f, type: 'f32', name: `${f.name ?? '?'} (start)` })
      out.push({ ...f, type: 'f32', name: `${f.name ?? '?'} (end)`, offset: f.offset + 4 })
    } else out.push(f)
  }
  return out
}

/** What a field (by its template name) points at: an effect, a SpEffect, a behaviour judge. */
export function linkOf(name: string): DecodedField['link'] {
  if (/^FFXID/i.test(name) && !/Deprecated/i.test(name)) return 'effect'
  if (/^SpEffectID/i.test(name)) return 'speffect'
  if (name === 'BehaviorJudgeID') return 'judge'
  return undefined
}

export function decodeEvent(ev: TaeFileEvent, template: TaeTemplate): DecodedField[] {
  const t = template.events[ev.type]
  if (!t) return []
  const out: DecodedField[] = []
  for (const f of flatFields(t.fields)) {
    const size = FIELD_SIZE[f.type]
    // Elden Ring stores some events shorter than the template describes.
    if (!size || f.offset + size > ev.params.length) continue
    const name = f.name ?? `Unknown @${f.offset}`
    out.push({
      name,
      type: f.type,
      offset: f.offset,
      value: READ[f.type](ev.params, f.offset),
      entries: f.entries,
      reserved: !f.name && f.assert !== undefined,
      link: linkOf(name),
    })
  }
  return out
}

/** A field's value as stored (null when the event's parameters are too short for it). */
export function readField(ev: TaeFileEvent, type: string, offset: number): number | null {
  const size = FIELD_SIZE[type]
  if (!size || offset < 0 || offset + size > ev.params.length) return null
  return READ[type](ev.params, offset)
}

export function writeField(ev: TaeFileEvent, type: string, offset: number, value: number): void {
  const size = FIELD_SIZE[type]
  if (!size) throw new Error(`Unknown field type ${type}`)
  if (offset < 0 || offset + size > ev.params.length)
    throw new Error('That field is outside this event’s stored parameters')
  WRITE[type](ev.params, value, offset)
}

/** Parameter bytes for a new event of a type: the template's defaults, padded to 16. */
export function newEventParams(type: number, template: TaeTemplate, sizes: ParamSizes): Buffer {
  const t = template.events[type]
  const size = sizes.get(type) ?? t?.size ?? 16
  const buf = Buffer.alloc(Math.ceil(size / 16) * 16)
  for (const f of flatFields(t?.fields ?? [])) {
    const s = FIELD_SIZE[f.type]
    const v = f.default ?? f.assert
    if (!s || v === undefined || f.offset + s > size) continue
    const n = Number(v)
    if (Number.isFinite(n)) WRITE[f.type](buf, n, f.offset)
  }
  return buf
}

/** One-line description of an event for timelines. */
export function eventSummary(fields: DecodedField[]): string {
  // A sound event's key is its sound (the id to look for and copy), not its first field (SoundType).
  const key = fields.find((f) => f.link) ?? fields.find((f) => f.name === 'SoundID') ?? fields.find((f) => !f.reserved)
  if (!key) return ''
  const label = key.entries?.find((e) => e.value === key.value)?.name
  const v = key.type.startsWith('f') ? +key.value.toFixed(3) : key.value
  return `${key.name} ${label ?? v}`
}

/* ------------------------------- the binder ------------------------------ */

/**
 * The animation binder with TAE files parsed on demand. Edited categories are
 * written back into the binder by `commit`.
 */
export class AnimationBinder {
  readonly bnd: Bnd4
  private sizes: ParamSizes
  private parsed = new Map<number, TaeFile>()
  readonly dirty = new Set<number>()
  private entries = new Map<number, Bnd4Entry>()

  constructor(bnd: Bnd4, sizes: ParamSizes) {
    this.bnd = bnd
    this.sizes = sizes
    for (const e of bnd.entries) {
      const c = entryCategory(e)
      if (c !== null) this.entries.set(c, e)
    }
  }

  categories(): number[] {
    return [...this.entries.keys()].sort((a, b) => a - b)
  }

  has(category: number): boolean {
    return this.entries.has(category)
  }

  tae(category: number): TaeFile {
    let t = this.parsed.get(category)
    if (t) return t
    const e = this.entries.get(category)
    if (!e) throw new Error(`There is no ${categoryLabel(category)} animation category`)
    t = readTaeFile(e.data, this.sizes)
    this.parsed.set(category, t)
    return t
  }

  find(name: string): { category: number; tae: TaeFile; anim: TaeFileAnimation } | null {
    const p = parseAnimationName(name)
    if (!p || !this.entries.has(p.category)) return null
    const tae = this.tae(p.category)
    const anim = tae.animations.find((a) => a.id === p.id)
    return anim ? { category: p.category, tae, anim } : null
  }

  require(name: string): { category: number; tae: TaeFile; anim: TaeFileAnimation } {
    const hit = this.find(name)
    if (!hit) throw new Error(`Animation ${name} was not found`)
    return hit
  }

  /** A new, empty category whose TAE header is copied from an existing one. */
  addCategory(category: number, headerFrom: number): TaeFile {
    if (this.entries.has(category)) return this.tae(category)
    if (category < 0 || category > 999) throw new Error('Categories run from 0 to 999')
    const from = this.tae(headerFrom)
    const tae: TaeFile = { prefix: Buffer.from(from.prefix), id: 2000 + category, animations: [] }
    const template = this.entries.get(headerFrom)!
    const entry: Bnd4Entry = {
      ...template,
      id: TAE_ENTRY_BASE + category,
      name: `${TAE_DIR}a${String(category).padStart(2, '0')}.tae`,
      data: Buffer.alloc(0),
    }
    // Keep entries in id order, as the game's binder has them.
    const at = this.bnd.entries.findIndex((e) => e.id > entry.id)
    this.bnd.entries.splice(at < 0 ? this.bnd.entries.length : at, 0, entry)
    this.entries.set(category, entry)
    this.parsed.set(category, tae)
    this.dirty.add(category)
    return tae
  }

  touch(category: number): void {
    this.dirty.add(category)
  }

  /**
   * Categories whose TAE header disagrees with itself about its id (0x50 against 0x90 and 0x94;
   * every retail file repeats its own): marked to be written again, which sets all three.
   */
  fixHeaderIds(): number[] {
    const fixed: number[] = []
    for (const [category, e] of this.entries) {
      const d = e.data
      if (d.length < 0x98) continue
      const id = d.readInt32LE(0x50)
      if (d.readInt32LE(0x90) === id && d.readInt32LE(0x94) === id) continue
      this.tae(category)
      this.dirty.add(category)
      fixed.push(category)
    }
    return fixed.sort((a, b) => a - b)
  }

  /** Adds a category's TAE entry as it is (copied from another binder, e.g. a newer game's). */
  addEntry(category: number, from: Bnd4Entry): void {
    if (this.entries.has(category)) return
    const entry: Bnd4Entry = { ...from, data: Buffer.from(from.data), sourceOffset: undefined }
    const at = this.bnd.entries.findIndex((e) => e.id > entry.id)
    this.bnd.entries.splice(at < 0 ? this.bnd.entries.length : at, 0, entry)
    this.entries.set(category, entry)
    this.parsed.delete(category)
  }

  /** Takes a category's TAE out of the binder (renumbering moves its animations first). */
  removeCategory(category: number): void {
    const e = this.entries.get(category)
    if (!e) return
    this.bnd.entries = this.bnd.entries.filter((x) => x !== e)
    this.entries.delete(category)
    this.parsed.delete(category)
    this.dirty.delete(category)
  }

  /** The binder entry holding a category's TAE (its id and file name). */
  entryOf(category: number): Bnd4Entry | null {
    return this.entries.get(category) ?? null
  }

  /** Writes edited categories into their binder entries. */
  commit(): number[] {
    const done = [...this.dirty]
    for (const c of done) {
      const tae = this.parsed.get(c)
      const e = this.entries.get(c)
      if (tae && e) e.data = writeTaeFile(tae)
    }
    this.dirty.clear()
    return done
  }

  /** Every animation id in a category (cheap once parsed). */
  ids(category: number): number[] {
    return this.tae(category).animations.map((a) => a.id)
  }

  /** A category's ids without parsing it (its edits included once parsed). */
  quickIds(category: number): number[] {
    const t = this.parsed.get(category)
    if (t) return t.animations.map((a) => a.id)
    const e = this.entries.get(category)
    return e ? taeAnimationIds(e.data) : []
  }

  /** A category's TAE to read: the parsed one (with edits), else parsed for this look only. */
  peek(category: number): TaeFile | null {
    const t = this.parsed.get(category)
    if (t) return t
    const e = this.entries.get(category)
    return e ? readTaeFile(e.data, this.sizes) : null
  }

  /** Every animation's motion reference, by category, without parsing events. */
  fileRefs(): { category: number; id: number; type: number; a: number; b: number }[] {
    const out: { category: number; id: number; type: number; a: number; b: number }[] = []
    for (const [category, e] of this.entries) {
      const t = this.parsed.get(category)
      if (t) for (const a of t.animations) out.push({ category, id: a.id, type: a.file.type, a: a.file.a, b: a.file.b })
      else for (const r of taeFileRefs(e.data)) out.push({ category, ...r })
    }
    return out
  }
}

/** Each animation's motion reference (id, type, a, b), read straight from a TAE's bytes. */
function taeFileRefs(buf: Buffer): { id: number; type: number; a: number; b: number }[] {
  const n = taeAnimationCount(buf)
  if (!n) return []
  const i64 = (o: number) => Number(buf.readBigInt64LE(o))
  const table = i64(0x58)
  const out: { id: number; type: number; a: number; b: number }[] = []
  for (let k = 0; k < n; k++) {
    const id = i64(table + k * 16)
    const at = i64(table + k * 16 + 8)
    const fileAt = i64(at + 24)
    const sub = i64(fileAt + 8)
    out.push({ id, type: i64(fileAt), a: buf.readInt32LE(sub + 8), b: buf.readInt32LE(sub + 12) })
  }
  return out
}

/** The animation (full id, category·1e6 + id) a reference takes its motion or everything from, or null. */
export function refTarget(r: { type: number; a: number; b: number }): number | null {
  if (r.type === 1) return r.a > 0 ? r.a : null
  return (r.a & IMPORTS_MOTION) !== 0 && r.b >= 0 ? r.b : null
}

/** A deep copy of an animation, for duplicating. */
export function cloneAnimation(a: TaeFileAnimation): TaeFileAnimation {
  return {
    id: a.id,
    file: { ...a.file },
    events: a.events.map((e) => ({ ...e, params: Buffer.from(e.params) })),
    groups: a.groups.map((g) => ({ data: Buffer.from(g.data), events: [...g.events] })),
    times: [...a.times],
  }
}

/**
 * A copy of `src` (in `category`) for a new name: its events are copied and
 * its motion is referenced, never duplicated, the way DSAS and modders'
 * projects do it. Animations that import everything from another animation
 * are resolved to that animation first, so the copy has editable events.
 */
export function duplicateAnimation(binder: AnimationBinder, srcName: string, id: number): TaeFileAnimation {
  let src = binder.require(srcName)
  const seen = new Set<string>()
  while (src.anim.file.type === 1 && src.anim.file.a > 0) {
    const target = fullName(src.anim.file.a)
    if (seen.has(target)) break
    seen.add(target)
    const next = binder.find(target)
    if (!next) break
    src = next
  }
  const copy = cloneAnimation(src.anim)
  copy.id = id
  const m = motionOf(src.category, src.anim)
  if (m.kind === 'own') {
    copy.file = { type: 0, name: m.file, a: 256, b: src.category * 1_000_000 + src.anim.id, c: 0n, d: 0n }
  }
  return copy
}

/** Adds or replaces an animation in a TAE. */
export function putAnimation(tae: TaeFile, anim: TaeFileAnimation): void {
  const i = tae.animations.findIndex((a) => a.id === anim.id)
  if (i >= 0) tae.animations[i] = anim
  else tae.animations.push(anim)
  tae.animations.sort((a, b) => a.id - b.id)
}

/**
 * Event group type for a new event: the group type its siblings of the same
 * event type use in this TAE (Elden Ring files every event in exactly one
 * group, usually of its own type), else the event type itself.
 */
function groupTypeFor(tae: TaeFile, anim: TaeFileAnimation, type: number): number {
  const look = (a: TaeFileAnimation) => {
    for (const g of a.groups) for (const i of g.events) if (a.events[i]?.type === type) return g.data.readInt32LE(0)
    return null
  }
  const own = look(anim)
  if (own !== null) return own
  for (const a of tae.animations) {
    const t = look(a)
    if (t !== null) return t
  }
  return type
}

export function addEvent(tae: TaeFile, anim: TaeFileAnimation, ev: TaeFileEvent): number {
  const index = anim.events.length
  anim.events.push(ev)
  const gt = groupTypeFor(tae, anim, ev.type)
  let group = anim.groups.find((g) => g.data.readInt32LE(0) === gt)
  if (!group) {
    const data = Buffer.alloc(16)
    data.writeInt32LE(gt, 0)
    group = { data, events: [] }
    anim.groups.push(group)
  }
  group.events.push(index)
  return index
}

export function deleteEvent(anim: TaeFileAnimation, index: number): void {
  if (index < 0 || index >= anim.events.length) throw new Error('No such event')
  anim.events.splice(index, 1)
  for (const g of anim.groups) g.events = g.events.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i))
}

export function groupOf(anim: TaeFileAnimation, index: number): number {
  return anim.groups.findIndex((g) => g.events.includes(index))
}

/* ---------------------- quick scans of unparsed TAEs ---------------------- */
export function taeAnimationCount(buf: Buffer): number {
  return buf.length >= 0x60 && buf.toString('ascii', 0, 4) === 'TAE ' ? buf.readInt32LE(0x54) : 0
}

/** Animation ids in a TAE, without parsing it. */
export function taeAnimationIds(buf: Buffer): number[] {
  const n = taeAnimationCount(buf)
  const at = n ? Number(buf.readBigInt64LE(0x58)) : 0
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Number(buf.readBigInt64LE(at + i * 16)))
  return out
}

/** Adds how many events of each type a TAE holds to `counts`. */
export function countEventTypes(buf: Buffer, counts: Map<number, number>): void {
  const n = taeAnimationCount(buf)
  if (!n) return
  const i64 = (o: number) => Number(buf.readBigInt64LE(o))
  const table = i64(0x58)
  for (let a = 0; a < n; a++) {
    const at = i64(table + a * 16 + 8)
    const headers = i64(at)
    const count = buf.readInt32LE(at + 32)
    for (let e = 0; e < count; e++) {
      const type = buf.readInt32LE(i64(headers + e * 0x18 + 0x10))
      counts.set(type, (counts.get(type) ?? 0) + 1)
    }
  }
}

/**
 * Which animations spawn each effect, over TAE files ([name, bytes]): effect
 * id -> animation names. The group number is the file's (a626.tae -> a626_…,
 * not the id inside it). Only the effect fields of each event type are read.
 */
export function indexEffectSpawns(files: [string, Buffer][], template: TaeTemplate): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>()
  const byType = new Map<number, TemplateField[]>()
  const fieldsOf = (type: number) => {
    let f = byType.get(type)
    if (!f) {
      const t = template.events[type]
      f = t ? flatFields(t.fields).filter((x) => linkOf(x.name ?? '') === 'effect' && FIELD_SIZE[x.type]) : []
      byType.set(type, f)
    }
    return f
  }
  for (const [file, buf] of files) {
    const m = /a(\d+)\.tae$/i.exec(file)
    if (!m) continue
    let tae
    try {
      tae = readTae(buf)
    } catch {
      continue
    }
    for (const a of tae.animations) {
      const name = animationName(Number(m[1]), a.id)
      for (const ev of a.events)
        for (const f of fieldsOf(ev.type)) {
          if (f.offset + FIELD_SIZE[f.type] > ev.params.length) continue
          const v = READ[f.type](ev.params, f.offset)
          if (v <= 0) continue
          let set = out.get(v)
          if (!set) out.set(v, (set = new Set()))
          set.add(name)
        }
    }
  }
  return out
}

/** What matters about an animation when telling whether the project changed it. */
export function animationSignature(a: TaeFileAnimation): string {
  const trim = (b: Buffer) => {
    let e = b.length
    while (e > 0 && b[e - 1] === 0) e--
    return b.toString('hex', 0, e)
  }
  return JSON.stringify([
    a.file.type,
    a.file.name,
    a.file.a,
    a.file.b,
    a.events.map((e) => [e.type, e.unk, Math.fround(e.start), Math.fround(e.end), trim(e.params)]),
  ])
}
