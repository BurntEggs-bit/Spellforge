/** Small shared UI pieces: toasts, a busy overlay, state badges, swatches. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ColorValue, ProjectState } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { clearOnProjectChange } from '../lib/projectCaches.ts'
import { cssColor, intensity } from '../lib/color.ts'
import { activeWindow, windowOf } from '../app/windows.ts'
import { errorMessage } from '../../shared/errors.ts'

/**
 * Renders a dialog (or toast) in the window the user is working in: a
 * panel popped out to another monitor opens its dialogs there, not on the
 * main window.
 */
export function InActiveWindow({ children }: { children: ReactNode }) {
  const [doc] = useState(() => activeWindow().document)
  return createPortal(children, doc.body)
}

export interface UiApi {
  /** A message for a while in the window being used (one at a time: a new one replaces it). */
  toast: (message: string, isError?: boolean) => void
  /** A thrown value as an error message. */
  error: (e: unknown) => void
  /** Runs a task behind a busy overlay and reports any error as a toast. */
  run: <T>(label: string, task: () => Promise<T>) => Promise<T | undefined>
}

const UiContext = createContext<UiApi | null>(null)

export function useUi(): UiApi {
  const ui = useContext(UiContext)
  if (!ui) throw new Error('useUi outside UiProvider')
  return ui
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; isError: boolean; doc: Document } | null>(null)
  const [busy, setBusy] = useState<{ label: string; doc: Document } | null>(null)

  // Long enough to read (longer messages stay longer), and kept while the pointer is on it.
  const toastTimer = useRef(0)
  const hideToastLater = useCallback((message: string, ms: number) => {
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast((t) => (t?.message === message ? null : t)), ms)
  }, [])
  const show = useCallback(
    (message: string, isError = false) => {
      setToast({ message, isError, doc: activeWindow().document })
      const words = message.split(/\s+/).filter(Boolean).length
      hideToastLater(message, Math.min(20000, Math.max(isError ? 9000 : 4000, 2000 + words * 320)))
    },
    [hideToastLater],
  )

  const run = useCallback(
    async <T,>(label: string, task: () => Promise<T>) => {
      // Only tasks that take a moment show the overlay: a quick edit would just flash it.
      const doc = activeWindow().document
      const timer = window.setTimeout(() => setBusy({ label, doc }), 250)
      try {
        return await task()
      } catch (err) {
        show(errorMessage(err), true)
        return undefined
      } finally {
        window.clearTimeout(timer)
        setBusy(null)
      }
    },
    [show],
  )

  // One object for the provider's life: consumers re-render for their own state, not for a toast.
  const api = useMemo<UiApi>(() => ({ toast: show, error: (e) => show(errorMessage(e), true), run }), [show, run])

  return (
    <UiContext.Provider value={api}>
      {children}
      {busy &&
        createPortal(
          <div className="busy" role="status" aria-live="polite">
            <div className="busy-card">{busy.label}…</div>
          </div>,
          busy.doc.body,
        )}
      {toast &&
        createPortal(
          <div
            className={`toast${toast.isError ? ' err' : ''}`}
            onClick={() => setToast(null)}
            onMouseEnter={() => window.clearTimeout(toastTimer.current)}
            onMouseLeave={() => hideToastLater(toast.message, 2500)}
          >
            {toast.message}
          </div>,
          toast.doc.body,
        )}
    </UiContext.Provider>
  )
}

/** Puts text on the clipboard (the page's own API, else a hidden text box). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

/**
 * A row id that copies itself when clicked, for pasting into another row's
 * field (a shop's Reference ID). Never shortened, unlike the name beside it.
 */
export function CopyId({ id }: { id: number }) {
  const ui = useUi()
  return (
    <button
      type="button"
      className="copy-id"
      title={`Copy ${id}`}
      onClick={(e) => {
        e.stopPropagation()
        void copyText(String(id)).then(() => ui.toast(`Copied ${id}`))
      }}
    >
      {id}
    </button>
  )
}

