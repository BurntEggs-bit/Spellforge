/**
 * The render loop of a 3D view that may sit in a popped-out window.
 *
 *  - Frames come from the window showing the canvas right now: a popped-out
 *    viewport keeps playing while the main window is minimised or behind.
 *  - The drawing buffer follows the element's size, but while a panel edge
 *    is being dragged it is re-allocated at most every SETTLE_MS (the canvas
 *    stretches in between), which keeps the drag smooth.
 *  - Nothing is drawn while the element has no size (a hidden tab or page).
 *  - Times are this page's clock, not the window's, so moving between
 *    windows doesn't make time jump.
 */
const SETTLE_MS = 90

export interface ViewLoop {
  stop: () => void
}

export function startViewLoop(
  el: HTMLElement,
  opts: {
    /** New size in CSS pixels, and the device pixel ratio to render at. */
    resize: (width: number, height: number, pixelRatio: number) => void
    frame: (now: number) => void
  },
): ViewLoop {
  let stopped = false
  let raf = 0
  let rafWindow: Window = window
  let w = 0
  let h = 0
  let ratio = 0
  let changedAt = 0

  const loop = () => {
    if (stopped) return
    const win = el.ownerDocument.defaultView ?? window
    const now = performance.now()
    const cw = el.clientWidth
    const ch = el.clientHeight
    if (cw > 0 && ch > 0) {
      const cr = Math.min(2, win.devicePixelRatio || 1)
      if (cw !== w || ch !== h || cr !== ratio) {
        if (!changedAt) changedAt = now
        if (w === 0 || now - changedAt >= SETTLE_MS) {
          w = cw
          h = ch
          ratio = cr
          changedAt = 0
          opts.resize(w, h, ratio)
        }
      } else changedAt = 0
      opts.frame(now)
    }
    rafWindow = win
    raf = win.requestAnimationFrame(loop)
  }
  raf = window.requestAnimationFrame(loop)

  return {
    stop: () => {
      stopped = true
      try {
        rafWindow.cancelAnimationFrame(raf)
      } catch {
        /* the window closed */
      }
    },
  }
}
