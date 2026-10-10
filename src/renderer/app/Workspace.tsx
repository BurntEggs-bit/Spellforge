/**
 * An open project: the top bar and its pages (Params & effects, Animations,
 * Enemies, Text), going from one to another (Back and Forward too), and the
 * dialogs any page can open (What is this ID?, Update from game, Duplicate).
 * The Params page's state lives here, since every page opens rows on it.
 */
import { useCallback, useState } from 'react'
import type { ProjectSummary } from '../../shared/api.ts'
import { AnimationsPage } from '../animations/AnimationsPage.tsx'
import type { AnimPlace } from '../animations/useAnimationsPage.ts'
import { EnemiesPage } from '../enemies/EnemiesPage.tsx'
import type { EnemiesPlace } from '../enemies/useEnemiesPage.ts'
import { EventsPage } from '../events/EventsPage.tsx'
import type { EventsPlace } from '../events/useEventsPage.ts'
import { effectsChanged } from '../fx/fxruns.ts'
import { IdLookupContext, IdLookupDialog } from '../ids/IdLookup.tsx'
import { CloneDialog } from '../params/CloneDialog.tsx'
import { ParamsPage } from '../params/ParamsPage.tsx'
import type { ParamsPageState, RowRef, Selection } from '../params/pageContext.ts'
import { InActiveWindow, useUi } from '../shared/ui.tsx'
import { TextPage } from '../text/TextPage.tsx'
import type { TextPlace } from '../text/useTextPage.ts'
import { showPanel } from './dock.tsx'
import { startOf, useNavigation, type Page, type Place } from './navigation.ts'
import { projectPath } from './projectPaths.ts'
import { TopBar } from './TopBar.tsx'
import { UpdateDialog } from './UpdateDialog.tsx'
import { useSaveAndReload } from './useSaveAndReload.ts'

