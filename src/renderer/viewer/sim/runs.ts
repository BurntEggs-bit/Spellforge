/**
 * What an animation plays in the viewer, worked out ahead of playback: every
 * bullet (the character posed at each spawn time for its dummy poly), the
 * effects of effect events, bullets, impacts and weapon buffs, and how far
 * its attacks reach.
 */
import * as THREE from 'three'
import { coatingStops } from '../../../shared/coating.ts'
import { FPS } from '../../../shared/frames.ts'
import { pose } from '../scene/pose.ts'
import { findDummy } from '../scene/dummies.ts'
import type { FxRun } from '../../fx/fxruns.ts'
import type { HelperPrefs } from '../prefs.ts'
import type { ViewerState } from '../scene/state.ts'
import { bulletDir, bulletPos, spawnBullets, type BulletRun } from './bullets.ts'

/** Orientation with +Z along `dir` and +Y toward `up`. */
function basisQuat(dir: THREE.Vector3, up: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const z = dir.clone().normalize()
  const x = up.clone().cross(z)
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0).cross(z)
  x.normalize()
  const y = z.clone().cross(x).normalize()
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

/** How long a coating has been on when an animation starts (its flames and lights fully grown). */
const COAT_WARMUP = 1

/** A dummy's transform in the character's (unmirrored) space. */
function localOf(s: ViewerState, m: THREE.Matrix4): { pos: THREE.Vector3; fwd: THREE.Vector3; up: THREE.Vector3 } {
  const local = s.world.matrixWorld.clone().invert().multiply(m)
  return {
    pos: new THREE.Vector3().setFromMatrixPosition(local),
    fwd: new THREE.Vector3(0, 0, 1).transformDirection(local),
    up: new THREE.Vector3(0, 1, 0).transformDirection(local),
  }
}

/**
 * Works out every bullet of the animation (posing the character at each
 * spawn time for its dummy poly) and the effects to play: effect events at
 * their dummy polys, each bullet's own effect, and impact effects.
 */
