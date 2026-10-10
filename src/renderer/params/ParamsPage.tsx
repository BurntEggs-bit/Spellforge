/**
 * The Params & effects page: browse weapons, items, spells, skills, bullets,
 * effects and every param; the tree of everything a row uses; and the
 * Inspector, which edits a row or an effect. The workspace owns the page's
 * state (other pages open rows on it) and hands it over as `api`.
 */
import { DockArea, type DockPanel, type DockPlacement } from '../app/dock.tsx'
import { BrowsePanel } from './BrowsePanel.tsx'
import { InspectorPanel } from './InspectorPanel.tsx'
import { ParamsContext, type ParamsPageState } from './pageContext.ts'
import { UsesPanel } from './UsesTree.tsx'

const PARAMS_PANELS: DockPanel[] = [
  { id: 'browse', title: 'Browse', component: () => <BrowsePanel /> },
  { id: 'uses', title: 'Everything it uses', component: () => <UsesPanel /> },
  { id: 'inspector', title: 'Inspector', component: () => <InspectorPanel /> },
]

const PARAMS_LAYOUT: DockPlacement[] = [
  { id: 'browse', width: 300 },
  { id: 'uses', ref: 'browse', direction: 'right', width: 420 },
  { id: 'inspector', ref: 'uses', direction: 'right' },
]

export function ParamsPage({ api }: { api: ParamsPageState }) {
  return (
    <ParamsContext.Provider value={api}>
      <DockArea page="params" panels={PARAMS_PANELS} layout={PARAMS_LAYOUT} />
    </ParamsContext.Provider>
  )
}
