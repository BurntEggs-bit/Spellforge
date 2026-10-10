/**
 * The Events page's state and what its panels do: the event scripts, the
 * one open and its events, the event picked, and the project's recipes
 * (added, edited, deleted) and test markers.
 */
import { useEffect, useMemo, useState } from 'react'
import type { EventFileView, EventRecipe, EventRecipeKind, EventSummary, EventView } from '../../shared/api.ts'
import { randomId } from '../../shared/format.ts'
import { call } from '../lib/ipc.ts'
import { useUi } from '../shared/ui.tsx'

/** Where the Events page is (for Back / Forward). */
export interface EventsPlace {
  file: string | null
  event: number | null
}

export interface EventsProps {
  /** A script / event to show (from elsewhere, or Back / Forward). */
  target: (EventsPlace & { seq: number }) | null
  version: number
  onEdited: () => void
  onOpenRow: (param: string, id: number) => void
  onPlace: (p: EventsPlace) => void
}

/** A new recipe of a kind, in a script. */
export function blankRecipe(kind: EventRecipeKind, file: string): EventRecipe {
  const base = { id: randomId(), file, events: [] }
  switch (kind) {
    case 'giveItems':
      return { ...base, kind, lot: 0, flag: 0 }
    case 'setFlag':
      return { ...base, kind, flag: 0, state: true, when: { kind: 'load' } }
    case 'whileSpEffect':
      return { ...base, kind, entity: 10000, speffect: 0, do: { kind: 'speffect', speffect: 0 } }
    case 'enableEnemy':
      return { ...base, kind, entity: 0, flag: 0 }
    case 'boss':
      return { ...base, kind, entity: 0, defeatFlag: 0, arena: 0, name: 0, banner: 17 }
  }
}

export function useEventsPage({ target, version, onEdited, onOpenRow, onPlace }: EventsProps) {
  const ui = useUi()
  const [files, setFiles] = useState<EventFileView[]>([])
  const [fileFilter, setFileFilter] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [file, setFile] = useState<string | null>(null)
  const [eventFilter, setEventFilter] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  /** A recipe being made or edited (shown in the Event panel). */
  const [editing, setEditing] = useState<EventRecipe | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  useEffect(() => {
    call('events:files', undefined).then(setFiles).catch(ui.error)
  }, [version, tick, ui])

  // Back / Forward, or a link from elsewhere: taken as it changes (state set while rendering, once per target).
  const [seen, setSeen] = useState<number | null>(null)
  if (target && target.seq !== seen) {
    setSeen(target.seq)
    setFile(target.file)
    setSelected(target.event)
  }

  // A script's events and the event picked, kept with what they were read for: another script or event shows
  // nothing until its own answer arrives.
  const [loaded, setLoaded] = useState<{ file: string; list: EventSummary[] } | null>(null)
  useEffect(() => {
    if (!file) return
    let live = true
    call('events:list', { file })
      .then((list) => live && setLoaded({ file, list }))
      .catch((e) => {
        if (!live) return
        setLoaded({ file, list: [] })
        ui.error(e)
      })
    return () => {
      live = false
    }
  }, [file, version, tick, ui])
  const events = useMemo(() => (loaded && loaded.file === file ? loaded.list : []), [loaded, file])

  const [shown, setShown] = useState<{ file: string; id: number; view: EventView | null } | null>(null)
  useEffect(() => {
    if (!file || selected === null) return
    let live = true
    call('events:get', { file, id: selected })
      .then((v) => live && setShown({ file, id: selected, view: v }))
      .catch(() => live && setShown({ file, id: selected, view: null }))
    return () => {
      live = false
    }
  }, [file, selected, version, tick])
  const view = shown && shown.file === file && shown.id === selected ? shown.view : null

  const shownFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase()
    return files.filter(
      (f) =>
        (!onlyMine || f.own > 0 || f.edited) &&
        (!q || f.file.toLowerCase().includes(q) || f.title.toLowerCase().includes(q)),
    )
  }, [files, fileFilter, onlyMine])
  const shownEvents = useMemo(() => {
    const q = eventFilter.trim().toLowerCase()
    return events.filter((e) => !q || String(e.id).includes(q) || e.about.toLowerCase().includes(q))
  }, [events, eventFilter])
  const current = files.find((f) => f.file === file) ?? null

  const selectFile = (f: string | null) => {
    setFile(f)
    setSelected(null)
    setEditing(null)
    onPlace({ file: f, event: null })
  }
  const selectEvent = (id: number | null) => {
    setSelected(id)
    setEditing(null)
    onPlace({ file, event: id })
  }

  /** Starts a recipe of a kind in the open script (or the common one when this script takes none). */
  const startRecipe = (kind: EventRecipeKind) => {
    setEditing(blankRecipe(kind, current?.canAdd ? current.file : 'common'))
  }
  const saveRecipe = async (r: EventRecipe) => {
    const saved = await ui.run('Writing the event', () => call('events:setRecipe', { recipe: r }))
    if (!saved) return
    setEditing(null)
    onEdited()
    if (saved.file !== file) setFile(saved.file)
    setSelected(saved.events[0] ?? null)
    onPlace({ file: saved.file, event: saved.events[0] ?? null })
    refresh()
    ui.toast(
      `Event ${saved.events.join(' and ')} in ${saved.file}, started from its event 0. Save to write it into the script.`,
    )
  }
  const deleteRecipe = async (r: EventRecipe) => {
    const ok = await ui.run('Taking the event out', async () => {
      await call('events:deleteRecipe', { id: r.id })
      return true
    })
    if (!ok) return
    setEditing(null)
    setSelected(null)
    onEdited()
    refresh()
  }
  const setMarker = async (on: boolean) => {
    if (!view) return
    const ok = await ui.run('Changing the test marker', async () => {
      await call('events:setMarker', { file: view.file, event: view.id, on })
      return true
    })
    if (!ok) return
    onEdited()
    refresh()
  }

  return {
    files,
    shownFiles,
    fileFilter,
    setFileFilter,
    onlyMine,
    setOnlyMine,
    file,
    current,
    selectFile,
    events,
    shownEvents,
    eventFilter,
    setEventFilter,
    selected,
    selectEvent,
    view,
    editing,
    setEditing,
    startRecipe,
    saveRecipe,
    deleteRecipe,
    setMarker,
    onOpenRow,
  }
}
