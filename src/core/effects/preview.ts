/**
 * Turns an effect into a compact, sampled description the UI can animate.
 *
 * This is an approximation of FromSoftware's particle system, built from the
 * action specs in @cccode/fxr: emitters, emission timing, emitter shapes,
 * spread, particle lifetime, speed, gravity, color/size over particle age,
 * textures, flipbooks and blend modes. Trails, lights and models are
 * approximated (see the UI's notes). Proxied child effects are included.
 *
 * Property arguments decide how a property is sampled:
 *   ParticleAge  -> sampled across the particle's lifetime
 *   EmissionTime -> taken at emission (t = 0)
 *   ActiveTime   -> taken at t = 0 (effect start)
 *   Constant0    -> constant
 *
 * Credit: @cccode/fxr (CCCode; Unlicense): the action specs and their
 * documentation. FXR Playground's guides explain how effects play.
 */
import type { FXR, Node as FxrNode } from '@cccode/fxr'
import type { EffectLibrary } from './effects.ts'
import { actionsOf, childNodes, isFields, keyframesOf, kindOf, modifiersOf, proxyTarget } from './fxrFields.ts'
import { IDENTITY, apply3, eulerToMatrix, mul3, type Mat3 } from './nodeTransforms.ts'
import type { PreviewEmitter, PreviewCurve, PreviewSpec, PreviewForce } from '../../shared/api/preview.ts'

const SAMPLES = 16
const TRANSLATION_STEP = 0.25
const TRANSLATION_SAMPLES = 33 // 8 seconds

const NODE_MOTION = new Set([
  'NodeSpeed',
  'NodeAcceleration',
  'NodeSpeedRandomTurns',
  'NodeAccelerationRandomTurns',
  'NodeSpeedPartialFollow',
  'NodeAccelerationPartialFollow',
  'NodeSpeedSpin',
  'NodeAccelerationSpin',
])
const NODE_SPIN = new Set(['NodeSpin', 'NodeSpeedSpin', 'NodeAccelerationSpin'])

/** Blend modes that add light (glows) rather than cover what's behind. */
function isAdditive(mode: number): boolean {
  return mode === 0 || mode === 4 || mode === 7
}

const APPEARANCE_KIND: Record<string, PreviewEmitter['appearance']['kind']> = {
  BillboardEx: 'sprite',
  MultiTextureBillboardEx: 'sprite',
  PointSprite: 'point',
  Tracer: 'trail',
  LegacyTracer: 'trail',
  RichModel: 'model',
  Model: 'model',
  Line: 'line',
  QuadLine: 'line',
  PointLight: 'light',
  SpotLight: 'light',
  GPUStandardParticle: 'gpu',
  GPUStandardCorrectParticle: 'gpu',
  GPUSparkParticle: 'gpu',
  GPUSparkCorrectParticle: 'gpu',
  Distortion: 'distortion',
  RadialBlur: 'radialBlur',
  LensFlare: 'lensFlare',
}

/**
 * What the game's external values are while an effect plays normally, for
 * ExternalValue modifiers: 0 Terminate (1 only while the effect is ending),
 * 1 Precipitation (dry), 2 TimeOfDay (noon), 1000 SFXDistance (near),
 * 2000 HitEffectVariation, 10000 BloodVisibility (0 = on).
 */
const EXTERNAL_DEFAULTS: Record<number, number> = { 0: 0, 1: 0, 2: 12, 1000: 0, 2000: 0, 10000: 0 }

/**
 * ExternalValue1/2 modifiers multiply a property by their factor curve,
 * evaluated at the external value. Vanilla effects use them for real
 * brightness (Bloody Rings' rings: alpha x 3.75 while Terminate is 0), so
 * leaving them out makes effects far too faint.
 */
function applyExternal(v: unknown, x: unknown): unknown {
  for (const m of modifiersOf(v)) {
    const kind = kindOf(m)
    if (kind !== 'ExternalValue1Modifier' && kind !== 'ExternalValue2Modifier' && m.type !== 38 && m.type !== 39)
      continue
    const ext = typeof m.externalValue === 'number' ? m.externalValue : 0
    const f = valueAt(m.factor, EXTERNAL_DEFAULTS[ext] ?? 0)
    if (f === undefined) continue
    if (Array.isArray(x)) x = x.map((k: number, i: number) => k * Number(Array.isArray(f) ? (f[i] ?? 1) : f))
    else if (typeof x === 'number') x *= Number(Array.isArray(f) ? f[0] : f)
  }
  return x
}

/** Evaluate a property (plain value or library Property) at `t`. */
function valueAt(v: unknown, t: number): unknown {
  if (typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) return v
  if (!isFields(v)) return undefined
  if (typeof v.valueAt === 'function') {
    try {
      return applyExternal(v, v.valueAt(t))
    } catch {
      return applyExternal(v, v.value)
    }
  }
  if ('value' in v) return applyExternal(v, v.value)
  return undefined
}

