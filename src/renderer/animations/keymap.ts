/**
 * The Animations page's keyboard shortcuts (DS Anim Studio's, mostly): one
 * table that both handles the keys and lists them in the shortcuts sheet
 * (F1), so the two can't disagree. No two entries take the same key press.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors): the shortcuts follow
 * its keymap.
 */
import type { AnimListItem, AnimationView } from '../../shared/api.ts'
import type { PlayClock } from '../viewer/PlayClock.ts'
import type { AnimDialog } from './useAnimationsPage.ts'

/** What the shortcuts read and do on the page. */
export interface ShortcutPage {
  clock: PlayClock
  anims: AnimListItem[]
  selected: string | null
  view: AnimationView | null
  category: number | null
  eventIndex: number | null
  selection: number[]
  mutedTypes: number[]
  colors: Record<string, string>
  /** Another animation of the list, its events unselected. */
  showAnimation(name: string): void
  toggleFocus(hand: 'right' | 'left'): void
  sameIdIn(dir: 1 | -1): void
  undo(): void
  redo(): void
  openDialog(d: AnimDialog): void
  openFind(): void
  selectMany(indices: number[], focus: number | null): void
  copyEvents(cut: boolean): void
  pasteEvents(): void
  setEventIndex(i: number | null): void
  deleteSelected(): void
  duplicateEvent(index: number): void
  toggleMute(kind: 'mute' | 'solo' | 'clear'): void
  setMutedTypes(types: number[]): void
  pickColor(type: number, current?: string): void
  /** F8: plays the combo, or stops it; with no combo yet, shows its panel. */
  toggleCombo(): void
  /** G / R: the viewer's move / rotate tool on the selected effect event (again: off). */
  toggleGizmo(mode: 'translate' | 'rotate'): void
}

export interface Shortcut {
  /** The keys and what they do, as the shortcuts sheet lists them; null for one it doesn't list. */
  label: [keys: string, what: string] | null
  /** Takes a key press that is this shortcut's: true when it did. Absent for mouse actions and app-wide keys. */
  handle?: (e: KeyboardEvent, page: ShortcutPage) => boolean
}

const ctrlOf = (e: KeyboardEvent) => e.ctrlKey || e.metaKey

/** Prevents the browser's own action for the key, and runs `f`. */
function take(e: KeyboardEvent, f: () => void): true {
  e.preventDefault()
  f()
  return true
}

