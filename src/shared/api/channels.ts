/** IPC contract: the channel map (every channel with its request and response) and the bridge the preload exposes. */
import type { SetupChannels } from './setup.ts'
import type { ProjectChannels } from './project.ts'
import type { ParamsChannels } from './params.ts'
import type { IdsChannels } from './ids.ts'
import type { EffectsChannels } from './effects.ts'
import type { TextChannels } from './text.ts'
import type { AnimationsChannels } from './animations.ts'
import type { CharacterChannels } from './character.ts'
import type { EnemiesChannels } from './enemies.ts'
import type { ScaleChannels } from './scale.ts'
import type { MovesetChannels } from './moveset.ts'
import type { BehaviorChannels } from './behavior.ts'
import type { EventsChannels } from './events.ts'

/** Every IPC channel: request type and response type. */
export interface Api
  extends
    SetupChannels,
    ProjectChannels,
    ParamsChannels,
    IdsChannels,
    EffectsChannels,
    TextChannels,
    AnimationsChannels,
    CharacterChannels,
    EnemiesChannels,
    ScaleChannels,
    MovesetChannels,
    BehaviorChannels,
    EventsChannels {}

export type Channel = keyof Api

export type Req<C extends Channel> = Api[C][0]

export type Res<C extends Channel> = Api[C][1]

export interface SpellforgeBridge {
  invoke<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>>
  /** A popped-out window being dragged by its title bar (desktop app only). */
  onPopoutMove?(listener: (e: PopoutMoveEvent) => void): () => void
}

/**
 * A popped-out window moving: the cursor relative to the main window's
 * content area. `moving` while dragged, `moved` when let go.
 */
export interface PopoutMoveEvent {
  /** The popout window's name (window.name in the page). */
  name: string
  kind: 'moving' | 'moved'
  x: number
  y: number
  /** The cursor is over the main window's content. */
  inside: boolean
}
