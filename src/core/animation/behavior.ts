/**
 * The player's behaviour graph (chr/c0000.behbnd.dcx -> Behaviors/c0000.hkx):
 * listing which animations it can play, and registering new ones.
 *
 * Elden Ring picks most animations through CustomManualSelectorGenerators
 * (CMSGs). Each CMSG handles one animation ID (e.g. 030000, a light attack)
 * and holds one hkbClipGenerator per animation category that can play it
 * (a020_030000, a021_030000, ...). A new category's animation only plays once
 * a clip for it is added to every CMSG with that ID. This is what
 * ERClipGeneratorTool does; here it is done directly on the tagfile:
 *
 *   - the new clip is a copy of a clip already in the CMSG, named after the
 *     animation ("a681_030000"), as ERClipGeneratorTool names its clips;
 *   - animationInternalId is shared by every clip of the same animation and
 *     otherwise the next free number;
 *   - the CMSG's clip array moves to the end of DATA with the new entry;
 *   - a jump attack's landing (031070, 031270, 033070, 033270, 034570) gets
 *     its start time bound to the graph's TimeActEditor_10 in every
 *     selector, as modders set it in ERClipGeneratorTool (without it the
 *     landing cuts in wrong). The game binds it in most of those selectors
 *     already (JumpAttack_…_Land…), not in the rest; ERClipGeneratorTool's
 *     clips have it in all. The binding is a copy of the game's own. Any
 *     binding a copied clip has is copied with it, never shared.
 *
 * A clip's own settings (playback speed, crop, mirror, play mode) can be
 * read and changed for all of an animation's clips at once.
 *
 * Credit: ERClipGeneratorTool (The12thAvenger): registering clips the way it
 * does (the same clips, checked by the animations suite); Syyyke's moveset
 * tutorial: the jump attacks' start time binding.
 */
import { member, itemString, sizeOf, type Tagfile, typeByName } from '../formats/havok/tagfile.ts'
import { animationIdText, parseAnimationName } from '../../shared/animIds.ts'

export interface BehaviorClip {
  item: number
  name: string
  animation: string
  internalId: number
}

export interface BehaviorSelector {
  item: number
  name: string
  animId: number
  offsetType: number
  clips: BehaviorClip[]
}

export interface BehaviorIndex {
  selectors: BehaviorSelector[]
  /** Animation name -> internal id. */
  internalIds: Map<string, number>
  nextInternalId: number
}

interface Layout {
  cmsg: number
  clip: number
  char: number
  cmsgName: number
  cmsgGenerators: number
  cmsgAnimId: number
  cmsgOffsetType: number
  clipName: number
  clipAnimation: number
  clipInternalId: number
  clipSize: number
  clipBindingSet: number
  clipCropStart: number
  clipCropEnd: number
  clipStartTime: number
  clipPlaybackSpeed: number
  clipMode: number
  clipFlags: number
}

function layout(tf: Tagfile): Layout {
  const cmsg = typeByName(tf, 'CustomManualSelectorGenerator')
  const clip = typeByName(tf, 'hkbClipGenerator')
  const char = typeByName(tf, 'char')
  if (!cmsg || !clip || !char)
    throw new Error('This is not a character behaviour graph (no CustomManualSelectorGenerator / hkbClipGenerator)')
  return {
    cmsg: cmsg.index,
    clip: clip.index,
    char: char.index,
    cmsgName: member(tf, cmsg.index, 'name').offset,
    cmsgGenerators: member(tf, cmsg.index, 'generators').offset,
    cmsgAnimId: member(tf, cmsg.index, 'animId').offset,
    cmsgOffsetType: member(tf, cmsg.index, 'offsetType').offset,
    clipName: member(tf, clip.index, 'name').offset,
    clipAnimation: member(tf, clip.index, 'animationName').offset,
    clipInternalId: member(tf, clip.index, 'animationInternalId').offset,
    clipSize: clip.size || 352,
    clipBindingSet: member(tf, clip.index, 'variableBindingSet').offset,
    clipCropStart: member(tf, clip.index, 'cropStartAmountLocalTime').offset,
    clipCropEnd: member(tf, clip.index, 'cropEndAmountLocalTime').offset,
    clipStartTime: member(tf, clip.index, 'startTime').offset,
    clipPlaybackSpeed: member(tf, clip.index, 'playbackSpeed').offset,
    clipMode: member(tf, clip.index, 'mode').offset,
    clipFlags: member(tf, clip.index, 'flags').offset,
  }
}

