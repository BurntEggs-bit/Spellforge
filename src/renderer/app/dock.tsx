/**
 * Dockable panels for a page (Params & effects, Animations, Enemies, Text), built on
 * dockview. Drag a tab to rearrange, split or stack panels; pop a panel out
 * into its own window (another monitor) with the header button, the tab's
 * right-click menu, or by dragging its tab outside the app; drag it back in
 * by its tab, or close the window to put it back where it was. Each page
 * remembers its layout, popped-out windows included; the top bar's Layout
 * menu resets layouts and brings every window back.
 */
import { useEffect, useMemo, useReducer, useRef, type FunctionComponent } from 'react'
import type { PopoutMoveEvent } from '../../shared/api.ts'
import {
  DockviewReact,
  DockviewDefaultTab,
  type DockviewApi,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type IDockviewPanel,
  type DockviewGroupPanel,
  type SerializedDockview,
} from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { addPopoutWindow, appWindows, notifyLayoutMoved, onAnyWindow } from './windows.ts'
import {
  LAYOUT_KEY_PREFIX,
  layoutKey,
  readPref,
  removePref,
  removePrefsStartingWith,
  writePref,
} from '../lib/storage.ts'
import { IconDockIn, IconMaximize, IconPin, IconPopout, IconRestore } from '../shared/icons.tsx'
import { useLatest } from '../lib/hooks.ts'

export interface DockPanel {
  id: string
  title: string
  component: FunctionComponent
}

/** The default layout: each panel placed relative to one placed before it. */
export interface DockPlacement {
  id: string
  ref?: string
  direction?: 'right' | 'below' | 'within'
  /** Default size of its group, in pixels. */
  width?: number
  height?: number
}

const THEME: DockviewTheme = {
  name: 'spellforge',
  className: 'dockview-theme-spellforge',
  gap: 0,
  dndOverlayMounting: 'absolute',
  dndPanelOverlay: 'group',
  dndTabIndicator: 'line',
}

/** A blank page of this app's own origin that popped-out panels are moved into. */
const POPOUT_URL = new URL('popout.html', window.location.href).toString()

/** Bumped when the default layouts change: saved layouts of an older version are replaced by the new defaults once. */
const LAYOUT_VERSION = 2

/* -------------------------------- registry ------------------------------- */

interface DockHandle {
  page: string
  api: DockviewApi
  /** The dock's element in the main window (hidden while its page isn't shown). */
  root: HTMLElement
  reset: () => void
}
const docks = new Map<string, DockHandle>()

/** Every page's popped-out windows. */
export function popoutCount(): number {
  let n = 0
  for (const d of docks.values()) n += d.api.getPopouts().length
  return n
}

/** Puts every popped-out panel back where it was in the main window. */
export function bringWindowsBack(): void {
  for (const d of docks.values()) for (const p of d.api.getPopouts()) p.window.close()
}

/** Back to the default arrangement: one page, or all of them. */
export function resetLayout(page?: string): void {
  for (const d of docks.values()) if (!page || d.page === page) d.reset()
  if (!page) removePrefsStartingWith(LAYOUT_KEY_PREFIX)
}

/** Brings a panel to the front of its group (and its window to the front, if popped out). */
export function showPanel(page: string, id: string): void {
  const d = docks.get(page)
  const panel = d?.api.getPanel(id)
  if (!panel) return
  panel.api.setActive()
  if (panel.group.api.location.type === 'popout') panel.group.api.getWindow().focus()
}

/** Widens a docked panel to at least `min` pixels if there's room (e.g. All params' two columns). */
export function ensureWidth(page: string, id: string, min: number): void {
  const panel = docks.get(page)?.api.getPanel(id)
  if (!panel || panel.group.api.location.type !== 'grid') return
  if (panel.group.api.width < min) panel.group.api.setSize({ width: min })
}

/* ------------------- docking a popout by its title bar -------------------- */

type Zone = 'center' | 'left' | 'right' | 'top' | 'bottom'
const TARGET = 34
const GAP = 6

let compass: { root: HTMLDivElement; preview: HTMLDivElement; targets: Record<Zone, HTMLDivElement> } | null = null
function compassEl() {
  if (compass) return compass
  const root = document.createElement('div')
  root.className = 'dock-compass'
  const preview = document.createElement('div')
  preview.className = 'dock-compass-preview'
  root.appendChild(preview)
  const targets = {} as Record<Zone, HTMLDivElement>
  for (const z of ['center', 'left', 'right', 'top', 'bottom'] as Zone[]) {
    const t = document.createElement('div')
    t.className = `dock-compass-target ${z}`
    root.appendChild(t)
    targets[z] = t
  }
  document.body.appendChild(root)
  compass = { root, preview, targets }
  return compass
}
function hideCompass() {
  if (compass) compass.root.style.display = 'none'
}

