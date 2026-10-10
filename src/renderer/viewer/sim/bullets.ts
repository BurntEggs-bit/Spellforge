/**
 * Bullets in the character viewer: each shot's flight (speed, acceleration,
 * gravity, homing) and the stages and children it spawns, aimed and chained
 * as Elden Ring does it (docs/NOTES.md, "How chained bullets aim").
 */
import * as THREE from 'three'
import type { SimBullet } from '../../../shared/api.ts'

/* ------------------------------ bullets and fx ------------------------------ */
/** One flying bullet: where and when it left, and its flight path. */
export interface BulletRun {
  key: string
  def: SimBullet
  t0: number
  life: number
  /** In the character's (unmirrored) space. */
  origin: THREE.Vector3
  up: THREE.Vector3
  /** Flight path sampled every PATH_STEP seconds: positions and directions. */
  path: THREE.Vector3[]
  dirs: THREE.Vector3[]
  speedEnd: number
  depth: number
  shot: number
  /** The stage this one hands its effect to (isInheritSfxToChild). */
  heir: BulletRun | null
  /** Its effect is the parent's, continued. */
  inherited: boolean
}

export const PATH_STEP = 1 / 60

/**
 * Flies a bullet: speed with acceleration between its min and max, gravity,
 * and homing toward the target at its turn rate (as the game does when
 * locked on, or always with auto homing).
 */
function fly(
  def: SimBullet,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  speed0: number,
  life: number,
  target: THREE.Vector3 | null,
): { path: THREE.Vector3[]; dirs: THREE.Vector3[]; speed: number; life: number } {
  const path = [origin.clone()]
  const dirs = [dir.clone().normalize()]
  const pos = origin.clone()
  const d = dir.clone().normalize()
  let speed = speed0
  let vy = 0
  const steps = Math.max(1, Math.ceil(life / PATH_STEP))
  let end = life
  for (let k = 1; k <= steps; k++) {
    speed += def.accel * PATH_STEP
    if (def.maxSpeed > 0) speed = Math.min(speed, def.maxSpeed)
    if (def.minSpeed > 0) speed = Math.max(speed, def.minSpeed)
    if (target && def.homingAngle > 0) {
      const want = target.clone().sub(pos)
      if (want.length() > Math.max(0.05, def.homingStop)) {
        want.normalize()
        const angle = d.angleTo(want)
        const maxTurn = THREE.MathUtils.degToRad(def.homingAngle) * PATH_STEP
        if (angle > 1e-5) {
          const axis = d.clone().cross(want)
          if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0)
          d.applyAxisAngle(axis.normalize(), Math.min(angle, maxTurn)).normalize()
        }
      }
    }
    vy -= Math.max(0, def.gravity) * PATH_STEP
    const prev = path[path.length - 1]
    pos.addScaledVector(d, Math.max(0, speed) * PATH_STEP)
    pos.y += vy * PATH_STEP
    // Falling bullets, and others that fly down into the ground, end on it (unless they go through the map).
    if (pos.y <= 0 && pos.y < prev.y - 1e-6 && (def.gravity > 0 || !def.penetrateMap)) {
      path.push(prev.clone().lerp(pos, prev.y > 0 ? prev.y / (prev.y - pos.y) : 0))
      dirs.push(d.clone())
      end = k * PATH_STEP
      break
    }
    path.push(pos.clone())
    dirs.push(d.clone())
  }
  return { path, dirs, speed, life: Math.min(life, end) }
}

export function bulletPos(b: BulletRun, age: number, out: THREE.Vector3): THREE.Vector3 {
  const f = Math.max(0, Math.min(b.path.length - 1, age / PATH_STEP))
  const i = Math.min(b.path.length - 2, Math.floor(f))
  if (i < 0) return out.copy(b.path[0])
  return out.lerpVectors(b.path[i], b.path[i + 1], f - i)
}

export function bulletDir(b: BulletRun, age: number, out: THREE.Vector3): THREE.Vector3 {
  const i = Math.max(0, Math.min(b.dirs.length - 1, Math.round(age / PATH_STEP)))
  return out.copy(b.dirs[i])
}

