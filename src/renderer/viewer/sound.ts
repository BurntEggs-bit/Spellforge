/**
 * Plays an animation's sound events in the viewer, as the game would post
 * them: each event's Wwise sounds (main: sound:clip, converted to Ogg Vorbis)
 * decoded once, then one of its choices picked by weight each time it plays,
 * its sounds together at their loudness and pitch from the bank.
 *
 * Not like the game: no distance, panning, filters or buses (every sound at
 * the listener), and a switch (floor or armour material) always plays its
 * default. Overlapping sounds add up past full scale (a combo's clashes
 * reach about 1.2), so a gentle limiter stands in for the game's mix: above
 * -6 dB at 12:1, which keeps the loudest parts under full scale with almost
 * the same loudness.
 */
import type { SoundClip } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'

interface Loaded {
  choices: { buffer: AudioBuffer; gain: number; rate: number }[][]
  weights: number[]
}

/** Sounds asked for this long after their moment are skipped rather than played late. */
const LATE_MS = 250

export class SoundPlayer {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private clips = new Map<string, Promise<Loaded | null>>()
  private live = new Set<AudioBufferSourceNode>()
  private volume = 0.6

  private context(): { ctx: AudioContext; out: GainNode } {
    if (!this.ctx || !this.out) {
      this.ctx = new AudioContext()
      this.out = this.ctx.createGain()
      this.out.gain.value = this.volume
      const limit = this.ctx.createDynamicsCompressor()
      limit.threshold.value = -6
      limit.knee.value = 3
      limit.ratio.value = 12
      limit.attack.value = 0.002
      limit.release.value = 0.2
      this.out.connect(limit).connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
    return { ctx: this.ctx, out: this.out }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.out) this.out.gain.value = this.volume
  }

  /** Fetches and decodes a sound event's audio, once. */
  prepare(chr: string, type: number, id: number): Promise<Loaded | null> {
    const key = `${chr}:${type}:${id}`
    let p = this.clips.get(key)
    if (!p) {
      p = call('sound:clip', { chr, type, id })
        .then((clip) => this.decode(clip))
        .catch(() => null)
      this.clips.set(key, p)
    }
    return p
  }

  private async decode(clip: SoundClip): Promise<Loaded | null> {
    if (!clip.choices.length) return null
    const { ctx } = this.context()
    const buffers = new Map<number, AudioBuffer>()
    for (const [media, b64] of Object.entries(clip.audio)) {
      try {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
        buffers.set(Number(media), await ctx.decodeAudioData(bytes.buffer))
      } catch {
        /* a sound the browser can't decode: left out */
      }
    }
    const choices: Loaded['choices'] = []
    const weights: number[] = []
    clip.choices.forEach((c, i) => {
      const voices = c.flatMap((v) => {
        const buffer = buffers.get(v.media)
        return buffer
          ? [
              {
                buffer,
                gain: Math.pow(10, Math.max(-96, Math.min(24, v.volume)) / 20),
                rate: Math.pow(2, Math.max(-2400, Math.min(2400, v.pitch)) / 1200),
              },
            ]
          : []
      })
      if (voices.length) {
        choices.push(voices)
        weights.push(clip.weights[i] ?? 1)
      }
    })
    return choices.length ? { choices, weights } : null
  }

  /** Plays a sound event now (when it has loaded in time). */
  play(chr: string, type: number, id: number): void {
    const asked = performance.now()
    void this.prepare(chr, type, id).then((clip) => {
      if (!clip || performance.now() - asked > LATE_MS) return
      const { ctx, out } = this.context()
      const total = clip.weights.reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      let pick = clip.choices.length - 1
      for (let i = 0; i < clip.weights.length; i++) {
        r -= clip.weights[i]
        if (r <= 0) {
          pick = i
          break
        }
      }
      for (const v of clip.choices[pick]) {
        const src = ctx.createBufferSource()
        src.buffer = v.buffer
        src.playbackRate.value = v.rate
        const g = ctx.createGain()
        g.gain.value = v.gain
        src.connect(g).connect(out)
        src.onended = () => this.live.delete(src)
        this.live.add(src)
        src.start()
      }
    })
  }

  /** Stops every sound playing (a pause, another animation). */
  stop(): void {
    for (const s of this.live) {
      try {
        s.stop()
      } catch {
        /* already ended */
      }
    }
    this.live.clear()
  }

  dispose(): void {
    this.stop()
    this.clips.clear()
    void this.ctx?.close().catch(() => {})
    this.ctx = null
    this.out = null
  }
}
