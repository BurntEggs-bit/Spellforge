/**
 * Dialogs: a dimmed backdrop over the window and a box in the middle. A
 * press on the backdrop closes the dialog (a drag that ends there doesn't),
 * unless it must be answered first. Render dialogs opened from a dock panel
 * through InActiveWindow (shared/ui.tsx), so they cover the whole window.
 */
import type { CSSProperties, ReactNode } from 'react'

/** The backdrop and the dialog box, with whatever goes inside it. */
export function ModalShell({
  onClose,
  escapeCloses = false,
  className,
  style,
  children,
}: {
  /** Closes the dialog: a press on the backdrop (and Escape, with escapeCloses). Without it, the dialog must be answered. */
  onClose?: () => void
  escapeCloses?: boolean
  /** Classes beside "modal". */
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className="modal-back" onMouseDown={onClose && ((e) => e.target === e.currentTarget && onClose())}>
      <div
        className={className ? `modal ${className}` : 'modal'}
        style={style}
        onKeyDown={onClose && escapeCloses ? (e) => e.key === 'Escape' && onClose() : undefined}
      >
        {children}
      </div>
    </div>
  )
}

/** A dialog laid out as most are: a title (and anything beside it), its content, and buttons at the foot. */
export function Modal({
  title,
  headerExtra,
  closeButton = true,
  width,
  bodyClassName,
  bodyStyle,
  footer,
  children,
  ...shell
}: {
  title: ReactNode
  /** Shown in the header after the title. */
  headerExtra?: ReactNode
  /** A ✕ in the header that closes it (when there is onClose). */
  closeButton?: boolean
  /** Its width in pixels (never wider than the window). */
  width?: number
  bodyClassName?: string
  bodyStyle?: CSSProperties
  footer?: ReactNode
  children: ReactNode
} & Omit<Parameters<typeof ModalShell>[0], 'children'>) {
  const style = width ? { width: `min(${width}px, 94vw)`, ...shell.style } : shell.style
  return (
    <ModalShell {...shell} style={style}>
      <header>
        <h2 className="grow">{title}</h2>
        {headerExtra}
        {closeButton && shell.onClose && (
          <button className="ghost" onClick={shell.onClose}>
            ✕
          </button>
        )}
      </header>
      <div className={bodyClassName ? `body ${bodyClassName}` : 'body'} style={bodyStyle}>
        {children}
      </div>
      {footer && <footer>{footer}</footer>}
    </ModalShell>
  )
}
