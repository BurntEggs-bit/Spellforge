/**
 * Dragging a library model or texture onto a slot. It's a pointer drag, not
 * the browser's drag and drop: during that, Windows holds the mouse wheel
 * back, so a slot scrolled out of view couldn't be reached. Here the wheel
 * scrolls whatever is under the pointer as usual, and a box that scrolls also
 * moves by itself while the pointer is near its top or bottom edge.
 *
 * Slots take drops through `addDropTarget`; a library tile starts a drag from
 * its pointerdown with `startAssetDrag`. A press that doesn't move is left to
 * the tile's click, and Esc cancels a drag.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AssetEntry } from '../../shared/api.ts'

/** A place a dragged asset can go (a slot). */
export interface DropTarget {
  accepts: (asset: AssetEntry) => boolean
  drop: (asset: AssetEntry) => void
  /** Shows whether an asset it accepts is over it. */
  setOver: (over: boolean) => void
}

/** How far a press moves (px) before it's a drag; less, and it's a click. */
const DRAG_DISTANCE = 4
/** How near a scrolling box's top or bottom (px) the pointer starts it scrolling, inside or just past the edge. */
const EDGE = 40
/** The edge scroll's fastest speed, at the edge itself (px per frame). */
const EDGE_SPEED = 16
/** Where the dragged tile's copy sits from the pointer (px). */
const GHOST_OFFSET = 10

const targets = new Map<Element, DropTarget>()

/** Makes `el` take dropped assets; returns what undoes it. */
export function addDropTarget(el: Element, target: DropTarget): () => void {
  targets.set(el, target)
  return () => {
    if (targets.get(el) === target) targets.delete(el)
  }
}

/** The drop target at a point, if it takes the asset. */
function targetAt(doc: Document, x: number, y: number, asset: AssetEntry): DropTarget | null {
  for (let n = doc.elementFromPoint(x, y); n; n = n.parentElement) {
    const t = targets.get(n)
    if (t) return t.accepts(asset) ? t : null
  }
  return null
}

/** The innermost box at a point that scrolls up and down. */
function scrollBoxAt(doc: Document, x: number, y: number): Element | null {
  const win = doc.defaultView ?? window
  for (let n = doc.elementFromPoint(x, y); n; n = n.parentElement) {
    if (n.scrollHeight <= n.clientHeight + 1) continue
    const overflow = win.getComputedStyle(n).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return n
  }
  return null
}

/** How far to scroll `box` this frame for the pointer at (x, y): faster the nearer its edge, 0 when it can't go on. */
function edgeStep(box: Element, x: number, y: number): number {
  const r = box.getBoundingClientRect()
  if (x < r.left || x > r.right) return 0
  const speed = (fromEdge: number) => Math.ceil(EDGE_SPEED * (1 - Math.max(0, fromEdge) / EDGE))
  const fromTop = y - r.top
  const fromBottom = r.bottom - y
  if (Math.abs(fromTop) < EDGE && box.scrollTop > 0) return -speed(fromTop)
  if (Math.abs(fromBottom) < EDGE && box.scrollTop + box.clientHeight < box.scrollHeight - 1) return speed(fromBottom)
  return 0
}

/** A see-through copy of the tile that follows the pointer (it never takes the pointer itself). */
function makeGhost(tile: HTMLElement): HTMLElement {
  const doc = tile.ownerDocument
  const ghost = doc.createElement('div')
  ghost.className = 'asset-ghost'
  ghost.style.width = `${tile.offsetWidth}px`
  ghost.appendChild(tile.cloneNode(true))
  doc.body.appendChild(ghost)
  return ghost
}

/** Swallows the click that releasing a drag makes: a drag isn't a click. */
function swallowNextClick(win: Window, released: boolean): void {
  const swallow = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
  }
  // The click comes straight after the release, in the same task; stop waiting once that has passed.
  const stop = () => win.setTimeout(() => win.removeEventListener('click', swallow, true), 0)
  win.addEventListener('click', swallow, { capture: true, once: true })
  if (released) stop()
  else win.addEventListener('pointerup', stop, { capture: true, once: true })
}

/** Starts dragging `asset` from its library tile: call it from the tile's pointerdown. */
export function startAssetDrag(e: ReactPointerEvent<HTMLElement>, asset: AssetEntry): void {
  if (e.button !== 0) return
  const tile = e.currentTarget
  const doc = tile.ownerDocument
  const win = doc.defaultView ?? window
  const pointerId = e.pointerId
  const start = { x: e.clientX, y: e.clientY }
  let x = start.x
  let y = start.y
  let ghost: HTMLElement | null = null
  let over: DropTarget | null = null
  let lastBox: Element | null = null
  let frame = 0
  // The tile keeps the pointer, so nothing else lights up on hover while dragging. The wheel isn't a pointer
  // event and still scrolls what's under the pointer.
  try {
    tile.setPointerCapture(pointerId)
  } catch {
    /* synthetic events */
  }

  const retarget = () => {
    const next = targetAt(doc, x, y, asset)
    if (next === over) return
    over?.setOver(false)
    next?.setOver(true)
    over = next
  }
  // A step of edge scrolling, then one each frame while the pointer stays near the edge. Just past the
  // edge (over a panel's tab, say) the box last under the pointer goes on scrolling.
  const scrollStep = () => {
    frame = 0
    const box = scrollBoxAt(doc, x, y) ?? lastBox
    lastBox = box
    const step = box ? edgeStep(box, x, y) : 0
    if (!box || !step) return
    box.scrollTop += step
    frame = win.requestAnimationFrame(scrollStep)
  }
  const move = (m: PointerEvent) => {
    if (m.pointerId !== pointerId) return
    x = m.clientX
    y = m.clientY
    if (!ghost) {
      if (Math.hypot(x - start.x, y - start.y) < DRAG_DISTANCE) return
      ghost = makeGhost(tile)
      doc.documentElement.classList.add('asset-dragging')
    }
    ghost.style.transform = `translate(${x + GHOST_OFFSET}px, ${y + GHOST_OFFSET}px)`
    retarget()
    if (!frame) scrollStep()
  }
  // The wheel or the edge scrolled: what's under the pointer has changed.
  const scrolled = () => {
    if (ghost) retarget()
  }
  const finish = (drop: boolean, released: boolean) => {
    win.removeEventListener('pointermove', move, true)
    win.removeEventListener('pointerup', up, true)
    win.removeEventListener('pointercancel', cancel, true)
    doc.removeEventListener('scroll', scrolled, true)
    doc.removeEventListener('keydown', key, true)
    if (frame) win.cancelAnimationFrame(frame)
    if (!ghost) return
    ghost.remove()
    doc.documentElement.classList.remove('asset-dragging')
    over?.setOver(false)
    if (drop) over?.drop(asset)
    swallowNextClick(win, released)
  }
  const up = (u: PointerEvent) => {
    if (u.pointerId === pointerId) finish(true, true)
  }
  const cancel = (c: PointerEvent) => {
    if (c.pointerId === pointerId) finish(false, true)
  }
  const key = (k: KeyboardEvent) => {
    if (k.key !== 'Escape' || !ghost) return
    k.preventDefault()
    k.stopPropagation()
    finish(false, false)
  }
  // On the window rather than the tile, so the drag ends properly even if the tile is redrawn under it.
  win.addEventListener('pointermove', move, true)
  win.addEventListener('pointerup', up, true)
  win.addEventListener('pointercancel', cancel, true)
  doc.addEventListener('scroll', scrolled, true)
  doc.addEventListener('keydown', key, true)
}
