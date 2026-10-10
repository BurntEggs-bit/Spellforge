/**
 * The Animations page's state and what its panels do: the categories, the
 * animation shown and its selected events, the viewer (its clock, outfit,
 * lighting, helpers, what the events act out), combos and entire spells,
 * the dialogs, and the keyboard shortcuts.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from 'react'
import type {
  AnimCategoryView,
  AnimListItem,
  AnimationView,
  SimAction,
  ClipView,
  WeaponPlacement,
  BuffRun,
  EntireSpellPlan,
  MovesetResult,
} from '../../shared/api.ts'
import { errorMessage } from '../../shared/errors.ts'
import { showPanel } from '../app/dock.tsx'
import { activeWindow, confirmHere } from '../app/windows.ts'
import { FPS } from '../../shared/frames.ts'
import { useLatest } from '../lib/hooks.ts'
import { PREF_KEYS, usePersistentState } from '../lib/storage.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import type { ComboStep } from '../viewer/CharacterView.tsx'
import { useEquipmentLists, defaultEquipment, fitEquipment } from '../viewer/equipment.ts'
import { eventEffects, type EventEffects } from '../viewer/eventEffects.ts'
import { PlayClock } from '../viewer/PlayClock.ts'
import type { GizmoMode, GizmoResult, GizmoTarget } from '../viewer/scene/effectGizmo.ts'
import { effectsChanged } from '../fx/fxruns.ts'
import {
  type LightingPrefs,
  loadLighting,
  saveLighting,
  type HelperPrefs,
  loadHelpers,
  saveHelpers,
  type EquipPrefs,
  loadEquipment,
  saveEquipment,
} from '../viewer/prefs.ts'
import type { ViewportPanel, WeaponFocus } from '../viewer/Transport.tsx'
import { type ComboStepDef, cutTime } from './ComboPanel.tsx'
import type { LaneOrder } from './editor/Timeline.tsx'
import { setCopiedEvents, copiedEvents } from './eventClipboard.ts'
import { useAnimationShortcuts } from './useAnimationShortcuts.ts'
import { plural } from '../../shared/format.ts'

/** Where the Animations page is (for Back / Forward). */
export interface AnimPlace {
  category: number | null
  animation: string | null
  /** The selected event (its index), so Back returns to it. */
  event?: number | null
  /** A weapon to hold in the right hand when opened (a skill just made for it). */
  weapon?: number
  /** Entire spell: cast this spell (a Magic row) from start to finish. */
  spell?: number
}

export interface AnimProps {
  /** Kept mounted while another page shows, so selections survive. */
  hidden: boolean
  /** Category / animation to show (from elsewhere in the app, or Back / Forward). */
  target: (AnimPlace & { seq: number }) | null
  version: number
  onEdited: () => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
  /** A param row was added or changed from this page (a behavior row for a judge). */
  onParamsEdited: () => void
  /** The user went somewhere (for Back / Forward). `detail`: the same place, more exactly (an event picked), not a new step. */
  onPlace: (p: AnimPlace, detail?: boolean) => void
}

/** The page's dialogs (one at a time). */
export type AnimDialog =
  | { kind: 'duplicate'; scope: 'one' | 'category' }
  | { kind: 'addEvent' }
  | { kind: 'goto'; target: 'animation' | 'category' }
  | { kind: 'rename' }
  | { kind: 'renumber' }
  | { kind: 'properties' }
  | { kind: 'categoryProperties' }
  | { kind: 'import' }
  | { kind: 'shortcuts' }

