/**
 * Hover notes: rest the pointer on something for a second and a small note
 * under it shows its full name (when a list, tree or field cuts it short) and
 * its tooltip. It goes as soon as the pointer moves off it, or on a click,
 * scroll or key press. It stands in for the browser's own title tooltips, so
 * there's one compact style everywhere, in every app window. View > Hover
 * notes turns it off (the browser's tooltips come back).
 */
import { PREF_KEYS, readText, writeText } from '../lib/storage.ts'
import { eventDocument, onAnyWindow } from './windows.ts'

/** How long the pointer rests before the note shows: a second. */
const DELAY = 1000
/** Where the note sits, below and right of the pointer. */
const OFFSET_X = 12
const OFFSET_Y = 20
/** Things that are a part of the screen rather than an item (a viewer, a whole panel) get no note. */
const MAX_SUBJECT = { width: 640, height: 220 }
/** What counts as an item to explain: the closest of these from the pointer up. */
const SUBJECT =
  '[title], [data-tip], .list-item, .tree-row, .field-label, .tl-bar, .tl-label, .menu-item, .menubar-item, button, td, th, label, .ellipsis'

interface Hover {
  subject: Element
  doc: Document
  timer: number
  x: number
  y: number
  /** The element whose title was set aside (so the browser's own tooltip doesn't show too). */
  titled: { el: Element; text: string } | null
}

let hover: Hover | null = null
const notes = new WeakMap<Document, HTMLDivElement>()
let enabled = readText(PREF_KEYS.hoverNotes) !== 'off'

/** Whether hover notes are on (View > Hover notes). */
export function hoverNotesOn(): boolean {
  return enabled
}

/** Turns hover notes on or off, remembered for next time. */
export function setHoverNotes(on: boolean): void {
  enabled = on
  writeText(PREF_KEYS.hoverNotes, on ? 'on' : 'off')
  if (!on) end()
}

function noteFor(doc: Document): HTMLDivElement {
  let n = notes.get(doc)
  if (!n || !n.isConnected) {
    n = doc.createElement('div')
    n.className = 'hover-note'
    n.setAttribute('role', 'tooltip')
    doc.body.appendChild(n)
    notes.set(doc, n)
  }
  return n
}

/** Text an element shows cut short with an ellipsis, or an input's value that doesn't fit. */
function cutShort(el: Element): string | null {
  if (el instanceof HTMLInputElement) {
    return el.type !== 'checkbox' && el.value && el.scrollWidth > el.clientWidth + 1 ? el.value : null
  }
  if (!(el instanceof HTMLElement) || el.scrollWidth <= el.clientWidth + 1) return null
  const s = el.ownerDocument.defaultView?.getComputedStyle(el)
  if (!s || s.overflowX === 'visible' || (s.textOverflow !== 'ellipsis' && s.whiteSpace !== 'nowrap')) return null
  const text = el.textContent?.replace(/\s+/g, ' ').trim()
  return text || null
}

/** The full names an item cuts short: itself or its parts (a row's name). */
function fullNames(subject: Element): string[] {
  const out: string[] = []
  const own = cutShort(subject)
  if (own) return [own]
  for (const el of Array.from(subject.querySelectorAll('*')).slice(0, 60)) {
    const t = cutShort(el)
    if (t && !out.some((o) => o.includes(t))) out.push(t)
  }
  return out
}

function show(h: Hover): void {
  const full = fullNames(h.subject)
  const tip = (h.titled?.text ?? h.subject.getAttribute('data-tip') ?? '').trim()
  // A tooltip that already says the full name says enough.
  const names = full.filter((f) => !tip.includes(f))
  if (!names.length && !tip) return
  const n = noteFor(h.doc)
  n.replaceChildren()
  for (const name of names) {
    const b = h.doc.createElement('b')
    b.textContent = name
    n.appendChild(b)
  }
  if (tip) n.appendChild(h.doc.createTextNode(tip))
  n.style.display = 'block'
  // Under the pointer, kept inside the window.
  const win = h.doc.defaultView ?? window
  const r = n.getBoundingClientRect()
  let left = h.x + OFFSET_X
  let top = h.y + OFFSET_Y
  if (left + r.width > win.innerWidth - 4) left = Math.max(4, win.innerWidth - r.width - 4)
  if (top + r.height > win.innerHeight - 4) top = Math.max(4, h.y - r.height - 8)
  n.style.left = `${left}px`
  n.style.top = `${top}px`
}

function end(): void {
  if (!hover) return
  const h = hover
  hover = null
  h.doc.defaultView?.clearTimeout(h.timer)
  const n = notes.get(h.doc)
  if (n) n.style.display = 'none'
  // Put the title back, unless the page has given it a new one since.
  if (h.titled && !h.titled.el.hasAttribute('title')) h.titled.el.setAttribute('title', h.titled.text)
}

function begin(target: Element, e: PointerEvent): void {
  if (!enabled) return
  const subject = target.closest(SUBJECT)
  if (!subject || subject === hover?.subject) return
  end()
  const r = subject.getBoundingClientRect()
  if (r.width > MAX_SUBJECT.width && r.height > MAX_SUBJECT.height) return
  const doc = eventDocument(e)
  const win = doc.defaultView ?? window
  // The tooltip text: the item's own title, or one just above it (a row's, a field's).
  const holder = target.closest('[title]')
  const titled =
    holder && (holder === subject || subject.contains(holder) || holder.contains(subject))
      ? { el: holder, text: holder.getAttribute('title') ?? '' }
      : null
  if (titled) titled.el.removeAttribute('title')
  const h: Hover = { subject, doc, timer: 0, x: e.clientX, y: e.clientY, titled }
  h.timer = win.setTimeout(() => hover === h && show(h), DELAY)
  hover = h
}

/** Starts the notes in every app window (once, at startup). */
export function installTooltips(): void {
  onAnyWindow('pointerover', (e) => {
    const t = e.target
    if (t instanceof Element) begin(t, e as PointerEvent)
  })
  onAnyWindow('pointermove', (e) => {
    if (!hover) return
    const p = e as PointerEvent
    hover.x = p.clientX
    hover.y = p.clientY
  })
  onAnyWindow('pointerout', (e) => {
    const next = (e as PointerEvent).relatedTarget
    if (hover && !(next instanceof Node && hover.subject.contains(next))) end()
  })
  for (const type of ['pointerdown', 'wheel', 'keydown', 'blur']) onAnyWindow(type, end)
}
