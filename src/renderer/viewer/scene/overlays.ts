/**
 * What the viewer draws over the scene: DS Anim Studio's helpers (bones, dummy
 * polys, glue joints, root motion, the hit capsule, attack reach), the
 * simulation's hitboxes, bullets, sounds and effect spawns, and their text
 * labels. Lines go into one fixed-size buffer of thick screen-space segments,
 * rewritten every frame; labels are drawn on a 2D canvas over the view.
 *
 * Credit: DS Anim Studio (Meowmaritus and contributors): the helpers follow
 * its viewport's.
 */
import * as THREE from 'three'
import { weaponFlip, follow, dummyWorld, findDummy } from './dummies.ts'
import { hexToRgb } from '../../lib/color.ts'
import { AXIS_COLORS, SIM_COLORS, SIM_CSS } from '../palette.ts'
import type { HelperPrefs } from '../prefs.ts'
import { bulletPos, radiusAt, PATH_STEP } from '../sim/bullets.ts'
import type { ViewerState, Overlay } from './state.ts'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

/** Adds a line from a to b in a colour (RGB, 0-1). */
type Seg = (a: THREE.Vector3, b: THREE.Vector3, c: number[]) => void

/** The line buffer's size: more segments than this in a frame are dropped. */
export const HELPER_SEGMENTS = 24000

const v0 = new THREE.Vector3()
const v1 = new THREE.Vector3()

/** A transform's axes and their colours (the legend explains them). */
const AXES = [
  { dir: new THREE.Vector3(1, 0, 0), color: hexToRgb(AXIS_COLORS.x) },
  { dir: new THREE.Vector3(0, 1, 0), color: hexToRgb(AXIS_COLORS.y) },
  { dir: new THREE.Vector3(0, 0, 1), color: hexToRgb(AXIS_COLORS.z) },
]

