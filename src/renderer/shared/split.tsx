/**
 * Resizable columns inside a panel (the param list beside its rows, the
 * field-name column). While dragging, only a CSS variable on the container
 * changes, so nothing re-renders and the drag stays smooth; the size is
 * saved when the drag ends. Sizes are only limited by the room available.
 */
import { useCallback, useState, type CSSProperties, type RefObject } from 'react'
import { clamp } from '../lib/math.ts'
import { readPref, writePref } from '../lib/storage.ts'

/** A size remembered between sessions (when storage is available). */
export function usePersistentSize(key: string, initial: number, min = 0): [number, (v: number) => void] {
  const [size, setSize] = useState<number>(() => {
    // A saved list of widths counts by its first.
    const saved = readPref<unknown>(key, null)
    const n = Array.isArray(saved) ? saved[0] : saved
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(min, n) : initial
  })
  const commit = useCallback(
    (v: number) => {
      setSize(v)
      writePref(key, v)
    },
    [key],
  )
  return [size, commit]
}

/**
 * A vertical drag handle. `target` holds the CSS variable `cssVar` (in px)
 * that the layout reads; `room` is how much space the other side needs.
 */
export function SplitHandle({
  target,
  cssVar,
  value,
  min,
  room = 160,
  onCommit,
  style,
  className = 'splitter',
}: {
  target: RefObject<HTMLElement | null>
  cssVar: string
  value: number
  min: number
  room?: number
  onCommit: (v: number) => void
  style?: CSSProperties
  className?: string
}) {
  return (
    <div
      className={className}
      style={style}
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onPointerDown={(e) => {
        const el = e.currentTarget
        const box = target.current
        if (!box) return
        try {
          el.setPointerCapture(e.pointerId)
        } catch {
          /* synthetic events */
        }
        const start = e.clientX
        const max = Math.max(min, box.clientWidth - room)
        let next = value
        let frame = 0
        const move = (ev: PointerEvent) => {
          next = clamp(value + ev.clientX - start, min, max)
          if (frame) return
          // One style write per frame.
          frame = (el.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
            frame = 0
            box.style.setProperty(cssVar, `${next}px`)
          })
        }
        const up = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', up)
          el.removeEventListener('pointercancel', up)
          el.classList.remove('active')
          box.style.setProperty(cssVar, `${next}px`)
          onCommit(next)
        }
        el.classList.add('active')
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
        el.addEventListener('pointercancel', up)
      }}
    />
  )
}