/** The graph's variable names, by index (hkbBehaviorGraphStringData). */
function variableNames(tf: Tagfile): string[] {
  const t = typeByName(tf, 'hkbBehaviorGraphStringData')
  const it = t && tf.items.find((x) => x.type === t.index)
  if (!t || !it) return []
  const arr = tf.items[tf.data.readUInt32LE(it.offset + member(tf, t.index, 'variableNames').offset)]
  const out: string[] = []
  for (let k = 0; arr && k < arr.count; k++) out.push(itemString(tf, tf.data.readUInt32LE(arr.offset + k * 8)))
  return out
}

/** A clip's variable bindings: which of its members follow which graph variable ("startTime" -> "TimeActEditor_10"). */
function clipBindings(tf: Tagfile, L: Layout, clipItem: number, names: string[]): { path: string; variable: string }[] {
  const setItem = tf.data.readUInt32LE(tf.items[clipItem].offset + L.clipBindingSet)
  const vbs = typeByName(tf, 'hkbVariableBindingSet')
  const binding = typeByName(tf, 'hkbVariableBindingSet::Binding')
  if (!setItem || !vbs || !binding) return []
  const arr = tf.items[tf.data.readUInt32LE(tf.items[setItem].offset + member(tf, vbs.index, 'bindings').offset)]
  const pathAt = member(tf, binding.index, 'memberPath').offset
  const varAt = member(tf, binding.index, 'variableIndex').offset
  const size = sizeOf(tf, binding.index)
  const out: { path: string; variable: string }[] = []
  for (let k = 0; arr && k < arr.count; k++) {
    const at = arr.offset + k * size
    const v = tf.data.readInt32LE(at + varAt)
    out.push({ path: itemString(tf, tf.data.readUInt32LE(at + pathAt)), variable: names[v] ?? `#${v}` })
  }
  return out
}

/** The jump attacks' landings (one-, two-handed, light and heavy, and dual): they start at the time TimeActEditor_10 holds. */
const JUMP_LANDINGS = new Set([31070, 31270, 33070, 33270, 34570])
const JUMP_START_VARIABLE = 'TimeActEditor_10'

export function indexBehavior(tf: Tagfile): BehaviorIndex {
  const L = layout(tf)
  const d = tf.data
  const selectors: BehaviorSelector[] = []
  const internalIds = new Map<string, number>()
  let maxId = 0
  const clipOf = (item: number): BehaviorClip | null => {
    const it = tf.items[item]
    if (!it || it.type !== L.clip) return null
    const animation = itemString(tf, d.readUInt32LE(it.offset + L.clipAnimation))
    const internalId = d.readInt16LE(it.offset + L.clipInternalId)
    return { item, name: itemString(tf, d.readUInt32LE(it.offset + L.clipName)), animation, internalId }
  }
  tf.items.forEach((it, i) => {
    if (it.type === L.clip) {
      const c = clipOf(i)!
      if (c.animation) internalIds.set(c.animation, c.internalId)
      maxId = Math.max(maxId, c.internalId)
    }
    if (it.type !== L.cmsg) return
    const arr = tf.items[d.readUInt32LE(it.offset + L.cmsgGenerators)]
    const clips: BehaviorClip[] = []
    if (arr)
      for (let k = 0; k < arr.count; k++) {
        const c = clipOf(d.readUInt32LE(arr.offset + k * 8))
        if (c) clips.push(c)
      }
    selectors.push({
      item: i,
      name: itemString(tf, d.readUInt32LE(it.offset + L.cmsgName)),
      animId: d.readInt32LE(it.offset + L.cmsgAnimId),
      offsetType: d.readInt32LE(it.offset + L.cmsgOffsetType),
      clips,
    })
  })
  return { selectors, internalIds, nextInternalId: maxId + 1 }
}

