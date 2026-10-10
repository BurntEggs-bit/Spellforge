/**
 * The Animations page: browse the player's animation categories, edit
 * an animation's events on a timeline (DS Anim Studio's job), copy
 * animations into new categories, and register them in the behaviour graph
 * so the game can play them (ERClipGeneratorTool's job).
 */
import { InActiveWindow } from '../shared/ui.tsx'
import { DockArea } from '../app/dock.tsx'
import { GoToDialog } from './dialogs/GoToDialog.tsx'
import { RenameDialog } from './dialogs/RenameDialog.tsx'
import { RenumberDialog } from './dialogs/RenumberDialog.tsx'
import { PropertiesDialog } from './dialogs/PropertiesDialog.tsx'
import { CategoryPropertiesDialog } from './dialogs/CategoryPropertiesDialog.tsx'
import { ImportDialog } from './dialogs/ImportDialog.tsx'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog.tsx'
import { DuplicateDialog } from './dialogs/DuplicateDialog.tsx'
import { EventTypePicker } from './dialogs/EventTypePicker.tsx'
import { ANIM_LAYOUT, ANIM_PANELS } from './docks.tsx'
import { AnimationsContext } from './pageContext.ts'
import { type AnimProps, useAnimationsPage } from './useAnimationsPage.ts'

/** The page's dock of panels, and the dialog open over it (one at a time). */
export function AnimationsPage(props: AnimProps) {
  const page = useAnimationsPage(props)
  const { dialog, setDialog, view, category, categories, eventIndex } = page
  const close = () => setDialog(null)
  return (
    <AnimationsContext.Provider value={page}>
      <DockArea page="animations" panels={ANIM_PANELS} layout={ANIM_LAYOUT} />
      {dialog?.kind === 'goto' && (
        <InActiveWindow>
          <GoToDialog
            kind={dialog.target}
            category={category}
            categories={categories ?? []}
            onClose={close}
            onAnimation={page.selectAnimation}
            onCategory={page.selectCategory}
          />
        </InActiveWindow>
      )}
      {dialog?.kind === 'rename' && view && (
        <InActiveWindow>
          <RenameDialog name={view.name} title={view.title} tags={view.tags} onClose={close} onDone={page.reloadView} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'renumber' && category !== null && (
        <InActiveWindow>
          <RenumberDialog category={category} categories={categories ?? []} onClose={close} onDone={page.renumbered} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'properties' && view && (
        <InActiveWindow>
          <PropertiesDialog name={view.name} onClose={close} onDone={page.movedTo} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'categoryProperties' && category !== null && (
        <InActiveWindow>
          <CategoryPropertiesDialog category={category} onClose={close} onDone={page.reloadView} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'import' && view && (
        <InActiveWindow>
          <ImportDialog name={view.name} category={view.category} onClose={close} onDone={page.reloadView} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'shortcuts' && (
        <InActiveWindow>
          <ShortcutsDialog onClose={close} />
        </InActiveWindow>
      )}
      {dialog?.kind === 'duplicate' && (
        <InActiveWindow>
          <DuplicateDialog
            scope={dialog.scope}
            source={dialog.scope === 'one' ? (view?.name ?? null) : null}
            sourceCategory={dialog.scope === 'one' ? (view?.category ?? category) : category}
            categories={categories ?? []}
            onClose={() => setDialog(null)}
            onDone={page.duplicated}
          />
        </InActiveWindow>
      )}
      {dialog?.kind === 'addEvent' && view && (
        <InActiveWindow>
          <EventTypePicker
            onClose={() => setDialog(null)}
            onPick={(type) => {
              setDialog(null)
              const at = eventIndex !== null ? (view.events[eventIndex]?.start ?? 0) : 0
              page.addEvent(type, at)
            }}
          />
        </InActiveWindow>
      )}
    </AnimationsContext.Provider>
  )
}