export function radiusAt(def: SimBullet, age: number): number {
  return def.radiusMax > def.radius && def.spreadTime > 0
    ? def.radius + (def.radiusMax - def.radius) * Math.min(1, age / def.spreadTime)
    : def.radius
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/** Bullet runs simulated per animation, at most (a sword rain is hundreds: swords, their stages, what they emit). */
const MAX_RUNS = 1200

/** A repeatable random number in [0, 1) for a key, so a bullet's spread is the same every time it's simulated. */
function hash01(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/**
 * A shot's direction and up, turned from a base direction as Elden Ring
 * aims a bullet: up by its up angle, then left by its side angle, in a level
 * frame (world up). For a stage fired from a bullet flying straight up, that
 * frame comes from the last bit of heading the parent has: the game's rising
 * bullets aim 89°, not 90°, so a split emitter's up-angle spread (Morgott's
 * sword rain: side 90°, up -90° + k × 72°) comes out as a level fan around
 * the caster, and each sword it drops (up -90°) points straight down.
 * `right`: the frame's right for a base that points exactly up or down.
 */
function aim(
  base: THREE.Vector3,
  yawDeg: number,
  pitchDeg: number,
  right: THREE.Vector3,
): { dir: THREE.Vector3; up: THREE.Vector3 } {
  const z = base.clone().normalize()
  // x = up × forward is the frame's right (the character faces -Z, its right is -X).
  const x = WORLD_UP.clone().cross(z)
  if (x.lengthSq() < 1e-10) x.copy(right)
  x.normalize()
  const y = z.clone().cross(x).normalize()
  const yaw = THREE.MathUtils.degToRad(yawDeg)
  const p = THREE.MathUtils.degToRad(pitchDeg)
  const dir = new THREE.Vector3()
    .addScaledVector(x, -Math.cos(p) * Math.sin(yaw))
    .addScaledVector(y, Math.sin(p))
    .addScaledVector(z, Math.cos(p) * Math.cos(yaw))
    .normalize()
  const up = new THREE.Vector3()
    .addScaledVector(x, Math.sin(p) * Math.sin(yaw))
    .addScaledVector(y, Math.cos(p))
    .addScaledVector(z, -Math.sin(p) * Math.cos(yaw))
    .normalize()
  return { dir, up }
}

/**
 * A bullet's shots and everything they spawn, flattened. `base` is the
 * direction its shots turn from: the character's facing for the first
 * stage, then the parent bullet's flight where this stage starts (or the
 * facing again, for a stage aimed from the owner). Shot k turns by the side
 * angle + k × its step and the up angle + k × its step, plus its random
 * spread.
 */
export function spawnBullets(
  def: SimBullet,
  table: Record<string, SimBullet>,
  t0: number,
  origin: THREE.Vector3,
  base: { dir: THREE.Vector3; up: THREE.Vector3 },
  facing: THREE.Vector3,
  depth: number,
  key: string,
  out: BulletRun[],
  target: THREE.Vector3 | null,
  speedIn: number | null,
  inherited: boolean,
): BulletRun[] {
  if (depth > 8 || out.length >= MAX_RUNS) return []
  const made: BulletRun[] = []
  const right = WORLD_UP.clone().cross(facing).normalize()
  const from = def.ownerAngle && depth > 0 ? { dir: facing, up: WORLD_UP } : base
  for (let k = 0; k < def.count && out.length < MAX_RUNS; k++) {
    const yaw =
      def.angle + k * def.angleInterval + (def.randomYaw > 0 ? (hash01(`${key}.${k}y`) - 0.5) * def.randomYaw : 0)
    const pitch =
      def.angleX + k * def.angleXInterval + (def.randomPitch > 0 ? (hash01(`${key}.${k}x`) - 0.5) * def.randomPitch : 0)
    // A stage with no angles of its own carries on as its parent was (its effect doesn't turn).
    const shot =
      yaw === 0 && pitch === 0
        ? { dir: from.dir.clone().normalize(), up: from.up.clone() }
        : aim(from.dir, yaw, pitch, right)
    const speed0 = speedIn !== null ? Math.max(speedIn, def.minSpeed) : def.speed
    const flight = fly(def, origin, shot.dir, speed0, Math.max(0.05, def.life), target)
    const run: BulletRun = {
      key: `${key}.${k}`,
      def,
      t0,
      life: flight.life,
      origin: origin.clone(),
      up: shot.up,
      path: flight.path,
      dirs: flight.dirs,
      speedEnd: flight.speed,
      depth,
      shot: k,
      heir: null,
      inherited,
    }
    out.push(run)
    made.push(run)
    const end = bulletPos(run, run.life, new THREE.Vector3())
    const endDir = bulletDir(run, run.life, new THREE.Vector3())
    // The next stage, where this one ends ("parent bullet" emit position), turning from the way it was going.
    const hit = table[def.hitBullet]
    const waterOnly = def.launchCondition === 1 || def.launchCondition === 2
    if (def.hitBullet > 0 && hit && !waterOnly) {
      const kids = spawnBullets(
        hit,
        table,
        t0 + run.life,
        end,
        { dir: endDir, up: shot.up },
        facing,
        depth + 1,
        `${run.key}h`,
        out,
        target,
        def.inheritSpeed ? flight.speed : null,
        def.inheritSfx,
      )
      if (def.inheritSfx) run.heir = kids[0] ?? null
    }
    // Bullets it emits on the way, every intervalCreateTime (min to max), from where it is then.
    const child = table[def.intervalBullet]
    if (def.intervalBullet > 0 && child && def.intervalMax > 0) {
      const lo = Math.max(0.03, def.intervalMin)
      const hi = Math.max(lo, def.intervalMax)
      let at = Math.max(0, def.intervalWait)
      for (let n = 0; at < run.life && n < 24 && out.length < MAX_RUNS; n++) {
        const where = bulletPos(run, at, new THREE.Vector3())
        spawnBullets(
          child,
          table,
          t0 + at,
          where,
          { dir: bulletDir(run, at, new THREE.Vector3()), up: shot.up },
          facing,
          depth + 1,
          `${run.key}i${n}`,
          out,
          target,
          null,
          false,
        )
        at += lo + (hi - lo) * hash01(`${run.key}i${n}t`)
      }
    }
  }
  return made
}
