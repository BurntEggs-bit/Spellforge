/**
 * The viewer's list of events active at the playhead, in its corner. It is
 * plain DOM updated from the render loop, so playback doesn't re-render React.
 */
import { escapeHtml } from '../../../shared/format.ts'
import { SIM_CSS } from '../palette.ts'
import type { HelperPrefs } from '../prefs.ts'
import type { ViewerState } from './state.ts'

/** The "active now" list in the viewport corner: items fade in once, and leave when their event ends. */
export function updateActiveList(el: HTMLDivElement | null, s: ViewerState, h: HelperPrefs): void {
  if (!el) return
  const show = h.all && h.simList
  const active = show ? s.actions.filter((a) => s.time >= a.start && s.time <= a.end) : []
  // Bullets in flight count as active too.
  for (const a of s.actions) {
    if (!show || !a.bullet || s.time <= a.end) continue
    const flying = s.bullets.some((b) => b.key.startsWith(`e${a.event}.`) && s.time >= b.t0 && s.time <= b.t0 + b.life)
    if (flying) active.push(a)
  }
  const MAX = 8
  const shown = active.slice(0, MAX)
  // An edited event keeps its index: its text is part of the key, so the list says what it does now.
  const key = shown.map((a) => `${a.event}:${a.kind}:${a.label}`).join(',') + `|${active.length}`
  if (el.dataset.key === key) return
  el.dataset.key = key
  const want = new Set(shown.map((a) => String(a.event)))
  for (const child of [...el.children] as HTMLElement[]) if (!want.has(child.dataset.event ?? '')) child.remove()
  shown.forEach((a, i) => {
    let item = el.querySelector<HTMLElement>(`[data-event="${a.event}"]`)
    if (!item) {
      item = document.createElement('div')
      item.className = 'sim-item'
      item.dataset.event = String(a.event)
    }
    const html = `<b>${a.kind === 'ffx' ? 'effect' : a.kind}</b> ${escapeHtml(a.label)}`
    if (item.dataset.html !== html) {
      item.dataset.html = html
      item.style.setProperty('--k', SIM_CSS[a.kind])
      item.innerHTML = html
    }
    if (el.children[i] !== item) el.insertBefore(item, el.children[i] ?? null)
  })
  if (active.length > MAX) {
    const more = document.createElement('div')
    more.className = 'sim-item sim-more'
    more.dataset.event = 'more'
    more.textContent = `+${active.length - MAX} more`
    el.appendChild(more)
  }
}
