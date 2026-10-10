/**
 * The menu bar (File, View, Tools, Help), laid out the way desktop editors
 * lay theirs out: a title opens its menu; while one is open, pointing at
 * another title opens that one; arrow keys move between titles and items,
 * Enter runs an item, Escape or a press elsewhere closes.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { onAnyWindow } from '../app/windows.ts'

/** One command: its name, its shortcut, and what it does. A `checked` command is a switch. */
export interface MenuCommand {
  label: string
  shortcut?: string
  run: () => void
  disabled?: boolean
  checked?: boolean
}

export interface MenuDef {
  label: string
  /** The commands; null draws a separator. */
  items: (MenuCommand | null)[]
  /** A line under the commands (a status), read as the menu opens. */
  note?: ReactNode
  /** Called as the menu opens. */
  onOpen?: () => void
}

export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const [active, setActive] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    return onAnyWindow('pointerdown', (e) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    })
  }, [open])

  const openMenu = (i: number | null) => {
    if (i !== null && i !== open) menus[i].onOpen?.()
    setOpen(i)
    setActive(-1)
  }
  const commands = open === null ? [] : menus[open].items
  const run = (c: MenuCommand) => {
    if (c.disabled) return
    setOpen(null)
    c.run()
  }
  /** The next enabled command from `from`, going `dir` (wrapping). */
  const step = (from: number, dir: 1 | -1) => {
    for (let k = 1; k <= commands.length; k++) {
      const i = (from + dir * k + commands.length * 2) % commands.length
      const c = commands[i]
      if (c && !c.disabled) return i
    }
    return from
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (open === null) return
    const key = e.key
    const current = active >= 0 ? commands[active] : null
    if (key === 'Escape') setOpen(null)
    else if (key === 'ArrowRight') openMenu((open + 1) % menus.length)
    else if (key === 'ArrowLeft') openMenu((open - 1 + menus.length) % menus.length)
    else if (key === 'ArrowDown') setActive(step(active, 1))
    else if (key === 'ArrowUp') setActive(step(active < 0 ? 0 : active, -1))
    else if (key === 'Enter' && current) run(current)
    else return
    e.preventDefault()
  }

  return (
    <div className="menubar" role="menubar" ref={ref} onKeyDown={onKeyDown}>
      {menus.map((m, i) => (
        <span key={m.label} className="menubar-anchor">
          <button
            className={`menubar-title${open === i ? ' open' : ''}`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            onClick={() => openMenu(open === i ? null : i)}
            onPointerEnter={() => open !== null && open !== i && openMenu(i)}
          >
            {m.label}
          </button>
          {open === i && (
            <div className="menu menubar-menu" role="menu">
              {m.items.map((c, k) =>
                c ? (
                  <button
                    key={c.label}
                    role={c.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={c.checked}
                    className={`menubar-item${k === active ? ' active' : ''}`}
                    disabled={c.disabled}
                    onPointerEnter={() => setActive(k)}
                    onClick={() => run(c)}
                  >
                    <span className="menubar-check">{c.checked ? '✓' : ''}</span>
                    <span className="grow">{c.label}</span>
                    {c.shortcut && <span className="menubar-shortcut">{c.shortcut}</span>}
                  </button>
                ) : (
                  <div key={`sep${k}`} className="menu-sep" />
                ),
              )}
              {m.note && <div className="menu-note">{m.note}</div>}
            </div>
          )}
        </span>
      ))}
    </div>
  )
}