export function Workspace({
  project,
  onClose,
  onAppearance,
  onAbout,
  onReopened,
}: {
  project: ProjectSummary
  onClose: () => void
  onAppearance: () => void
  onAbout: () => void
  onReopened: (summary: ProjectSummary) => void
}) {
  const ui = useUi()
  const [root, setRoot] = useState<RowRef | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [pinnedSelection, setPinnedSelection] = useState<Selection | null>(null)
  const [pinnedRoot, setPinnedRoot] = useState<RowRef | null>(null)
  const [cloneRoots, setCloneRoots] = useState<RowRef[] | null>(null)
  const [updateOpen, setUpdateOpen] = useState(false)
  /** "What is this ID?", open (on an id, or empty). */
  const [lookup, setLookup] = useState<{ id?: number; seq: number } | null>(null)
  const openLookup = useCallback((id?: number) => setLookup((l) => ({ id, seq: (l?.seq ?? 0) + 1 })), [])
  /** Bumped after any edit so panels refetch. */
  const [version, setVersion] = useState(0)
  const [mode, setModeState] = useState<Page>('params')
  /** The other pages load on their first visit, then stay mounted. */
  const [opened, setOpened] = useState<ReadonlySet<Page>>(() => new Set(['params']))
  if (!opened.has(mode)) setOpened(new Set([...opened, mode]))
  const [animTarget, setAnimTarget] = useState<(AnimPlace & { seq: number }) | null>(null)
  const [enemyTarget, setEnemyTarget] = useState<(EnemiesPlace & { seq: number }) | null>(null)
  const [textTarget, setTextTarget] = useState<(TextPlace & { seq: number }) | null>(null)
  const [eventsTarget, setEventsTarget] = useState<(EventsPlace & { seq: number }) | null>(null)

  const saving = useSaveAndReload(project.modDir)
  const { refreshDirty } = saving
  const edited = useCallback(() => {
    setVersion((v) => v + 1)
    // Effects playing in the viewports show the edit (a recolour, a new size).
    effectsChanged()
    refreshDirty()
  }, [refreshDirty])

  /** Puts the pages in a place (Back, Forward, the place the project was left at). */
  const show = (p: Place) => {
    setModeState(p.page)
    if (p.page === 'params') {
      setRoot(p.root)
      setSelection(p.selection)
      if (p.selection) showPanel('params', 'inspector')
    } else if (p.page === 'animations') {
      setAnimTarget((t) => ({
        category: p.category,
        animation: p.animation,
        event: p.event ?? null,
        seq: (t?.seq ?? 0) + 1,
      }))
    } else if (p.page === 'enemies') {
      setEnemyTarget((t) => ({ chr: p.chr, move: p.move, seq: (t?.seq ?? 0) + 1 }))
    } else if (p.page === 'events') {
      setEventsTarget((t) => ({ file: p.file, event: p.event, seq: (t?.seq ?? 0) + 1 }))
    } else {
      setTextTarget((t) => ({ lang: p.lang, rel: p.rel, file: p.file, id: p.id, seq: (t?.seq ?? 0) + 1 }))
    }
  }
  const nav = useNavigation(project.modDir, show)
  const { visit } = nav

  const setMode = (m: Page) => {
    if (m === mode) return
    setModeState(m)
    visit(nav.lastPlaceOf(m) ?? startOf(m))
  }

  const showParams = (r: RowRef | null, s: Selection | null) => {
    setModeState('params')
    setRoot(r)
    setSelection(s)
    visit({ page: 'params', root: r, selection: s })
  }
  const openRow = (param: string, id: number) => {
    if (param === 'fxr') return showParams(root, { kind: 'effect', id })
    showParams({ param, id }, { kind: 'row', param, id })
  }
  /** From the Animations or Text page: show a row or effect on the Params page. */
  const showRow = (param: string, id: number) => {
    showParams(param !== 'SpEffectParam' ? { param, id } : root, { kind: 'row', param, id })
    showPanel('params', 'inspector')
  }
  const showEffect = (id: number) => {
    showParams(root, { kind: 'effect', id })
    showPanel('params', 'inspector')
  }
  const openAnimation = (name: string, weapon?: number) => {
    setModeState('animations')
    const m = /^a(\d{3})_/.exec(name)
    const place: AnimPlace = { category: m ? Number(m[1]) : null, animation: name, weapon }
    setAnimTarget((t) => ({ ...place, seq: (t?.seq ?? 0) + 1 }))
    visit({ page: 'animations', ...place })
  }
  const openEntireSpell = (spell: number) => {
    setModeState('animations')
    const place: AnimPlace = { category: null, animation: null, spell }
    setAnimTarget((t) => ({ ...place, seq: (t?.seq ?? 0) + 1 }))
    visit({ page: 'animations', ...place })
  }

  const paramsApi: ParamsPageState = {
    project,
    version,
    root,
    selection,
    pinnedSelection,
    setPinnedSelection,
    pinnedRoot,
    setPinnedRoot,
    openRow,
    select: (s) => showParams(root, s),
    openRoot: (param, id) => showParams({ param, id }, { kind: 'row', param, id }),
    edited,
    duplicate: (roots) => setCloneRoots(roots),
    openAnimation,
    openEntireSpell,
    cleared: () => showParams(null, null),
    openUpdate: () => setUpdateOpen(true),
  }

  return (
    <div className="app">
      <TopBar
        project={project}
        page={mode}
        onPage={setMode}
        canBack={nav.canBack}
        canForward={nav.canForward}
        onGo={nav.go}
        dirty={saving.dirty}
        isDirty={saving.isDirty}
        onSave={saving.save}
        onReload={saving.reloadInGame}
        onPlay={saving.playInGame}
        reloadOnSave={saving.reloadOnSave}
        onReloadOnSave={saving.setReloadOnSave}
        onLookup={() => openLookup()}
        onAppearance={onAppearance}
        onAbout={onAbout}
        onClose={onClose}
      />

      <IdLookupContext.Provider value={openLookup}>
        <div className="pages">
          <div className="dock-host" style={{ display: mode === 'params' ? undefined : 'none' }}>
            <ParamsPage api={paramsApi} />
          </div>
          {opened.has('animations') && (
            <div className="dock-host" style={{ display: mode === 'animations' ? undefined : 'none' }}>
              <AnimationsPage
                hidden={mode !== 'animations'}
                target={animTarget}
                version={version}
                onEdited={refreshDirty}
                onOpenRow={showRow}
                onOpenEffect={showEffect}
                onParamsEdited={edited}
                onPlace={(p, detail) => visit({ page: 'animations', ...p }, detail)}
              />
            </div>
          )}
          {opened.has('enemies') && (
            <div className="dock-host" style={{ display: mode === 'enemies' ? undefined : 'none' }}>
              <EnemiesPage
                hidden={mode !== 'enemies'}
                target={enemyTarget}
                version={version}
                onEdited={edited}
                onOpenRow={showRow}
                onOpenEffect={showEffect}
                onOpenAnimation={(p) => openAnimation(p.animation, p.weapon)}
                onPlace={(p) => visit({ page: 'enemies', ...p })}
              />
            </div>
          )}
          {opened.has('events') && (
            <div className="dock-host" style={{ display: mode === 'events' ? undefined : 'none' }}>
              <EventsPage
                target={eventsTarget}
                version={version}
                onEdited={edited}
                onOpenRow={showRow}
                onPlace={(p) => visit({ page: 'events', ...p })}
              />
            </div>
          )}
          {opened.has('text') && (
            <div className="dock-host" style={{ display: mode === 'text' ? undefined : 'none' }}>
              <TextPage
                target={textTarget}
                onEdited={edited}
                onOpenRow={showRow}
                onPlace={(p) => visit({ page: 'text', ...p })}
              />
            </div>
          )}
        </div>
      </IdLookupContext.Provider>

      {lookup && (
        <IdLookupDialog
          key={lookup.seq}
          initial={lookup.id}
          onClose={() => setLookup(null)}
          onOpenRow={(param, id) => (mode === 'params' ? openRow(param, id) : showRow(param, id))}
          onOpenEffect={showEffect}
        />
      )}

      {updateOpen && (
        <UpdateDialog
          onCancel={() => setUpdateOpen(false)}
          onDone={(summary, written, to) => {
            setUpdateOpen(false)
            onReopened(summary)
            edited()
            ui.toast(
              `Updated to game ${to} and saved:\n${written.map((f) => projectPath(project.modDir, f)).join('\n')}`,
            )
          }}
        />
      )}
      {cloneRoots && (
        <InActiveWindow>
          <CloneDialog
            roots={cloneRoots}
            onClose={() => setCloneRoots(null)}
            onDone={(newRoot) => {
              setCloneRoots(null)
              edited()
              showParams(newRoot, { kind: 'row', ...newRoot })
            }}
          />
        </InActiveWindow>
      )}
    </div>
  )
}