/** Where the cursor is over the main window: a group and which of its drop targets. */
function dropAt(
  api: DockviewApi,
  exclude: DockviewGroupPanel,
  x: number,
  y: number,
): { group: DockviewGroupPanel; zone: Zone | null; rect: DOMRect } | null {
  // By position: panel contents are drawn in a layer above the groups, not inside them.
  const inside = (r: DOMRect) => r.width > 0 && r.height > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom
  const group = api.groups.find(
    (g) =>
      g !== exclude && g.api.location.type === 'grid' && g.api.isVisible && inside(g.element.getBoundingClientRect()),
  )
  if (!group) return null
  const rect = group.element.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const step = TARGET + GAP
  const spots: Record<Zone, [number, number]> = {
    center: [cx, cy],
    left: [cx - step, cy],
    right: [cx + step, cy],
    top: [cx, cy - step],
    bottom: [cx, cy + step],
  }
  let zone: Zone | null = null
  for (const z of Object.keys(spots) as Zone[]) {
    const [sx, sy] = spots[z]
    if (Math.abs(x - sx) <= TARGET / 2 + 2 && Math.abs(y - sy) <= TARGET / 2 + 2) zone = z
  }
  return { group, zone, rect }
}

function showCompass(rect: DOMRect, zone: Zone | null) {
  const c = compassEl()
  c.root.style.display = 'block'
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const step = TARGET + GAP
  const at: Record<Zone, [number, number]> = {
    center: [cx, cy],
    left: [cx - step, cy],
    right: [cx + step, cy],
    top: [cx, cy - step],
    bottom: [cx, cy + step],
  }
  for (const z of Object.keys(at) as Zone[]) {
    const t = c.targets[z]
    t.style.left = `${at[z][0] - TARGET / 2}px`
    t.style.top = `${at[z][1] - TARGET / 2}px`
    t.classList.toggle('hot', z === zone)
  }
  if (!zone) {
    c.preview.style.display = 'none'
    return
  }
  const half = { w: rect.width / 2, h: rect.height / 2 }
  const box =
    zone === 'center'
      ? [rect.left, rect.top, rect.width, rect.height]
      : zone === 'left'
        ? [rect.left, rect.top, half.w, rect.height]
        : zone === 'right'
          ? [rect.left + half.w, rect.top, half.w, rect.height]
          : zone === 'top'
            ? [rect.left, rect.top, rect.width, half.h]
            : [rect.left, rect.top + half.h, rect.width, half.h]
  Object.assign(c.preview.style, {
    display: 'block',
    left: `${box[0]}px`,
    top: `${box[1]}px`,
    width: `${box[2]}px`,
    height: `${box[3]}px`,
  })
}

/**
 * A popped-out window dragged by its title bar over the main window shows
 * drop targets on the panel under the cursor; letting go on one docks the
 * window's panels there (in that panel's tabs, or beside it). Letting go
 * anywhere else leaves the window where it is.
 */
function handlePopoutMove(e: PopoutMoveEvent): void {
  let owner: { api: DockviewApi; root: HTMLElement; group: DockviewGroupPanel; window: Window } | null = null
  for (const d of docks.values()) {
    const pop = d.api.getPopouts().find((p) => {
      try {
        return p.window.name === e.name
      } catch {
        return false
      }
    })
    if (pop) owner = { api: d.api, root: d.root, group: pop.group, window: pop.window }
  }
  const pageShown = !!owner && owner.root.getClientRects().length > 0
  const hit = owner && pageShown && e.inside ? dropAt(owner.api, owner.group, e.x, e.y) : null
  if (e.kind === 'moving') {
    if (hit) showCompass(hit.rect, hit.zone)
    else hideCompass()
    return
  }
  hideCompass()
  if (!owner || !hit?.zone) return
  const { api, window: w } = owner
  const zone = hit.zone
  const target = hit.group
  const ids = owner.group.panels.map((p) => p.id)
  // Closing the window puts its panels back where they came from; then they move to the drop target.
  w.close()
  const started = performance.now()
  const settle = () => {
    const back = ids.map((id) => api.getPanel(id)).find(Boolean)
    if (back && back.group.api.location.type === 'grid') {
      if (back.group !== target) back.group.api.moveTo({ group: target, position: zone })
      back.api.setActive()
      return
    }
    if (performance.now() - started < 3000) window.setTimeout(settle, 30)
  }
  window.setTimeout(settle, 30)
}
window.spellforge?.onPopoutMove?.(handlePopoutMove)

/* -------------------------------- pinning -------------------------------- */

/**
 * A panel that can be pinned: while pinned it keeps showing what it shows
 * (the Inspector stays on its row while you browse). The page owns the state;
 * the panel's header shows the pin button and its tab a pin mark.
 */
