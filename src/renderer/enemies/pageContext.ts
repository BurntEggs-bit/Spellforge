/** The Enemies page's state, handed to its dock panels. */
import { createContext, useContext } from 'react'
import type { useEnemiesPage } from './useEnemiesPage.ts'

/** Everything the page's panels show and do; the page owns the state. */
type EnemiesPageState = ReturnType<typeof useEnemiesPage>

export const EnemiesContext = createContext<EnemiesPageState | null>(null)
export const useEnemies = () => useContext(EnemiesContext)!
