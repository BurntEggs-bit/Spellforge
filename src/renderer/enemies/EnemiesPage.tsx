/**
 * The Enemies page: every character with animations (enemies, bosses, NPCs
 * and creatures), what each of their moves does, a viewer that plays a move
 * on the character or fitted to you, and turning a move into one of your
 * weapons' skills or a character's bullet into a spell, in one step each.
 */
import { ScaleDialog } from '../params/ScaleDialog.tsx'
import { DockArea, type DockPanel, type DockPlacement } from '../app/dock.tsx'
import { ResultDialog } from './dialogs/ResultDialog.tsx'
import { SpellDialog } from './dialogs/SpellDialog.tsx'
import { SkillDialog } from './dialogs/SkillDialog.tsx'
import { EventsPanel } from './panels/EventsPanel.tsx'
import { ViewerPanel } from './panels/ViewerPanel.tsx'
import { MovesPanel } from './panels/MovesPanel.tsx'
import { CharactersPanel } from './panels/CharactersPanel.tsx'
import { EnemiesContext } from './pageContext.ts'
import { type EnemiesProps, useEnemiesPage } from './useEnemiesPage.ts'

const PANELS: DockPanel[] = [
  { id: 'enemyList', title: 'Characters', component: () => <CharactersPanel /> },
  { id: 'enemyMoves', title: 'Moves & spells', component: () => <MovesPanel /> },
  { id: 'enemyViewer', title: 'Viewer', component: () => <ViewerPanel /> },
  { id: 'enemyEvents', title: 'What it does', component: () => <EventsPanel /> },
]
const LAYOUT: DockPlacement[] = [
  { id: 'enemyList', width: 260 },
  { id: 'enemyMoves', ref: 'enemyList', direction: 'right', width: 360 },
  { id: 'enemyViewer', ref: 'enemyMoves', direction: 'right', height: 420 },
  { id: 'enemyEvents', ref: 'enemyViewer', direction: 'below' },
]

export function EnemiesPage(props: EnemiesProps) {
  const page = useEnemiesPage(props)
  const { dialog, setDialog, view, move, spell } = page
  return (
    <EnemiesContext.Provider value={page}>
      <DockArea page="enemies" panels={PANELS} layout={LAYOUT} />
      {dialog === 'skill' && view && move && (
        <SkillDialog
          view={view}
          move={view.moves.find((m) => m.name === move)!}
          fit={page.fit}
          version={props.version}
          onClose={() => setDialog(null)}
          onDone={(r, weapon) => {
            setDialog(null)
            props.onEdited()
            page.setResult({ kind: 'skill', skill: r, weapon })
          }}
        />
      )}
      {dialog === 'spell' && view && spell !== null && (
        <SpellDialog
          view={view}
          bullet={spell}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            setDialog(null)
            props.onEdited()
            page.setResult({ kind: 'spell', spell: r })
          }}
        />
      )}
      {page.result && (
        <ResultDialog
          result={page.result}
          onClose={() => page.setResult(null)}
          onOpenRow={props.onOpenRow}
          onOpenAnimation={props.onOpenAnimation}
          onScale={() => {
            page.setScaling(page.result)
            page.setResult(null)
          }}
        />
      )}
      {page.scaling && (
        <ScaleDialog
          param={page.scaling.kind === 'skill' ? 'SwordArtsParam' : 'Magic'}
          id={page.scaling.kind === 'skill' ? page.scaling.skill.skill : page.scaling.spell.spell}
          onClose={() => page.setScaling(null)}
          onDone={() => props.onEdited()}
          onOpenAnimation={
            page.scaling.kind === 'skill'
              ? (
                  (made) => (animation: string, weapon?: number) =>
                    props.onOpenAnimation({ category: made.skill.category, animation, weapon: weapon ?? made.weapon })
                )(page.scaling)
              : undefined
          }
        />
      )}
    </EnemiesContext.Provider>
  )
}