export function drawHelpers(s: ViewerState, h: HelperPrefs): Overlay[] {
  const geom = s.helperLines.geometry as LineSegmentsGeometry
  const posBuf = (geom.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data
  const colBuf = (geom.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute).data
  const P = posBuf.array as Float32Array
  const C = colBuf.array as Float32Array
  // n counts points; each segment is two.
  let n = 0
  const max = HELPER_SEGMENTS * 2 - 2
  const mat = s.helperLines.material as LineMaterial
  mat.linewidth = h.thickness
  const labels: Overlay[] = []
  const seg = (a: THREE.Vector3, b: THREE.Vector3, c: number[]) => {
    if (n >= max) return
    P.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 3)
    C.set([c[0], c[1], c[2], c[0], c[1], c[2]], n * 3)
    n += 2
  }
  const axes = (m: THREE.Matrix4, len: number, scale = h.axisScale) => {
    const L = len * scale
    v0.setFromMatrixPosition(m)
    for (const ax of AXES) {
      v1.copy(ax.dir).transformDirection(m).multiplyScalar(L).add(v0)
      seg(v0, v1, ax.color)
    }
    // Arrow tip on the forward (Z, blue) axis, so facing reads at a glance.
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(m)
    const side = new THREE.Vector3(1, 0, 0).transformDirection(m)
    const tip = fwd.clone().multiplyScalar(L).add(v0)
    const back = fwd
      .clone()
      .multiplyScalar(L * 0.72)
      .add(v0)
    const c = AXES[2].color
    seg(
      tip,
      side
        .clone()
        .multiplyScalar(L * 0.16)
        .add(back),
      c,
    )
    seg(
      tip,
      side
        .clone()
        .multiplyScalar(-L * 0.16)
        .add(back),
      c,
    )
  }
  /** The character's facing: Elden Ring characters face their model's -Z. */
  const facing = (m: THREE.Matrix4, c: number[], len: number) => {
    const o = new THREE.Vector3().setFromMatrixPosition(m)
    const f = new THREE.Vector3(0, 0, -1).transformDirection(m)
    const side = new THREE.Vector3(1, 0, 0).transformDirection(m)
    const tip = f.clone().multiplyScalar(len).add(o)
    const back = f
      .clone()
      .multiplyScalar(len * 0.78)
      .add(o)
    seg(o, tip, c)
    seg(
      tip,
      side
        .clone()
        .multiplyScalar(len * 0.12)
        .add(back),
      c,
    )
    seg(
      tip,
      side
        .clone()
        .multiplyScalar(-len * 0.12)
        .add(back),
      c,
    )
  }
  const on = h.all
  mat.depthTest = !h.xray
  ;(s.trail.material as THREE.LineBasicMaterial).depthTest = !h.xray
  ;(s.trail.material as THREE.LineBasicMaterial).color.set(h.colors.root)
  s.trail.visible = on && h.rootTrail && !!s.clip?.root && h.rootMotion

  if (on && s.skeleton) {
    // HKX bones.
    if (h.hkxBones || h.hkxNames) {
      const c = hexToRgb(h.colors.hkx)
      s.bones.forEach((b, i) => {
        if (h.hkxBones) {
          axes(b.matrixWorld, 0.05, h.boneAxisScale ?? 1)
          const p = s.skel!.bones[i].parent
          if (p >= 0)
            seg(
              v0.setFromMatrixPosition(b.matrixWorld).clone(),
              v1.setFromMatrixPosition(s.bones[p].matrixWorld).clone(),
              c,
            )
        }
        if (h.hkxNames)
          labels.push({
            label: b.name,
            pos: new THREE.Vector3().setFromMatrixPosition(b.matrixWorld),
            color: h.colors.hkx,
          })
      })
    }
    const parts = [...(s.body ? [s.body] : []), ...[...s.parts.values()].filter((p) => !p.slot.includes(':'))]
    for (const p of parts) {
      const isBody = p === s.body
      // FLVER bones and glue joints.
      if ((h.flverBones || h.flverNames || h.glue || h.flverAxes || h.flverBoxes) && !isBody) {
        const world = p.view.bones.map((b, i) =>
          p.rigid
            ? new THREE.Matrix4()
                .multiplyMatrices(s.bones[b.skeletonBone]?.matrixWorld ?? s.actor.matrixWorld, weaponFlip(p.slot))
                .multiply(p.binds[i])
            : follow(s, b.skeletonBone, p.binds[i], new THREE.Matrix4()),
        )
        const fc = hexToRgb(h.colors.flver)
        const gc = hexToRgb(h.colors.glue)
        p.view.bones.forEach((b, i) => {
          const at = new THREE.Vector3().setFromMatrixPosition(world[i])
          if (h.flverBones && b.parent >= 0 && world[b.parent])
            seg(at, new THREE.Vector3().setFromMatrixPosition(world[b.parent]), fc)
          if (h.flverAxes) axes(world[i], 0.035, h.boneAxisScale ?? 1)
          // Its bounding box, in its own space.
          if (h.flverBoxes && b.box) wireBox(seg, world[i], b.box, fc)
          if (h.flverNames) labels.push({ label: b.name, pos: at, color: h.colors.flver })
          if (h.glue && b.glued && !p.rigid && s.bones[b.skeletonBone]) {
            const joint = new THREE.Vector3().setFromMatrixPosition(s.bones[b.skeletonBone].matrixWorld)
            seg(at, joint, gc)
            const k = 0.015
            seg(at.clone().add(new THREE.Vector3(-k, 0, 0)), at.clone().add(new THREE.Vector3(k, 0, 0)), gc)
            seg(at.clone().add(new THREE.Vector3(0, -k, 0)), at.clone().add(new THREE.Vector3(0, k, 0)), gc)
          }
        })
      }
      // Dummy polys.
      if ((h.dummyIds || h.dummyAxes) && (isBody || h.partDummies)) {
        p.view.dummies.forEach((d, i) => {
          const m = dummyWorld(s, p, i)
          if (h.dummyAxes) axes(m, 0.07)
          if (h.dummyIds) {
            // Weapon points as events name them (10000 + n on the right weapon, 20000 + n on the left), or by slot.
            const tag = isBody
              ? `${d.id}`
              : h.dummyEventIds && (p.slot === 'right' || p.slot === 'left')
                ? `${(p.slot === 'right' ? 10000 : 20000) + d.id}`
                : `${p.slot === 'right' ? 'R' : p.slot === 'left' ? 'L' : p.slot[0].toUpperCase()}:${d.id}`
            labels.push({ label: tag, pos: new THREE.Vector3().setFromMatrixPosition(m), color: h.colors.dummy })
          }
        })
      }
    }
    // Root motion start transform.
    if (h.rootTrail && h.rootMotion && s.clip?.root) {
      const r = s.clip.root
      const sxz = h.rootScaleXZ ?? 1
      const start = new THREE.Matrix4()
        .makeRotationY(r[3] * (h.rootRotation ?? 1))
        .setPosition(r[0] * sxz, r[1] * (h.rootScaleY ?? 1) + 0.01, r[2] * sxz)
      facing(start.premultiply(s.actor.parent!.matrixWorld), hexToRgb(h.colors.root), 0.45)
      facing(s.actor.matrixWorld, hexToRgb(h.colors.root), 0.6)
      labels.push({
        label: 'facing',
        pos: new THREE.Vector3(0, 0, -0.62).applyMatrix4(s.actor.matrixWorld),
        color: h.colors.root,
      })
    }
    // The character's hit capsule (NpcParam hitRadius, hitHeight): where it is now, and faint where the animation started.
    if (h.hitCapsule && s.capsule) {
      const { radius, height } = s.capsule
      const up = Math.max(radius, height - radius)
      const now = new THREE.Vector3().setFromMatrixPosition(s.actor.matrixWorld)
      wireCapsule(seg, now.clone().setY(now.y + radius), now.clone().setY(now.y + up), radius, [0.55, 0.85, 1])
      const start = new THREE.Vector3(0, 0, 0).applyMatrix4(s.world.matrixWorld)
      if (start.distanceTo(now) > 0.05)
        wireCapsule(
          seg,
          start.clone().setY(start.y + radius),
          start.clone().setY(start.y + up),
          radius,
          [0.3, 0.45, 0.6],
        )
      labels.push({
        label: `capsule r ${radius.toFixed(2)} m, h ${height.toFixed(2)} m`,
        pos: now.clone().setY(now.y + height + 0.12),
        color: '#8cd9ff',
      })
    }
    // How far the hitboxes reach from where the animation starts: a line on the ground and its length.
    if (h.attackReach && s.reach && s.reach.dist > 0) {
      const start = new THREE.Vector3(0, 0.02, 0).applyMatrix4(s.world.matrixWorld)
      const far = s.reach.point.clone().setY(0.02).applyMatrix4(s.world.matrixWorld)
      const c = [1, 0.35, 0.3]
      seg(start, far, c)
      const side = far
        .clone()
        .sub(start)
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize()
        .multiplyScalar(0.12)
      seg(far.clone().add(side), far.clone().sub(side), c)
      labels.push({ label: `reach ${s.reach.dist.toFixed(2)} m`, pos: far.clone().setY(0.25), color: '#ff7a6b' })
    }
    drawSimulation(s, h, seg, labels)
  }
  geom.instanceCount = n / 2
  posBuf.needsUpdate = true
  colBuf.needsUpdate = true
  s.helperLines.visible = n > 0
  return h.text ? labels : []
}

