/**
 * Spellforge's windows: the main one and the panels popped out into their
 * own windows (dockview popouts). All of them run this one page's code, so
 * state is shared; what differs is the document. This module keeps track of
 * them so that:
 *
 *   - keyboard shortcuts work in whichever window has focus,
 *   - dialogs, toasts and confirmations open in the window being used,
 *   - popouts get the same theme (CSS variables live on <html>),
 *   - code that measures or observes an element uses that element's window.
 */
import { useEffect, useState } from 'react'

const popouts = new Set<Window>()
let active: Window = window
const listeners = new Set<() => void>()
const keyHandlers = new Set<(e: KeyboardEvent) => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** The main window and every open popout. */
export function appWindows(): Window[] {
  return [window, ...[...popouts].filter((w) => !w.closed)]
}

/** The window the user last clicked or focused (where dialogs should open). */
export function activeWindow(): Window {
  return active.closed ? window : active
}

/** Called when anything about the set of windows or the dock layout changes. */
export function onWindowsChanged(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** Panels moved (popped out, docked back, rearranged): code bound to a window re-binds. */
export function notifyLayoutMoved(): void {
  emit()
}

const windowListeners: { type: string; handler: (e: Event) => void }[] = []

function track(w: Window): void {
  const mark = () => {
    active = w
  }
  w.addEventListener('focus', mark)
  w.addEventListener('pointerdown', mark, true)
  w.addEventListener('keydown', (e) => keyHandlers.forEach((h) => h(e)))
  for (const l of windowListeners) w.addEventListener(l.type, l.handler, true)
}
track(window)

/** Listens (capturing) for an event in every app window, present and future. */
export function onAnyWindow(type: string, handler: (e: Event) => void): () => void {
  const entry = { type, handler }
  windowListeners.push(entry)
  for (const w of appWindows()) w.addEventListener(type, handler, true)
  return () => {
    windowListeners.splice(windowListeners.indexOf(entry), 1)
    for (const w of appWindows()) w.removeEventListener(type, handler, true)
  }
}

/** A popout window opened (from dockview's onDidOpen). */
export function addPopoutWindow(w: Window): void {
  // The window first holds a blank document, then loads the popout page:
  // copy the theme once that page is there (and again now, harmlessly).
  syncAppearance(w)
  if (popouts.has(w)) return
  popouts.add(w)
  track(w)
  w.addEventListener('load', () => syncAppearance(w))
  w.addEventListener('beforeunload', () => {
    popouts.delete(w)
    if (active === w) active = window
    emit()
  })
  emit()
}

/* ------------------------------- appearance ------------------------------ */

// The theme writes CSS variables (and attributes) on <html>; copy them over.
function syncAppearance(w: Window): void {
  try {
    const from = document.documentElement
    const to = w.document.documentElement
    to.setAttribute('style', from.getAttribute('style') ?? '')
    for (const a of Array.from(from.attributes)) if (a.name !== 'style') to.setAttribute(a.name, a.value)
    to.lang = from.lang
    w.document.body.className = document.body.className
    w.document.title = document.title
  } catch {
    /* the window is closing */
  }
}
new MutationObserver(() => appWindows().forEach((w) => w !== window && syncAppearance(w))).observe(
  document.documentElement,
  { attributes: true },
)

/* -------------------------------- keyboard ------------------------------- */

/** Listens to keydown in every app window (shortcuts follow the focused window). */
export function useAppKeydown(handler: (e: KeyboardEvent) => void): void {
  useEffect(() => {
    keyHandlers.add(handler)
    return () => {
      keyHandlers.delete(handler)
    }
  })
}

/** The document an event happened in. */
export function eventDocument(e: Event): Document {
  const t = e.target as unknown
  if (!t || typeof t !== 'object') return document
  if ('nodeType' in t) return (t as Node).nodeType === 9 ? (t as Document) : ((t as Node).ownerDocument ?? document)
  if ('document' in t) return (t as Window).document
  return document
}

/** Whether an event happened in the main window (not in a popout). */
export function inMainWindow(e: Event): boolean {
  return eventDocument(e) === document
}

/* --------------------------------- elements ------------------------------ */

/** The window currently showing an element (a popout's, after the panel moved there). */
export function windowOf(el: Element | null | undefined): typeof window {
  return (el?.ownerDocument?.defaultView ?? window) as typeof window
}

/**
 * The window an element is shown in, kept current as panels move between
 * windows: effects that create observers can depend on it and re-create
 * them in the right window.
 */
export function useWindowOf(ref: { current: Element | null }): Window {
  const [w, setW] = useState<Window>(window)
  useEffect(() => {
    const check = () => setW(windowOf(ref.current))
    check()
    return onWindowsChanged(check)
  }, [])
  return w
}

/** Asks for confirmation in the window being used. */
export function confirmHere(message: string): boolean {
  return activeWindow().confirm(message)
}