/** Appends to a tagfile: data, items and patch offsets. */
class TagEditor {
  private tf: Tagfile
  private extra: Buffer[] = []
  private size: number
  constructor(tf: Tagfile) {
    this.tf = tf
    this.size = tf.data.length
  }
  alloc(bytes: Buffer, align = 16): number {
    const pad = (align - (this.size % align)) % align
    if (pad) this.extra.push(Buffer.alloc(pad))
    const at = this.size + pad
    this.extra.push(bytes)
    this.size = at + bytes.length
    return at
  }
  addItem(type: number, flags: number, offset: number, count: number): number {
    this.tf.items.push({ type, flags, offset, count })
    return this.tf.items.length - 1
  }
  string(charType: number, text: string): number {
    const bytes = Buffer.concat([Buffer.from(text, 'utf8'), Buffer.alloc(1)])
    return this.addItem(charType, 0x20, this.alloc(bytes, 1), bytes.length)
  }
  patch(group: number, offset: number): void {
    this.tf.patches[group].offsets.push(offset)
  }
  /** Writes pending bytes into the tagfile and keeps patch offsets sorted. */
  commit(touched: Set<number>): void {
    if (this.extra.length) this.tf.data = Buffer.concat([this.tf.data, ...this.extra])
    this.extra = []
    for (const g of touched) this.tf.patches[g].offsets.sort((a, b) => a - b)
  }
  /** Writes a u32 into DATA (old or newly allocated). */
  writeU32(offset: number, value: number): void {
    if (offset + 4 <= this.tf.data.length) {
      this.tf.data.writeUInt32LE(value, offset)
      return
    }
    // Inside pending bytes: find the chunk.
    let at = this.tf.data.length
    for (const b of this.extra) {
      if (offset >= at && offset + 4 <= at + b.length) {
        b.writeUInt32LE(value, offset - at)
        return
      }
      at += b.length
    }
    throw new Error(`Offset ${offset} is outside the data`)
  }
}

export interface RegisterResult {
  added: { animation: string; selector: string; clipName: string }[]
  skipped: { animation: string; reason: string }[]
}

/**
 * Copies a clip's variable binding set (the set and its bindings array) for
 * another clip: references inside them (the member path strings) point
 * where the original's do. Returns the new set's item.
 */
function copyBindingSet(
  tf: Tagfile,
  ed: TagEditor,
  groupOf: Map<number, number>,
  touched: Set<number>,
  setItem: number,
): number {
  const vbs = typeByName(tf, 'hkbVariableBindingSet')!
  const bindingsAt = member(tf, vbs.index, 'bindings').offset
  const set = tf.items[setItem]
  const setSize = sizeOf(tf, set.type)
  const copyRefs = (from: number, to: number, length: number) => {
    for (let rel = 0; rel < length; rel += 4) {
      const g = groupOf.get(from + rel)
      if (g === undefined) continue
      ed.patch(g, to + rel)
      touched.add(g)
    }
  }
  const setBytes = Buffer.from(tf.data.subarray(set.offset, set.offset + setSize))
  const arrItem = setBytes.readUInt32LE(bindingsAt)
  if (arrItem) {
    const arr = tf.items[arrItem]
    const length = sizeOf(tf, arr.type) * arr.count
    const arrAt = ed.alloc(Buffer.from(tf.data.subarray(arr.offset, arr.offset + length)), 16)
    setBytes.writeUInt32LE(ed.addItem(arr.type, arr.flags, arrAt, arr.count), bindingsAt)
    copyRefs(arr.offset, arrAt, length)
  }
  const setAt = ed.alloc(setBytes, 16)
  copyRefs(set.offset, setAt, setSize)
  return ed.addItem(set.type, set.flags, setAt, 1)
}

/** How an animation's clips play (hkbClipGenerator): the settings an editor changes. */
export interface ClipSettings {
  /** 1 = as made, 2 = twice as fast. */
  playbackSpeed: number
  /** Seconds cut from the start and from the end. */
  cropStart: number
  cropEnd: number
  /** Havok's play modes: 0 once, 1 looping, 2 user controlled, 3 ping-pong. */
  mode: number
  /** Played mirrored, left for right (FLAG_MIRROR). */
  mirror: boolean
}

const FLAG_MIRROR = 4

/**
 * An animation's clips in the graph: their settings (the first's) and
 * whether all agree, and its bindings: the first clip's, and how many of
 * its clips bind its start time.
 */
