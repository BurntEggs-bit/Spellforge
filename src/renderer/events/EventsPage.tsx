/**
 * The game's event scripts (EMEVD): what the world does on its own (gives
 * items, sets flags, brings enemies in, runs boss fights). Scripts on the
 * left (the common one, always loaded; the shared events the maps start;
 * one per map), a script's events in the middle, the event on the right in
 * plain words with what starts it.
 *
 * The project's own events are recipes (Add): Spellforge writes them into
 * the script on Save, each started from the script's event 0. Any event can
 * carry the test marker: a Rowa Fruit when it starts, the community's way
 * of seeing that an event runs.
 */
import { DockArea, type DockPanel, type DockPlacement } from '../app/dock.tsx'
import { type EventsProps, useEventsPage } from './useEventsPage.ts'
import { EventsContext } from './pageContext.ts'
import { ScriptsPanel } from './panels/ScriptsPanel.tsx'
import { EventListPanel } from './panels/EventListPanel.tsx'
import { EventPanel } from './panels/EventPanel.tsx'

const EVENT_PANELS: DockPanel[] = [
  { id: 'eventScripts', title: 'Scripts', component: () => <ScriptsPanel /> },
  { id: 'eventList', title: 'Events', component: () => <EventListPanel /> },
  { id: 'eventView', title: 'Event', component: () => <EventPanel /> },
]
const EVENT_LAYOUT: DockPlacement[] = [
  { id: 'eventScripts', width: 280 },
  { id: 'eventList', ref: 'eventScripts', direction: 'right', width: 420 },
  { id: 'eventView', ref: 'eventList', direction: 'right' },
]

export function EventsPage(props: EventsProps) {
  const page = useEventsPage(props)
  return (
    <EventsContext.Provider value={page}>
      <DockArea page="events" panels={EVENT_PANELS} layout={EVENT_LAYOUT} />
    </EventsContext.Provider>
  )
}
