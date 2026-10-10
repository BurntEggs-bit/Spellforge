/** The Text page's state, handed to its dock panels. */
import { createContext, useContext } from 'react'
import type { useTextPage } from './useTextPage.ts'

/** Everything the page's panels show and do; the page owns the state. */
type TextPageState = ReturnType<typeof useTextPage>

export const TextContext = createContext<TextPageState | null>(null)
export const useText = () => useContext(TextContext)!