function num(v: unknown, t = 0, fallback = 0): number {
  const x = valueAt(v, t)
  const n = Array.isArray(x) ? x[0] : x
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

/**
 * [min, max] of a property at time t, including its random modifiers (which
 * `valueAt` ignores): RandomRange adds min..max, RandomDelta adds -max..max,
 * RandomFraction scales by 1 -/+ max.
 */
function range(v: unknown, t = 0, fallback = 0): [number, number] {
  const base = num(v, t, fallback)
  let lo = base
  let hi = base
  const first = (x: unknown): number => (Array.isArray(x) ? x[0] : typeof x === 'number' ? x : 0)
  for (const m of modifiersOf(v)) {
    switch (kindOf(m)) {
      case 'RandomRangeModifier':
        lo += first(m.min)
        hi += first(m.max)
        break
      case 'RandomDeltaModifier':
        lo -= Math.abs(first(m.max))
        hi += Math.abs(first(m.max))
        break
      case 'RandomFractionModifier':
        lo -= Math.abs(base * first(m.max))
        hi += Math.abs(base * first(m.max))
        break
    }
  }
  return [Math.min(lo, hi), Math.max(lo, hi)]
}

function bool(v: unknown): boolean {
  const x = valueAt(v, 0)
  return x === true || (typeof x === 'number' && x !== 0)
}

function vec(v: unknown, t: number, n: number, fallback: number): number[] {
  const x = valueAt(v, t)
  if (Array.isArray(x)) return Array.from({ length: n }, (_, i) => (typeof x[i] === 'number' ? x[i] : fallback))
  if (typeof x === 'number') return Array.from({ length: n }, () => x)
  return Array.from({ length: n }, () => fallback)
}

function sampleOverLife(lifetime: number, f: (age: number) => number[]): PreviewCurve {
  const life = lifetime > 0 ? lifetime : 1
  return { samples: Array.from({ length: SAMPLES }, (_, i) => f((i / (SAMPLES - 1)) * life)) }
}

interface Walked {
  node: FxrNode
  index: number
  offset: number[]
  variance: number[]
  rotation: number[]
  motion: { vel: number[]; acc: number[]; accY: number }
  translation?: number[][]
  spin?: {
    pivot: number[]
    axes: number[]
    rates: number[]
    motion: { vel: number[]; acc: number[] }
    translation?: number[][]
  }
  rotationVariance?: number[]
  attachToCamera?: { followRotation: boolean }
}

const add3 = (a: number[], b: number[]) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

function walk(fxr: FXR): Walked[] {
  const out: Walked[] = []
  let index = 0
  type Inherited = Pick<Walked, 'motion' | 'translation' | 'spin' | 'attachToCamera'>
  const visit = (node: FxrNode, offset: number[], variance: number[], rotation: Mat3, parent: Inherited) => {
    let off = offset
    let vari = variance
    let rot = rotation
    let rotationVariance: number[] | undefined
    for (const a of actionsOf(node)) {
      const name = kindOf(a)
      if (name === 'StaticNodeTransform' || name === 'RandomNodeTransform') {
        // The node's offset is in its parent's frame; its rotation turns its own frame.
        const o = apply3(rotation, vec(a.offset, 0, 3, 0))
        off = [off[0] + o[0], off[1] + o[1], off[2] + o[2]]
        const r = vec(a.rotation, 0, 3, 0)
        if (r[0] || r[1] || r[2]) rot = mul3(rotation, eulerToMatrix(r))
        if (name === 'RandomNodeTransform') {
          const v = vec(a.offsetVariance, 0, 3, 0)
          vari = [vari[0] + v[0], vari[1] + v[1], vari[2] + v[2]]
          const rv = vec(a.rotationVariance, 0, 3, 0)
          if (rv[0] || rv[1] || rv[2]) rotationVariance = rv
        }
      }
    }
    // Node motion and spin, in this node's (rotated) frame; children inherit them.
    let motion = parent.motion
    let translation = parent.translation
    let spin = parent.spin
    let attachToCamera = parent.attachToCamera
    let ownSpin: number[] | undefined
    for (const a of actionsOf(node)) {
      const name = kindOf(a)
      if (NODE_MOTION.has(name)) {
        const isSpeed = name.startsWith('NodeSpeed')
        const v0 = num(a.speedZ) * (isSpeed ? num(a.speedMultiplierZ, 0, 1) : 1)
        const az = isSpeed ? 0 : num(a.accelerationZ) * num(a.accelerationMultiplierZ, 0, 1)
        motion = {
          vel: add3(motion.vel, apply3(rot, [0, 0, v0])),
          acc: add3(motion.acc, apply3(rot, [0, 0, az])),
          accY: motion.accY + num(a.accelerationY),
        }
      }
      if (NODE_SPIN.has(name)) {
        const rates = ['X', 'Y', 'Z'].map(
          (ax) => num(a[`angularSpeed${ax}`]) * num(a[`angularSpeedMultiplier${ax}`], 0, 1),
        )
        if (rates.some((r) => r !== 0)) ownSpin = rates
      }
      if (name === 'NodeAttachToCamera')
        attachToCamera = { followRotation: a.followRotation === undefined ? true : bool(a.followRotation) }
      if (name === 'NodeTranslation') {
        const own = Array.from({ length: TRANSLATION_SAMPLES }, (_, i) =>
          apply3(rot, vec(a.translation, i * TRANSLATION_STEP, 3, 0)),
        )
        translation = translation ? translation.map((p, i) => add3(p, own[i])) : own
      }
    }
    // A spinning node turns around where it is now, including how its parents move it.
    if (ownSpin)
      spin = { pivot: off, axes: rot, rates: ownSpin, motion: { vel: motion.vel, acc: motion.acc }, translation }
    out.push({
      node,
      index: index++,
      offset: off,
      variance: vari,
      rotation: rot,
      motion,
      translation,
      spin,
      rotationVariance,
      attachToCamera,
    })
    for (const child of childNodes(node)) visit(child, off, vari, rot, { motion, translation, spin, attachToCamera })
  }
  visit(fxr.root, [0, 0, 0], [0, 0, 0], IDENTITY, { motion: { vel: [0, 0, 0], acc: [0, 0, 0], accY: 0 } })
  return out
}

export function buildPreviewSpec(lib: EffectLibrary, effectId: number, maxDepth = 2): PreviewSpec {
  const emitters: PreviewEmitter[] = []
  const forces: PreviewForce[] = []
  const notes = new Set<string>()
  const seen = new Set<number>()

  const addEffect = (id: number, base: number[], baseRot: Mat3, depth: number) => {
    if (seen.has(id) || depth > maxDepth || !lib.hasEffect(id)) return
    seen.add(id)
    const fxr = lib.getEffect(id)

    for (const w of walk(fxr)) {
      const { node } = w
      const local = apply3(baseRot, w.offset)
      const at = [base[0] + local[0], base[1] + local[1], base[2] + local[2]]
      const nodeRot = mul3(baseRot, w.rotation)

      const proxied = proxyTarget(node)
      if (proxied !== null) {
        addEffect(proxied, at, nodeRot, depth + 1)
        continue
      }

      const acts = actionsOf(node)
      const byName = (n: string) => acts.find((a) => kindOf(a) === n)
      // Force fields act on other particles; collect them before skipping non-visual nodes.
      const wind = byName('WindForce')
      if (wind) {
        const shape = Math.round(num(wind.shape, 0, 1))
        const size =
          shape === 1
            ? [num(wind.sphereRadius, 0, 10)]
            : shape === 2
              ? vec(wind.boxSize, 0, 3, 0)
              : shape === 3
                ? [num(wind.cylinderRadius), num(wind.cylinderHeight)]
                : shape === 4
                  ? [num(wind.squarePrismApothem), num(wind.squarePrismHeight)]
                  : []
        const mid = (num(wind.forceRandomMultiplierMin, 0, 1) + num(wind.forceRandomMultiplierMax, 0, 1)) / 2
        forces.push({
          position: at,
          direction: apply3(nodeRot, [0, 0, 1]),
          strength: num(wind.force, 0, 1) * num(wind.forceMultiplier, 0, 1) * mid,
          shape,
          size,
        })
      }
      // The appearance action: what the node draws, and most of how.
      const a = acts.find((action) => APPEARANCE_KIND[kindOf(action)])
      if (!a) continue
      const appearanceName = kindOf(a)
      const kind = APPEARANCE_KIND[appearanceName]

      const nodeAttrs = byName('NodeAttributes')
      const partAttrs = byName('ParticleAttributes')
      let lifetime = num(partAttrs?.duration, 0, -1)

      // Emission.
      let emission: PreviewEmitter['emission'] = { kind: 'once' }
      const periodic = byName('PeriodicEmitter')
      const distance = byName('EqualDistanceEmitter')
      if (periodic) {
        emission = {
          kind: 'periodic',
          interval: Math.max(1 / 120, num(periodic.interval, 0, 0.1)),
          perEmission: Math.max(1, Math.round(num(periodic.perEmission, 0, 1))),
          total: Math.round(num(periodic.totalEmissions, 0, -1)),
          maxConcurrent: Math.round(num(periodic.maxConcurrent, 0, -1)),
        }
      } else if (distance) {
        emission = {
          kind: 'distance',
          threshold: Math.max(0.01, num(distance.threshold, 0, 0.1)),
          total: Math.round(num(distance.totalEmissions, 0, -1)),
          maxConcurrent: Math.round(num(distance.maxConcurrent, 0, -1)),
        }
      }

      // Emitter shape.
      let shape: PreviewEmitter['shape'] = { kind: 'point', size: [0, 0, 0] }
      const disk = byName('DiskEmitterShape')
      const rect = byName('RectangleEmitterShape')
      const sphere = byName('SphereEmitterShape')
      const box = byName('BoxEmitterShape')
      const cyl = byName('CylinderEmitterShape')
      if (disk) shape = { kind: 'disk', size: [num(disk.radius), 0, 0] }
      else if (rect) shape = { kind: 'rect', size: [num(rect.sizeX), num(rect.sizeY), 0] }
      else if (sphere) shape = { kind: 'sphere', size: [num(sphere.radius), 0, 0] }
      else if (box)
        shape = {
          kind: 'box',
          size: [num(box.sizeX), num(box.sizeY), num(box.sizeZ)],
          emitInside: bool(box.emitInside),
        }
      else if (cyl)
        shape = {
          kind: 'cylinder',
          size: [num(cyl.radius, 0, 1), num(cyl.height, 0, 1), 0],
          emitInside: cyl.emitInside === undefined ? true : bool(cyl.emitInside),
          yAxis: cyl.yAxis === undefined ? true : bool(cyl.yAxis),
        }
      const shapeAction = disk ?? rect ?? box ?? cyl ?? byName('PointEmitterShape')
      const direction = shapeAction ? Math.round(num(shapeAction.direction, 0, 0)) : 0

      // Spread.
      const circ = byName('CircularSpread')
      const ell = byName('EllipticalSpread')
      const rectSpread = byName('RectangularSpread')
      const spread = circ
        ? num(circ.angle)
        : ell
          ? Math.max(num(ell.angleX), num(ell.angleY))
          : rectSpread
            ? Math.max(num(rectSpread.angleX), num(rectSpread.angleY))
            : 0

      if (kind === 'gpu') {
        const count = Math.max(1, Math.round(num(a.emissionParticleCount, 0, 10)))
        const iMin = num(a.emissionIntervalMin, 0, 0) || num(a.emissionInterval, 0, 1)
        const iMax = num(a.emissionIntervalMax, 0, iMin)
        const limited = bool(a.limitEmissionCount)
        emission = {
          kind: 'periodic',
          interval: Math.max(1 / 30, (iMin + iMax) / 2 || 1),
          perEmission: Math.min(200, count),
          total: limited ? Math.round(num(a.emissionCountLimit, 0, -1)) : -1,
          maxConcurrent: -1,
        }
        const size = vec(a.emitterSize, 0, 3, 1)
        const gShape = Math.round(num(a.emitterShape, 0, 1))
        shape =
          gShape === 4
            ? { kind: 'cylinder', size: [size[0], size[1], 0], emitInside: true, yAxis: true }
            : gShape === 1 || gShape === 2
              ? { kind: 'box', size, emitInside: true }
              : { kind: 'box', size: [size[0], 0, 0], emitInside: true }
        lifetime = Math.max(1 / 30, num(a.particleDuration, 0, 1) * num(a.particleDurationMultiplier, 0, 1))
      }

      // Movement.
      const pSpeed =
        byName('ParticleSpeed') ?? byName('ParticleSpeedRandomTurns') ?? byName('ParticleSpeedPartialFollow')
      const pAccel =
        byName('ParticleAcceleration') ??
        byName('ParticleAccelerationRandomTurns') ??
        byName('ParticleAccelerationPartialFollow')
      const turnAction =
        byName('ParticleSpeedRandomTurns') ??
        byName('ParticleSpeedPartialFollow') ??
        byName('ParticleAccelerationRandomTurns') ??
        byName('ParticleAccelerationPartialFollow')
      const turnAngle = turnAction ? Math.abs(num(turnAction.maxTurnAngle, 0, 0)) : 0
      const turns =
        turnAngle > 0
          ? { angle: turnAngle, interval: Math.max(0.02, num(turnAction?.turnInterval, 0, 0.1)) }
          : undefined
      const modifier = byName('ParticleModifier')
      const speed = sampleOverLife(lifetime, (age) => [
        (pSpeed ? num(pSpeed.speed, age) * num(pSpeed.speedMultiplier, age, 1) : 0) +
          (pAccel ? num(pAccel.acceleration, age) * num(pAccel.accelerationMultiplier, age, 1) * age : 0) +
          (modifier ? num(modifier.speed, 0) : 0),
      ])
      const gravity = sampleOverLife(lifetime, (age) => [
        kind === 'gpu' ? num(a.particleGravity) : num(pSpeed?.gravity ?? pAccel?.gravity, age),
      ])

      // Size over life.
      // ParticleModifier scale (taken at emission); uniformScale uses X for both.
      const scaleX = (_age: number) => (modifier ? num(modifier.scaleX, 0, 1) : 1)
      const scaleY = () =>
        modifier ? (bool(modifier.uniformScale) ? num(modifier.scaleX, 0, 1) : num(modifier.scaleY, 0, 1)) : 1
      // The action's own uniformScale: width controls the height too.
      const uniform = bool(a.uniformScale)
      const size = sampleOverLife(lifetime, (age) => {
        switch (appearanceName) {
          case 'BillboardEx':
          case 'MultiTextureBillboardEx':
            return [
              num(a.width, age, 1) * scaleX(age),
              (uniform ? num(a.width, age, 1) : num(a.height, age, 1)) * scaleY(),
            ]
          case 'PointSprite':
            return [num(a.size, age, 0.2) * scaleX(age), num(a.size, age, 0.2) * scaleX(age)]
          case 'QuadLine':
          case 'Line': {
            // [length, width]: a streak along the particle's travel. Line is a
            // one-pixel line in game; give it a hairline width.
            const length = num(a.length, age, 1) * num(a.lengthMultiplier, age, 1) * scaleX(age)
            const width =
              appearanceName === 'QuadLine' ? num(a.width, age, 1) * num(a.widthMultiplier, age, 1) * scaleY() : 0.01
            return [Math.max(0.001, length), Math.max(0, width)]
          }
          case 'Tracer':
          case 'LegacyTracer':
            return [num(a.width, age, 0.1) * num(a.widthMultiplier, 0, 1), num(a.width, age, 0.1)]
          case 'RichModel':
          case 'Model': {
            // All three axes: rings and discs are flattened on one of them.
            // ParticleModifier scale multiplies all three (X for all when uniform).
            const mu = modifier && bool(modifier.uniformScale)
            const mx = modifier ? num(modifier.scaleX, 0, 1) : 1
            const my = modifier ? (mu ? mx : num(modifier.scaleY, 0, 1)) : 1
            const mz = modifier ? (mu ? mx : num(modifier.scaleZ, 0, 1)) : 1
            const sx = num(a.sizeX, age, 1)
            const sy = uniform ? sx : num(a.sizeY, age, sx)
            const sz = uniform ? sx : num(a.sizeZ, age, sx)
            return [Math.max(0.01, sx * mx), Math.max(0.01, sy * my), Math.max(0.01, sz * mz)]
          }
          case 'PointLight':
          case 'SpotLight':
            return [num(a.radius, 0, 1), num(a.radius, 0, 1)]
          case 'Distortion':
            return [num(a.sizeX, age, 1), uniform ? num(a.sizeX, age, 1) : num(a.sizeY, age, 1)]
          case 'RadialBlur':
            return [num(a.width, age, 1), uniform ? num(a.width, age, 1) : num(a.height, age, 1)]
          case 'GPUStandardParticle':
          case 'GPUStandardCorrectParticle': {
            const k = num(a.particleSizeMultiplier, 0, 1)
            const w = num(a.particleSizeX, 0, 1) * k
            const h = bool(a.particleUniformScale) ? w : num(a.particleSizeY, 0, 1) * k
            return [w, h]
          }
          case 'GPUSparkParticle':
          case 'GPUSparkCorrectParticle':
            return [num(a.particleLength, 0, 1), num(a.particleWidth, 0, 0.05)]
          default:
            return [0.3, 0.3]
        }
      })

      // rgbMultiplier and alphaMultiplier are read at the effect's active time
      // (the fxr docs' ActiveTime), not the particle's age: when either changes
      // (keyframes), they're a curve of their own over it.
      const keyframes = (v: unknown): number[] => keyframesOf(v).map((k) => Number(k.position) || 0)
      const loops = (v: unknown) => isFields(v) && !!v.loop
      const changes = (v: unknown) =>
        v !== undefined &&
        keyframes(v).length > 1 &&
        keyframes(v).some((_, i, k) => Math.abs(num(v, k[i], 1) - num(v, k[0], 1)) > 1e-6)
      let activeColor: PreviewEmitter['activeColor']
      if (kind !== 'light' && (changes(a.rgbMultiplier) || changes(a.alphaMultiplier))) {
        const span = Math.max(1 / 30, ...keyframes(a.rgbMultiplier), ...keyframes(a.alphaMultiplier))
        activeColor = {
          samples: Array.from({ length: SAMPLES }, (_, i) => {
            const t = (i / (SAMPLES - 1)) * span
            return [num(a.rgbMultiplier, t, 1), num(a.alphaMultiplier, t, 1)]
          }),
          span,
          loop: loops(a.rgbMultiplier) || loops(a.alphaMultiplier),
        }
      }

      // Color over life: the product of every color property.
      const color = sampleOverLife(lifetime, (age) => {
        let c = [1, 1, 1, 1]
        // color1 and color2 are clamped to 0-1 by the game (lines clamp color3
        // too); color3, the modifier colour and the multipliers can go above 1.
        const mul = (v: unknown, t: number, clamp = false) => {
          if (v === undefined) return
          const x = vec(v, t, 4, 1).map((k) => (clamp ? Math.max(0, Math.min(1, k)) : k))
          c = [c[0] * x[0], c[1] * x[1], c[2] * x[2], c[3] * x[3]]
        }
        if (appearanceName === 'PointLight' || appearanceName === 'SpotLight') {
          mul(a.diffuseColor, 0)
          const m = num(a.diffuseMultiplier, 0, 1)
          c = [c[0] * m, c[1] * m, c[2] * m, c[3]]
        } else if (appearanceName === 'Distortion' || appearanceName === 'RadialBlur') {
          mul(a.color, age, true)
        } else if (kind === 'gpu') {
          mul(a.color, age)
        } else {
          const isLine = appearanceName === 'Line' || appearanceName === 'QuadLine'
          mul(a.color1, age, true)
          mul(a.color2, 0, true)
          mul(a.color3, age, isLine)
          if (isLine) mul(a.startColor, 0, true)
        }
        if (modifier) mul(modifier.color, 0)
        // Multipliers that change over active time go into activeColor instead.
        const rgbm = activeColor ? 1 : num(a.rgbMultiplier, 0, 1)
        const am = activeColor ? 1 : num(a.alphaMultiplier, 0, 1)
        return [c[0] * rgbm, c[1] * rgbm, c[2] * rgbm, c[3] * am]
      })

      // Node motion.
      const nodeSpeed = byName('NodeSpeed') ?? byName('NodeAcceleration')
      const nodeSpeedZ = nodeSpeed ? num(nodeSpeed.speedZ) : 0

      let texture: { id: number; type: string } | undefined
      const tex = num(a.texture, 0, 0) || num(a.layer1, 0, 0)
      if (tex > 0) texture = { id: tex, type: 'a' }
      const model = appearanceName === 'RichModel' || appearanceName === 'Model' ? num(a.model, 0, 0) : undefined
      // Orientation and roll. Spin = angular speed x its multiplier, each possibly random.
      const orientation = a.orientation !== undefined ? Math.round(num(a.orientation, 0, 1)) : 1
      const rotation = range(a.rotationZ)
      const speedZ = range(a.angularSpeedZ)
      const speedMul =
        a.angularSpeedMultiplierZ !== undefined ? range(a.angularSpeedMultiplierZ, 0, 1) : ([1, 1] as [number, number])
      const products = [
        speedZ[0] * speedMul[0],
        speedZ[0] * speedMul[1],
        speedZ[1] * speedMul[0],
        speedZ[1] * speedMul[1],
      ]
      const spin: [number, number] = [Math.min(...products), Math.max(...products)]
      const spinRange = (ax: string): [number, number] => {
        const sp = range(a[`angularSpeed${ax}`])
        const mu =
          a[`angularSpeedMultiplier${ax}`] !== undefined
            ? range(a[`angularSpeedMultiplier${ax}`], 0, 1)
            : ([1, 1] as [number, number])
        const pr = [sp[0] * mu[0], sp[0] * mu[1], sp[1] * mu[0], sp[1] * mu[1]]
        return [Math.min(...pr), Math.max(...pr)]
      }
      const rotation3 = kind === 'model' ? [range(a.rotationX), range(a.rotationY), range(a.rotationZ)] : undefined
      const spin3 = kind === 'model' ? ['X', 'Y', 'Z'].map(spinRange) : undefined
      // Model spin speeds often change over the particle's life (deathblight
      // thorns: 0 -> 480 deg/s). The angle is the speed integrated over age;
      // the random multiplier is picked per particle.
      let spinAngle3: PreviewCurve | undefined
      let spinMul3: [number, number][] | undefined
      // Curves of endless particles run over their first second (like sampleOverLife).
      const spinSpan = lifetime > 0 ? lifetime : 1
      if (kind === 'model') {
        const axes = ['X', 'Y', 'Z']
        const steps = 96
        const dt = spinSpan / steps
        const cumulative: number[][] = [[0, 0, 0]]
        for (let i = 1; i <= steps; i++) {
          const t0 = (i - 1) * dt
          const t1 = i * dt
          const prev = cumulative[i - 1]
          cumulative.push(
            axes.map(
              (ax, k) => prev[k] + ((num(a[`angularSpeed${ax}`], t0, 0) + num(a[`angularSpeed${ax}`], t1, 0)) / 2) * dt,
            ),
          )
        }
        spinAngle3 = {
          samples: Array.from({ length: SAMPLES }, (_, i) => cumulative[Math.round((i / (SAMPLES - 1)) * steps)]),
        }
        spinMul3 = axes.map((ax) =>
          a[`angularSpeedMultiplier${ax}`] !== undefined ? range(a[`angularSpeedMultiplier${ax}`], 0, 1) : [1, 1],
        )
      }
      // Screen effects: distortion and radial blur.
      let screen: PreviewEmitter['appearance']['screen']
      let screenMask: { id: number; type: string } | undefined
      if (appearanceName === 'Distortion' || appearanceName === 'RadialBlur') {
        const isDistortion = appearanceName === 'Distortion'
        const nm = isDistortion ? num(a.normalMap, 0, 0) : 0
        screen = {
          mode: isDistortion ? Math.round(num(a.mode, 0, 1)) : -1,
          shape: isDistortion ? Math.round(num(a.shape, 0, 0)) : 0,
          normalMap: nm > 0 ? { id: nm, type: 'n' } : undefined,
          normalScale: [num(a.normalMapScaleU, 0, 1), num(a.normalMapScaleV, 0, 1)],
          normalSpeed: [num(a.normalMapSpeedU, 0, 0), num(a.normalMapSpeedV, 0, 0)],
          stirSpeed: num(a.stirSpeed, 0, 60),
          iterations: Math.max(1, Math.round(num(a.iterations, 0, 1))),
          strength: sampleOverLife(lifetime, (age) =>
            isDistortion ? [num(a.intensity, age, 1), num(a.radius, age, 1)] : [num(a.blurRadius, age, 0.5), 1],
          ),
        }
        const maskTex = num(a.mask, 0, 0)
        if (maskTex > 1) screenMask = { id: maskTex, type: 'a' }
      }
      // Lens flares.
      let flare: PreviewEmitter['appearance']['flare']
      if (appearanceName === 'LensFlare') {
        const layers = [1, 2, 3, 4]
          .map((n) => {
            const tex = num(a[`layer${n}`], 0, 0)
            const uni = bool(a[`layer${n}UniformScale`])
            const w = num(a[`layer${n}Width`], 0, 1)
            const c = vec(a[`layer${n}Color`], 0, 4, 1).map((k) => Math.max(0, Math.min(1, k)))
            const m = vec(a[`layer${n}ColorMultiplier`], 0, 4, 1)
            return {
              texture: tex > 0 ? { id: tex, type: 'a' } : undefined,
              attenuationRadius: num(a[`layer${n}AttenuationRadius`], 0, -1),
              size: [w, uni ? w : num(a[`layer${n}Height`], 0, 1)],
              color: c.map((k, i) => k * m[i]),
              count: Math.max(0, Math.round(num(a[`layer${n}Count`], 0, 1))),
              offset: num(a[`layer${n}Offset`], 0, 0),
              offsetVariation: num(a[`layer${n}OffsetVariation`], 0, 1),
              reflection: Math.round(num(a[`layer${n}Reflection`], 0, 0)),
              scaleVariation: [num(a[`layer${n}ScaleVariationX`], 0, 1), num(a[`layer${n}ScaleVariationY`], 0, 1)],
            }
          })
          .filter((l) => l.texture && l.count > 0)
        flare = {
          sourceSize: num(a.sourceSize, 0, 1),
          fadeTime: Math.max(0, num(a.opacityTransitionDuration, 0, 1)),
          layers,
        }
      }
      // How particles respond to force fields.
      const forceSpeed = byName('ParticleForceSpeed')
      const forceAccel = byName('ParticleForceAcceleration')
      const forceResponse =
        forceSpeed || forceAccel
          ? {
              speed: forceSpeed ? num(forceSpeed.speed) * num(forceSpeed.speedMultiplier, 0, 1) : 0,
              acceleration: forceAccel
                ? num(forceAccel.acceleration) * num(forceAccel.accelerationMultiplier, 0, 1)
                : 0,
            }
          : undefined
      // GPU particle systems carry their own velocity, growth and colour variation.
      let gpu: PreviewEmitter['gpu']
      if (kind === 'gpu') {
        const v3 = (k: string) => vec(a[k], 0, 3, 0)
        const isSpark = appearanceName.startsWith('GPUSpark')
        gpu = {
          velocity: isSpark ? [0, 0, 0] : v3('particleSpeed'),
          velocityMin: v3('particleSpeedMin'),
          velocityMax: v3('particleSpeedMax'),
          acceleration: [num(a.particleAccelerationX), num(a.particleAccelerationY), num(a.particleAccelerationZ)],
          growth: isSpark
            ? [0, 0]
            : [
                num(a.particleGrowthRateXStatic) || num(a.particleGrowthRateX),
                num(a.particleGrowthRateYStatic) || num(a.particleGrowthRateY),
              ],
          colorMin: vec(a.colorMin, 0, 4, 0),
          colorMax: vec(a.colorMax, 0, 4, 0),
          collision: bool(a.particleCollision),
          bounciness: Math.max(0, Math.min(1, num(a.particleBounciness, 0, 0.5))),
        }
      }
      // Flipbook frames: frameIndex + frameIndexOffset over the particle's life,
      // with any random part of the offset picked per particle.
      let frames: PreviewCurve | undefined
      let frameRandom: [number, number] | undefined
      if (a.frameIndex !== undefined || a.frameIndexOffset !== undefined) {
        frames = sampleOverLife(lifetime, (age) => [num(a.frameIndex, age, 0) + num(a.frameIndexOffset, age, 0)])
        const r = range(a.frameIndexOffset)
        const base = num(a.frameIndexOffset, 0, 0)
        if (r[0] !== base || r[1] !== base) frameRandom = [r[0] - base, r[1] - base]
      }
      // Texture scrolling: shift = offset + the distance scrolled so far.
      const scrolled = (
        offU: unknown,
        offV: unknown,
        speedU: (age: number) => number,
        speedV: (age: number) => number,
      ) => {
        const life = lifetime > 0 ? lifetime : 4
        return {
          samples: Array.from({ length: SAMPLES }, (_, i) => {
            const end = (i / (SAMPLES - 1)) * life
            let u = num(offU, 0, 0)
            let v = num(offV, 0, 0)
            const steps = 24
            for (let k = 0; k < steps; k++) {
              const t = ((k + 0.5) / steps) * end
              u += (speedU(t) * end) / steps
              v += (speedV(t) * end) / steps
            }
            return [u, v]
          }),
        }
      }
      let uv: PreviewEmitter['appearance']['uv']
      if (appearanceName === 'MultiTextureBillboardEx') {
        const layer = (n: number) => ({
          shift: scrolled(
            a[`layer${n}OffsetU`],
            a[`layer${n}OffsetV`],
            (t) => num(a[`layer${n}SpeedU`], t, 0),
            (t) => num(a[`layer${n}SpeedV`], t, 0),
          ),
          scale: sampleOverLife(lifetime, (age) => [
            num(a[`layer${n}ScaleU`], age, 1),
            num(a[`layer${n}ScaleV`], age, 1),
          ]),
        })
        uv = { layer1: layer(1), layer2: layer(2) }
      }
      let modelUv: PreviewCurve | undefined
      let modelUvRandom: [number, number][] | undefined
      if (appearanceName === 'RichModel' || appearanceName === 'Model') {
        const su = (t: number) =>
          num(a.speedU, t, 0) * num(a.speedMultiplierU, t, 1) +
          (appearanceName === 'RichModel' ? vec(a.speedUV, t, 2, 0)[0] * num(a.speedMultiplierUV, t, 1) : 0)
        const sv = (t: number) =>
          num(a.speedV, t, 0) * num(a.speedMultiplierV, t, 1) +
          (appearanceName === 'RichModel' ? vec(a.speedUV, t, 2, 0)[1] * num(a.speedMultiplierUV, t, 1) : 0)
        const off = appearanceName === 'RichModel' ? vec(a.offsetUV, 0, 2, 0) : [0, 0]
        const curve = scrolled(a.offsetU, a.offsetV, su, sv)
        curve.samples = curve.samples.map(([u, v]) => [u + off[0], v + off[1]])
        // Random start offsets (e.g. offsetU 1 + RandomRange -1..0): each model
        // particle starts its texture somewhere else, so stacked copies don't line up.
        const ru = range(a.offsetU)
        const rv = range(a.offsetV)
        const bu = num(a.offsetU)
        const bv = num(a.offsetV)
        if (ru[1] > ru[0] || rv[1] > rv[0])
          modelUvRandom = [
            [ru[0] - bu, ru[1] - bu],
            [rv[0] - bv, rv[1] - bv],
          ]
        if (modelUvRandom || curve.samples.some(([u, v]) => u !== 0 || v !== 0)) modelUv = curve
      }
      const maskId = appearanceName === 'MultiTextureBillboardEx' ? num(a.layer2, 0, 0) : 0
      const mask = maskId > 0 ? { id: maskId, type: 'a' } : undefined
      const fadeAt = (age: number) => Math.max(0, Math.min(0.99, num(a.alphaFadeThreshold, age, 0) / 255))
      const alphaFade = fadeAt(0)
      const fadeOverLife = sampleOverLife(lifetime, (age) => [fadeAt(age)])
      const alphaFadeCurve = fadeOverLife.samples.some(([v]) => Math.abs(v - alphaFade) > 1e-3)
        ? fadeOverLife
        : undefined

      // Lighting and bloom. Models are always lit; RichModel has bloomColor without a switch.
      const lit = kind === 'model' ? !isAdditive(num(a.blendMode, 0, 2)) : Math.round(num(a.lighting, 0, -1)) !== -1
      let bloom: number[] | null = null
      if (a.bloomColor !== undefined && (bool(a.bloom) || appearanceName === 'RichModel')) {
        const bc = vec(a.bloomColor, 0, 4, 1)
        if (bc[3] > 0) bloom = [bc[0] * bc[3], bc[1] * bc[3], bc[2] * bc[3]]
      }
      const light =
        appearanceName === 'PointLight'
          ? { radius: Math.max(0.1, num(a.radius, 0, 10)), spot: false }
          : appearanceName === 'SpotLight'
            ? { radius: Math.max(0.1, num(a.radiusX, 0, 10)), spot: true }
            : undefined

      if (kind === 'model')
        notes.add(
          '3D models are drawn with their real mesh, albedo and emissive textures, lit by the chosen area; their in-game shaders differ.',
        )
      if (kind === 'light')
        notes.add('Point and spot lights light the ground and lit particles; shadows and flicker are not simulated.')
      if (kind === 'trail')
        notes.add('Trails are left where the emitter moves; turn on “Fly forward” to see them stream.')
      if (kind === 'gpu')
        notes.add(
          'GPU particle systems use their own emission, speed, growth and colour ranges, and bounce off the ground; particle traces are not drawn.',
        )
      if (kind === 'distortion' || kind === 'radialBlur')
        notes.add('Distortion and radial blur bend or blur what is behind them; their strength is calibrated by eye.')
      if (kind === 'lensFlare')
        notes.add(
          'Lens flares fade when their source goes behind the ground and as the view turns away; other objects don’t hide them.',
        )

      emitters.push({
        effectId: id,
        nodeIndex: w.index,
        label: appearanceName,
        offset: at,
        rotation: nodeRot,
        nodeMotion: { vel: apply3(baseRot, w.motion.vel), acc: apply3(baseRot, w.motion.acc), accY: w.motion.accY },
        translation: w.translation?.map((p) => apply3(baseRot, p)),
        nodeSpin: w.spin
          ? {
              pivot: add3(base, apply3(baseRot, w.spin.pivot)),
              axes: mul3(baseRot, w.spin.axes),
              rates: w.spin.rates,
              motion: { vel: apply3(baseRot, w.spin.motion.vel), acc: apply3(baseRot, w.spin.motion.acc) },
              translation: w.spin.translation?.map((p) => apply3(baseRot, p)),
            }
          : undefined,
        rotationVariance: w.rotationVariance,
        turns,
        forceResponse,
        attachToCamera: w.attachToCamera,
        gpu,
        offsetVariance: w.variance,
        delay: num(nodeAttrs?.delay, 0, 0),
        nodeDuration: num(nodeAttrs?.duration, 0, -1),
        emission,
        shape,
        direction,
        spread,
        lifetime,
        attached: Math.round(num(partAttrs?.attachment, 0, 0)) !== 0,
        speed,
        gravity,
        appearance: {
          kind,
          action: appearanceName,
          texture,
          model,
          modelAnimation:
            model && num(a.anibnd, 0, 0) > 0
              ? {
                  anibnd: num(a.anibnd, 0, 0),
                  animation: num(a.animation, 0, 0),
                  loop: bool(a.loopAnimation),
                  speed: num(a.animationSpeed, 0, 1) || 1,
                }
              : undefined,
          blendMode: num(a.blendMode, 0, 2),
          columns: Math.max(1, Math.round(num(a.columns, 0, 1))),
          totalFrames: Math.max(1, Math.round(num(a.totalFrames, 0, 1))),
          trailDuration: kind === 'trail' ? Math.max(0.05, num(a.segmentDuration, 0, 0.3)) : undefined,
          trail:
            kind === 'trail'
              ? {
                  interval: Math.max(0, num(a.segmentInterval, 0, 0)),
                  textureFraction: num(a.textureFraction, 0, 0.1),
                  uvAttached: bool(a.attachedUV),
                  speedU: num(a.speedU, 0, 0),
                }
              : undefined,
          mask: screen ? screenMask : mask,
          frames,
          frameRandom,
          interpolateFrames: bool(a.interpolateFrames),
          uv,
          modelUv,
          modelUvRandom,
          screen,
          flare,
          alphaFade,
          alphaFadeCurve,
          scaleVariation: [
            num(a.scaleVariationX, 0, 1),
            bool(a.uniformScale) ? num(a.scaleVariationX, 0, 1) : num(a.scaleVariationY, 0, 1),
          ],
          uniformScale: bool(a.uniformScale),
          orientation,
          rotation,
          spin,
          rotation3,
          spin3,
          spinAngle3,
          spinMul3,
          spinSpan: kind === 'model' ? spinSpan : undefined,
          lit,
          bloom,
          light,
        },
        size,
        color,
        activeColor,
        nodeSpeedZ,
      })
    }
  }

  addEffect(effectId, [0, 0, 0], IDENTITY, 0)

  // Loop long enough to see the longest-lived emitter play out.
  const loop = Math.min(
    8,
    Math.max(
      1.5,
      ...emitters.map((e) => e.delay + (e.nodeDuration > 0 ? e.nodeDuration : 2) + (e.lifetime > 0 ? e.lifetime : 0.5)),
    ),
  )
  notes.add(
    'Approximate preview — lighting comes from the game’s own light probes, but the game’s renderer and materials differ.',
  )
  return { effectId, loop, emitters, forces, notes: [...notes] }
}
