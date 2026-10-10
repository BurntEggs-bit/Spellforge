/** The Params page's Inspector panel: the selected row or effect, edited. */
import { usePanelPin } from '../app/dock.tsx'
import { useParams } from './pageContext.ts'
import { PinBanner } from './PinBanner.tsx'
import { EffectInspector } from '../effects/EffectInspector.tsx'
import { RowInspector } from './RowInspector.tsx'

export function InspectorPanel() {
  const {
    selection: picked,
    pinnedSelection,
    setPinnedSelection,
    version,
    select,
    openRoot,
    edited,
    duplicate,
    openAnimation,
    openEntireSpell,
    cleared,
  } = useParams()
  const selection = pinnedSelection ?? picked
  const pinned = !!pinnedSelection
  usePanelPin(
    'inspector',
    selection
      ? {
          pinned,
          what: selection.kind === 'row' ? 'this row' : 'this effect',
          toggle: () => setPinnedSelection(pinned ? null : selection),
        }
      : null,
  )
  return (
    <div className="panel">
      {pinned && (
        <PinBanner
          what={selection?.kind === 'effect' ? 'this effect' : 'this row'}
          onUnpin={() => setPinnedSelection(null)}
        />
      )}
      <div className="panel-body">
        {!selection && <div className="empty">No row selected.</div>}
        {selection?.kind === 'row' && (
          <RowInspector
            // Not keyed on `version` (it refetches instead), so the field filter and scroll survive edits.
            key={`${selection.param}:${selection.id}`}
            param={selection.param}
            id={selection.id}
            version={version}
            // Pinned: what a field points at opens in the tree; the pinned row stays.
            onNavigate={(p, i) => (pinned ? openRoot(p, i) : select({ kind: 'row', param: p, id: i }))}
            onOpenEffect={(id) => select({ kind: 'effect', id })}
            onEdited={edited}
            onDuplicate={() => duplicate([{ param: selection.param, id: selection.id }])}
            onOpenAnimation={openAnimation}
            onEntireSpell={openEntireSpell}
            // A copy made from a pinned row takes the pin over.
            onOpenRow={(p, i) => {
              if (pinned) setPinnedSelection({ kind: 'row', param: p, id: i })
              openRoot(p, i)
            }}
            onDeleted={() => {
              setPinnedSelection(null)
              cleared()
            }}
          />
        )}
        {selection?.kind === 'effect' && (
          <EffectInspector
            // Not keyed on `version`: the inspector refreshes itself after
            // edits, and remounting would drop the selected part and scroll.
            key={`fx:${selection.id}`}
            id={selection.id}
            onOpenEffect={(id) => select({ kind: 'effect', id })}
            onOpenRow={(p, i) => select({ kind: 'row', param: p, id: i })}
            onEdited={edited}
            onEntireSpell={openEntireSpell}
          />
        )}
      </div>
    </div>
  )
}