export function clipSettings(
  tf: Tagfile,
  animation: string,
): {
  settings: ClipSettings
  clips: number
  same: boolean
  bindings: { path: string; variable: string }[]
  startBound: number
} | null {
  const L = layout(tf)
  const items = clipItemsOf(tf, L, animation)
  if (!items.length) return null
  const read = (item: number): ClipSettings => {
    const at = tf.items[item].offset
    return {
      playbackSpeed: tf.data.readFloatLE(at + L.clipPlaybackSpeed),
      cropStart: tf.data.readFloatLE(at + L.clipCropStart),
      cropEnd: tf.data.readFloatLE(at + L.clipCropEnd),
      mode: tf.data.readInt8(at + L.clipMode),
      mirror: (tf.data.readUInt8(at + L.clipFlags) & FLAG_MIRROR) !== 0,
    }
  }
  const all = items.map(read)
  const key = (s: ClipSettings) => JSON.stringify(s)
  const variables = variableNames(tf)
  return {
    settings: all[0],
    clips: items.length,
    same: all.every((s) => key(s) === key(all[0])),
    bindings: clipBindings(tf, L, items[0], variables),
    startBound: items.filter((i) => clipBindings(tf, L, i, variables).some((b) => b.path === 'startTime')).length,
  }
}

/** Changes every clip of an animation (each selector's); returns how many. */
export function setClipSettings(tf: Tagfile, animation: string, patch: Partial<ClipSettings>): number {
  const L = layout(tf)
  const items = clipItemsOf(tf, L, animation)
  if (patch.playbackSpeed !== undefined && !(patch.playbackSpeed > 0 && patch.playbackSpeed <= 100))
    throw new Error('Playback speed must be above 0 (1 plays it as made)')
  for (const v of [patch.cropStart, patch.cropEnd])
    if (v !== undefined && !(v >= 0 && v < 1000)) throw new Error('Crop times are seconds, 0 or more')
  if (patch.mode !== undefined && ![0, 1, 2, 3].includes(patch.mode)) throw new Error('Unknown play mode')
  for (const item of items) {
    const at = tf.items[item].offset
    if (patch.playbackSpeed !== undefined) tf.data.writeFloatLE(patch.playbackSpeed, at + L.clipPlaybackSpeed)
    if (patch.cropStart !== undefined) tf.data.writeFloatLE(patch.cropStart, at + L.clipCropStart)
    if (patch.cropEnd !== undefined) tf.data.writeFloatLE(patch.cropEnd, at + L.clipCropEnd)
    if (patch.mode !== undefined) tf.data.writeInt8(patch.mode, at + L.clipMode)
    if (patch.mirror !== undefined) {
      const f = tf.data.readUInt8(at + L.clipFlags)
      tf.data.writeUInt8(patch.mirror ? f | FLAG_MIRROR : f & ~FLAG_MIRROR, at + L.clipFlags)
    }
  }
  return items.length
}

/** Every clip item that plays an animation (one per selector it's registered in). */
function clipItemsOf(tf: Tagfile, L: Layout, animation: string): number[] {
  const out: number[] = []
  tf.items.forEach((it, i) => {
    if (it.type === L.clip && itemString(tf, tf.data.readUInt32LE(it.offset + L.clipAnimation)) === animation)
      out.push(i)
  })
  return out
}

/**
 * Registers animations (names like "a681_030000") in every CMSG with their
 * animation ID. Animations already present in a CMSG are left alone there.
 */
