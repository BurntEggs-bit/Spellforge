/** Whether the behaviour graph can play an animation: a coloured dot that says so on hover. */
import type { AnimRegistration } from '../../shared/api.ts'

const REG_TEXT: Record<AnimRegistration, string> = {
  registered: 'The behaviour graph can play it',
  missing: 'Not in the behaviour graph yet: the game won’t play it until it’s registered',
  unsupported: 'No behaviour selector uses this animation ID, so it can’t be registered automatically',
}

export function RegDot({ r }: { r: AnimRegistration }) {
  return <span className={`reg-dot ${r}`} title={REG_TEXT[r]} />
}
