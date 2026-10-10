/**
 * The playback clock an animation page shares between its viewer, its
 * toolbar and its timeline: they follow it without React re-renders.
 */
import { FPS } from '../../shared/frames.ts'

/** Playback time, speed and looping; subscribers hear of every change (emit). */
export class PlayClock {
  time = 0
  playing = false
  speed = 1
  loop = true
  duration = 0
  /** The playing clip's frame length (seconds); stepping moves by it. */
  frameDuration = 1 / FPS
  private subs = new Set<() => void>()
  subscribe(f: () => void): () => void {
    this.subs.add(f)
    return () => this.subs.delete(f)
  }
  emit(): void {
    for (const f of this.subs) f()
  }
  set(t: number): void {
    this.time = Math.max(0, Math.min(this.duration || 0, t))
    this.emit()
  }
  /** A clip to play: its length and frame length (seconds). The playhead stays, unless it's past the end. */
  load(duration: number, frameDuration: number): void {
    this.duration = duration
    this.frameDuration = frameDuration
    if (this.time > duration) this.time = 0
  }
  /** No clip: nothing to play (the playhead stays where it was for the next one). */
  unload(): void {
    this.duration = 0
  }
  /** Plays from `t` (seconds). */
  playFrom(t: number): void {
    this.set(t)
    this.playing = true
    this.emit()
  }
  /** Stops at `t` (seconds). */
  pauseAt(t: number): void {
    this.playing = false
    this.set(t)
  }
  setSpeed(speed: number): void {
    this.speed = speed
    this.emit()
  }
  setLoop(loop: boolean): void {
    this.loop = loop
    this.emit()
  }
  toggle(): void {
    if (!this.playing && this.time >= this.duration - 1e-4) this.time = 0
    this.playing = !this.playing
    this.emit()
  }
  step(frames: number): void {
    this.playing = false
    this.set(Math.round(this.time / this.frameDuration + frames) * this.frameDuration)
  }
  tick(dt: number): void {
    if (!this.playing || !this.duration) return
    let t = this.time + dt * this.speed
    if (t > this.duration) {
      if (this.loop) t %= this.duration
      else {
        t = this.duration
        this.playing = false
      }
    }
    this.time = t
    this.emit()
  }
}
