/** The Params page's state, handed to its panels: what is selected, pinned, and what they can open. */
import { createContext, useContext } from 'react'
import type { ProjectSummary } from '../../shared/api.ts'

/** What the Inspector shows: a param row or an effect. */
export type Selection = { kind: 'row'; param: string; id: number } | { kind: 'effect'; id: number }

/** A param row. */
export type RowRef = { param: string; id: number }

export interface ParamsPageState {
  project: ProjectSummary
  version: number
  root: RowRef | null
  selection: Selection | null
  /** A pinned Inspector keeps showing this while you browse. */
  pinnedSelection: Selection | null
  setPinnedSelection: (s: Selection | null) => void
  /** A pinned "Everything it uses" keeps this tree while you browse. */
  pinnedRoot: RowRef | null
  setPinnedRoot: (r: RowRef | null) => void
  /** Opens a row (as the tree's root) or an effect. */
  openRow: (param: string, id: number) => void
  /** Selects within the current tree (the root stays). */
  select: (s: Selection) => void
  /** Opens a row as the new root and selects it. */
  openRoot: (param: string, id: number) => void
  edited: () => void
  duplicate: (roots: RowRef[]) => void
  openAnimation: (name: string) => void
  /** Entire spell: casts a spell from start to finish on the Animations page. */
  openEntireSpell: (spell: number) => void
  cleared: () => void
  /** Opens "Update from game" (projects made with an older game version). */
  openUpdate: () => void
}

export const ParamsContext = createContext<ParamsPageState | null>(null)
export const useParams = () => useContext(ParamsContext)!
