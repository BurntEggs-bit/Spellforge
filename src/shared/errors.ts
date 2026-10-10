/** A thrown value's message, for showing or logging: an Error's message, or the value itself in words. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') return e.message
  return String(e)
}
