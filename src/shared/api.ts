/**
 * The contract between the main process (which owns all files and data) and
 * the UI. Everything crossing IPC is plain JSON described here, one file per
 * domain under api/ (its views, requests and channels); api/channels.ts
 * gathers the channels into `Api`.
 */
export * from './api/setup.ts'
export * from './api/project.ts'
export * from './api/params.ts'
export * from './api/ids.ts'
export * from './api/effects.ts'
export * from './api/preview.ts'
export * from './api/text.ts'
export * from './api/animations.ts'
export * from './api/character.ts'
export * from './api/enemies.ts'
export * from './api/scale.ts'
export * from './api/moveset.ts'
export * from './api/behavior.ts'
export * from './api/events.ts'
export * from './api/channels.ts'