export function useAnimationsPage({
  hidden,
  target,
  version,
  onEdited,
  onOpenRow,
  onOpenEffect,
  onParamsEdited,
  onPlace,
}: AnimProps) {
  const ui = useUi()
  const [categories, setCategories] = useState<AnimCategoryView[] | null>(null)
  const [category, setCategory] = useState<number | null>(null)
  const [anims, setAnims] = useState<AnimListItem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<AnimationView | null>(null)
  const [eventIndex, setEventIndexState] = useState<number | null>(null)
  // Selected events (the timeline's multi-select); `eventIndex` is the one shown in the inspector.
  const [selection, setSelection] = useState<number[]>([])
  // The inspector's event as last set: a functional update sees it even before React re-renders.
  const eventRef = useRef<number | null>(null)
  /** One event selected (or none). */
  const setEventIndex = (i: number | null | ((cur: number | null) => number | null)) => {
    const next = typeof i === 'function' ? i(eventRef.current) : i
    eventRef.current = next
    setEventIndexState(next)
    setSelection(next === null ? [] : [next])
  }
  /** Several events selected; `focus` is the one the inspector shows. */
  const selectMany = (indices: number[], focus: number | null) => {
    const list = [...new Set(indices)].sort((a, b) => a - b)
    const f = focus !== null && list.includes(focus) ? focus : (list[0] ?? null)
    eventRef.current = f
    setEventIndexState(f)
    setSelection(list)
  }
  const [unregistered, setUnregistered] = useState<string[]>([])
  // The viewer's move and rotate tool (G, R) on the selected effect event, and whether it snaps.
  const [gizmoMode, setGizmoMode] = useState<GizmoMode | null>(null)
  const [gizmoSnap, setGizmoSnap] = useState(true)
  const [dialog, setDialog] = useState<AnimDialog | null>(null)
  const [history, setHistory] = useState<{ undo: number; redo: number }>({ undo: 0, redo: 0 })
  const refreshHistory = () =>
    call('anim:history', undefined)
      .then(setHistory)
      .catch(() => {})
  // Ctrl+F: the Find panel, focused.
  const [findSeq, setFindSeq] = useState(0)
  // Viewer only: events muted or soloed in this animation, and event types muted everywhere.
  const [muted, setMuted] = useState<{ name: string; mute: number[]; solo: number[] }>({ name: '', mute: [], solo: [] })
  const [mutedTypes, setMutedTypes] = usePersistentState<number[]>(PREF_KEYS.mutedEventTypes, [])
  const [colors, setColors] = usePersistentState<Record<string, string>>(PREF_KEYS.eventColors, {})
  const [laneOrder, setLaneOrder] = usePersistentState<LaneOrder>(PREF_KEYS.laneOrder, 'kind')

  // Viewport: one clock shared by the viewport, toolbar and timeline.
  const clock = useMemo(() => new PlayClock(), [])
  const [panel, setPanel] = useState<ViewportPanel>(null)
  // A held weapon the camera frames and follows (F).
  const [focus, setFocus] = useState<WeaponFocus>(null)
  const [lighting, setLightingState] = useState<LightingPrefs>(loadLighting)
  const setLighting = (l: LightingPrefs) => {
    setLightingState(l)
    saveLighting(l)
  }
  const [helpers, setHelpersState] = useState<HelperPrefs>(loadHelpers)
  const setHelpers = (h: HelperPrefs) => {
    setHelpersState(h)
    saveHelpers(h)
  }
  const [equipment, setEquipmentState] = useState<EquipPrefs | null>(loadEquipment)
  const setEquipment = (e: EquipPrefs) => {
    setEquipmentState(e)
    saveEquipment(e)
  }
  const lists = useEquipmentLists(equipment?.female ?? false, version)
  useEffect(() => {
    if (!lists) return
    if (!equipment) return setEquipment(defaultEquipment(lists))
    // Another project's weapon or armor (the outfit is saved for every project) comes off.
    const fitted = fitEquipment(equipment, lists)
    if (fitted !== equipment) setEquipment(fitted)
  }, [lists])
  // What the events do with the weapons held (hitboxes, bullets, effects).
  const [actions, setActions] = useState<SimAction[]>([])
  const rowOf = (v: string | null) => (v && v.includes(':') ? Number(v.split(':')[0]) : null)
  // The weapons held, once this project's lists say they're here (another project's would fail).
  const held = equipment && lists ? fitEquipment(equipment, lists) : null
  const rightId = rowOf(held?.right ?? null)
  const leftId = rowOf(held?.left ?? null)
  useEffect(() => {
    if (!view) {
      setActions([])
      return
    }
    let live = true
    call('char:actions', { animation: view.name, right: rightId, left: leftId })
      .then((a) => live && setActions(a))
      .catch(() => live && setActions([]))
    return () => {
      live = false
    }
    // `version`: a behavior, bullet or attack row edited in Params changes what plays.
  }, [view, rightId, leftId, version])
  const [clipStatus, setClipStatus] = useState<{ clip: ClipView | null; error: string | null; loading: boolean }>({
    clip: null,
    error: null,
    loading: false,
  })
  // Where the game hangs each held weapon's second model (its scabbard): WepAbsorpPosParam.
  const [placements, setPlacements] = useState<{ right: WeaponPlacement | null; left: WeaponPlacement | null }>({
    right: null,
    left: null,
  })
  useEffect(() => {
    let live = true
    Promise.all([
      rightId !== null ? call('char:placement', { weapon: rightId }) : null,
      leftId !== null ? call('char:placement', { weapon: leftId }) : null,
    ])
      .then(([right, left]) => live && setPlacements({ right, left }))
      .catch(() => live && setPlacements({ right: null, left: null }))
    return () => {
      live = false
    }
  }, [rightId, leftId, version])
  // A grease, other buff item or buff spell on the held weapons.
  const buffItem = equipment?.buff ?? null
  const buffSpell = equipment?.buffSpell ?? null
  const [chosenBuffs, setChosenBuffs] = useState<BuffRun[]>([])
  useEffect(() => {
    if (buffItem === null && buffSpell === null) return setChosenBuffs([])
    let live = true
    call('char:buff', {
      ...(buffSpell !== null ? { spell: buffSpell } : { goods: buffItem! }),
      right: rightId,
      left: leftId,
    })
      .then((b) => live && setChosenBuffs(b))
      .catch(() => live && setChosenBuffs([]))
    return () => {
      live = false
    }
  }, [buffItem, buffSpell, rightId, leftId, version])
  // And the looks the held weapons carry themselves (a Passive SpEffect keeping one on).
  const [ownLooks, setOwnLooks] = useState<BuffRun[]>([])
  useEffect(() => {
    if (rightId === null && leftId === null) return setOwnLooks([])
    let live = true
    call('char:ownLooks', { right: rightId, left: leftId })
      .then((b) => live && setOwnLooks(b))
      .catch(() => live && setOwnLooks([]))
    return () => {
      live = false
    }
  }, [rightId, leftId, version])
  const buffs = useMemo(() => [...ownLooks, ...chosenBuffs], [ownLooks, chosenBuffs])

  const loadCategories = useCallback(() => call('anim:categories', undefined).then(setCategories).catch(ui.error), [ui])
  const loadUnregistered = useCallback(
    () =>
      call('anim:unregistered', undefined)
        .then(setUnregistered)
        .catch(() => {}),
    [],
  )

  // The first load reads the animation binder (a second or two); later ones are quick and silent.
  const loaded = useRef(false)
  useEffect(() => {
    const load = async () => {
      await loadCategories()
      await loadUnregistered()
    }
    if (loaded.current) load()
    else ui.run('Reading the player’s animations', load)
    loaded.current = true
  }, [version])

  useEffect(() => {
    if (category === null) return
    let live = true
    call('anim:list', { category, query: '' })
      .then((l) => live && setAnims(l))
      .catch(ui.error)
    return () => {
      live = false
    }
  }, [category, version, ui])

  // An event to select once its animation has loaded (Back / Forward).
  const pendingEvent = useRef<{ name: string; index: number } | null>(null)
  useEffect(() => {
    if (!selected) {
      setView(null)
      return
    }
    let live = true
    call('anim:get', { name: selected })
      .then((v) => {
        if (!live) return
        setView(v)
        const p = pendingEvent.current
        if (p?.name === v.name) {
          pendingEvent.current = null
          if (p.index < v.events.length) setEventIndex(p.index)
        }
      })
      .catch(ui.error)
    return () => {
      live = false
    }
  }, [selected, version, ui])

  // A weapon to hold, once the equipment lists are there.
  const [pendingWeapon, setPendingWeapon] = useState<number | null>(null)
  useEffect(() => {
    if (pendingWeapon === null || !lists || !equipment) return
    const w = lists.weapons.find((x) => x.id === pendingWeapon)
    setPendingWeapon(null)
    if (w?.part) setEquipment({ ...equipment, right: `${w.id}:${w.part}` })
  }, [pendingWeapon, lists, equipment])

  // The combo viewer (F8): animations one after another in the viewport.
  const [comboSteps, setComboSteps] = usePersistentState<ComboStepDef[]>(PREF_KEYS.combo, [])
  const [comboPlaying, setComboPlayingState] = useState(false)
  // Entire spell: a spell cast from start to finish (its cast animations one after another, every bullet
  // and effect it has), played by the same player as a combo.
  const [entireSpell, setEntireSpell] = useState<EntireSpellPlan | null>(null)
  const setComboPlaying = (on: boolean | ((p: boolean) => boolean)) => {
    setComboPlayingState(on)
    setEntireSpell(null)
  }
  const playFromStart = () => clock.playFrom(0)
  const startEntireSpell = async (spell: number) => {
    const plan = await ui.run('Reading the spell’s casts', () => call('spell:entire', { spell, right: rightId }))
    if (!plan) return
    if (!plan.steps.length) return ui.toast(`${plan.name} has no cast animations in its category`, true)
    // Cast with its catalyst in the right hand (a staff or a seal), as a skill opens with its weapon.
    if (plan.catalyst && plan.catalyst.id !== rightId) setPendingWeapon(plan.catalyst.id)
    setComboPlayingState(false)
    setEntireSpell(plan)
    const first = plan.steps[0].animation
    const m = /^a(\d{3})_/.exec(first)
    if (m) setCategory(Number(m[1]))
    setSelected(first)
    playFromStart()
  }

  // Opened from elsewhere in the app, or Back / Forward.
  useEffect(() => {
    if (!target) return
    // Entire spell, from a spell's row or one of its effects.
    if (target.spell !== undefined) {
      void startEntireSpell(target.spell)
      return
    }
    if (target.weapon !== undefined) setPendingWeapon(target.weapon)
    if (target.category !== null) setCategory(target.category)
    setSelected(target.animation)
    const ev = target.event ?? null
    if (ev !== null && view && view.name === target.animation) {
      pendingEvent.current = null
      setEventIndex(ev < view.events.length ? ev : null)
    } else {
      pendingEvent.current = ev !== null && target.animation ? { name: target.animation, index: ev } : null
      setEventIndex(null)
    }
  }, [target?.seq])

  // The picked event is part of where you are: Back returns to it.
  useEffect(() => {
    if (selected) onPlace({ category, animation: selected, event: eventIndex }, true)
  }, [eventIndex])

  const selectCategory = (c: number) => {
    setCategory(c)
    setSelected(null)
    setEventIndex(null)
    onPlace({ category: c, animation: null })
  }
  const selectAnimation = (name: string) => {
    const m = /^a(\d{3})_/.exec(name)
    const c = m ? Number(m[1]) : category
    if (c !== category) setCategory(c)
    setSelected(name)
    setEventIndex(null)
    onPlace({ category: c, animation: name })
  }

  /** After an edit: show the new view and keep the list and badges current. */
  const applied = (v: AnimationView) => {
    setView(v)
    setAnims((l) =>
      l.map((a) =>
        a.name === v.name
          ? {
              ...a,
              events: v.events.length,
              state: v.state,
              registration: v.registration,
              title: v.title,
              tags: v.tags,
            }
          : a,
      ),
    )
    // Mute and solo are by event: an event added or removed shifts them, so they start over.
    setMuted((m) =>
      m.name === v.name && view && view.name === v.name && view.events.length !== v.events.length
        ? { name: '', mute: [], solo: [] }
        : m,
    )
    onEdited()
    refreshHistory()
  }

  /** The animation, list and categories read again (after a dialog changed them). */
  const reloadView = async () => {
    onEdited()
    refreshHistory()
    await loadCategories()
    if (category !== null) setAnims(await call('anim:list', { category, query: '' }).catch(() => anims))
    if (selected) setView(await call('anim:get', { name: selected }).catch(() => null))
  }

  /** An animation moved or renamed by its properties (F3): show it where it is now. */
  const movedTo = async (name: string) => {
    await loadCategories()
    selectAnimation(name)
    await loadUnregistered()
    refreshHistory()
    onEdited()
    const c = Number(name.slice(1, 4))
    setAnims(await call('anim:list', { category: c, query: '' }).catch(() => []))
  }

  /** A category moved to a new number (Shift+F2). */
  const renumbered = async (to: number) => {
    onParamsEdited()
    onEdited()
    await loadCategories()
    await loadUnregistered()
    refreshHistory()
    selectCategory(to)
  }

  /** Undo / redo: the animation they changed comes back into view. */
  const step = async (kind: 'undo' | 'redo') => {
    const name = await call(kind === 'undo' ? 'anim:undo' : 'anim:redo', undefined).catch(ui.error)
    if (!name) {
      if (name === null) ui.toast(kind === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.')
      return
    }
    const v = await call('anim:get', { name }).catch(() => null)
    if (!v) {
      // It's gone (an undone copy): its category still shows.
      await reloadView()
      return
    }
    if (name !== selected) {
      setCategory(v.category)
      setSelected(name)
    }
    applied(v)
    setEventIndex((i) => (i !== null && i < v.events.length ? i : null))
    if (category !== v.category || !anims.some((a) => a.name === name)) {
      await loadCategories()
      setAnims(await call('anim:list', { category: v.category, query: '' }).catch(() => anims))
    }
  }
  const undo = () => step('undo')
  const redo = () => step('redo')

  /** The selected events, the inspector's first. */
  const selectedEvents = () => (selection.length ? selection : eventIndex !== null ? [eventIndex] : [])

  const copyEvents = async (cut: boolean) => {
    const indices = selectedEvents()
    if (!view || !indices.length) return
    try {
      setCopiedEvents(await call('anim:copyEvents', { name: view.name, indices }))
      ui.toast(
        `${cut ? 'Cut' : 'Copied'} ${plural(indices.length, 'event')}. Ctrl+V pastes at the playhead, in any animation.`,
      )
      if (cut) applied(await call('anim:deleteEvents', { name: view.name, indices }))
      if (cut) setEventIndex(null)
    } catch (e) {
      ui.error(e)
    }
  }
  const pasteEvents = async () => {
    const events = copiedEvents()
    if (!view || !events?.length) return
    try {
      const r = await call('anim:pasteEvents', { name: view.name, events, at: clock.time })
      applied(r.view)
      selectMany(r.indices, r.indices[0] ?? null)
    } catch (e) {
      ui.error(e)
    }
  }
  const deleteEvent = (index: number) =>
    view &&
    call('anim:deleteEvent', { name: view.name, index })
      .then((v) => {
        applied(v)
        setEventIndex(v.events.length ? Math.min(index, v.events.length - 1) : null)
      })
      .catch(ui.error)

  const duplicateEvent = (index: number) => {
    if (!view) return
    const ev = view.events[index]
    call('anim:addEvent', { name: view.name, copyFrom: index, start: ev.start, end: ev.end })
      .then((r) => {
        applied(r.view)
        setEventIndex(r.index)
      })
      .catch(ui.error)
  }

  const deleteSelected = () => {
    const indices = selectedEvents()
    if (!view || !indices.length) return
    if (indices.length === 1) return deleteEvent(indices[0])
    call('anim:deleteEvents', { name: view.name, indices })
      .then((v) => {
        applied(v)
        setEventIndex(null)
      })
      .catch(ui.error)
  }

  /** Mute or solo the selected events in the viewer (1 / 2), or clear both (3). */
  const toggleMute = (kind: 'mute' | 'solo' | 'clear') => {
    if (!view) return
    const base = muted.name === view.name ? muted : { name: view.name, mute: [], solo: [] }
    if (kind === 'clear') return setMuted({ name: view.name, mute: [], solo: [] })
    const sel = selectedEvents()
    if (!sel.length) return
    const list = base[kind]
    const all = sel.every((i) => list.includes(i))
    const next = all ? list.filter((i) => !sel.includes(i)) : [...new Set([...list, ...sel])]
    setMuted({ ...base, name: view.name, [kind]: next })
  }

  /** The same animation id in the previous / next category that has it (Page Up / Page Down). */
  const sameIdIn = async (dir: 1 | -1) => {
    if (!selected) return
    const name = await call('anim:sameIdIn', { name: selected, dir }).catch(() => null)
    if (name) selectAnimation(name)
    else ui.toast(`No ${dir > 0 ? 'later' : 'earlier'} category has animation ${selected.slice(5)}.`)
  }

  /** Opens an animation with one of its events selected (a Find hit). */
  const openEvent = (name: string, index: number) => {
    if (view?.name === name) {
      setEventIndex(index < view.events.length ? index : null)
      const ev = view.events[index]
      if (ev) clock.pauseAt(ev.start)
      return
    }
    pendingEvent.current = { name, index }
    selectAnimation(name)
  }

  // What the events do to playback speed, opacity, weapons and model parts (muted ones don't).
  const effects = useMemo(() => {
    if (!view) return null
    const m = muted.name === view.name ? muted : null
    const types = new Set(mutedTypes)
    const live = view.events.filter(
      (e) =>
        !(m && m.mute.includes(e.index)) && !(m && m.solo.length && !m.solo.includes(e.index)) && !types.has(e.type),
    )
    return eventEffects(live, view.length)
  }, [view, muted, mutedTypes])

  // The spells cast with this category's animations (Entire spell in the viewport's toolbar).
  const [categorySpells, setCategorySpells] = useState<{ id: number; name: string }[]>([])
  useEffect(() => {
    if (category === null || category < 400) return setCategorySpells([])
    let live = true
    call('spell:forCategory', { category })
      .then((s) => live && setCategorySpells(s))
      .catch(() => live && setCategorySpells([]))
    return () => {
      live = false
    }
  }, [category, version])
  // Each step's cut, from its events (cancel windows; a spell's, from where the game moves on): what the viewport plays.
  const [comboResolved, setComboResolved] = useState<{ steps: ComboStep[]; views: AnimationView[] } | null>(null)
  useEffect(() => {
    const spell = entireSpell
    if (!spell && (!comboPlaying || !comboSteps.length)) return setComboResolved(null)
    let live = true
    const names = spell ? spell.steps.map((st) => st.animation) : comboSteps.map((c) => c.animation)
    Promise.all(names.map((name) => call('anim:get', { name })))
      .then(
        (views) =>
          live &&
          setComboResolved({
            steps: views.map((v, i) => ({
              animation: v.name,
              to: spell ? spell.steps[i].to : cutTime(v, comboSteps[i].cut),
            })),
            views,
          }),
      )
      .catch((e) => {
        if (!live) return
        ui.toast(`${spell ? `${spell.name} can’t play` : 'The combo can’t play'}: ${errorMessage(e)}`, true)
        setComboPlaying(false)
      })
    return () => {
      live = false
    }
  }, [comboPlaying, comboSteps, entireSpell, version, ui])
  // Where each step starts on the combo's clock (the viewport says, from the clips' lengths).
  const [comboStarts, setComboStarts] = useState<number[] | null>(null)
  useEffect(() => setComboStarts(null), [comboResolved])
  // Every step's events, at its time: hitboxes, bullets, effects; and what they do to speed, opacity, weapons.
  const [comboActions, setComboActions] = useState<{ actions: SimAction[]; effects: EventEffects } | null>(null)
  useEffect(() => {
    if (!comboResolved || !comboStarts) return setComboActions(null)
    let live = true
    const spell = entireSpell?.spell
    Promise.all(
      comboResolved.steps.map((st) =>
        call('char:actions', {
          animation: st.animation,
          right: rightId,
          left: leftId,
          ...(spell !== undefined ? { spell } : {}),
        }).catch(() => [] as SimAction[]),
      ),
    ).then((lists) => {
      if (!live) return
      const actions: SimAction[] = []
      const effects: EventEffects = { speed: [], opacity: [], hideWeapons: [], masks: [] }
      lists.forEach((list, k) => {
        const t0 = comboStarts[k] ?? 0
        const cut = comboResolved.steps[k].to
        // An event lasting "for ever" ends with its animation, as in game.
        const until = cut ?? comboResolved.views[k].length
        for (const a of list) {
          if (a.start > until + 1e-4) continue
          actions.push({ ...a, event: k * 10000 + a.event, start: a.start + t0, end: Math.min(a.end, until) + t0 })
        }
        const view = comboResolved.views[k]
        const e = eventEffects(view.events, view.length)
        for (const key of ['speed', 'opacity', 'hideWeapons', 'masks'] as const)
          for (const w of e[key] as { start: number; end: number }[])
            if (w.start <= until)
              (effects[key] as { start: number; end: number }[]).push({
                ...w,
                start: w.start + t0,
                end: Math.min(w.end, until) + t0,
              })
      })
      setComboActions({ actions, effects })
    })
    return () => {
      live = false
    }
  }, [comboResolved, comboStarts, rightId, leftId, entireSpell, version])
  /** A combo or an entire spell plays in the viewport. */
  const sequencePlaying = comboPlaying || !!entireSpell

  // Muted and soloed events, and muted event types, don't act in the viewer.
  const shownActions = useMemo(() => {
    if (!view) return actions
    const m = muted.name === view.name ? muted : null
    const types = new Set(mutedTypes)
    return actions.filter(
      (a) =>
        !(m && m.mute.includes(a.event)) &&
        !(m && m.solo.length && !m.solo.includes(a.event)) &&
        !types.has(view.events[a.event]?.type ?? -1),
    )
  }, [actions, muted, mutedTypes, view])

  // The selected event, when it places an effect: what the move and rotate tool works on.
  const gizmoEvent = view && eventIndex !== null ? (view.events[eventIndex] ?? null) : null
  const gizmoEffect = gizmoEvent?.fields.find((f) => f.link === 'effect' && f.value > 0) ?? null
  const gizmoDummy = gizmoEvent?.fields.find((f) => /^DummyPoly(ID)?$/i.test(f.name)) ?? null
  const gizmo: GizmoTarget | null =
    gizmoMode && gizmoEvent && gizmoEffect
      ? { event: gizmoEvent.index, mode: gizmoMode, snap: gizmoSnap, dummy: gizmoDummy?.value ?? -1 }
      : null
  /**
   * A drag of the tool, written: the effect turned and moved in its own axes (a game effect is copied
   * first, and the event takes the copy), or, let go near another dummy poly with snapping on, the event
   * moved to that dummy.
   */
  const writeGizmo = async (r: GizmoResult) => {
    const ev = view?.events[r.event]
    const fx = ev?.fields.find((f) => f.link === 'effect' && f.value > 0)
    if (!view || !ev || !fx) return
    const setField = (f: { type: string; offset: number }, value: number) =>
      call('anim:setEvent', { name: view.name, index: ev.index, field: { type: f.type, offset: f.offset, value } })
    try {
      const dummy = ev.fields.find((f) => /^DummyPoly(ID)?$/i.test(f.name))
      if (r.dummy !== undefined && dummy) {
        applied(await setField(dummy, r.dummy))
        return
      }
      const t = await call('effect:transform', { id: fx.value, rotation: r.rotation, offset: r.offset })
      if (t.copied) {
        applied(await setField(fx, t.id))
        ui.toast(`Effect ${fx.value} is the game’s: this event now uses its copy, ${t.id}, so nothing else changes.`)
      } else onEdited()
      effectsChanged()
    } catch (e) {
      ui.error(e)
    }
  }
  // One function for the viewer, writing with the page as it is when the drag ends.
  const writeGizmoRef = useLatest(writeGizmo)
  const onGizmo = useCallback((r: GizmoResult) => writeGizmoRef.current(r), [writeGizmoRef])

  const colorsRef = useLatest(colors)
  /** C: a colour for an event type's bars (a native colour picker), kept for every animation. */
  const pickColor = (type: number, current?: string) => {
    const doc = activeWindow().document
    const input = doc.createElement('input')
    input.type = 'color'
    input.value = current ?? '#d4a84a'
    input.style.position = 'fixed'
    input.style.opacity = '0'
    input.style.pointerEvents = 'none'
    doc.body.appendChild(input)
    input.addEventListener('input', () => setColors({ ...colorsRef.current, [type]: input.value }))
    input.addEventListener('change', () => input.remove())
    input.addEventListener('blur', () => setTimeout(() => input.remove(), 300))
    input.click()
  }

  const register = (names: string[]) =>
    ui.run('Registering in the behaviour graph', async () => {
      const r = await call('anim:register', { names })
      const ok = r.added.length
      const why = r.skipped.filter((s) => s.reason !== 'already playable')
      ui.toast(
        (ok
          ? `${plural(ok, 'animation')} can now play in game (added to ${r.added.reduce((n, a) => n + a.selectors, 0)} selectors).`
          : 'Nothing was registered.') +
          (why.length ? `\n${why.length} not registered: ${why[0].animation} — ${why[0].reason}` : '') +
          '\nWritten to the project’s c0000.behbnd when you save.',
        !ok && why.length > 0,
      )
      onEdited()
      await loadUnregistered()
      if (selected) setView(await call('anim:get', { name: selected }))
      if (category !== null) setAnims(await call('anim:list', { category, query: '' }))
    })

  const deleteAnimation = () => {
    if (!view) return
    if (!confirmHere(`Delete ${view.name} and its ${view.events.length} events from the project? (Ctrl+Z undoes it.)`))
      return
    call('anim:delete', { name: view.name })
      .then(async () => {
        onEdited()
        setSelected(null)
        setEventIndex(null)
        if (category !== null) setAnims(await call('anim:list', { category, query: '' }))
        loadCategories()
      })
      .catch(ui.error)
  }

  const duplicated = async (created: string | null, toCategory: number) => {
    setDialog(null)
    // New animations can change what a weapon plays, and a copied stance category is one to hold a
    // weapon in (Moveset): everything that reads them reads again.
    onParamsEdited()
    onEdited()
    await loadCategories()
    await loadUnregistered()
    setCategory(toCategory)
    setAnims(await call('anim:list', { category: toCategory, query: '' }))
    if (created) setSelected(created)
    setEventIndex(null)
    onPlace({ category: toCategory, animation: created })
  }
  /** A weapon given moves of its own (Moveset panel): everything reads again, its first new move plays. */
  const movesetApplied = (r: MovesetResult) => {
    onParamsEdited()
    onEdited()
    loadUnregistered()
    if (r.category >= 0 && r.animations.length) selectAnimation(r.animations[0])
  }
  const addEvent = (type: number, at: number) =>
    view &&
    call('anim:addEvent', { name: view.name, type, start: at, end: at + 3 / FPS })
      .then((r) => {
        applied(r.view)
        setEventIndex(r.index)
      })
      .catch(ui.error)

  useAnimationShortcuts(
    {
      clock,
      anims,
      selected,
      view,
      category,
      eventIndex,
      selection,
      mutedTypes,
      colors,
      showAnimation: (name) => {
        setSelected(name)
        setEventIndex(null)
        onPlace({ category, animation: name })
      },
      toggleFocus: (hand) => setFocus((f) => (f === hand ? null : hand)),
      sameIdIn,
      undo,
      redo,
      openDialog: setDialog,
      openFind: () => {
        showPanel('animations', 'animFind')
        setFindSeq((n) => n + 1)
      },
      selectMany,
      copyEvents,
      pasteEvents,
      setEventIndex,
      deleteSelected,
      duplicateEvent,
      toggleMute,
      setMutedTypes,
      pickColor,
      toggleCombo: () => {
        if (comboSteps.length) setComboPlaying((p) => !p)
        else showPanel('animations', 'animCombo')
      },
      toggleGizmo: (mode) => setGizmoMode((m) => (m === mode ? null : mode)),
    },
    { hidden, dialogOpen: !!dialog },
  )

  return {
    categories,
    category,
    unregistered,
    anims,
    selected,
    view,
    eventIndex,
    setEventIndex,
    selection,
    selectMany,
    history,
    redo,
    reloadView,
    movedTo,
    renumbered,
    copyEvents,
    pasteEvents,
    deleteSelected,
    openEvent,
    findSeq,
    muted: view && muted.name === view.name ? muted : null,
    mutedTypes,
    setMutedTypes,
    colors,
    setColors,
    pickColor,
    laneOrder,
    setLaneOrder,
    shownActions,
    effects,
    gizmo,
    onGizmo,
    gizmoMode,
    setGizmoMode,
    gizmoSnap,
    setGizmoSnap,
    gizmoAvailable: !!gizmoEffect,
    comboSteps,
    setComboSteps,
    comboPlaying,
    setComboPlaying,
    comboResolved,
    setComboStarts,
    comboActions,
    sequencePlaying,
    entireSpell,
    startEntireSpell,
    stopEntireSpell: () => setEntireSpell(null),
    categorySpells,
    playFromStart,
    dialog,
    setDialog,
    clock,
    panel,
    setPanel,
    focus,
    setFocus,
    lighting,
    setLighting,
    helpers,
    setHelpers,
    equipment,
    setEquipment,
    lists,
    actions,
    buffs,
    clipStatus,
    setClipStatus,
    selectCategory,
    selectAnimation,
    register,
    applied,
    undo,
    deleteEvent,
    duplicateEvent,
    deleteAnimation,
    duplicated,
    movesetApplied,
    addEvent,
    onOpenRow,
    onOpenEffect,
    onParamsEdited,
    version,
    rightWeapon:
      rightId !== null
        ? { id: rightId, name: lists?.weapons.find((w) => w.id === rightId)?.name ?? `Weapon ${rightId}` }
        : null,
    placements,
  }
}
