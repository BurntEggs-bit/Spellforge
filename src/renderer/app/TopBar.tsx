/**
 * The bar across the top of an open project: the menus (File, View, Tools,
 * Help), Back and Forward, the pages, the project and whether anything is
 * unsaved, Save, and What is this ID?.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { DirtyState, GameLinkStatus, ProjectSummary } from '../../shared/api.ts'
import { plural } from '../../shared/format.ts'
import { call } from '../lib/ipc.ts'
import {
  IconBack,
  IconForward,
  IconHash,
  IconLayers,
  IconMotion,
  IconSave,
  IconSkull,
  IconText,
  IconEvents,
} from '../shared/icons.tsx'
import { MenuBar, type MenuDef } from '../shared/menubar.tsx'
import { useUi } from '../shared/ui.tsx'
import { BrandMark } from './Appearance.tsx'
import { bringWindowsBack, popoutCount, resetLayout } from './dock.tsx'
import type { Page } from './navigation.ts'
import { projectName } from './projectPaths.ts'
import { hoverNotesOn, setHoverNotes } from './tooltips.ts'
import { openWalkthrough } from './Walkthrough.tsx'
import { onWindowsChanged } from './windows.ts'

/** The pages, as their tabs show them. */
const PAGES: { page: Page; label: string; title: string; icon: ReactNode }[] = [
  {
    page: 'params',
    label: 'Params & effects',
    title: 'Weapons, items, skills, bullets, params and effects',
    icon: <IconLayers />,
  },
  {
    page: 'animations',
    label: 'Animations',
    title: 'Animation events (TAE), behaviour registration and the character viewport',
    icon: <IconMotion />,
  },
  {
    page: 'enemies',
    label: 'Enemies',
    title: 'Every enemy, boss and NPC: their moves and spells, and making them yours',
    icon: <IconSkull />,
  },
  {
    page: 'events',
    label: 'Events',
    title:
      'The game’s event scripts (EMEVD): items given, flags, enemies brought in, boss fights, and events of your own',
    icon: <IconEvents />,
  },
  {
    page: 'text',
    label: 'Text',
    title: 'Game text: names, descriptions, dialogue and menus, in every language',
    icon: <IconText />,
  },
]

