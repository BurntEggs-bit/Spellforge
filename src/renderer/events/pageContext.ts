/** The Events page's state, handed to its dock panels. */
import { createContext, useContext } from 'react'
import type { useEventsPage } from './useEventsPage.ts'

/** Everything the page's panels show and do; the page owns the state. */
type EventsPageState = ReturnType<typeof useEventsPage>

export const EventsContext = createContext<EventsPageState | null>(null)
export const useEvents = () => useContext(EventsContext)!
