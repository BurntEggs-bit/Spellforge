/** What the editor knows of an event at a glance: its kind (colours, lane order) and whether it runs to the end. */
import { OPEN_EVENT_END } from '../../../shared/api.ts'

type Kind = 'attack' | 'sfx' | 'sound' | 'speffect' | 'flag' | 'other'

export function kindOf(name: string): Kind {
  if (/Behavior/i.test(name)) return 'attack'
  if (/FFX|Sfx/i.test(name)) return 'sfx'
  if (/Sound|Wwise/i.test(name)) return 'sound'
  if (/SpEffect/i.test(name)) return 'speffect'
  if (/Flag|JumpTable|Cancel/i.test(name)) return 'flag'
  return 'other'
}

export const KIND_ORDER: Kind[] = ['attack', 'sfx', 'speffect', 'sound', 'flag', 'other']
export const isOpen = (end: number) => end >= OPEN_EVENT_END
