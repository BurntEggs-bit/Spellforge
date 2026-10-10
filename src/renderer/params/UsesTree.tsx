/**
 * The Params page's "Everything it uses" panel: the tree of rows and effects
 * a row refers to, opened a level at a time.
 */
import { useState, useEffect } from 'react'
import type { TreeNode } from '../../shared/api.ts'
import { usePanelPin } from '../app/dock.tsx'
import { type Selection, useParams } from './pageContext.ts'
import { call } from '../lib/ipc.ts'
import { PARAM_LABELS } from './paramLabels.ts'
import { CopyId, StateBadge } from '../shared/ui.tsx'
import { PinBanner } from './PinBanner.tsx'
import { plural } from '../../shared/format.ts'

export function UsesPanel() {
  const { root: browsed, pinnedRoot, setPinnedRoot, version, selection, select } = useParams()
  const root = pinnedRoot ?? browsed
  const [node, setNode] = useState<TreeNode | null>(null)
  usePanelPin(
    'uses',
    root ? { pinned: !!pinnedRoot, what: 'this tree', toggle: () => setPinnedRoot(pinnedRoot ? null : root) } : null,
  )

  useEffect(() => {
    if (!root) return setNode(null)
    call('tree:root', root).then(setNode)
  }, [root?.param, root?.id, version])

  return (
    <div className="panel">
      {pinnedRoot && <PinBanner what="this tree" onUnpin={() => setPinnedRoot(null)} />}
      <div className="panel-body">
        {!node && <div className="empty">No row selected.</div>}
        {node && (
          <div className="tree">
            {/* Keyed by row: another row's tree starts fresh (its open state and children aren't the last row's). */}
            <TreeItem
              key={`${node.param}:${node.id}`}
              node={node}
              depth={0}
              selection={selection}
              onSelect={select}
              initiallyOpen
              version={version}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function TreeItem({
  node,
  depth,
  selection,
  onSelect,
  initiallyOpen,
  version,
}: {
  node: TreeNode
  depth: number
  selection: Selection | null
  onSelect: (s: Selection) => void
  initiallyOpen?: boolean
  version: number
}) {
  const [open, setOpen] = useState(!!initiallyOpen)
  const [children, setChildren] = useState<TreeNode[] | null>(null)

  useEffect(() => {
    // A row that no longer uses anything (after an edit) drops the children it showed.
    if (!node.hasChildren || !node.param) return setChildren(null)
    if (!open) return
    call('tree:children', { param: node.param, id: node.id }).then(setChildren)
  }, [open, node.param, node.id, node.hasChildren, version])

  const selected = selection?.kind === 'row' && selection.param === node.param && selection.id === node.id

  return (
    <>
      <div
        className={`tree-row${selected ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => node.param && onSelect({ kind: 'row', param: node.param, id: node.id })}
      >
        <span
          className="twisty"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {node.hasChildren ? (open ? '▾' : '▸') : ''}
        </span>
        <span className="badge kind">{PARAM_LABELS[node.param ?? ''] ?? node.param}</span>
        <span className="ellipsis grow" title={node.via ? `via ${node.via}` : undefined}>
          {node.name || <span className="faint">{node.kind === 'effect' ? `Effect ${node.id}` : 'No name'}</span>}
        </span>
        <CopyId id={node.id} />
        <StateBadge state={node.state} />
        {node.animationCount !== undefined && node.animationCount > 0 && (
          <span
            className="badge kind"
            title={`Fired by ${plural(node.animationCount, 'animation')} — select to see which`}
          >
            ▶ {node.animationCount}
          </span>
        )}
        {node.effects.map((fx) => (
          <button
            key={fx.field}
            className={`fx-chip${fx.exists ? '' : ' missing'}`}
            title={`${fx.label}: effect ${fx.id}${fx.name ? `\n${fx.name}` : ''}${fx.exists ? '' : '\n(not in the common effect bundles)'}`}
            onClick={(e) => {
              e.stopPropagation()
              // A missing one opens too: the Inspector finds which bundle has it.
              onSelect({ kind: 'effect', id: fx.id })
            }}
          >
            ✦{fx.id}
          </button>
        ))}
      </div>
      {open &&
        children?.map((c) => (
          <TreeItem
            key={`${c.key}:${c.via}`}
            node={c}
            depth={depth + 1}
            selection={selection}
            onSelect={onSelect}
            version={version}
          />
        ))}
    </>
  )
}