export interface PanelPin {
  pinned: boolean
  /** What gets pinned, for the button's tooltip ("this row"). */
  what: string
  toggle: () => void
}
const pins = new Map<string, PanelPin>()
const pinListeners = new Set<() => void>()
const pinsChanged = () => pinListeners.forEach((f) => f())

/** Makes a panel pinnable (null: nothing to pin right now). */
export function usePanelPin(panelId: string, pin: PanelPin | null): void {
  const toggle = useLatest(pin?.toggle)
  const key = pin ? `${pin.pinned}|${pin.what}` : ''
  useEffect(() => {
    if (pin) pins.set(panelId, { pinned: pin.pinned, what: pin.what, toggle: () => toggle.current?.() })
    else pins.delete(panelId)
    pinsChanged()
  }, [panelId, key])
  useEffect(
    () => () => {
      pins.delete(panelId)
      pinsChanged()
    },
    [panelId],
  )
}

/** Re-renders when any panel's pin changes. */
function usePins(): void {
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    pinListeners.add(refresh)
    return () => {
      pinListeners.delete(refresh)
    }
  }, [])
}

function PinButton({ panelId }: { panelId: string | undefined }) {
  usePins()
  const pin = panelId ? pins.get(panelId) : undefined
  if (!pin) return null
  return (
    <button
      className={`ghost square${pin.pinned ? ' on' : ''}`}
      title={pin.pinned ? `Unpin: show what you pick again` : `Pin: keep ${pin.what} here while you browse`}
      onClick={pin.toggle}
    >
      <IconPin size={15} />
    </button>
  )
}

/** A panel's tab, with a mark while it's pinned. Tabs can't be closed: every panel stays reachable (Reset layout restores the arrangement). */
function Tab(props: IDockviewPanelHeaderProps) {
  usePins()
  const pinned = !!pins.get(props.api.id)?.pinned
  return (
    <div className={`dock-tab${pinned ? ' pinned' : ''}`}>
      <DockviewDefaultTab {...props} hideClose />
      {pinned && (
        <span className="dock-tab-pin" title="Pinned">
          <IconPin size={12} />
        </span>
      )}
    </div>
  )
}

function HeaderActions({ api, containerApi, group }: IDockviewHeaderActionsProps) {
  // Maximizing or restoring any group changes which button this one shows;
  // a different tab in front may bring its own pin.
  const [, refresh] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const a = containerApi.onDidMaximizedGroupChange(() => refresh())
    const b = api.onDidLocationChange(() => refresh())
    const c = group.api.onDidActivePanelChange(() => refresh())
    return () => {
      a.dispose()
      b.dispose()
      c.dispose()
    }
  }, [containerApi, api, group])
  const location = api.location.type
  const active = group.activePanel?.id
  if (location === 'popout') {
    return (
      <div className="dock-actions">
        <PinButton panelId={active} />
        <button
          className="ghost square"
          title="Put back into the main window (or just close this window)"
          onClick={() => api.getWindow().close()}
        >
          <IconDockIn size={15} />
        </button>
      </div>
    )
  }
  const maximized = api.isMaximized()
  return (
    <div className="dock-actions">
      <PinButton panelId={active} />
      <button
        className="ghost square"
        title={maximized ? 'Restore the layout' : 'Fill the window with this panel'}
        onClick={() => {
          if (maximized) api.exitMaximized()
          else api.maximize()
          // Panel bodies render in an overlay (renderer "always") that can keep
          // the old place after a maximize or restore: lay out again, now.
          requestAnimationFrame(() => containerApi.layout(containerApi.width, containerApi.height, true))
        }}
      >
        {maximized ? <IconRestore size={15} /> : <IconMaximize size={15} />}
      </button>
      <button
        className="ghost square"
        title="Open in its own window (move it to another monitor)"
        onClick={() => popOut(containerApi, group)}
      >
        <IconPopout size={15} />
      </button>
    </div>
  )
}

function popOut(api: DockviewApi, item: DockviewGroupPanel | IDockviewPanel, at?: { x: number; y: number }): void {
  const group = 'panels' in item ? item : item.group
  const r = group.element.getBoundingClientRect()
  const width = Math.max(420, Math.round(r.width))
  const height = Math.max(320, Math.round(r.height))
  const position = at
    ? { left: Math.round(at.x - 80), top: Math.round(at.y - 16), width, height }
    : { left: Math.round(window.screenX + r.left + 40), top: Math.round(window.screenY + r.top + 40), width, height }
  void api.addPopoutGroup(item, { popoutUrl: POPOUT_URL, position, onDidOpen: ({ window: w }) => addPopoutWindow(w) })
}

/* ------------------------------- the area -------------------------------- */

