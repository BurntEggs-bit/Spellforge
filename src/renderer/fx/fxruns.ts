/**
 * Real FXR effects in the animation viewport, in step with the animation.
 *
 * An EffectInstance is one effect (its emitters, textures and models) placed
 * at a position and orientation that can change every frame (a dummy poly on
 * a moving hand, a flying bullet). The FxManager owns the instances for a set
 * of "runs" (an effect from start time to stop time, with a placement over
 * time) and keeps them matched to the playhead: stepping while playing,
 * replaying from the start when you scrub backwards or jump.
 */
import * as THREE from 'three'
import type { PreviewSpec } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { clearOnProjectChange } from '../lib/projectCaches.ts'
import { dotTexture, shardTexture } from './canvasTextures.ts'
import { EmitterSim } from './EmitterSim.ts'
import { decodeRig } from './rig.ts'
import { ModelPool } from './ModelPool.ts'
import { cachedTexture, lateTexture, type TextureRef } from './textures.ts'

/* ------------------------------- loading -------------------------------- */
const specs = new Map<number, Promise<PreviewSpec | null>>()
/** Bumped when the project's effects change (edits, scaling): specs are read again, playing effects reload. */
let generation = 0
export function effectsChanged(): void {
  specs.clear()
  generation++
}
clearOnProjectChange(effectsChanged)
function effectSpec(id: number): Promise<PreviewSpec | null> {
  let p = specs.get(id)
  if (!p) {
    p = call('effect:preview', { id }).catch(() => null)
    specs.set(id, p)
  }
  return p
}

let dot: THREE.Texture | null = null
let shard: THREE.Texture | null = null

/* -------------------------------- instance ------------------------------- */
class EffectInstance {
  readonly group = new THREE.Group()
  readonly sims: EmitterSim[] = []
  private pools = new Map<EmitterSim, ModelPool>()
  private disposed = false
  /** Effect-local time. */
  time = 0
  readonly spec: PreviewSpec

  constructor(spec: PreviewSpec, bloomPass: { value: number }, groundY: number) {
    this.spec = spec
    dot ??= dotTexture()
    shard ??= shardTexture()
    for (const e of spec.emitters) {
      // Screen effects (heat haze, radial blur) and lens flares need the
      // preview's extra buffers; the viewport leaves them out.
      if (e.appearance.screen || e.appearance.kind === 'lensFlare') continue
      const isModel = e.appearance.kind === 'model'
      const sim = new EmitterSim(e, isModel ? shard : dot, bloomPass)
      sim.groundY = groundY
      sim.forces = []
      this.group.add(sim.mesh)
      if (sim.ribbon) this.group.add(sim.ribbon)
      const tex = e.appearance.texture
      if (tex && !isModel)
        cachedTexture(tex, { greyAsAlpha: true }).then((t) => t && !this.disposed && sim.setTexture(t))
      const mask = e.appearance.mask
      if (mask && !isModel)
        cachedTexture(mask, { greyAsAlpha: 'mask', size: 128 }).then((t) => t && !this.disposed && sim.setMask(t))
      const modelId = e.appearance.model
      if (isModel && modelId) {
        const anim = e.appearance.modelAnimation
        Promise.all([
          call('model:mesh', { id: modelId }),
          anim
            ? call('model:rig', { model: modelId, anibnd: anim.anibnd, animation: anim.animation }).catch(() => null)
            : null,
        ])
          .then(([meshes, rig]) => {
            if (!meshes || this.disposed) return
            // Models take their particles' places only when updated, which a
            // step does: draw them as soon as they (or a late texture) arrive,
            // or a paused viewer shows nothing until the playhead moves (as
            // after an effect is moved or turned by hand, then reloaded).
            const redraw = () => {
              if (!this.disposed) this.pools.get(sim)?.update(sim.instances)
            }
            const modelTex = (ref: TextureRef | null | undefined): THREE.Texture | null => {
              if (!ref) return null
              const load = cachedTexture(ref)
              const texture = lateTexture(load, () => !this.disposed)
              void load.then(redraw)
              return texture
            }
            const pool = new ModelPool(meshes, e.appearance, modelTex, rig && anim ? decodeRig(rig, anim) : null)
            this.pools.set(sim, pool)
            this.group.add(pool.root)
            sim.mesh.visible = false
            redraw()
          })
          .catch(() => {})
      }
      this.sims.push(sim)
    }
  }

  reset(): void {
    this.time = 0
    for (const s of this.sims) s.reset()
  }

  step(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion, stopAt: number): void {
    this.time += dt
    for (const s of this.sims) {
      s.frame.copy(quat)
      s.stopTime = stopAt
      s.update(this.time, dt, pos)
      this.pools.get(s)?.update(s.instances)
    }
  }

  alive(): number {
    let n = 0
    for (const s of this.sims) n += s.alive()
    return n
  }

  lights(): { pos: THREE.Vector3; color: number[]; radius: number }[] {
    return this.sims
      .filter((s) => s.lightOut)
      .map((s) => ({ ...s.lightOut!, radius: s.spec_.appearance.light?.radius ?? 10 }))
  }

  dispose(): void {
    this.disposed = true
    this.group.parent?.remove(this.group)
    for (const s of this.sims) s.dispose()
    for (const p of this.pools.values()) p.dispose()
  }
}

/* -------------------------------- manager -------------------------------- */