export function buildRuns(s: ViewerState, h: HelperPrefs): FxRun[] {
  const now = s.time
  const runs: FxRun[] = []
  const bullets: BulletRun[] = []
  s.targets = []
  const q = new THREE.Quaternion()
  for (const act of s.actions) {
    if (act.bullet) {
      // A spell's cast event that keeps firing fires again every shootInterval while it lasts (Comet Azur's beam).
      const times = [act.start]
      const every = act.bullet.shootInterval
      if (act.repeat && every > 0)
        for (let t = act.start + every; t < act.end - 1e-4 && times.length < 60; t += every) times.push(t)
      times.forEach((t, n) => {
        pose(s, t, h)
        const m = findDummy(s, act.bullet!.dummy, act.bullet!.source) ?? s.actor.matrixWorld.clone()
        const at = localOf(s, m)
        // Elden Ring aims bullets from the character's facing, level, with world
        // up as up; the bullet's side and up angles turn it from there, and the
        // dummy poly says where it starts. Characters face their -Z.
        const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(s.actor.quaternion).setY(0).normalize()
        // Homing needs a target: a stand-in enemy in front of the character.
        const target =
          h.targetDistance > 0
            ? s.actor.position
                .clone()
                .addScaledVector(facing, h.targetDistance)
                .setY(s.actor.position.y + 1.2)
            : null
        if (target && n === 0) s.targets.push(target)
        spawnBullets(
          act.bullet!,
          act.bulletTable,
          t,
          at.pos,
          { dir: facing, up: new THREE.Vector3(0, 1, 0) },
          facing,
          0,
          n ? `e${act.event}.r${n}` : `e${act.event}`,
          bullets,
          target,
          null,
          false,
        )
      })
    }
    if (act.effect) {
      const e = act.effect
      if (e.follow) {
        runs.push({
          key: `f${act.event}`,
          effectId: e.id,
          t0: act.start,
          t1: act.end,
          place: (_t, pos, quat) => {
            const m = findDummy(s, e.dummy, e.source)
            if (!m) return false
            const l = localOf(s, m)
            pos.copy(l.pos)
            basisQuat(l.fwd, l.up, quat)
            return true
          },
        })
      } else {
        pose(s, act.start, h)
        const m = findDummy(s, e.dummy, e.source)
        if (m) {
          const l = localOf(s, m)
          const fixed = basisQuat(l.fwd, l.up, new THREE.Quaternion())
          runs.push({
            key: `f${act.event}`,
            effectId: e.id,
            t0: act.start,
            t1: act.end,
            place: (_t, pos, quat) => {
              pos.copy(l.pos)
              quat.copy(fixed)
              return true
            },
          })
        }
      }
    }
  }
  for (const b of bullets) {
    // A bullet that took over its parent's effect doesn't start its own.
    if (b.def.effect > 0 && !b.inherited) {
      // Follow this bullet, then the stages it hands the effect to.
      const chain: BulletRun[] = [b]
      while (chain[chain.length - 1].heir && chain.length < 8) chain.push(chain[chain.length - 1].heir!)
      const last = chain[chain.length - 1]
      const tmpDir = new THREE.Vector3()
      runs.push({
        key: `b${b.key}`,
        effectId: b.def.effect,
        t0: b.t0,
        t1: last.t0 + last.life,
        place: (t, pos, quat) => {
          const run = chain.find((c, i) => i === chain.length - 1 || t < c.t0 + c.life) ?? last
          bulletPos(run, t - run.t0, pos)
          basisQuat(bulletDir(run, t - run.t0, tmpDir), run.up, quat)
          return true
        },
      })
    }
    // Impact effect where it ends (not where it hands over to its next stage).
    if (b.def.hitEffect > 0 && !b.heir) {
      const end = bulletPos(b, b.life, new THREE.Vector3())
      const qq = basisQuat(bulletDir(b, b.life, new THREE.Vector3()), b.up, q.clone())
      runs.push({
        key: `h${b.key}`,
        effectId: b.def.hitEffect,
        t0: b.t0 + b.life,
        t1: b.t0 + b.life + 1,
        place: (_t, pos, quat) => {
          pos.copy(end)
          quat.copy(qq)
          return true
        },
      })
    }
  }
  s.bullets = bullets
  // Weapon buffs (greases): their coating stays on the weapon the whole time
  // and covers the whole blade. Each group runs from its first point (300;
  // 310 for a second blade) through the numbers that follow (301, 302…) to
  // the last, or to the row's end point; the game fills that line, not just
  // the points (a longsword has only 300 at the hilt and 301 at the tip). A
  // copy every 15 cm along it (COAT_STEP), facing along the blade, tiles it: the
  // coatings' emitters are boxes that long along the blade.
  s.buffs.forEach((b, i) => {
    const part = s.parts.get(b.source)
    if (!part) return
    const byId = new Map(part.view.dummies.map((d) => [d.id, d]))
    b.groups.forEach((g, gi) => {
      const end = b.ends?.[gi] ?? -1
      const chain: number[] = []
      for (let id = g; byId.has(id) && chain.length < 32; id++) {
        chain.push(id)
        if (id === end) break
      }
      for (const stop of coatingStops(chain.map((id) => byId.get(id)!.position))) {
        const a = chain[stop.from]
        const z = chain[stop.to]
        runs.push({
          key: `buff${i}:${b.effectId}@${b.source}${a}-${z}:${stop.f.toFixed(3)}`,
          effectId: b.effectId,
          // Already burning when the animation starts, as in game.
          t0: -COAT_WARMUP,
          t1: 1e9,
          place: (_t, pos, quat) => {
            const ma = findDummy(s, a, b.source)
            const mz = a === z ? ma : findDummy(s, z, b.source)
            if (!ma || !mz) return false
            const la = localOf(s, ma)
            const lz = localOf(s, mz)
            pos.copy(la.pos).lerp(lz.pos, stop.f)
            basisQuat(la.fwd.lerp(lz.fwd, stop.f), la.up.lerp(lz.up, stop.f), quat)
            return true
          },
        })
      }
    })
  })
  // How far the attacks reach from where the animation starts: each hit shape
  // sampled every frame while its event runs (the farthest edge, along the ground).
  s.reach = null
  for (const act of s.actions) {
    if (!act.hits.length || act.end <= act.start) continue
    const end = Math.min(act.end, s.clip ? s.clip.view.duration || act.end : act.end)
    for (let t = act.start; t <= end + 1e-6; t += 1 / FPS) {
      pose(s, t, h)
      for (const hit of act.hits) {
        for (const d of [hit.dummy1, hit.dummy2]) {
          if (d < 0) continue
          const m = findDummy(s, d, hit.source)
          if (!m) continue
          const p = localOf(s, m).pos
          const dist = Math.hypot(p.x, p.z) + hit.radius
          if (!s.reach || dist > s.reach.dist) {
            const dir = new THREE.Vector3(p.x, 0, p.z)
            const far = dir.lengthSq() > 1e-8 ? dir.normalize().multiplyScalar(dist) : new THREE.Vector3(0, 0, -dist)
            s.reach = { dist, point: far }
          }
        }
      }
    }
  }
  pose(s, now, h)
  return runs
}