/** Three great circles: a wire sphere. */
function wireSphere(seg: Seg, c: THREE.Vector3, r: number, col: number[]): void {
  const N = 20
  for (let axis = 0; axis < 3; axis++) {
    let prev: THREE.Vector3 | null = null
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2
      const u = Math.cos(a) * r
      const v = Math.sin(a) * r
      const p =
        axis === 0
          ? new THREE.Vector3(c.x, c.y + u, c.z + v)
          : axis === 1
            ? new THREE.Vector3(c.x + u, c.y, c.z + v)
            : new THREE.Vector3(c.x + u, c.y + v, c.z)
      if (prev) seg(prev, p, col)
      prev = p
    }
  }
}

/** A capsule: spheres at both ends joined by four lines. */
function wireCapsule(seg: Seg, a: THREE.Vector3, b: THREE.Vector3, r: number, col: number[]): void {
  wireSphere(seg, a, r, col)
  wireSphere(seg, b, r, col)
  const axis = b.clone().sub(a)
  if (axis.lengthSq() < 1e-8) return
  axis.normalize()
  const u = new THREE.Vector3(0, 1, 0).cross(axis)
  if (u.lengthSq() < 1e-6) u.set(1, 0, 0).cross(axis)
  u.normalize().multiplyScalar(r)
  const v = axis.clone().cross(u).normalize().multiplyScalar(r)
  for (const o of [u, u.clone().negate(), v, v.clone().negate()]) seg(a.clone().add(o), b.clone().add(o), col)
}

