/**
 * The game's text: names, descriptions, dialogue, menus, in every language
 * the game has. Files on the left (grouped Items / Menus, then base game,
 * DLC 1, DLC 2), entries in the middle, the entry on the right with the
 * same id's text in the related tables (an item's name, short description
 * and description together). Edits are saved into the project's own copy
 * of the text binder.
 *
 * "Edited" means changed by the modder: the project's copy is compared with
 * the game's text of the version it was made with. Text a newer game has
 * that the copy lacks is shown apart ("newer in game") and can be brought in.
 */
import { DockArea, type DockPanel, type DockPlacement } from '../app/dock.tsx'
import { type TextProps, useTextPage } from './useTextPage.ts'
import { TextContext } from './pageContext.ts'
import { FilesPanel } from './panels/FilesPanel.tsx'
import { EntriesPanel } from './panels/EntriesPanel.tsx'
import { EntryPanel } from './panels/EntryPanel.tsx'

const TEXT_PANELS: DockPanel[] = [
  { id: 'textFiles', title: 'Text files', component: () => <FilesPanel /> },
  { id: 'textEntries', title: 'Entries', component: () => <EntriesPanel /> },
  { id: 'textEntry', title: 'Entry', component: () => <EntryPanel /> },
]
const TEXT_LAYOUT: DockPlacement[] = [
  { id: 'textFiles', width: 280 },
  { id: 'textEntries', ref: 'textFiles', direction: 'right', width: 420 },
  { id: 'textEntry', ref: 'textEntries', direction: 'right' },
]

export function TextPage(props: TextProps) {
  const page = useTextPage(props)
  return (
    <TextContext.Provider value={page}>
      <DockArea page="text" panels={TEXT_PANELS} layout={TEXT_LAYOUT} />
    </TextContext.Provider>
  )
}
