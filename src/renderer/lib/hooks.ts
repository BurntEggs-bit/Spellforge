/** Small React hooks the pages share. */
import { useLayoutEffect, useRef } from 'react'

/**
 * A ref holding the latest value, for code that runs after the render that
 * produced it: event listeners, render loops and timers set up once. It is
 * updated as each render commits, before any effect of that render runs.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
