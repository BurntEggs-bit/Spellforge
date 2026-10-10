/**
 * Events copied with Ctrl+C / Ctrl+X: pasted into any animation, in any
 * window, for as long as Spellforge runs (another project opened keeps them).
 */
import { useSyncExternalStore } from 'react'
import type { AnimClipboardEvent } from '../../shared/api.ts'

let copied: AnimClipboardEvent[] | null = null
const listeners = new Set<() => void>()

export function copiedEvents(): AnimClipboardEvent[] | null {
  return copied
}

export function setCopiedEvents(events: AnimClipboardEvent[] | null): void {
  copied = events
  for (const f of listeners) f()
}

function subscribe(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

/** The copied events, re-rendering when they change. */
export function useCopiedEvents(): AnimClipboardEvent[] | null {
  return useSyncExternalStore(subscribe, copiedEvents)
}