export const KEYMAP: Shortcut[] = [
  {
    label: ['Space / Shift+Space', 'Play or pause / play from the start'],
    handle: (e, p) => e.key === ' ' && take(e, () => (e.shiftKey ? p.clock.playFrom(0) : p.clock.toggle())),
  },
  {
    label: ['← → (Shift: 5)', 'Previous / next frame'],
    handle: (e, p) =>
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      !e.altKey &&
      take(e, () => p.clock.step((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1))),
  },
  {
    label: ['Home / End', 'First / last frame'],
    handle: (e, p) =>
      (e.key === 'Home' || e.key === 'End') && take(e, () => p.clock.set(e.key === 'Home' ? 0 : p.clock.duration)),
  },
  {
    label: ['Ctrl+R', 'Back to the start, paused'],
    handle: (e, p) => ctrlOf(e) && e.key.toLowerCase() === 'r' && take(e, () => p.clock.pauseAt(0)),
  },
  {
    label: ['↑ ↓ (Shift: 10)', 'Previous / next animation'],
    handle: (e, p) => {
      if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !p.anims.length) return false
      return take(e, () => {
        const i = p.anims.findIndex((a) => a.name === p.selected)
        const step = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 10 : 1)
        const next = p.anims[Math.max(0, Math.min(p.anims.length - 1, (i < 0 ? 0 : i) + step))]
        if (next) p.showAnimation(next.name)
      })
    },
  },
  {
    label: ['Page Up / Page Down', 'The same animation id in the previous / next category that has it'],
    handle: (e, p) =>
      (e.key === 'PageUp' || e.key === 'PageDown') && take(e, () => p.sameIdIn(e.key === 'PageDown' ? 1 : -1)),
  },
  // Back and forward are the whole app's (Workspace).
  { label: ['Alt+← / Alt+→', 'Back / forward'] },
  {
    label: ['Ctrl+G / Ctrl+H', 'Go to an animation / a category (by number or TAE id)'],
    handle: (e, p) => {
      const key = e.key.toLowerCase()
      if (!ctrlOf(e) || (key !== 'g' && key !== 'h')) return false
      return take(e, () => p.openDialog({ kind: 'goto', target: key === 'g' ? 'animation' : 'category' }))
    },
  },
  {
    label: ['Ctrl+F', 'Find events by type and value (every animation)'],
    handle: (e, p) => ctrlOf(e) && e.key.toLowerCase() === 'f' && take(e, p.openFind),
  },
  { label: ['Click, Ctrl+click, Shift+click', 'Select an event, toggle one, add one'] },
  { label: ['Drag on empty timeline', 'Select the events in a rectangle'] },
  {
    label: ['Ctrl+A / Esc', 'Select every event / none'],
    handle: (e, p) => {
      if (ctrlOf(e) && e.key.toLowerCase() === 'a' && p.view) {
        const view = p.view
        return take(e, () =>
          p.selectMany(
            view.events.map((x) => x.index),
            p.eventIndex,
          ),
        )
      }
      // Escape leaves the browser's own handling alone.
      if (e.key === 'Escape' && p.selection.length) {
        p.setEventIndex(null)
        return true
      }
      return false
    },
  },
  { label: ['Drag', 'Move (all selected), edges resize; Alt: no frame snapping'] },
  { label: ['Double-click or Ctrl+right-click a lane', 'Add an event of that lane’s type there'] },
  {
    label: ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste events (at the playhead, into any animation)'],
    handle: (e, p) => {
      const key = e.key.toLowerCase()
      if (!ctrlOf(e) || !p.view || (key !== 'c' && key !== 'x' && key !== 'v')) return false
      return take(e, () => (key === 'v' ? p.pasteEvents() : p.copyEvents(key === 'x')))
    },
  },
  {
    label: ['Ctrl+D / Delete', 'Duplicate the event / delete the selected events'],
    handle: (e, p) => {
      if (ctrlOf(e) && e.key.toLowerCase() === 'd' && p.view && p.eventIndex !== null) {
        const index = p.eventIndex
        return take(e, () => p.duplicateEvent(index))
      }
      if (e.key === 'Delete' && p.view && (p.eventIndex !== null || p.selection.length))
        return take(e, p.deleteSelected)
      return false
    },
  },
  {
    label: ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    handle: (e, p) => {
      const key = e.key.toLowerCase()
      if (!ctrlOf(e)) return false
      if (key === 'z' && !e.shiftKey) return take(e, p.undo)
      if (key === 'y' || (key === 'z' && e.shiftKey)) return take(e, p.redo)
      return false
    },
  },
  {
    label: ['1 / 2 / 3', 'Mute / solo the selected events in the viewer / clear'],
    handle: (e, p) =>
      !ctrlOf(e) &&
      !e.altKey &&
      (e.key === '1' || e.key === '2' || e.key === '3') &&
      !!p.view &&
      take(e, () => p.toggleMute(e.key === '1' ? 'mute' : e.key === '2' ? 'solo' : 'clear')),
  },
  {
    label: ['4', 'Mute every event of the selected event’s type in the viewer'],
    handle: (e, p) => {
      if (ctrlOf(e) || e.altKey || e.key !== '4' || !p.view || p.eventIndex === null) return false
      const type = p.view.events[p.eventIndex]?.type
      return take(e, () => {
        if (type === undefined) return
        p.setMutedTypes(p.mutedTypes.includes(type) ? p.mutedTypes.filter((t) => t !== type) : [...p.mutedTypes, type])
      })
    },
  },
  {
    label: ['C', 'Color the selected event’s type'],
    handle: (e, p) => {
      if (ctrlOf(e) || e.altKey || e.key.toLowerCase() !== 'c' || !p.view || p.eventIndex === null) return false
      const type = p.view.events[p.eventIndex]?.type
      return take(e, () => {
        if (type !== undefined) p.pickColor(type, p.colors[type])
      })
    },
  },
  {
    label: ['F2 / Shift+F2', 'Name and tag the animation / move the category to a new number'],
    handle: (e, p) =>
      e.key === 'F2' &&
      take(e, () => {
        if (e.shiftKey) {
          if (p.category !== null) p.openDialog({ kind: 'renumber' })
        } else if (p.view) p.openDialog({ kind: 'rename' })
      }),
  },
  {
    label: ['F3 / Shift+F3', 'Animation properties / category properties'],
    handle: (e, p) =>
      e.key === 'F3' &&
      take(e, () => {
        if (e.shiftKey) {
          if (p.category !== null) p.openDialog({ kind: 'categoryProperties' })
        } else if (p.view) p.openDialog({ kind: 'properties' })
      }),
  },
  {
    label: ['Ctrl+I', 'Import another animation’s events'],
    handle: (e, p) =>
      ctrlOf(e) && e.key.toLowerCase() === 'i' && !!p.view && take(e, () => p.openDialog({ kind: 'import' })),
  },
  // Saving and reloading in game is the whole app's (Workspace).
  { label: ['F5', 'Save and reload the character in the running game'] },
  {
    label: ['F8', 'Combo viewer: play animations one after another'],
    handle: (e, p) => e.key === 'F8' && take(e, p.toggleCombo),
  },
  {
    label: ['G / R', 'Move / turn the selected effect event’s effect in the viewer (again: off)'],
    handle: (e, p) => {
      const key = e.key.toLowerCase()
      if (ctrlOf(e) || e.altKey || (key !== 'g' && key !== 'r') || !p.view || p.eventIndex === null) return false
      return take(e, () => p.toggleGizmo(key === 'g' ? 'translate' : 'rotate'))
    },
  },
  {
    label: ['F', 'Frame the held weapon (Shift: left hand)'],
    handle: (e, p) =>
      e.key.toLowerCase() === 'f' &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      take(e, () => p.toggleFocus(e.shiftKey ? 'left' : 'right')),
  },
  // The sheet itself.
  {
    label: null,
    handle: (e, p) =>
      (e.key === 'F1' || (e.key === '?' && !ctrlOf(e))) && take(e, () => p.openDialog({ kind: 'shortcuts' })),
  },
]
