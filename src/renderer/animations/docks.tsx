/**
 * The Animations page's dock panels: each reads the page (useAnim) and shows
 * one of its parts, in the default arrangement ANIM_LAYOUT.
 */
import type { DockPanel, DockPlacement } from '../app/dock.tsx'
import { AnimationList } from './AnimationList.tsx'
import { useAnimations } from './pageContext.ts'
import { BehaviourPanel } from './behaviour/BehaviourPanel.tsx'
import { CategoryPanel } from './CategoryPanel.tsx'
import { ComboPanel } from './ComboPanel.tsx'
import { AnimationEditor } from './editor/AnimationEditor.tsx'
import { FindPanel } from './FindPanel.tsx'
import { MovesetPanel } from './MovesetPanel.tsx'
import { ViewportDock } from './ViewportDock.tsx'

function CategoriesDock() {
  const a = useAnimations()
  return (
    <CategoryPanel
      categories={a.categories}
      selected={a.category}
      unregistered={a.unregistered}
      onSelect={a.selectCategory}
      onRegister={() => a.register(a.unregistered)}
    />
  )
}

function MovesetDock() {
  const a = useAnimations()
  return (
    <MovesetPanel weapon={a.rightWeapon} version={a.version} onPlay={a.selectAnimation} onDone={a.movesetApplied} />
  )
}

function BehaviourDock() {
  const a = useAnimations()
  return (
    <BehaviourPanel
      current={a.view?.name ?? null}
      category={a.category}
      version={a.version}
      onEdited={a.reloadView}
      onOpenAnimation={a.selectAnimation}
      clockTime={() => a.clock.time}
    />
  )
}

function ComboDock() {
  const a = useAnimations()
  return (
    <ComboPanel
      steps={a.comboSteps}
      onSteps={(s) => {
        a.setComboSteps(s)
        if (!s.length) a.setComboPlaying(false)
      }}
      playing={a.comboPlaying}
      onPlay={(on) => {
        a.setComboPlaying(on)
        if (on) a.clock.playFrom(0)
      }}
      current={a.view?.name ?? null}
      category={a.category}
    />
  )
}

function FindDock() {
  const a = useAnimations()
  return <FindPanel category={a.category} focusSeq={a.findSeq} onOpen={a.openEvent} />
}

function ListDock() {
  const a = useAnimations()
  return (
    <AnimationList
      category={a.category}
      info={a.categories?.find((c) => c.category === a.category) ?? null}
      anims={a.anims}
      selected={a.selected}
      onSelect={a.selectAnimation}
      onDuplicateCategory={() => a.setDialog({ kind: 'duplicate', scope: 'category' })}
    />
  )
}

function EventsDock() {
  const a = useAnimations()
  const { view, category } = a
  return (
    <div className="panel">
      <div className="panel-body">
        {!view ? (
          <div className="empty">{category === null ? 'No category selected.' : 'No animation selected.'}</div>
        ) : (
          <AnimationEditor
            key={view.name}
            view={view}
            eventIndex={a.eventIndex}
            selection={a.selection}
            onSelectEvent={a.setEventIndex}
            onSelectMany={a.selectMany}
            onApplied={a.applied}
            onAddEvent={() => a.setDialog({ kind: 'addEvent' })}
            onDuplicateEvent={a.duplicateEvent}
            onDeleteEvent={a.deleteEvent}
            onDeleteSelected={a.deleteSelected}
            onDuplicate={() => a.setDialog({ kind: 'duplicate', scope: 'one' })}
            onDelete={a.deleteAnimation}
            onRegister={() => a.register([view.name])}
            onOpenAnimation={a.selectAnimation}
            onOpenRow={a.onOpenRow}
            onOpenEffect={a.onOpenEffect}
            onUndo={a.undo}
            onRedo={a.redo}
            history={a.history}
            onDialog={a.setDialog}
            onCopy={a.copyEvents}
            onPaste={a.pasteEvents}
            muted={a.muted}
            mutedTypes={a.mutedTypes}
            onUnmuteTypes={() => a.setMutedTypes([])}
            colors={a.colors}
            onPickColor={a.pickColor}
            onResetColors={() => a.setColors({})}
            laneOrder={a.laneOrder}
            onLaneOrder={a.setLaneOrder}
            clock={a.clock}
            weapon={a.rightWeapon}
            onParamsEdited={a.onParamsEdited}
            version={a.version}
          />
        )}
      </div>
    </div>
  )
}

export const ANIM_PANELS: DockPanel[] = [
  { id: 'animCategories', title: 'Categories', component: () => <CategoriesDock /> },
  { id: 'animMoveset', title: 'Moveset', component: () => <MovesetDock /> },
  { id: 'animFind', title: 'Find', component: () => <FindDock /> },
  { id: 'animCombo', title: 'Combo', component: () => <ComboDock /> },
  { id: 'animList', title: 'Animations', component: () => <ListDock /> },
  { id: 'animViewport', title: 'Viewport', component: () => <ViewportDock /> },
  { id: 'animEvents', title: 'Events', component: () => <EventsDock /> },
  { id: 'animBehaviour', title: 'Behaviour', component: () => <BehaviourDock /> },
]

// Finding animations on the left (categories, Find, combos); what's edited below the viewer:
// the animation's events, then the weapon's moveset and its behaviours.
export const ANIM_LAYOUT: DockPlacement[] = [
  { id: 'animCategories', width: 250 },
  { id: 'animFind', ref: 'animCategories', direction: 'within' },
  { id: 'animCombo', ref: 'animCategories', direction: 'within' },
  { id: 'animList', ref: 'animCategories', direction: 'right', width: 300 },
  { id: 'animViewport', ref: 'animList', direction: 'right', height: 380 },
  { id: 'animEvents', ref: 'animViewport', direction: 'below' },
  { id: 'animMoveset', ref: 'animEvents', direction: 'within' },
  { id: 'animBehaviour', ref: 'animEvents', direction: 'within' },
]
