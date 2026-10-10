/**
 * Where the user has been, for Back and Forward (the top bar's arrows,
 * Alt+Left / Alt+Right and the mouse's back and forward buttons, in every
 * window), and where the project was left: the main process keeps it
 * (crash-proof), so the project opens there next time.
 */
import { useEffect, useRef, useState } from 'react'
import type { AnimPlace } from '../animations/useAnimationsPage.ts'
import type { EnemiesPlace } from '../enemies/useEnemiesPage.ts'
import type { EventsPlace } from '../events/useEventsPage.ts'
import { useLatest } from '../lib/hooks.ts'
import type { RowRef, Selection } from '../params/pageContext.ts'
import { call } from '../lib/ipc.ts'
import type { TextPlace } from '../text/useTextPage.ts'
import { onAnyWindow, useAppKeydown } from './windows.ts'

export type Page = 'params' | 'animations' | 'enemies' | 'events' | 'text'

/** Somewhere the user has been, for Back and Forward. */
export type Place =
  | { page: 'params'; root: RowRef | null; selection: Selection | null }
  | ({ page: 'animations' } & AnimPlace)
  | ({ page: 'enemies' } & EnemiesPlace)
  | ({ page: 'events' } & EventsPlace)
  | ({ page: 'text' } & TextPlace)

/** The same place, whatever event is picked in it. */
function samePlace(a: Place, b: Place): boolean {
  const spot = (p: Place) => JSON.stringify({ ...p, event: undefined, weapon: undefined })
  return spot(a) === spot(b)
}

/** A page with nothing picked on it yet. */
export function startOf(page: Page): Place {
  return page === 'params'
    ? { page: 'params', root: null, selection: null }
    : page === 'animations'
      ? { page: 'animations', category: null, animation: null }
      : page === 'enemies'
        ? { page: 'enemies', chr: null, move: null }
        : page === 'events'
          ? { page: 'events', file: null, event: null }
          : { page: 'text', lang: '', rel: null, file: null, id: null }
}

/**
 * The places visited: `visit` records one as the user goes there (the pages
 * report where they are), and Back, Forward or reopening the project goes to
 * one through `show`, which puts the pages there. While it does, the places
 * the pages report on the way don't add steps.
 */
export function useNavigation(modDir: string, show: (p: Place) => void) {
  const history = useRef<{ list: Place[]; i: number }>({ list: [startOf('params')], i: 0 })
  /** Where in the history we are, for the arrows (the list itself changes without a render). */
  const [position, setPosition] = useState({ i: 0, length: 1 })
  const moved = () => setPosition({ i: history.current.i, length: history.current.list.length })
  const restoring = useRef(false)
  /** The last place seen on each page (where a page switch returns to). */
  const lastOf = useRef<Partial<Record<Page, Place>>>({ params: startOf('params') })

  /** Where the user was in this project, kept by the main process so it opens there next time. */
  const placeTimer = useRef<number | null>(null)
  const remember = (p: Place) => {
    if (placeTimer.current) window.clearTimeout(placeTimer.current)
    placeTimer.current = window.setTimeout(() => {
      call('place:set', { modDir, place: p }).catch(() => {})
    }, 300)
  }

  /** The user went somewhere. `detail`: the same place, more exactly (an event picked), not a new step. */
  const visit = (p: Place, detail = false) => {
    lastOf.current[p.page] = p
    remember(p)
    const h = history.current
    // The same place, more exactly (an event picked): update that step, don't add one.
    if (h.list[h.i] && samePlace(h.list[h.i], p)) {
      h.list[h.i] = p
      return
    }
    if (detail || restoring.current) return
    h.list = [...h.list.slice(0, h.i + 1), p].slice(-200)
    h.i = h.list.length - 1
    moved()
  }

  /** Shows a place (Back, Forward, the place the project was left at). */
  const goTo = (p: Place) => {
    restoring.current = true
    lastOf.current[p.page] = p
    remember(p)
    show(p)
    window.setTimeout(() => {
      restoring.current = false
    }, 50)
  }

  const go = (step: -1 | 1) => {
    const h = history.current
    const j = h.i + step
    if (j < 0 || j >= h.list.length) return
    h.i = j
    moved()
    goTo(h.list[j])
  }

  // Opened again: back where the user left off, if what was open is still there.
  useEffect(() => {
    ;(async () => {
      const p = (await call('place:get', { modDir }).catch(() => null)) as Place | null
      if (!p?.page) return
      if (p.page === 'params' && p.selection) {
        try {
          if (p.selection.kind === 'row') await call('row:get', { param: p.selection.param, id: p.selection.id })
          else await call('effect:get', { id: p.selection.id })
        } catch {
          return
        }
      }
      history.current = { list: [p], i: 0 }
      moved()
      goTo(p)
    })()
  }, [])

  // The mouse's back and forward buttons, and Alt+Left / Alt+Right, in every window.
  const goRef = useLatest(go)
  useEffect(
    () =>
      onAnyWindow('mouseup', (e) => {
        const b = (e as MouseEvent).button
        if (b === 3 || b === 4) {
          e.preventDefault()
          goRef.current(b === 3 ? -1 : 1)
        }
      }),
    [goRef],
  )
  useAppKeydown((e) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      goRef.current(e.key === 'ArrowLeft' ? -1 : 1)
    }
  })

  return {
    visit,
    go,
    canBack: position.i > 0,
    canForward: position.i < position.length - 1,
    /** The last place seen on a page (where switching to it returns to). */
    lastPlaceOf: (page: Page) => lastOf.current[page],
  }
}
