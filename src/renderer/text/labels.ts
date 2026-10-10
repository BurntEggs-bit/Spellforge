/** How the Text page tells its files apart and shows an entry's state. */
import type { TextEntryState } from '../../shared/api.ts'

/** One key per text file: its binder and its name inside it. */
export function fileKey(f: { rel: string; file: string }): string {
  return `${f.rel}|${f.file}`
}

/** An entry's state as a badge: its word, its colour (a .badge class) and what it means. */
export const STATE_LABEL: Record<TextEntryState, { text: string; cls: string; title: string }> = {
  added: { text: 'new', cls: 'added', title: 'You added this entry (the game doesn’t have it)' },
  changed: { text: 'edited', cls: 'changed', title: 'You changed this text' },
  removed: { text: 'removed', cls: 'changed', title: 'You removed this entry: in game it shows nothing' },
  outdated: {
    text: 'newer in game',
    cls: 'outdated',
    title: 'The installed game has newer text for this id than your copy',
  },
}
