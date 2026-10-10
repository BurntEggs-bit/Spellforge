/**
 * The Enemies page's state and what its panels do: the characters, the one
 * picked and its moves, the move shown and what it does, the viewer (on the
 * character, or fitted to you), and the skill, attack or spell made from it.
 */
import { useState, useMemo, useEffect } from 'react'
import type {
  EnemyListItem,
  EnemyView,
  AnimationView,
  RetargetOptionsView,
  ClipView,
  SimAction,
  EnemySkillResult,
  EnemySpellResult,
} from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'
import { useEquipmentLists, withBareHead, fitEquipment, defaultEquipment } from '../viewer/equipment.ts'
import { maskWindows, type ModelMasks } from '../viewer/eventEffects.ts'
import { PlayClock } from '../viewer/PlayClock.ts'
import {
  type HelperPrefs,
  loadHelpers,
  saveHelpers,
  type LightingPrefs,
  loadLighting,
  saveLighting,
  type EquipPrefs,
  loadEquipment,
} from '../viewer/prefs.ts'
import type { ViewportPanel, WeaponFocus } from '../viewer/Transport.tsx'

/** A skill, attack or spell just made from one of the character's moves or bullets. */
export type Result =
  { kind: 'skill'; skill: EnemySkillResult; weapon: number } | { kind: 'spell'; spell: EnemySpellResult }

export function useEnemiesPage({ hidden, target, version, onOpenRow, onOpenEffect, onPlace }: EnemiesProps) {
  const ui = useUi()
  const [list, setList] = useState<EnemyListItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [chr, setChr] = useState<string | null>(null)
  const [variation, setVariation] = useState<number | undefined>(undefined)
  const [view, setView] = useState<EnemyView | null>(null)
  const [tab, setTab] = useState<'moves' | 'spells' | 'effects'>('moves')
  const [moveQuery, setMoveQuery] = useState('')
  const [onlyActions, setOnlyActions] = useState(true)
  const [move, setMove] = useState<string | null>(null)
  const [anim, setAnim] = useState<AnimationView | null>(null)
  const [spell, setSpell] = useState<number | null>(null)
  const [dialog, setDialog] = useState<null | 'skill' | 'spell'>(null)
  const [result, setResult] = useState<Result | null>(null)
  /** A skill or spell just made, being scaled. */
  const [scaling, setScaling] = useState<Result | null>(null)

  // Viewer.
  const clock = useMemo(() => new PlayClock(), [])
  const [on, setOn] = useState<'them' | 'you'>('them')
  const [fit, setFit] = useState<RetargetOptionsView>({ mirror: false, upright: false, travel: 1 })
  const [panel, setPanel] = useState<ViewportPanel>(null)
  const [focus, setFocus] = useState<WeaponFocus>(null)
  const [helpers, setHelpersState] = useState<HelperPrefs>(loadHelpers)
  const setHelpers = (h: HelperPrefs) => {
    setHelpersState(h)
    saveHelpers(h)
  }
  const [lighting, setLightingState] = useState<LightingPrefs>(loadLighting)
  const setLighting = (l: LightingPrefs) => {
    setLightingState(l)
    saveLighting(l)
  }
  const [clipStatus, setClipStatus] = useState<{ clip: ClipView | null; error: string | null; loading: boolean }>({
    clip: null,
    error: null,
    loading: false,
  })
  const [actions, setActions] = useState<SimAction[]>([])
  // You, as the Animations page dresses you.
  const lists = useEquipmentLists(false, version)
  const you = useMemo<EquipPrefs | null>(() => {
    // Once the project's lists are in: the saved outfit is shared by every project, and what this one doesn't have comes off.
    if (!lists) return null
    const saved = loadEquipment()
    return withBareHead(saved ? fitEquipment(saved, lists) : defaultEquipment(lists), lists)
  }, [lists, on])

  useEffect(() => {
    if (hidden || list) return
    ui.run('Reading every character in the game', () => call('enemy:list', undefined)).then((l) => l && setList(l))
  }, [hidden])

  const enemy = list?.find((e) => e.chr === chr) ?? null
  useEffect(() => {
    if (!chr) {
      setView(null)
      return
    }
    let live = true
    ui.run(`Reading ${enemy?.name ?? chr}’s moves`, () => call('enemy:get', { chr, variation })).then(
      (v) => live && v && setView(v),
    )
    return () => {
      live = false
    }
  }, [chr, variation, version])

  useEffect(() => {
    if (!chr || !move) {
      setAnim(null)
      return
    }
    let live = true
    call('enemy:anim', { chr, animation: move })
      .then((v) => live && setAnim(v))
      .catch(ui.error)
    return () => {
      live = false
    }
  }, [chr, move, ui])

  // What the move does on the character: its hits, bullets and effects.
  useEffect(() => {
    if (!chr || !move || on !== 'them') {
      setActions([])
      return
    }
    let live = true
    call('char:actions', { animation: move, right: null, left: null, chr, variation: view?.variation })
      .then((a) => live && setActions(a))
      .catch(() => live && setActions([]))
    return () => {
      live = false
    }
  }, [chr, move, on, view?.variation, version])

  // A left-handed move is mirrored into the weapon hand by default.
  const current = view?.moves.find((m) => m.name === move) ?? null
  useEffect(() => {
    if (current) setFit((f) => ({ ...f, mirror: current.hand === 'left' }))
  }, [current?.name])

  // The model's parts: its NPC row's defaults, then the move's mask events.
  const masks = useMemo<ModelMasks | null>(() => {
    if (!view) return null
    const npc = view.npcs.find((n) => n.variation === view.variation) ?? view.npcs[0]
    return { base: npc?.masks ?? [], windows: anim ? maskWindows(anim.events, anim.length) : [] }
  }, [view, anim])

  useEffect(() => {
    if (!target) return
    if (target.chr !== chr) {
      setChr(target.chr)
      setVariation(undefined)
    }
    setMove(target.move)
  }, [target?.seq])

  const pickCharacter = (c: string) => {
    setChr(c)
    setVariation(undefined)
    setMove(null)
    setSpell(null)
    setOn('them')
    onPlace({ chr: c, move: null })
  }
  const pickMove = (name: string) => {
    setMove(name)
    clock.playFrom(0)
    onPlace({ chr, move: name })
  }

  return {
    list,
    query,
    setQuery,
    chr,
    enemy,
    pickCharacter,
    view,
    variation,
    setVariation,
    tab,
    setTab,
    moveQuery,
    setMoveQuery,
    onlyActions,
    setOnlyActions,
    move,
    current,
    pickMove,
    anim,
    spell,
    setSpell,
    clock,
    on,
    setOn,
    fit,
    setFit,
    panel,
    setPanel,
    focus,
    setFocus,
    helpers,
    setHelpers,
    lighting,
    setLighting,
    clipStatus,
    setClipStatus,
    actions,
    masks,
    you,
    dialog,
    setDialog,
    result,
    setResult,
    scaling,
    setScaling,
    onOpenRow,
    onOpenEffect,
  }
}

/** Where the Enemies page is (for Back / Forward). */
export interface EnemiesPlace {
  chr: string | null
  move: string | null
}

export interface EnemiesProps {
  hidden: boolean
  target: (EnemiesPlace & { seq: number }) | null
  version: number
  onEdited: () => void
  onOpenRow: (param: string, id: number) => void
  onOpenEffect: (id: number) => void
  onOpenAnimation: (p: { category: number; animation: string; weapon?: number }) => void
  onPlace: (p: EnemiesPlace) => void
}