export function DockArea({
  page,
  panels,
  layout,
  className,
}: {
  page: string
  panels: DockPanel[]
  layout: DockPlacement[]
  className?: string
}) {
  const panelsRef = useLatest(panels)
  const rootRef = useRef<HTMLDivElement>(null)

  const components = useMemo(() => {
    const out: Record<string, FunctionComponent<IDockviewPanelProps>> = {}
    for (const p of panels) {
      const Body = p.component
      out[p.id] = () => (
        <div className="dock-panel" data-page={page} data-panel={p.id}>
          <Body />
        </div>
      )
    }
    return out
  }, [])

  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api
    const buildDefault = () => {
      api.clear()
      for (const step of layout) {
        const def = panelsRef.current.find((p) => p.id === step.id)
        if (!def) continue
        api.addPanel({
          id: def.id,
          component: def.id,
          title: def.title,
          position: step.ref ? { referencePanel: step.ref, direction: step.direction ?? 'right' } : undefined,
          inactive: step.direction === 'within',
        })
      }
      // Sizes after everything is placed, left to right.
      for (const step of layout) {
        const panel = api.getPanel(step.id)
        if (!panel) continue
        if (step.width) panel.group.api.setSize({ width: step.width })
        if (step.height) panel.group.api.setSize({ height: step.height })
      }
      const first = layout[0] && api.getPanel(layout[0].id)
      first?.api.setActive()
    }

    let restored = false
    try {
      const saved = readPref<{ v: number; layout: SerializedDockview } | null>(layoutKey(page), null)
      const ids = new Set(Object.keys(saved?.layout?.panels ?? {}))
      if (
        saved?.v === LAYOUT_VERSION &&
        panelsRef.current.every((p) => ids.has(p.id)) &&
        ids.size === panelsRef.current.length
      ) {
        api.fromJSON(saved.layout)
        restored = true
      }
    } catch {
      restored = false
    }
    if (!restored) buildDefault()
    // Titles follow the code, not an old saved layout.
    for (const p of panelsRef.current) api.getPanel(p.id)?.api.setTitle(p.title)

    let saveTimer = 0
    const save = () => {
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(() => writePref(layoutKey(page), { v: LAYOUT_VERSION, layout: api.toJSON() }), 400)
    }
    const registerPopouts = () => {
      for (const p of api.getPopouts()) addPopoutWindow(p.window)
    }
    api.onDidLayoutChange(() => {
      save()
      notifyLayoutMoved()
    })
    api.onDidAddPopoutGroup(() => {
      registerPopouts()
      notifyLayoutMoved()
    })
    api.onDidRemovePopoutGroup(() => notifyLayoutMoved())
    api.onDidMovePanel(() => notifyLayoutMoved())
    api.onDidPopoutGroupPositionChange(save)
    api.onDidPopoutGroupSizeChange(save)
    registerPopouts()

    // Dragging a tab (or a whole group) and letting go outside every app
    // window pops it out right there.
    let dragged: { panel?: IDockviewPanel; group?: DockviewGroupPanel } | null = null
    api.onWillDragPanel((e) => {
      dragged = { panel: e.panel }
    })
    api.onWillDragGroup((e) => {
      dragged = { group: e.group }
    })
    onAnyWindow('dragend', (ev) => {
      const e = ev as DragEvent
      const item = dragged
      dragged = null
      if (!item || e.dataTransfer?.dropEffect !== 'none') return
      if (!e.screenX && !e.screenY) return
      const inside = appWindows().some(
        (w) =>
          e.screenX >= w.screenX &&
          e.screenX < w.screenX + w.outerWidth &&
          e.screenY >= w.screenY &&
          e.screenY < w.screenY + w.outerHeight,
      )
      if (inside) return
      const target = item.panel ?? item.group
      if (!target) return
      // A tab alone in its group takes the group (dockview pops the group).
      popOut(api, item.panel && item.panel.group.panels.length === 1 ? item.panel.group : target, {
        x: e.screenX,
        y: e.screenY,
      })
    })

    docks.set(page, {
      page,
      api,
      root: rootRef.current ?? document.body,
      reset: () => {
        for (const p of api.getPopouts()) p.window.close()
        removePref(layoutKey(page))
        // Closing popouts returns their panels asynchronously; rebuild after.
        window.setTimeout(buildDefault, 0)
      },
    })
  }

  return (
    <DockviewReact
      ref={rootRef}
      className={`dock-area ${className ?? ''}`}
      components={components}
      defaultTabComponent={Tab}
      rightHeaderActionsComponent={HeaderActions}
      onReady={onReady}
      theme={THEME}
      popoutUrl={POPOUT_URL}
      disableFloatingGroups
      // Resizing the window resizes the last panel; side panels keep their width.
      proportionalLayout={false}
      defaultRenderer="always"
      getTabContextMenuItems={() => ['popout', 'maximize']}
    />
  )
}
