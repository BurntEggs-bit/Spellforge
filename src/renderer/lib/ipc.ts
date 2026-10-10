/**
 * The UI's one way to the main process, which owns every file and the open
 * project: a channel of src/shared/api.ts and its request, answered as a
 * promise (the preload exposes `window.spellforge`).
 */
import type { Channel, Req, Res, SpellforgeBridge } from '../../shared/api.ts'

declare global {
  interface Window {
    spellforge: SpellforgeBridge
  }
}

/** Asks the main process: the channel's answer, or its error as a rejection. */
export function call<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>> {
  return window.spellforge.invoke(channel, request)
}
