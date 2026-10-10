/**
 * Animation time in frames. Elden Ring's animations (their HKX clips and TAE
 * events) run at 30 frames a second, and DS Anim Studio counts in those
 * frames, so the UI shows and snaps to them while the data is in seconds.
 */
export const FPS = 30

/** Seconds as frames (not rounded). */
export function toFrames(seconds: number): number {
  return seconds * FPS
}

/** Frames as seconds. */
export function toSeconds(frames: number): number {
  return frames / FPS
}

/** A time moved to the nearest frame. */
export function snapToFrame(seconds: number): number {
  return Math.round(seconds * FPS) / FPS
}

/** The frame a time falls on, to show: `decimals` places at most ("12.5", "30"). */
export function frameNumber(seconds: number, decimals = 2): number {
  return +(seconds * FPS).toFixed(decimals)
}
