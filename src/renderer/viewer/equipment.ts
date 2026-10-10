/**
 * The viewer's outfit: what the project offers to wear and hold, the first-run
 * outfit, and keeping a saved outfit to what the open project has.
 */
import { useState, useEffect } from 'react'
import type { EquipChoice, EquipmentLists } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import type { EquipPrefs } from './prefs.ts'

/** The kinds of head part, in the order they're put on. */
export const FACE_PART_KEYS = ['face', 'fg01', 'hair', 'fg20', 'fg30', 'fg70', 'fg50']

/** An equipment slot's value: "rowId:part" (several rows can share a model), or a bare part. */
export function partOf(v: string | null): string | null {
  if (!v) return null
  const i = v.indexOf(':')
  return i >= 0 ? v.slice(i + 1) : v
}

/** First-run outfit, as DS Anim Studio opens: the Carian Knight set and a longsword. */
export function defaultEquipment(lists: EquipmentLists): EquipPrefs {
  const pick = (l: EquipChoice[], name: RegExp) => {
    const c = l.find((x) => name.test(x.name) && x.part)
    return c ? `${c.id}:${c.part}` : null
  }
  return {
    female: false,
    head: pick(lists.head, /^Carian Knight Helm$/),
    body: pick(lists.body, /^Carian Knight Armor$/),
    arms: pick(lists.arms, /^Carian Knight Gauntlets$/),
    legs: pick(lists.legs, /^Carian Knight Greaves$/),
    // The project's own weapon if it has one, else a longsword.
    right: (() => {
      const own = lists.weapons.find((w) => w.project && w.part)
      return own ? `${own.id}:${own.part}` : pick(lists.weapons, /^Longsword$/)
    })(),
    left: null,
  }
}

/** A plain bare head: a face, eyes and mouth, short hair, eyebrows and eyelashes (the first of each where those aren't there). */
export function defaultFaceParts(lists: EquipmentLists, female: boolean): Record<string, string | null> {
  const pick = (key: string, want: string) => {
    const parts = lists.faceParts?.find((g) => g.key === key)?.parts ?? []
    return parts.find((p) => p === want) ?? parts[0] ?? null
  }
  return {
    face: pick('face', female ? 'fc_f_0000' : 'fc_m_0000'),
    fg01: pick('fg01', 'fg_a_0100'),
    hair: pick('hair', 'hr_a_0001'),
    fg20: pick('fg20', 'fg_a_2001'),
    fg70: pick('fg70', 'fg_a_7001'),
  }
}

/**
 * The outfit, with anything this project doesn't have taken off: the saved
 * outfit is shared by every project, so a weapon from a mod opened before
 * would otherwise fail to load. A missing weapon or armor piece goes back to the first-run choice;
 * a missing buff comes off; a face part the game doesn't have (a male face
 * after switching to the female body) is the default one again. Returns
 * the same object when nothing changes.
 */
export function fitEquipment(e: EquipPrefs, lists: EquipmentLists): EquipPrefs {
  const has = (l: EquipChoice[], v: string | null) => !v || l.some((x) => x.part && `${x.id}:${x.part}` === v)
  const d = defaultEquipment(lists)
  const out: EquipPrefs = { ...e }
  let changed = false
  for (const [slot, list] of [
    ['head', lists.head],
    ['body', lists.body],
    ['arms', lists.arms],
    ['legs', lists.legs],
    ['right', lists.weapons],
    ['left', lists.weapons],
  ] as const) {
    if (has(list, e[slot])) continue
    out[slot] = slot === 'left' ? null : d[slot]
    changed = true
  }
  if (e.buff != null && !lists.buffs.some((b) => !b.spell && b.id === e.buff)) {
    out.buff = null
    changed = true
  }
  if (e.buffSpell != null && !lists.buffs.some((b) => b.spell && b.id === e.buffSpell)) {
    out.buffSpell = null
    changed = true
  }
  if (lists.faceParts?.length && out.faceParts) {
    const fallback = defaultFaceParts(lists, out.female)
    const fixed = Object.fromEntries(
      Object.entries(out.faceParts).map(([k, v]) => [
        k,
        v && !lists.faceParts!.find((g) => g.key === k)?.parts.includes(v) ? (fallback[k] ?? null) : v,
      ]),
    )
    if (Object.entries(fixed).some(([k, v]) => v !== out.faceParts![k])) {
      out.faceParts = fixed
      changed = true
    }
  }
  return changed ? out : e
}

/** As shown: with no helmet and no face parts picked yet, a bare head rather than a headless body (not saved into the outfit). */
export function withBareHead(e: EquipPrefs, lists: EquipmentLists): EquipPrefs {
  return !e.head && e.faceParts === undefined && lists.faceParts?.length
    ? { ...e, faceParts: defaultFaceParts(lists, e.female) }
    : e
}

/** The equipment to pick from; read again when the project changes (`version`), e.g. a new weapon. */
export function useEquipmentLists(female: boolean, version = 0): EquipmentLists | null {
  const [lists, setLists] = useState<EquipmentLists | null>(null)
  useEffect(() => {
    let live = true
    call('char:equipment', { female })
      .then((l) => live && setLists(l))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [female, version])
  return lists
}