/** A box (min x y z, max x y z in a bone's space) drawn where the bone is. */
function wireBox(seg: Seg, m: THREE.Matrix4, box: number[], col: number[]): void {
  const c = (i: number) =>
    new THREE.Vector3(i & 1 ? box[3] : box[0], i & 2 ? box[4] : box[1], i & 4 ? box[5] : box[2]).applyMatrix4(m)
  const p = Array.from({ length: 8 }, (_, i) => c(i))
  for (const [a, b] of [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ])
    seg(p[a], p[b], col)
}

/** The events active at the playhead, acted out: hitboxes, bullets in flight, sounds, effect spawns. */
function drawSimulation(s: ViewerState, h: HelperPrefs, seg: Seg, labels: Overlay[]): void {
  const t = s.time
  // The stand-in target bullets home on.
  if (h.simBullets && s.bullets.length) {
    for (const tg of s.targets) {
      const p = tg.clone().applyMatrix4(s.world.matrixWorld)
      const c = [1, 0.85, 0.3]
      wireSphere(seg, p, 0.3, c)
      seg(p.clone().add(new THREE.Vector3(0, -1.2, 0)), p, c)
      labels.push({ label: 'target', pos: p.clone().add(new THREE.Vector3(0, 0.45, 0)), color: '#ffd84d' })
    }
  }
  // Bullets (and the bullets they spawn): hit size and path while alive.
  if (h.simBullets) {
    const toScene = s.world.matrixWorld
    const col = SIM_COLORS.bullet
    for (const b of s.bullets) {
      const age = t - b.t0
      if (age < 0 || age > b.life) continue
      const at = bulletPos(b, age, new THREE.Vector3()).applyMatrix4(toScene)
      const r = radiusAt(b.def, age)
      wireSphere(seg, at, r, col)
      // The path flown so far.
      const n = Math.min(b.path.length - 1, Math.floor(age / PATH_STEP))
      for (let i = 0; i < n; i += 2)
        seg(b.path[i].clone().applyMatrix4(toScene), b.path[Math.min(n, i + 2)].clone().applyMatrix4(toScene), col)
      if (b.depth === 0 && b.shot === 0)
        labels.push({
          label: b.def.name || `Bullet ${b.def.id}`,
          pos: at.clone().add(new THREE.Vector3(0, r + 0.05, 0)),
          color: SIM_CSS.bullet,
        })
      else if (b.shot === 0 && age < 0.4)
        labels.push({
          label: `↳ ${b.def.name || `Bullet ${b.def.id}`}`,
          pos: at.clone().add(new THREE.Vector3(0, r + 0.05, 0)),
          color: SIM_CSS.bullet,
        })
    }
  }
  for (const act of s.actions) {
    const col = SIM_COLORS[act.kind]
    const css = SIM_CSS[act.kind]
    const active = t >= act.start && t <= act.end
    // Attack hitboxes: while the behaviour event is active.
    if (h.simHits && active && act.hits.length) {
      for (const hit of act.hits) {
        const m1 = findDummy(s, hit.dummy1, hit.source)
        if (!m1) continue
        const p1 = new THREE.Vector3().setFromMatrixPosition(m1)
        const m2 = hit.dummy2 >= 0 ? findDummy(s, hit.dummy2, hit.source) : null
        if (m2) wireCapsule(seg, p1, new THREE.Vector3().setFromMatrixPosition(m2), hit.radius, col)
        else wireSphere(seg, p1, hit.radius, col)
      }
      const m = findDummy(s, act.hits[0].dummy1, act.hits[0].source)
      if (m)
        labels.push({
          label: act.label.split(' → ').pop()!,
          pos: new THREE.Vector3().setFromMatrixPosition(m),
          color: css,
        })
      // Each hit shape's name: the attack and which of its hits it is.
      if (h.hitNames && act.hits.length > 1) {
        act.hits.forEach((hit, k) => {
          if (k === 0) return
          const mh = findDummy(s, hit.dummy1, hit.source)
          if (mh)
            labels.push({
              label: `hit${hit.slot ?? k}${act.attack ? ` ${act.attack}` : ''}`,
              pos: new THREE.Vector3().setFromMatrixPosition(mh).add(new THREE.Vector3(0, hit.radius, 0)),
              color: css,
            })
        })
      }
    }
    // Sounds: a marker where each plays, briefly (most last a frame), with the sound's name.
    if (
      h.soundMarkers &&
      act.sound &&
      t >= act.start &&
      t <= Math.max(act.end < 1e5 ? act.end : act.start, act.start + 0.4)
    ) {
      const m = act.sound.dummy >= 0 ? findDummy(s, act.sound.dummy, act.sound.source) : null
      const p = m
        ? new THREE.Vector3().setFromMatrixPosition(m)
        : new THREE.Vector3(0, 1.1, 0).applyMatrix4(s.actor.matrixWorld)
      const k = 0.05
      seg(p.clone().add(new THREE.Vector3(-k, -k, 0)), p.clone().add(new THREE.Vector3(k, k, 0)), col)
      seg(p.clone().add(new THREE.Vector3(-k, k, 0)), p.clone().add(new THREE.Vector3(k, -k, 0)), col)
      labels.push({ label: `♪ ${act.sound.name ?? act.sound.id}`, pos: p, color: css })
    }
    // Effect spawns: a marker at the dummy while the event is active.
    if (h.simEffects && active && act.effect) {
      const m = findDummy(s, act.effect.dummy, act.effect.source)
      if (!m) continue
      const p = new THREE.Vector3().setFromMatrixPosition(m)
      const k = 0.04
      seg(p.clone().add(new THREE.Vector3(-k, 0, 0)), p.clone().add(new THREE.Vector3(0, k, 0)), col)
      seg(p.clone().add(new THREE.Vector3(0, k, 0)), p.clone().add(new THREE.Vector3(k, 0, 0)), col)
      seg(p.clone().add(new THREE.Vector3(k, 0, 0)), p.clone().add(new THREE.Vector3(0, -k, 0)), col)
      seg(p.clone().add(new THREE.Vector3(0, -k, 0)), p.clone().add(new THREE.Vector3(-k, 0, 0)), col)
      labels.push({ label: `FX ${act.effect.id}`, pos: p, color: css })
    }
  }
}

export function drawText(
  canvas: HTMLCanvasElement | null,
  labels: Overlay[],
  camera: THREE.Camera,
  h: HelperPrefs,
): void {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!h.all || !labels.length) return
  const dpr = (canvas.width / Math.max(1, canvas.clientWidth)) * (h.textScale ?? 1)
  ctx.font = `600 ${11 * dpr}px Consolas, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const p = new THREE.Vector3()
  const padX = 4 * dpr
  const hgt = 15 * dpr
  for (const l of labels) {
    p.copy(l.pos).project(camera)
    if (p.z > 1 || p.z < -1) continue
    const x = (p.x * 0.5 + 0.5) * canvas.width
    // Just above the point, so the axes stay visible.
    const y = (-p.y * 0.5 + 0.5) * canvas.height - 11 * dpr
    const w = ctx.measureText(l.label).width + padX * 2
    ctx.fillStyle = 'rgba(12, 12, 16, 0.78)'
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - hgt / 2, w, hgt, 4 * dpr)
    ctx.fill()
    ctx.strokeStyle = l.color
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1 * dpr
    ctx.stroke()
    ctx.globalAlpha = 1
    ctx.fillStyle = l.color
    ctx.fillText(l.label, x, y + 0.5 * dpr)
  }
}