export function StateBadge({ state }: { state: ProjectState }) {
  if (!state) return null
  return <span className={`badge ${state}`}>{state === 'added' ? 'new' : 'edited'}</span>
}

export function Swatch({ color, wide }: { color: ColorValue | null; wide?: boolean }) {
  if (!color) return <span className={`swatch${wide ? ' wide' : ''}`} title="No color" />
  if (color.kind === 'static') {
    const i = intensity(color.rgba)
    return (
      <span
        className={`swatch${wide ? ' wide' : ''}`}
        title={`rgba ${color.rgba.map((v) => v.toFixed(3)).join(', ')} — brightness ${i.toFixed(3)}${i > 1 ? ' (HDR)' : ''}
Shown at full brightness so the hue is visible.`}
      >
        <span style={{ background: cssColor(color.rgba) }} />
      </span>
    )
  }
  const stops = color.stops.map((s) => `${cssColor(s.rgba)} ${(s.t * 100).toFixed(0)}%`).join(', ')
  return (
    <span className={`swatch wide`} title={`Animated color, ${color.stops.length} keyframes`}>
      <span style={{ background: `linear-gradient(90deg, ${stops})` }} />
    </span>
  )
}

/* ------------------------------ thumbnails ------------------------------- */
const iconCache = new Map<string, Promise<string | null>>()
clearOnProjectChange(() => iconCache.clear())

function loadIcon(kind: string, id: number, size: number): Promise<string | null> {
  const key = `${kind}:${id}:${size}`
  let p = iconCache.get(key)
  if (!p) {
    p = call('icon:get', { kind, id, size }).catch(() => null)
    iconCache.set(key, p)
  }
  return p
}

/**
 * One of the game's menu icons (an item's, a status effect's, a map icon) by
 * its id, as the game shows it; loaded once it scrolls into view.
 */
export function GameIcon({ kind, id, size = 48, title }: { kind: string; id: number; size?: number; title?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [url, setUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    setUrl(undefined)
    const win = windowOf(el)
    // Sharp on high-DPI screens; the game's icons are 160 px.
    const px = Math.min(160, Math.ceil(size * (win.devicePixelRatio || 1)))
    const io = new win.IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      loadIcon(kind, id, px).then((u) => live && setUrl(u))
    })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [kind, id, size])

  return (
    <span
      ref={ref}
      className="game-icon"
      style={{ width: size, height: size }}
      title={title ?? (url === null ? `No ${kind.toLowerCase()} icon ${id} in the game` : `${kind} icon ${id}`)}
    >
      {url ? <img src={url} alt="" draggable={false} /> : url === null ? <span>?</span> : null}
    </span>
  )
}

const thumbCache = new Map<string, Promise<string | null>>()
clearOnProjectChange(() => thumbCache.clear())

function loadThumb(resource: 'texture' | 'model', id: number, textureType?: string): Promise<string | null> {
  const key = `${resource}:${id}:${textureType ?? ''}`
  let p = thumbCache.get(key)
  if (!p) {
    p = call('assets:thumb', { resource, id, textureType }).catch(() => null)
    thumbCache.set(key, p)
  }
  return p
}

/** Texture or model thumbnail, loaded only once it scrolls into view. */
export function Thumb({
  resource,
  id,
  textureType,
  size = 56,
}: {
  resource: 'texture' | 'model'
  id: number
  textureType?: string
  size?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let live = true
    // The observer of the element's own window: thumbnails in a popped-out panel load too.
    const io = new (windowOf(el).IntersectionObserver)((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      loadThumb(resource, id, textureType).then((u) => live && setUrl(u))
    })
    io.observe(el)
    return () => {
      live = false
      io.disconnect()
    }
  }, [resource, id, textureType])

  return (
    <div ref={ref} className="thumb" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span>{url === null ? (resource === 'model' ? 'MDL' : '—') : ''}</span>
      )}
    </div>
  )
}
