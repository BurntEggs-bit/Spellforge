/** A button that opens a small menu of actions, closed by a press anywhere else (in any window). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { onAnyWindow } from '../app/windows.ts'

/** One action in a menu: its label, its shortcut, a hint under it, and what it does. */
export interface MenuAction {
  label: string
  shortcut?: string
  hint?: string
  run: () => void
  disabled?: boolean
}

/** How much room there is above and below the button: the menu opens where it fits and scrolls if it's taller. */
function placement(anchor: HTMLElement): { up: boolean; max: number } {
  const win = anchor.ownerDocument.defaultView ?? window
  const r = anchor.getBoundingClientRect()
  const below = win.innerHeight - r.bottom - 8
  const above = r.top - 8
  const up = below < 320 && above > below
  return { up, max: Math.max(120, up ? above : below) }
}

export function MenuButton({
  label,
  title,
  items,
  className = 'ghost icon',
  width,
  anchorClassName,
  onOpen,
  children,
}: {
  label: ReactNode
  title?: string
  /** The actions; null draws a separator. */
  items: (MenuAction | null)[]
  /** The button's classes. */
  className?: string
  /** The menu's width in pixels (else the stylesheet's). */
  width?: number
  /** Classes beside "menu-anchor" on the wrapper, for styling one menu. */
  anchorClassName?: string
  /** Called as the menu opens (to read what it shows). */
  onOpen?: () => void
  /** Shown below the actions: options, notes. */
  children?: ReactNode
}) {
  const [open, setOpen] = useState<{ up: boolean; max: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    return onAnyWindow('pointerdown', (e) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    })
  }, [open])
  return (
    <span className={anchorClassName ? `menu-anchor ${anchorClassName}` : 'menu-anchor'} ref={ref}>
      <button
        className={className}
        title={title}
        onClick={() => {
          if (open) return setOpen(null)
          onOpen?.()
          if (ref.current) setOpen(placement(ref.current))
        }}
      >
        {label}
      </button>
      {open && (
        <div
          className={`menu${open.up ? ' up' : ''}`}
          role="menu"
          style={{ maxHeight: open.max, ...(width ? { width } : {}) }}
        >
          {items.map((it, i) =>
            it ? (
              <button
                key={it.label}
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(null)
                  it.run()
                }}
              >
                <span className="menu-item-line">
                  <span>{it.label}</span>
                  {it.shortcut && <span className="menubar-shortcut">{it.shortcut}</span>}
                </span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            ) : (
              <div key={`sep${i}`} className="menu-sep" />
            ),
          )}
          {children}
        </div>
      )}
    </span>
  )
}
