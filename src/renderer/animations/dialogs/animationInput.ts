/** Animation names as people type them in the dialogs. */
import { animationName } from '../../../shared/animIds.ts'

/**
 * What a typed animation means: "a050_030000", "50_30000", "a50 30000", or
 * just an id ("030000") in the current category.
 */
export function parseAnimationInput(text: string, category: number | null): string | null {
  const t = text.trim().toLowerCase()
  let m = /^a?(\d{1,3})[_\s-]+(\d{1,6})$/.exec(t)
  if (m) return animationName(Number(m[1]), Number(m[2]))
  m = /^(\d{1,6})$/.exec(t)
  if (m && category !== null) return animationName(category, Number(m[1]))
  return null
}
