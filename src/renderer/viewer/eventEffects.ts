/**
 * What an animation's events do to the character beyond attacks and effects,
 * read from their fields (DS Anim Studio's names), and what that means at a
 * time on the clock: playback speed, opacity, the held weapons and which
 * model parts show.
 */

/** An animation event, as far as its effects on the character go. */
interface EventLike {
  type: number
  typeName: string
  start: number
  end: number
  fields: { name: string; value: number }[]
}

/** A Show/HideModelMask event: the model's mask groups it shows or hides while it runs. */
export interface MaskWindow {
  start: number
  end: number
  show: number[]
  hide: number[]
}

/**
 * What the animation's events do to the character beyond attacks and
 * effects (simulated in the viewer): playback speed (AnimSpeedGradient),
 * opacity (SetOpacityKeyframe), weapons hidden (HideEquippedWeapon) and
 * model parts shown or hidden (Show/HideModelMask).
 */
export interface EventEffects {
  speed: { start: number; end: number; from: number; to: number }[]
  opacity: { start: number; end: number; from: number; to: number }[]
  hideWeapons: { start: number; end: number; right: boolean; left: boolean; rightCase: boolean; leftCase: boolean }[]
  masks: MaskWindow[]
  /**
   * OverrideWeaponModelLocations (712): while it runs, held one-handed or
   * with the right / left weapon two-handed (as its flags say), each weapon
   * model (0-3) goes to another of its places: 0 its one-handed right
   * place, 1 its left, 2 two-handed, 3 sheathed (-1 where it is; 4 keeps an
   * earlier event's change).
   */
  weaponLocations?: {
    start: number
    end: number
    one: boolean
    right: boolean
    left: boolean
    models: { right: number[]; left: number[] }
  }[]
}

/** Which of another character's model parts show (FLVER mask groups, the #NN# in material names). */
export interface ModelMasks {
  /** Shown from the start (its NpcParam row's modelDispMask flags). */
  base: number[]
  /** Shown or hidden by the animation's events while they run. */
  windows: MaskWindow[]
}

/** An event's end: one that lasts "for ever" ends with the animation (at least 1e5 s, past any playhead). */
function endOf(e: EventLike, length: number): number {
  return e.end >= 1e5 ? Math.max(length, 1e5) : e.end
}

/** A Show/HideModelMask event's window (null for any other event). */
function maskWindow(e: EventLike, end: number): MaskWindow | null {
  if (!/ShowModelMask|HideModelMask/i.test(e.typeName)) return null
  const groups = e.fields.filter((x) => /^Mask\d+$/.test(x.name) && x.value).map((x) => Number(x.name.slice(4)))
  const show = /ShowModelMask/i.test(e.typeName)
  return { start: e.start, end, show: show ? groups : [], hide: show ? [] : groups }
}

/** The windows of an animation's Show/HideModelMask events (711, 713). */
export function maskWindows(events: EventLike[], length: number): MaskWindow[] {
  return events.flatMap((e) => maskWindow(e, endOf(e, length)) ?? [])
}

/**
 * What an animation's events do to playback speed, opacity, the held
 * weapons and the model's parts, read from its events' fields (DS Anim
 * Studio's names): AnimSpeedGradient (608), SetOpacityKeyframe (193),
 * HideEquippedWeapon (710), HideModelMask (711) and ShowModelMask (713).
 */
export function eventEffects(events: EventLike[], length: number): EventEffects {
  const out: EventEffects = { speed: [], opacity: [], hideWeapons: [], masks: [] }
  const end = (e: EventLike) => endOf(e, length)
  for (const e of events) {
    const f = (n: string) => e.fields.find((x) => x.name === n)?.value
    const mask = maskWindow(e, end(e))
    if (e.type === 608 || /AnimSpeedGradient/i.test(e.typeName)) {
      const from = f('SpeedAtStart') ?? 1
      const to = f('SpeedAtEnd') ?? from
      out.speed.push({ start: e.start, end: end(e), from, to })
    } else if (e.type === 193 || /SetOpacityKeyframe/i.test(e.typeName)) {
      out.opacity.push({
        start: e.start,
        end: end(e),
        from: f('OpacityAtEventStart') ?? 1,
        to: f('OpacityAtEventEnd') ?? 1,
      })
    } else if (e.type === 710 || /HideEquippedWeapon/i.test(e.typeName)) {
      out.hideWeapons.push({
        start: e.start,
        end: end(e),
        right: !!f('RightHand'),
        left: !!f('LeftHand'),
        rightCase: !!f('RightHand_WithScabbard'),
        leftCase: !!f('LeftHand_WithScabbard'),
      })
    } else if (mask) {
      out.masks.push(mask)
    } else if (e.type === 712 || /OverrideWeaponModelLocations/i.test(e.typeName)) {
      const change = (hand: 'RH' | 'LH') => [0, 1, 2, 3].map((n) => f(`${hand}Model${n}ChangeType`) ?? -1)
      ;(out.weaponLocations ??= []).push({
        start: e.start,
        end: end(e),
        one: !!f('IsEnabledWhile1Handing'),
        right: !!f('IsEnabledWhile2HandingRightWeapon'),
        left: !!f('IsEnabledWhile2HandingLeftWeapon'),
        models: { right: change('RH'), left: change('LH') },
      })
    }
  }
  out.opacity.sort((a, b) => a.start - b.start)
  return out
}

/* ------------------------------- at a time -------------------------------- */

/** Playback speed at a time: 1, or an AnimSpeedGradient event's, from its start speed to its end speed. */
export function speedAt(eff: EventEffects | null | undefined, time: number): number {
  for (const g of eff?.speed ?? []) {
    if (time < g.start || time > g.end) continue
    const k = g.end > g.start ? (time - g.start) / (g.end - g.start) : 0
    const v = g.from + (g.to - g.from) * k
    return Number.isFinite(v) && v > 0.01 ? Math.min(v, 10) : 0.01
  }
  return 1
}

/** The character's opacity at a time (SetOpacityKeyframe: from its start value to its end value). */
export function opacityAt(eff: EventEffects | null | undefined, time: number): number {
  let op = 1
  for (const o of eff?.opacity ?? []) {
    if (time < o.start) continue
    const k = time >= o.end ? 1 : o.end > o.start ? (time - o.start) / (o.end - o.start) : 1
    op = Math.max(0, Math.min(1, o.from + (o.to - o.from) * k))
    if (time > o.end && o.end < 1e5) op = o.to
  }
  return op
}

/** Whether a mask group shows at a time: `shown` at first, then as the windows running then show or hide it. */
function maskGroupShows(windows: MaskWindow[], group: number, time: number, shown: boolean): boolean {
  let on = shown
  for (const w of windows) {
    if (time < w.start || time > w.end) continue
    if (w.show.includes(group)) on = true
    if (w.hide.includes(group)) on = false
  }
  return on
}

/** Whether a model part (mask group) shows at a time, as Show/HideModelMask events say (shown unless hidden). */
export function effectMaskShows(eff: EventEffects | null | undefined, group: unknown, time: number): boolean {
  if (typeof group !== 'number' || group < 0 || !eff?.masks.length) return true
  return maskGroupShows(eff.masks, group, time, true)
}

/** Whether a mask group shows at a time: always without masks; else its NPC default, changed by mask events in their windows. */
export function maskShows(masks: ModelMasks | null | undefined, group: unknown, time: number): boolean {
  if (typeof group !== 'number' || group < 0 || !masks) return true
  return maskGroupShows(masks.windows, group, time, masks.base.includes(group))
}
