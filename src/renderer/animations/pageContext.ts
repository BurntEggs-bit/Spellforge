/** The Animations page's state, handed to its dock panels. */
import { createContext, useContext } from 'react'
import type { useAnimationsPage } from './useAnimationsPage.ts'

/** Everything the page's panels show and do; the page owns the state. */
type AnimationsPageState = ReturnType<typeof useAnimationsPage>

export const AnimationsContext = createContext<AnimationsPageState | null>(null)
export const useAnimations = () => useContext(AnimationsContext)!