export function TopBar({
  project,
  page,
  onPage,
  canBack,
  canForward,
  onGo,
  dirty,
  isDirty,
  onSave,
  onReload,
  onPlay,
  reloadOnSave,
  onReloadOnSave,
  onLookup,
  onAppearance,
  onAbout,
  onClose,
}: {
  project: ProjectSummary
  page: Page
  onPage: (page: Page) => void
  canBack: boolean
  canForward: boolean
  onGo: (step: -1 | 1) => void
  dirty: DirtyState
  isDirty: boolean
  onSave: () => void
  onReload: () => void
  /** Saves and starts the game with the mod (me3, offline, its own save). */
  onPlay: () => void
  reloadOnSave: boolean
  onReloadOnSave: (on: boolean) => void
  onLookup: () => void
  onAppearance: () => void
  onAbout: () => void
  onClose: () => void
}) {
  const ui = useUi()
  // The game's state for reloading in it (F5), read as the File menu opens.
  const [game, setGame] = useState<GameLinkStatus | null>(null)
  const [notes, setNotes] = useState(hoverNotesOn)
  // Windows popping out or back change what View offers.
  const [, setTick] = useState(0)
  useEffect(() => onWindowsChanged(() => setTick((t) => t + 1)), [])
  const windows = popoutCount()
  const pageName = PAGES.find((p) => p.page === page)?.label ?? ''
  const gameState = !game
    ? 'Checking the game…'
    : !game.running
      ? 'Elden Ring isn’t running.'
      : (game.problem ?? 'Elden Ring is running with a character loaded.')

  const menus: MenuDef[] = [
    {
      label: 'File',
      onOpen: () =>
        call('game:status', undefined)
          .then(setGame)
          .catch(() => setGame(null)),
      items: [
        { label: 'Save to project', shortcut: 'Ctrl+S', run: onSave, disabled: !isDirty },
        { label: 'Save and play in game', run: onPlay, disabled: !!game?.running },
        { label: 'Save and reload in game', shortcut: 'F5', run: onReload },
        { label: 'Reload in game after every save', run: () => onReloadOnSave(!reloadOnSave), checked: reloadOnSave },
        null,
        { label: 'Close project', run: onClose },
      ],
      note: (
        <span title="Spellforge asks the game to reload the player’s model the way DS Anim Studio does: it patches one instruction in the running game, until the game closes.">
          <b>{gameState}</b> Play starts it through me3, offline, on its own save (Spellforge.sl2). Reloading needs the
          game offline with EAC off (ModEngine 2 or me3); a file that’s new since the game started needs one restart
          under me3.
        </span>
      ),
    },
    {
      label: 'View',
      items: [
        { label: 'Back', shortcut: 'Alt+Left', run: () => onGo(-1), disabled: !canBack },
        { label: 'Forward', shortcut: 'Alt+Right', run: () => onGo(1), disabled: !canForward },
        null,
        {
          label: windows ? `Bring back ${plural(windows, 'popped-out window')}` : 'Bring all windows back',
          run: bringWindowsBack,
          disabled: !windows,
        },
        { label: `Reset the ${pageName} layout`, run: () => resetLayout(page) },
        { label: 'Reset every layout', run: () => resetLayout() },
        null,
        {
          label: 'Hover notes',
          checked: notes,
          run: () => {
            setHoverNotes(!notes)
            setNotes(!notes)
          },
        },
        { label: 'Appearance…', run: onAppearance },
      ],
      note: 'Drag tabs to rearrange panels; drag one out of the app (or ↗) for a window of its own.',
    },
    {
      label: 'Tools',
      items: [{ label: 'What is this ID?', run: onLookup }],
    },
    {
      label: 'Help',
      items: [
        { label: 'Walkthrough', run: () => void openWalkthrough(ui) },
        null,
        { label: 'About Spellforge', run: onAbout },
      ],
    },
  ]

  return (
    <div className="topbar">
      <span className="brand">
        <BrandMark />
        Spellforge
      </span>
      <MenuBar menus={menus} />
      <span className="nav-buttons">
        <button
          className="ghost square"
          disabled={!canBack}
          onClick={() => onGo(-1)}
          title="Back (Alt+Left, or the mouse's back button)"
        >
          <IconBack />
        </button>
        <button className="ghost square" disabled={!canForward} onClick={() => onGo(1)} title="Forward (Alt+Right)">
          <IconForward />
        </button>
      </span>
      <div className="page-tabs" role="tablist">
        {PAGES.map((p) => (
          <button
            key={p.page}
            role="tab"
            aria-selected={page === p.page}
            className={page === p.page ? 'active' : ''}
            onClick={() => onPage(p.page)}
            title={p.title}
          >
            {p.icon}
            <span className="seg-label">{p.label}</span>
          </button>
        ))}
      </div>
      <span className="grow" />
      <span className="project-chip" title={project.modDir}>
        <span className="project-name ellipsis">{projectName(project.modDir)}</span>
        <span className="project-path ellipsis">{project.modDir}</span>
      </span>
      {isDirty && (
        <span
          className="unsaved"
          title={[dirty.regulation ? 'regulation.bin' : '', ...dirty.bundles].filter(Boolean).join('\n')}
        >
          <span className="dirty-dot" /> Unsaved
        </span>
      )}
      <button
        className="primary"
        disabled={!isDirty}
        onClick={onSave}
        title="Write changes into the project folder (Ctrl+S)"
      >
        <IconSave />
        Save
      </button>
      <button
        className="ghost square"
        onClick={onLookup}
        title="What is this ID? Look up any number: event flags, rows, text, icons, effects"
      >
        <IconHash />
      </button>
    </div>
  )
}