/** An effect played from animation time t0, stopping new emission at t1. */
export interface FxRun {
  key: string
  effectId: number
  t0: number
  t1: number
  /** Where the effect is at animation time `t` (in the parent's space); false if it can't be placed. */
  place: (t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => boolean
}

interface Live {
  run: FxRun
  inst: EffectInstance | null
  loading: boolean
  missing: boolean
  lastT: number
  /** The effects' generation its instance was made from. */
  gen: number
}

/** The effects' fixed simulation step (30 a second) when replaying from the start or sub-stepping. */
const STEP = 1 / 30
/** How long after stopping an effect's remaining particles may linger. */
const TAIL = 6

export class FxManager {
  private parent: THREE.Object3D
  private groundY: number
  private bloomPass = { value: 0 }
  private live = new Map<string, Live>()
  /** Moves and turns on top of where runs place their effects (by run key), while one is being dragged. */
  private adjustments = new Map<string, { pos: THREE.Vector3; quat: THREE.Quaternion }>()
  /** Effects that loaded, for the status line. */
  playing = 0

  constructor(parent: THREE.Object3D, groundY: number) {
    this.parent = parent
    this.groundY = groundY
  }

  setRuns(runs: FxRun[]): void {
    const keep = new Set(runs.map((r) => r.key))
    for (const [k, l] of this.live) {
      if (keep.has(k)) continue
      l.inst?.dispose()
      this.live.delete(k)
    }
    for (const r of runs) {
      const cur = this.live.get(r.key)
      if (cur && cur.run.effectId === r.effectId) {
        cur.run = r
        cur.lastT = -1
        continue
      }
      cur?.inst?.dispose()
      this.live.set(r.key, { run: r, inst: null, loading: false, missing: false, lastT: -1, gen: generation })
    }
  }

  /**
   * Shows a run's effect moved by `pos` and turned by `quat`, in its own axes, on top of where the run
   * places it (null: as placed); it plays again from its start so its particles follow.
   */
  adjust(key: string, change: { pos: THREE.Vector3; quat: THREE.Quaternion } | null): void {
    if (change) this.adjustments.set(key, change)
    else this.adjustments.delete(key)
    const l = this.live.get(key)
    if (l) l.lastT = -1
  }

  /** Where a run places its effect at animation time `t`, as the run says (no adjustment). */
  placement(key: string, t: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    const l = this.live.get(key)
    return !!l && l.run.place(t, pos, quat)
  }

  /** Where a run places its effect at `t`, with the adjustment being dragged. */
  private placeAt(r: FxRun, t: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    if (!r.place(t, pos, quat)) return false
    const a = this.adjustments.get(r.key)
    if (a) {
      pos.add(a.pos.clone().applyQuaternion(quat))
      quat.multiply(a.quat)
    }
    return true
  }

  private ensure(l: Live): void {
    if (l.gen !== generation && !l.loading) {
      // The effect changed since: show the new one.
      l.inst?.dispose()
      l.inst = null
      l.missing = false
      l.lastT = -1
      l.gen = generation
    }
    if (l.inst || l.loading || l.missing) return
    l.loading = true
    effectSpec(l.run.effectId).then((spec) => {
      l.loading = false
      if (!spec || !spec.emitters.length) {
        l.missing = true
        return
      }
      if (!this.live.has(l.run.key)) return
      l.inst = new EffectInstance(spec, this.bloomPass, this.groundY)
      this.parent.add(l.inst.group)
      l.lastT = -1
    })
  }

  update(t: number): void {
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    let playing = 0
    for (const l of this.live.values()) {
      const r = l.run
      if (t < r.t0) {
        if (l.inst) l.inst.group.visible = false
        l.lastT = -1
        continue
      }
      this.ensure(l)
      const inst = l.inst
      if (!inst) continue
      const local = t - r.t0
      const stopAt = r.t1 - r.t0
      // Done: stopped, past the tail, nothing left.
      if (local > stopAt + TAIL || (local > stopAt && l.lastT >= 0 && inst.alive() === 0 && local > stopAt + 0.5)) {
        inst.group.visible = false
        l.lastT = t
        continue
      }
      inst.group.visible = true
      playing++
      const dt = t - l.lastT
      if (l.lastT < 0 || dt < 0 || dt > 0.25) {
        // Jumped (scrub, loop, new animation): replay from the start to now.
        inst.reset()
        const target = Math.min(local, stopAt + TAIL)
        let tau = 0
        while (tau + STEP <= target) {
          tau += STEP
          if (this.placeAt(r, r.t0 + tau, pos, quat)) inst.step(STEP, pos, quat, stopAt)
          else inst.time += STEP
        }
        const rest = target - tau
        if (rest > 1e-5 && this.placeAt(r, t, pos, quat)) inst.step(rest, pos, quat, stopAt)
      } else if (dt > 0) {
        // Playing forward: sub-step so fast playback stays stable.
        const n = Math.max(1, Math.ceil(dt / STEP))
        for (let k = 1; k <= n; k++) {
          const at = l.lastT + (dt * k) / n
          if (this.placeAt(r, at, pos, quat)) inst.step(dt / n, pos, quat, stopAt)
        }
      }
      l.lastT = t
    }
    this.playing = playing
  }

  lights(): { pos: THREE.Vector3; color: number[]; radius: number }[] {
    const out: { pos: THREE.Vector3; color: number[]; radius: number }[] = []
    for (const l of this.live.values()) if (l.inst?.group.visible) out.push(...l.inst.lights())
    return out
  }

  dispose(): void {
    for (const l of this.live.values()) l.inst?.dispose()
    this.live.clear()
  }
}
