/**
 * The Animations page's keyboard shortcuts (KEYMAP): in the main window
 * while the page shows, and in any popped-out window holding one of its
 * panels.
 */
import { eventDocument, inMainWindow, useAppKeydown } from '../app/windows.ts'
import { KEYMAP, type ShortcutPage } from './keymap.ts'

export function useAnimationShortcuts(
  page: ShortcutPage,
  { hidden, dialogOpen }: { hidden: boolean; dialogOpen: boolean },
): void {
  useAppKeydown((e) => {
    // Keys typed into a field are the field's (the target can be a window, which has no closest), and an
    // open dialog has the keyboard.
    const typing = (e.target as Partial<Element> | null)?.closest?.('input, textarea, select')
    if (typing || dialogOpen) return
    if (inMainWindow(e) ? hidden : !eventDocument(e).querySelector('[data-page="animations"]')) return
    for (const s of KEYMAP) if (s.handle?.(e, page)) return
  })
}