export function registerAnimations(tf: Tagfile, names: string[]): RegisterResult {
  const L = layout(tf)
  const index = indexBehavior(tf)
  const result: RegisterResult = { added: [], skipped: [] }
  const ed = new TagEditor(tf)
  const touched = new Set<number>()
  let nextId = index.nextInternalId

  // Patch group lookup: which group holds a given reference offset.
  const groupOf = new Map<number, number>()
  tf.patches.forEach((p, g) => p.offsets.forEach((o) => groupOf.set(o, g)))

  // Pending clip arrays per selector (selector item -> new element list).
  const arrays = new Map<number, number[]>()

  // The game's start time binding (a magic jump landing's), for jump attack landings, and the patch
  // group that clips' binding set references go in.
  const variables = variableNames(tf)
  let jumpBinding: { set: number; group: number } | null = null
  for (let i = 0; i < tf.items.length && !jumpBinding; i++) {
    const it = tf.items[i]
    if (it.type !== L.clip) continue
    const b = clipBindings(tf, L, i, variables)
    const group = groupOf.get(it.offset + L.clipBindingSet)
    if (b.length === 1 && b[0].path === 'startTime' && b[0].variable === JUMP_START_VARIABLE && group !== undefined)
      jumpBinding = { set: tf.data.readUInt32LE(it.offset + L.clipBindingSet), group }
  }

  for (const raw of names) {
    const animation = raw.trim()
    const parsed = parseAnimationName(animation)
    if (!parsed) {
      result.skipped.push({ animation, reason: 'not an animation name like a681_030000' })
      continue
    }
    const selectors = index.selectors.filter((s) => s.animId === parsed.id && s.clips.length)
    if (!selectors.length) {
      result.skipped.push({
        animation,
        reason: `no selector plays animation ID ${animationIdText(parsed.id)}; new IDs need a new state, which isn't supported`,
      })
      continue
    }
    let internalId = index.internalIds.get(animation)
    let addedHere = 0
    for (const sel of selectors) {
      if (sel.clips.some((c) => c.animation === animation)) continue
      const template = sel.clips[0]
      const t = tf.items[template.item]
      // Copy the template clip and give it its own name and animation strings.
      const bytes = Buffer.from(tf.data.subarray(t.offset, t.offset + L.clipSize))
      if (internalId === undefined) {
        internalId = nextId++
        index.internalIds.set(animation, internalId)
      }
      bytes.writeInt16LE(internalId, L.clipInternalId)
      // Named like ERClipGeneratorTool's clips: just the animation name.
      const clipName = animation
      const nameItem = ed.string(L.char, clipName)
      const animItem = ed.string(L.char, animation)
      bytes.writeUInt32LE(nameItem, L.clipName)
      bytes.writeUInt32LE(animItem, L.clipAnimation)
      // Its binding set: its own copy of the template's, or of the game's start time binding on a jump
      // attack's landing.
      const templateSet = bytes.readUInt32LE(L.clipBindingSet)
      const jump = JUMP_LANDINGS.has(parsed.id) ? jumpBinding : null
      let setGroup = groupOf.get(t.offset + L.clipBindingSet)
      if (jump) {
        const own = templateSet && clipBindings(tf, L, template.item, variables).some((b) => b.path === 'startTime')
        bytes.writeUInt32LE(copyBindingSet(tf, ed, groupOf, touched, own ? templateSet : jump.set), L.clipBindingSet)
        setGroup = jump.group
      } else if (templateSet)
        bytes.writeUInt32LE(copyBindingSet(tf, ed, groupOf, touched, templateSet), L.clipBindingSet)
      const at = ed.alloc(bytes, 16)
      const clipItem = ed.addItem(L.clip, t.flags, at, 1)
      // Every reference the template had (strings, shared triggers) is patched at the same place.
      for (let rel = 0; rel < L.clipSize; rel += 4) {
        if (rel === L.clipBindingSet) continue
        const g = groupOf.get(t.offset + rel)
        if (g === undefined) continue
        ed.patch(g, at + rel)
        touched.add(g)
      }
      if (bytes.readUInt32LE(L.clipBindingSet) && setGroup !== undefined) {
        ed.patch(setGroup, at + L.clipBindingSet)
        touched.add(setGroup)
      }
      const list = arrays.get(sel.item) ?? []
      list.push(clipItem)
      arrays.set(sel.item, list)
      sel.clips.push({ item: clipItem, name: clipName, animation, internalId })
      result.added.push({ animation, selector: sel.name, clipName })
      addedHere++
    }
    if (!addedHere) result.skipped.push({ animation, reason: 'already registered in every selector for its ID' })
  }

  // Grow each touched selector's clip array: same item index, new storage.
  for (const [selItem, newClips] of arrays) {
    const sel = tf.items[selItem]
    const arrItemIndex = tf.data.readUInt32LE(sel.offset + L.cmsgGenerators)
    const arr = tf.items[arrItemIndex]
    const old = Buffer.from(tf.data.subarray(arr.offset, arr.offset + arr.count * 8))
    const grown = Buffer.alloc((arr.count + newClips.length) * 8)
    old.copy(grown)
    newClips.forEach((c, k) => grown.writeUInt32LE(c, (arr.count + k) * 8))
    const at = ed.alloc(grown, 16)
    // Element references move with the array.
    let group: number | undefined
    for (let k = 0; k < arr.count; k++) {
      const g = groupOf.get(arr.offset + k * 8)
      if (g === undefined) continue
      group = g
      const offs = tf.patches[g].offsets
      const i = offs.indexOf(arr.offset + k * 8)
      if (i >= 0) offs.splice(i, 1)
      ed.patch(g, at + k * 8)
    }
    if (group === undefined) throw new Error('Could not find the patch group for a selector clip array')
    for (let k = 0; k < newClips.length; k++) ed.patch(group, at + (arr.count + k) * 8)
    touched.add(group)
    arr.offset = at
    arr.count += newClips.length
  }

  ed.commit(touched)
  return result
}
