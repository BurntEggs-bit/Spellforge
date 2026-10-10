/**
 * The effect particle engine's emitters, shared by the effect preview and the
 * character viewer: each FXR emitter simulated on the CPU (spawn timing,
 * shapes, speed and forces, colour and size over life, flipbook frames, trails)
 * and drawn as instanced quads with its blend mode.
 *
 * Each EmitterSim has its own `frame`: the orientation of the effect root in
 * the scene. The preview uses one frame for the whole effect; the viewer gives
 * every effect instance the orientation of the dummy poly or bullet it rides on.
 */
import * as THREE from 'three'
import type { PreviewEmitter } from '../../shared/api.ts'
import { GROUND_Y, FX_BLOOM_GAIN, fxExposure } from './constants.ts'
import { fxAdditiveGain } from './glow.ts'
import {
  FX_VERTEX,
  VERTEX,
  FX_FRAGMENT,
  FRAGMENT,
  RIBBON_VERTEX,
  identityUv,
  isAdditive,
  applyBlend,
  drawLayer,
} from './shaders.ts'
import { sample, translationAt, activeAt, sampleExtended } from './curves.ts'

/** Particles one emitter draws at most (its instance buffers' size). */
const MAX_PER_EMITTER = 1500
/** Points a trail ribbon keeps at most. */
const MAX_TRAIL_POINTS = 256

/** Whether a point (relative to a force's origin) is inside its volume (ForceVolumeShape). */
function insideForce(fz: { shape: number; size: number[] }, rel: THREE.Vector3): boolean {
  const [a = 0, b = 0, c = 0] = fz.size
  switch (fz.shape) {
    case 1:
      return rel.length() <= a
    case 2:
      return Math.abs(rel.x) <= a / 2 && Math.abs(rel.y) <= b / 2 && Math.abs(rel.z) <= c / 2
    case 3:
      return Math.hypot(rel.x, rel.z) <= a && Math.abs(rel.y) <= b / 2
    case 4:
      return Math.abs(rel.x) <= a && Math.abs(rel.z) <= a && Math.abs(rel.y) <= b / 2
    default:
      return true
  }
}

export interface Particle {
  pos: THREE.Vector3
  dir: THREE.Vector3
  vy: number
  age: number
  life: number
  attached: boolean
  offset: THREE.Vector3
  /** GPU particles: own velocity, acceleration and colour offset. */
  vel?: THREE.Vector3
  acc?: THREE.Vector3
  colorAdd?: number[]
  /** Random flipbook start frame. */
  frameOff?: number
  /** Models: random texture start offset [u, v]. */
  uvOff?: number[]
  /** Speed picked up from force fields. */
  forceVel?: THREE.Vector3
  /** Attached particles: direction in the node's frame (their offset is node-local too). */
  dirLocal?: THREE.Vector3
  /** Trail points: the node's Z axis when the point was left (LocalZ trails lie along it). */
  axis?: THREE.Vector3
  /** Random turns: time since the last turn. */
  turnClock?: number
  /** Models: rotation per axis in radians at emission, and spin in radians per second. */
  rot3?: number[]
  spin3?: number[]
  /** Models whose spin speed changes over life: this particle's multiplier per axis. */
  spinMul?: number[]
  /** Random width/height multipliers (scaleVariation). */
  scale?: number[]
  /** Roll in radians at emission, and its speed in radians per second. */
  rot: number
  spin: number
}

export class EmitterSim {
  readonly mesh: THREE.Mesh
  private spec: PreviewEmitter
  private particles: Particle[] = []
  /** Last frame's particles as position/scale/colour, for real-mesh rendering. */
  instances: {
    pos: THREE.Vector3
    scale: number[]
    color: number[]
    quat: THREE.Quaternion
    uv?: number[]
    age: number
  }[] = []
  private emitted = 0
  private accum = 0
  private lastRoot = new THREE.Vector3()
  private travelled = 0
  private started = false
  private aPos: THREE.InstancedBufferAttribute
  private aSize: THREE.InstancedBufferAttribute
  private aColor: THREE.InstancedBufferAttribute
  private aFrame: THREE.InstancedBufferAttribute
  private aRot: THREE.InstancedBufferAttribute
  private aDir: THREE.InstancedBufferAttribute
  private aFade: THREE.InstancedBufferAttribute
  private geometry: THREE.InstancedBufferGeometry
  private material: THREE.ShaderMaterial
  /** Camera position, for turning trail ribbons toward the viewer. */
  static camera = new THREE.Vector3()
  /** Camera rotation, for nodes attached to the camera. */
  static cameraQuat = new THREE.Quaternion()
  /** Force fields of the effect (scene axes, relative to the effect root). */
  static forces: { pos: THREE.Vector3; dir: THREE.Vector3; strength: number; shape: number; size: number[] }[] = []
  /** Drawing-buffer size, for screen effects. */
  static resolution = { value: new THREE.Vector2(1, 1) }
  /** Distortion and radial blur: drawn into the screen-effects buffer, not the scene. */
  readonly screen: boolean
  /** Lens flares: where the flare sources are this frame. */
  flareSources: { pos: THREE.Vector3; color: number[] }[] = []
  private aFx!: THREE.InstancedBufferAttribute
  private aUv!: THREE.InstancedBufferAttribute
  private aUv2!: THREE.InstancedBufferAttribute
  /**
   * The effect's own axes in the scene. Identity for projectiles (+Z forward);
   * a quarter turn for effects authored with +Z up (things attached to items
   * or the ground), so their local +Z points up.
   */
  static frame = new THREE.Quaternion()
  /** This emitter's effect frame (defaults to the shared one at creation). */
  frame = EmitterSim.frame.clone()
  /** Force fields this emitter feels (defaults to the shared ones). */
  forces: typeof EmitterSim.forces = EmitterSim.forces
  /** Ground height for GPU particle collisions. */
  groundY = GROUND_Y
  /** Effect time after which nothing new is emitted (the effect was stopped). */
  stopTime = Infinity
  /** Trails: a ribbon through the segment points (the instanced quads stay hidden). */
  readonly ribbon: THREE.Mesh | null = null
  private ribbonGeometry: THREE.BufferGeometry | null = null
  private segmentClock = 0
  private segmentSerial = 0
  private trailTime = 0
  /** A trail's random start frame (frameIndexOffset's random part). */
  private trailFrameOff = 0
  /** The [rgb, alpha] multipliers at the effect's active time this frame (spec.activeColor), if they change. */
  private activeNow: number[] | null = null
  /** A colour with this frame's active-time multipliers applied. */
  private withActive(c: number[]): number[] {
    const m = this.activeNow
    return m ? [c[0] * m[0], c[1] * m[0], c[2] * m[0], (c[3] ?? 1) * m[1]] : c
  }
  /** For light emitters: where the light is and its colour this frame. */
  lightOut: { pos: THREE.Vector3; color: number[] } | null = null
  /** Emitter position this frame, for lighting lit particles. */
  readonly center = new THREE.Vector3()

  /** The node's own axes in the scene: the effect frame times the node's rotation (and spin). */
  readonly local = new THREE.Quaternion()
  /** The node's position relative to the effect root, in scene axes (moves with node motion and spin). */
  readonly nodePos = new THREE.Vector3()
  private baseRot = new THREE.Quaternion()
  private varRot = new THREE.Quaternion()
  private spinAxes = new THREE.Quaternion()

  constructor(spec: PreviewEmitter, texture: THREE.Texture | null, bloomPass: { value: number }) {
    this.spec = spec
    const toQuat = (r: number[]) =>
      new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1),
      )
    this.baseRot.copy(toQuat(spec.rotation ?? [1, 0, 0, 0, 1, 0, 0, 0, 1]))
    if (spec.nodeSpin) this.spinAxes.copy(toQuat(spec.nodeSpin.axes))
    this.local.copy(this.baseRot).premultiply(this.frame)
    const plane = new THREE.PlaneGeometry(1, 1)
    const g = new THREE.InstancedBufferGeometry()
    g.index = plane.index
    g.setAttribute('position', plane.getAttribute('position'))
    g.setAttribute('uv', plane.getAttribute('uv'))
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER * 3), 3)
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER * 2), 2)
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER * 4), 4)
    this.aFrame = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER), 1)
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER), 1)
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER * 3), 3)
    this.aFade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER), 1)
    for (const a of [this.aPos, this.aSize, this.aColor, this.aFrame, this.aRot, this.aDir, this.aFade])
      a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iFade', this.aFade)
    g.setAttribute('iRot', this.aRot)
    g.setAttribute('iDir', this.aDir)
    this.aFx = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_EMITTER * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    )
    g.setAttribute('iFx', this.aFx)
    this.aUv = new THREE.InstancedBufferAttribute(identityUv(MAX_PER_EMITTER), 4).setUsage(THREE.DynamicDrawUsage)
    this.aUv2 = new THREE.InstancedBufferAttribute(identityUv(MAX_PER_EMITTER, 0.5), 4).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iUv', this.aUv)
    g.setAttribute('iUv2', this.aUv2)
    g.setAttribute('iPos', this.aPos)
    g.setAttribute('iSize', this.aSize)
    g.setAttribute('iColor', this.aColor)
    g.setAttribute('iFrame', this.aFrame)
    g.instanceCount = 0
    this.geometry = g

    const cols = spec.appearance.columns
    const rows = Math.max(1, Math.ceil(spec.appearance.totalFrames / cols))
    const sc = spec.appearance.screen
    this.screen = !!sc
    // GPU sparks and lines (Line, QuadLine) stretch along their velocity.
    const orient =
      spec.appearance.action.startsWith('GPUSpark') || spec.appearance.kind === 'line'
        ? 7
        : (spec.appearance.orientation ?? 1)
    this.material = new THREE.ShaderMaterial({
      vertexShader: sc ? FX_VERTEX : VERTEX,
      fragmentShader: sc ? FX_FRAGMENT : FRAGMENT,
      uniforms: {
        uMode: { value: sc?.mode ?? 0 },
        uShape: { value: sc?.shape ?? 0 },
        uStir: { value: THREE.MathUtils.degToRad(sc?.stirSpeed ?? 60) },
        uNormalUv: {
          value: new THREE.Vector4(
            sc?.normalScale[0] ?? 1,
            sc?.normalScale[1] ?? 1,
            sc?.normalSpeed[0] ?? 0,
            sc?.normalSpeed[1] ?? 0,
          ),
        },
        uResolution: EmitterSim.resolution,
        uMap: { value: texture },
        uHasMap: { value: texture ? 1 : 0 },
        uMask: { value: null },
        uHasMask: { value: 0 },
        // Changing over the particle's life: per particle (iFade) instead.
        uAlphaFade: { value: spec.appearance.alphaFadeCurve ? 0 : (spec.appearance.alphaFade ?? 0) },
        uCols: { value: cols },
        uRows: { value: rows },
        uFrames: { value: Math.max(1, spec.appearance.totalFrames) },
        uInterp: { value: spec.appearance.interpolateFrames ? 1 : 0 },
        uOrient: { value: orient },
        uLocalX: { value: new THREE.Vector3(1, 0, 0).applyQuaternion(this.local) },
        uLocalY: { value: new THREE.Vector3(0, 1, 0).applyQuaternion(this.local) },
        uLocalZ: { value: new THREE.Vector3(0, 0, 1).applyQuaternion(this.local) },
        uLight: { value: new THREE.Vector3(1, 1, 1) },
        uBloom: { value: new THREE.Vector3(...(spec.appearance.bloom ?? [0, 0, 0])) },
        uBloomPass: bloomPass,
        uBloomGain: { value: FX_BLOOM_GAIN },
        uExposure: fxExposure,
        uAdditive: { value: !sc && isAdditive(spec.appearance.blendMode) ? 1 : 0 },
        uAdditiveGain: fxAdditiveGain,
      },
    })
    if (sc) {
      // Effects-buffer values add up; nothing hides them.
      this.material.transparent = true
      this.material.depthWrite = false
      this.material.depthTest = false
      this.material.blending = THREE.CustomBlending
      this.material.blendEquation = THREE.AddEquation
      this.material.blendSrc = THREE.OneFactor
      this.material.blendDst = THREE.OneFactor
    } else {
      applyBlend(this.material, spec.appearance.blendMode)
    }
    this.material.side = THREE.DoubleSide
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    // Glow (additive) draws after dark/normal layers, like the game: a dark
    // backing crest (Pureblood Knight's Medal) sits under its glowing crest.
    this.mesh.renderOrder = drawLayer(spec.appearance.blendMode)
    // Lights are real lights and flares are drawn by a FlareBatch, not as sprites here.
    if (spec.appearance.kind === 'light' || spec.appearance.kind === 'lensFlare') this.mesh.visible = false
    this.placeNode(0)
    if (spec.appearance.kind === 'trail') {
      const rg = new THREE.BufferGeometry()
      const n = MAX_TRAIL_POINTS
      rg.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage),
      )
      rg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage))
      rg.setAttribute(
        'color',
        new THREE.BufferAttribute(new Float32Array(n * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage),
      )
      const index: number[] = []
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
      rg.setIndex(index)
      rg.setDrawRange(0, 0)
      const rm = new THREE.ShaderMaterial({
        vertexShader: RIBBON_VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: this.material.uniforms,
      })
      applyBlend(rm, spec.appearance.blendMode)
      rm.side = THREE.DoubleSide
      const ribbon = new THREE.Mesh(rg, rm)
      ribbon.frustumCulled = false
      ribbon.renderOrder = drawLayer(spec.appearance.blendMode)
      this.ribbon = ribbon
      this.ribbonGeometry = rg
      this.mesh.visible = false
    }
  }

  /**
   * Where the node is and how it is turned at node time `t`: its offset plus
   * node motion and translation, orbiting and turning with the nearest
   * spinning node, then into the scene through the effect frame.
   */
  private placeNode(t: number, root: THREE.Vector3 = new THREE.Vector3()): void {
    const s = this.spec
    const m = s.nodeMotion
    const p = new THREE.Vector3(s.offset[0], s.offset[1], s.offset[2])
    if (m)
      p.add(new THREE.Vector3(...m.vel).multiplyScalar(t)).add(new THREE.Vector3(...m.acc).multiplyScalar(0.5 * t * t))
    if (s.translation?.length) p.add(translationAt(s.translation, t))
    const rot = this.baseRot.clone().multiply(this.varRot)
    if (s.nodeSpin) {
      // Spin about the spinning node's own axes, around its origin.
      const [rx, ry, rz] = s.nodeSpin.rates.map((r) => THREE.MathUtils.degToRad(r * t))
      const spinLocal = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz))
      const spin = this.spinAxes.clone().multiply(spinLocal).multiply(this.spinAxes.clone().invert())
      // The pivot is where the spinning node is now (moved by its own parents).
      const ns = s.nodeSpin
      const pivot = new THREE.Vector3(...ns.pivot)
        .add(new THREE.Vector3(...ns.motion.vel).multiplyScalar(t))
        .add(new THREE.Vector3(...ns.motion.acc).multiplyScalar(0.5 * t * t))
      if (ns.translation?.length) pivot.add(translationAt(ns.translation, t))
      p.sub(pivot).applyQuaternion(spin).add(pivot)
      rot.premultiply(spin)
    }
    if (s.attachToCamera) {
      // NodeAttachToCamera: the node rides on the camera, its +Z along the view
      // (three.js cameras look down -Z) and at least half a metre in front of
      // the lens, so screen-filling effects (rain, zoom blur) are visible.
      const follow = s.attachToCamera.followRotation
      const view = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
      const axes = follow ? EmitterSim.cameraQuat.clone().multiply(view) : this.frame
      p.z = Math.max(p.z, 0.5)
      this.nodePos.copy(p).applyQuaternion(axes).add(EmitterSim.camera).sub(root)
      this.local.copy(rot).premultiply(axes)
    } else {
      this.nodePos.copy(p).applyQuaternion(this.frame)
      this.local.copy(rot).premultiply(this.frame)
    }
    if (m?.accY) this.nodePos.y += 0.5 * m.accY * t * t
    const u = this.material?.uniforms
    if (u) {
      u.uLocalX.value.set(1, 0, 0).applyQuaternion(this.local)
      u.uLocalY.value.set(0, 1, 0).applyQuaternion(this.local)
      u.uLocalZ.value.set(0, 0, 1).applyQuaternion(this.local)
    }
  }

  /** Light reaching a "Lit" emitter (1 = daylight average); unlit emitters ignore it. */
  setLight(rgb: THREE.Vector3): void {
    if (this.spec.appearance.lit) this.material.uniforms.uLight.value.copy(rgb)
  }

  /** Distortion normal map (linear data, tiled). */
  setNormalMap(t: THREE.Texture | null): void {
    if (t) {
      t.colorSpace = THREE.NoColorSpace
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.needsUpdate = true
    }
    this.material.uniforms.uMap.value = t
    this.material.uniforms.uHasMap.value = t ? 1 : 0
  }

  setTexture(t: THREE.Texture | null): void {
    // Trail textures repeat along the ribbon; scrolling layers repeat both ways.
    if (t && this.ribbon) {
      t.wrapS = THREE.RepeatWrapping
      t.needsUpdate = true
    }
    if (t && this.spec.appearance.uv) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.needsUpdate = true
    }
    this.material.uniforms.uMap.value = t
    this.material.uniforms.uHasMap.value = t ? 1 : 0
  }

  setMask(t: THREE.Texture | null): void {
    // Masks stay clamped: a moving shape mask shouldn't drag copies of itself in.
    this.material.uniforms.uMask.value = t
    this.material.uniforms.uHasMask.value = t ? 1 : 0
  }

  /** Particles alive now. */
  alive(): number {
    return this.particles.length
  }

  reset(): void {
    this.particles = []
    this.emitted = 0
    this.accum = 0
    this.travelled = 0
    this.started = false
    this.lightOut = null
    this.segmentClock = 0
    this.trailTime = 0
    const fr = this.spec.appearance.frameRandom
    this.trailFrameOff = fr ? fr[0] + Math.random() * (fr[1] - fr[0]) : 0
    // RandomNodeTransform: a new random node rotation each time the effect starts.
    const rv = this.spec.rotationVariance
    if (rv) {
      const r = (d: number) => THREE.MathUtils.degToRad((Math.random() * 2 - 1) * d)
      this.varRot.setFromEuler(new THREE.Euler(r(rv[0]), r(rv[1]), r(rv[2])))
    }
    this.placeNode(0)
  }

  private spawn(root: THREE.Vector3): void {
    const s = this.spec
    if (this.particles.length >= MAX_PER_EMITTER) return
    if (s.emission.kind !== 'once' && s.emission.maxConcurrent > 0 && this.particles.length >= s.emission.maxConcurrent)
      return
    if (s.emission.kind !== 'once' && s.emission.total > 0 && this.emitted >= s.emission.total) return

    // Shape points are in the node's frame; the node offset is added after.
    const offset = new THREE.Vector3(
      (Math.random() - 0.5) * 2 * s.offsetVariance[0],
      (Math.random() - 0.5) * 2 * s.offsetVariance[1],
      (Math.random() - 0.5) * 2 * s.offsetVariance[2],
    )
    const [a, b, c] = s.shape.size
    // The shape's own direction (used when the emitter says "depends on the shape").
    const shapeDir = new THREE.Vector3(0, 0, 1)
    switch (s.shape.kind) {
      case 'disk': {
        const r = a * Math.sqrt(Math.random())
        const th = Math.random() * Math.PI * 2
        offset.x += r * Math.cos(th)
        offset.y += r * Math.sin(th)
        break
      }
      case 'rect':
        offset.x += (Math.random() - 0.5) * a
        offset.y += (Math.random() - 0.5) * b
        break
      case 'sphere': {
        const d = new THREE.Vector3().randomDirection()
        shapeDir.copy(d)
        offset.addScaledVector(d, a * Math.cbrt(Math.random()))
        break
      }
      case 'box': {
        const p = new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * b, (Math.random() - 0.5) * c)
        if (!s.shape.emitInside) {
          // On the surface: push the point onto one face, picked by face area.
          const areas = [b * c, a * c, a * b]
          let pick = Math.random() * (areas[0] + areas[1] + areas[2])
          let axis = 0
          while (axis < 2 && pick > areas[axis]) pick -= areas[axis++]
          const sign = Math.random() < 0.5 ? -1 : 1
          p.setComponent(axis, (sign * [a, b, c][axis]) / 2)
          shapeDir.set(0, 0, 0).setComponent(axis, sign)
        } else {
          const axis = Math.floor(Math.random() * 3)
          shapeDir.set(0, 0, 0).setComponent(axis, Math.random() < 0.5 ? -1 : 1)
        }
        offset.add(p)
        break
      }
      case 'cylinder': {
        // Axis Y by default, Z when yAxis is off; the surface only, unless emitInside.
        const th = Math.random() * Math.PI * 2
        const r = s.shape.emitInside ? a * Math.sqrt(Math.random()) : a
        const h = (Math.random() - 0.5) * b
        if (s.shape.yAxis === false) {
          offset.x += r * Math.cos(th)
          offset.y += r * Math.sin(th)
          offset.z += h
          shapeDir.set(Math.cos(th), Math.sin(th), 0)
        } else {
          offset.x += r * Math.cos(th)
          offset.y += h
          offset.z += r * Math.sin(th)
          shapeDir.set(Math.cos(th), 0, Math.sin(th))
        }
        break
      }
    }

    // Into the scene: shape and local directions by the node's axes, the node
    // offset by the effect's.
    const F = this.local
    offset.applyQuaternion(F).add(this.nodePos)
    shapeDir.applyQuaternion(F)

    // Direction: the emitter's initial direction, within the spread cone.
    // 1-3 are global axes; 4-6 the effect's local ones.
    const base =
      s.direction === 1
        ? new THREE.Vector3(0, 1, 0)
        : s.direction === 2
          ? new THREE.Vector3(0, -1, 0)
          : s.direction === 3
            ? new THREE.Vector3(0, 0, 1)
            : s.direction === 4
              ? new THREE.Vector3(0, 1, 0).applyQuaternion(F)
              : s.direction === 5
                ? new THREE.Vector3(0, -1, 0).applyQuaternion(F)
                : s.direction === 6
                  ? new THREE.Vector3(0, 0, 1).applyQuaternion(F)
                  : shapeDir.normalize()
    const spread = THREE.MathUtils.degToRad(Math.min(180, Math.max(0, s.spread)))
    const cosT = 1 - Math.random() * (1 - Math.cos(spread))
    const sinT = Math.sqrt(1 - cosT * cosT)
    const phi = Math.random() * Math.PI * 2
    const dir = new THREE.Vector3(sinT * Math.cos(phi), sinT * Math.sin(phi), cosT)
    dir.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), base))
    // Per-particle size variation: a random factor between scaleVariation and 1.
    const [vx, vy] = s.appearance.scaleVariation ?? [1, 1]
    const rx = Math.random()
    const ry = s.appearance.uniformScale ? rx : Math.random()

    // Attached particles ride along with the node (e.g. a projectile's aura);
    // the rest stay where they were emitted. Models stay with the node too.
    const attached = s.attached || s.lifetime <= 0 || s.appearance.kind === 'model'
    const between = (r: [number, number] | undefined) => (r ? r[0] + Math.random() * (r[1] - r[0]) : 0)
    // GPU particles: velocity = base + a random amount per axis, in the node's axes.
    let vel: THREE.Vector3 | undefined
    let acc: THREE.Vector3 | undefined
    let colorAdd: number[] | undefined
    if (s.gpu) {
      const g = s.gpu
      const r = (i: number) => g.velocity[i] + g.velocityMin[i] + Math.random() * (g.velocityMax[i] - g.velocityMin[i])
      vel = new THREE.Vector3(r(0), r(1), r(2)).applyQuaternion(this.local)
      acc = new THREE.Vector3(...g.acceleration).applyQuaternion(this.local)
      colorAdd = g.colorMin.map((lo, i) => lo + Math.random() * (g.colorMax[i] - lo))
      if (vel.lengthSq() > 1e-8) dir.copy(vel).normalize()
    }

    // Attached particles keep their offset and direction in the node's frame,
    // so they follow it as it moves and spins.
    const toNode = this.local.clone().invert()
    this.particles.push({
      pos: root.clone().add(offset),
      dir,
      vy: 0,
      age: 0,
      life: s.lifetime > 0 ? s.lifetime : Infinity,
      attached,
      offset: attached ? offset.clone().sub(this.nodePos).applyQuaternion(toNode) : offset,
      dirLocal: attached ? dir.clone().applyQuaternion(toNode) : undefined,
      turnClock: 0,
      vel,
      acc,
      colorAdd,
      scale: [vx + (1 - vx) * rx, vy + (1 - vy) * ry],
      frameOff: s.appearance.frameRandom ? between(s.appearance.frameRandom) : 0,
      uvOff: s.appearance.modelUvRandom?.map((r) => between(r as [number, number])),
      rot3: s.appearance.rotation3?.map((r) => THREE.MathUtils.degToRad(between(r))),
      spin3: s.appearance.spin3?.map((r) => THREE.MathUtils.degToRad(between(r))),
      spinMul: s.appearance.spinMul3?.map((r) => between(r as [number, number])),
      rot: THREE.MathUtils.degToRad(between(s.appearance.rotation)),
      spin: THREE.MathUtils.degToRad(between(s.appearance.spin)),
    })
    this.emitted++
  }

  update(t: number, dt: number, root: THREE.Vector3): void {
    const s = this.spec
    const local = t - s.delay
    const active = local >= 0 && (s.nodeDuration <= 0 || local <= s.nodeDuration) && t < this.stopTime
    this.activeNow = s.activeColor ? activeAt(s.activeColor, Math.max(0, local)) : null

    // The node's place in the scene; trails and distance emitters follow it
    // (whether the whole effect flies or the node itself moves or spins).
    this.placeNode(Math.max(0, local), root)
    this.center.copy(root).add(this.nodePos)
    if (!this.started) this.lastRoot.copy(this.center)
    const moved = this.center.distanceTo(this.lastRoot)
    this.lastRoot.copy(this.center)

    if (active) {
      if (!this.started) {
        this.started = true
        if (s.emission.kind === 'once') this.spawn(root)
      }
      if (s.emission.kind === 'periodic') {
        this.accum += dt
        let guard = 0
        while (this.accum >= s.emission.interval && guard++ < 200) {
          this.accum -= s.emission.interval
          for (let i = 0; i < s.emission.perEmission; i++) this.spawn(root)
        }
      } else if (s.emission.kind === 'distance') {
        this.travelled += moved
        let guard = 0
        while (this.travelled >= s.emission.threshold && guard++ < 200) {
          this.travelled -= s.emission.threshold
          this.spawn(root)
        }
      }
    }
    // Trails: drop a segment point every segmentInterval while the node moves.
    // Each point remembers its segment number (in offset.x) for texture placement.
    if (s.appearance.kind === 'trail') {
      this.trailTime += dt
      this.segmentClock += dt
      const interval = Math.max(1 / 120, s.appearance.trail?.interval ?? 0)
      if (active && moved > 0 && this.segmentClock >= interval) {
        this.segmentClock = 0
        const life = s.appearance.trailDuration ?? 0.3
        const serial = new THREE.Vector3(++this.segmentSerial, 0, 0)
        // The node's Z axis then: a LocalZ trail's width lies along it.
        const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.local)
        this.particles.push({
          pos: this.center.clone(),
          dir: new THREE.Vector3(),
          vy: 0,
          age: 0,
          life,
          attached: false,
          offset: serial,
          rot: 0,
          spin: 0,
          axis,
        })
        if (this.particles.length > MAX_TRAIL_POINTS - 1) this.particles.shift()
      }
    }

    // Simulate.
    const alive: Particle[] = []
    const toNode = this.local.clone().invert()
    const fall = new THREE.Vector3()
    const turnAxis = new THREE.Vector3()
    for (const p of this.particles) {
      p.age += dt
      if (p.age > p.life) continue
      if (!active && p.life === Infinity) continue
      const f = p.life === Infinity ? 0 : p.age / p.life
      // Random turns: a new heading every interval, within the max angle.
      if (s.turns && p.turnClock !== undefined) {
        p.turnClock += dt
        if (p.turnClock >= s.turns.interval) {
          p.turnClock = 0
          turnAxis.randomDirection().cross(p.dir).normalize()
          const turn = new THREE.Quaternion().setFromAxisAngle(
            turnAxis,
            THREE.MathUtils.degToRad(Math.random() * s.turns.angle),
          )
          p.dir.applyQuaternion(turn).normalize()
          p.dirLocal?.copy(p.dir).applyQuaternion(toNode)
        }
      }
      // Own motion; attached particles move in the node's frame and follow it.
      const speed = sample(s.speed, f)[0]
      const g = sample(s.gravity, f)[0]
      p.vy -= g * dt
      if (p.vel) {
        if (p.acc) p.vel.addScaledVector(p.acc, dt)
        p.pos.addScaledVector(p.vel, dt)
        p.pos.y += p.vy * dt
        // particleCollision: bounce off the ground, losing speed.
        if (s.gpu?.collision && p.pos.y < this.groundY) {
          p.pos.y = this.groundY
          const down = p.vel.y + p.vy
          if (down < 0) {
            p.vel.y = -down * s.gpu.bounciness
            p.vy = 0
            p.vel.x *= 0.8
            p.vel.z *= 0.8
          }
        }
      } else if (p.attached) {
        p.offset.addScaledVector(p.dirLocal ?? p.dir, speed * dt)
        p.offset.add(fall.set(0, p.vy * dt, 0).applyQuaternion(toNode))
        p.pos.copy(p.offset).applyQuaternion(this.local).add(this.nodePos).add(root)
      } else {
        p.pos.addScaledVector(p.dir, speed * dt)
        p.pos.y += p.vy * dt
      }
      // Force fields push particles that respond to forces.
      const fr = s.forceResponse
      if (fr && !p.attached && this.forces.length) {
        for (const fz of this.forces) {
          if (!insideForce(fz, fall.copy(p.pos).sub(root).sub(fz.pos))) continue
          p.pos.addScaledVector(fz.dir, fz.strength * fr.speed * dt)
          if (fr.acceleration)
            (p.forceVel ??= new THREE.Vector3()).addScaledVector(fz.dir, fz.strength * fr.acceleration * dt)
        }
        if (p.forceVel) p.pos.addScaledVector(p.forceVel, dt)
      }
      alive.push(p)
    }
    this.particles = alive

    if (s.appearance.kind === 'trail') {
      this.buildRibbon(alive, active ? this.center : null)
      this.geometry.instanceCount = 0
      return
    }

    // Upload. Normal-blend sprites (smoke, blood, dust) are drawn far to near,
    // like the game, so a newer piece behind an older one doesn't cover it.
    // Additive glow adds up the same in any order.
    const drawOrder =
      alive.length > 1 && !this.screen && !isAdditive(s.appearance.blendMode)
        ? [...alive].sort(
            (a, b) => b.pos.distanceToSquared(EmitterSim.camera) - a.pos.distanceToSquared(EmitterSim.camera),
          )
        : alive
    const n = Math.min(drawOrder.length, MAX_PER_EMITTER)
    const isTrail = false
    this.instances = []
    for (let i = 0; i < n; i++) {
      const p = drawOrder[i]
      const f =
        p.life === Infinity
          ? Math.min(1, local / Math.max(0.1, s.nodeDuration > 0 ? s.nodeDuration : 1))
          : p.age / p.life
      const size = sample(s.size, f)
      if (s.gpu) {
        size[0] += s.gpu.growth[0] * p.age
        size[1] = (size[1] ?? size[0]) + s.gpu.growth[1] * p.age
      }
      const color = this.withActive(sample(s.color, f))
      if (p.colorAdd) for (let k = 0; k < 4; k++) color[k] = (color[k] ?? 1) + p.colorAdd[k]
      if (s.appearance.screen) {
        const st = sample(s.appearance.screen.strength, f)
        this.aFx.setXYZW(i, st[0], st[1] ?? 1, p.age, 0)
      }
      const fade = isTrail ? 1 - f : 1
      this.aPos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z)
      const isModel = s.appearance.kind === 'model'
      // Model sizes are mesh scale factors, not metres: draw a dagger-sized shard.
      const w = isModel ? 0.35 * Math.abs(size[0]) : Math.max(0.01, Math.abs(size[0]) * (isTrail ? 6 : 1))
      const h = isModel
        ? 0.12 * Math.abs(size[1] ?? size[0])
        : Math.max(0.01, Math.abs(size[1] ?? size[0]) * (isTrail ? 6 : 1))
      this.aSize.setXY(i, w * (p.scale?.[0] ?? 1), h * (p.scale?.[1] ?? 1))
      this.aColor.setXYZW(i, color[0], color[1], color[2], (color[3] ?? 1) * fade)
      const fadeCurve = s.appearance.alphaFadeCurve
      this.aFade.setX(i, fadeCurve ? sample(fadeCurve, f)[0] : 0)
      // Frame: from the frame curve (looping each second for endless particles),
      // or stepping through the flipbook over the particle's life.
      const fr = s.appearance.frames
      if (fr) this.aFrame.setX(i, sample(fr, p.life === Infinity ? p.age % 1 : f)[0] + (p.frameOff ?? 0))
      else this.aFrame.setX(i, Math.min(s.appearance.totalFrames - 1, Math.floor(f * s.appearance.totalFrames)))
      const layers = s.appearance.uv
      if (layers) {
        // Endless particles scroll on past the sampled 4 s at the final speed.
        const at = (c: { samples: number[][] }) => (p.life === Infinity ? sampleExtended(c, p.age / 4) : sample(c, f))
        for (const [L, attr, centre] of [
          [layers.layer1, this.aUv, 0],
          [layers.layer2, this.aUv2, 0.5],
        ] as const) {
          if (!L) continue
          const sh = at(L.shift)
          const sc = sample(L.scale, p.life === Infinity ? 0 : f)
          // The mask (layer 2) is sampled around the sprite's centre (see
          // VERTEX), so the game's "no shift" is 0.5 there; without it the
          // mask lands a quarter off (a sigil shows a dark copy of its crest
          // cut off in the sprite's corner).
          attr.setXYZW(i, sh[0] + centre, sh[1] + centre, sc[0], sc[1])
        }
      }
      this.aRot.setX(i, p.rot + p.spin * p.age)
      // Travel direction (bent by gravity) for sprites that stretch along it.
      const speedNow = sample(s.speed, f)[0]
      const along = p.attached && p.dirLocal ? p.dirLocal.clone().applyQuaternion(this.local) : p.dir
      if (p.vel) this.aDir.setXYZ(i, p.vel.x, p.vel.y + p.vy, p.vel.z)
      else if (Math.abs(speedNow) > 1e-6 || Math.abs(p.vy) > 1e-6)
        this.aDir.setXYZ(i, along.x * speedNow, along.y * speedNow + p.vy, along.z * speedNow)
      else this.aDir.setXYZ(i, along.x, along.y, along.z)
      if (isModel) {
        const mu = s.appearance.modelUv
        let uvShift = mu ? (p.life === Infinity ? sampleExtended(mu, p.age / 4) : sample(mu, f)) : undefined
        if (uvShift && p.uvOff) uvShift = [uvShift[0] + p.uvOff[0], uvShift[1] + p.uvOff[1]]
        this.instances.push({
          pos: p.pos.clone(),
          scale: [Math.abs(size[0]), Math.abs(size[1] ?? size[0]), Math.abs(size[2] ?? size[0])],
          color,
          quat: this.modelQuat(p),
          uv: uvShift,
          age: p.age,
        })
      }
    }
    this.geometry.instanceCount = n
    for (const a of [
      this.aPos,
      this.aSize,
      this.aColor,
      this.aFrame,
      this.aRot,
      this.aDir,
      this.aFade,
      this.aFx,
      this.aUv,
      this.aUv2,
    ])
      a.needsUpdate = true
    if (s.appearance.kind === 'lensFlare') {
      this.flareSources = alive.map((p) => {
        const f = p.life === Infinity ? 0 : p.age / p.life
        return { pos: p.pos, color: this.withActive(sample(s.color, f)) }
      })
    }
    if (s.appearance.kind === 'light') {
      const p = alive[0]
      const f = !p
        ? 0
        : p.life === Infinity
          ? Math.min(1, local / Math.max(0.1, s.nodeDuration > 0 ? s.nodeDuration : 1))
          : p.age / p.life
      this.lightOut = p ? { pos: p.pos, color: sample(s.color, f) } : null
    }
  }

  /**
   * A ribbon through the trail points, oldest first, ending at the node while
   * it is active. Its width lies the way the tracer's orientation mode says
   * (TracerOrientationMode): 0 across the travel, facing the camera; 1 along
   * the node's Z axis when the point was left (a weapon buff's trails: along
   * the blade, so a still blade leaves nothing); 2 vertical; 3 global X;
   * 4 a cross of both (drawn vertical); 5 the (1, 1, 1) diagonal. The
   * texture's width runs along the trail: `textureFraction` per segment (the
   * texture stays with its segment), or across the whole trail when the UV
   * is attached to the node.
   */
  private buildRibbon(points: Particle[], head: THREE.Vector3 | null): void {
    const g = this.ribbonGeometry
    if (!g) return
    const s = this.spec
    const tr = s.appearance.trail
    const fraction = tr?.textureFraction ?? 0.1
    const mode = s.appearance.orientation
    const pts = points.map((p) => ({
      pos: p.pos,
      z: p.axis ?? new THREE.Vector3(),
      f: p.age / p.life,
      serial: p.offset.x,
    }))
    if (head && pts.length)
      pts.push({
        pos: head,
        z: new THREE.Vector3(0, 0, 1).applyQuaternion(this.local),
        f: 0,
        serial: this.segmentSerial + 1,
      })
    const n = Math.min(pts.length, MAX_TRAIL_POINTS)
    if (n < 2) {
      g.setDrawRange(0, 0)
      return
    }
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    const col = g.getAttribute('color') as THREE.BufferAttribute
    const width = Math.max(0.005, Math.abs(sample(s.size, 0)[0]))
    let total = 0
    for (let i = 1; i < n; i++) total += pts[i].pos.distanceTo(pts[i - 1].pos)
    const tangent = new THREE.Vector3()
    const toCam = new THREE.Vector3()
    const side = new THREE.Vector3()
    const scroll = (tr?.speedU ?? 0) * this.trailTime
    // A flipbook of strips stacked down the texture (one column): the trail
    // shows one strip, the frame curve looping each second; not all at once.
    const rows = s.appearance.columns <= 1 ? s.appearance.totalFrames : 1
    let v0 = 0
    let v1 = 1
    if (rows > 1) {
      const fr = s.appearance.frames
      const frame = Math.floor((fr ? sample(fr, this.trailTime % 1)[0] : 0) + this.trailFrameOff)
      const row = ((frame % rows) + rows) % rows
      v0 = 1 - (row + 1) / rows
      v1 = 1 - row / rows
    }
    let fromTail = 0
    for (let i = 0; i < n; i++) {
      const p = pts[i]
      if (i > 0) fromTail += p.pos.distanceTo(pts[i - 1].pos)
      if (mode === 1 && p.z.lengthSq() > 1e-10) side.copy(p.z)
      else if (mode === 2 || mode === 4) side.set(0, 1, 0)
      else if (mode === 3) side.set(1, 0, 0)
      else if (mode === 5) side.set(1, 1, 1)
      else {
        tangent.subVectors(pts[Math.min(n - 1, i + 1)].pos, pts[Math.max(0, i - 1)].pos)
        if (tangent.lengthSq() < 1e-10) tangent.set(0, 0, 1)
        tangent.normalize()
        toCam.subVectors(EmitterSim.camera, p.pos)
        side.crossVectors(tangent, toCam)
        if (side.lengthSq() < 1e-10) side.set(1, 0, 0)
      }
      side.normalize().multiplyScalar(width / 2)
      pos.setXYZ(i * 2, p.pos.x + side.x, p.pos.y + side.y, p.pos.z + side.z)
      pos.setXYZ(i * 2 + 1, p.pos.x - side.x, p.pos.y - side.y, p.pos.z - side.z)
      // u runs from the head (newest) back along the trail.
      const u = tr?.uvAttached ? (1 - fromTail / Math.max(1e-6, total)) * fraction : -p.serial * fraction
      uv.setXY(i * 2, u + scroll, v0)
      uv.setXY(i * 2 + 1, u + scroll, v1)
      const c = this.withActive(sample(s.color, p.f))
      const a = (c[3] ?? 1) * (1 - p.f)
      col.setXYZW(i * 2, c[0], c[1], c[2], a)
      col.setXYZW(i * 2 + 1, c[0], c[1], c[2], a)
    }
    pos.needsUpdate = true
    uv.needsUpdate = true
    col.needsUpdate = true
    g.setDrawRange(0, (n - 1) * 6)
  }

  /**
   * A model particle's rotation: its orientation mode, then its own rotation
   * and spin. Modes (RichModelOrientationMode): 0/3 north (the effect's axes),
   * 1 the camera's facing, 2 the particle's direction, 4 upright toward the camera.
   */
  private modelQuat(p: Particle): THREE.Quaternion {
    const q = new THREE.Quaternion()
    const m = new THREE.Matrix4()
    const up = new THREE.Vector3(0, 1, 0)
    switch (this.spec.appearance.orientation) {
      case 1: {
        // Facing away from the camera, the way it looks.
        const away = p.pos.clone().multiplyScalar(2).sub(EmitterSim.camera)
        m.lookAt(away, p.pos, up)
        q.setFromRotationMatrix(m)
        break
      }
      case 2: {
        // Along the particle's direction, keeping the node's roll and tilt:
        // turn the node's own +Z onto the direction (usually no turn at all).
        // Turning world +Z instead loses any roll about Z, e.g. Bloody Rings'
        // 22.5° tilt, so its rings lay flat under the tilted orbit line.
        // An attached particle's direction turns with the node: its direction
        // when it appeared would leave Margit's hammer pointing where his
        // hand was then, across the body, as the hand swings.
        const z = new THREE.Vector3(0, 0, 1).applyQuaternion(this.local)
        const d = p.attached && p.dirLocal ? p.dirLocal.clone().applyQuaternion(this.local) : p.dir.clone()
        q.setFromUnitVectors(z, d.normalize()).multiply(this.local)
        break
      }
      case 4: {
        const flat = EmitterSim.camera.clone().sub(p.pos).setY(0)
        if (flat.lengthSq() > 1e-8) q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), flat.normalize())
        break
      }
      default:
        q.copy(this.local)
    }
    if (p.rot3) {
      // Spin: the speed curve integrated over the particle's age when it has
      // one (speeds that ramp up over life), else a constant speed.
      const curve = this.spec.appearance.spinAngle3
      const span = this.spec.appearance.spinSpan ?? 1
      let turned: number[]
      if (curve && p.spinMul) {
        const f = p.age / span
        const s = curve.samples
        const at = sample(curve, Math.min(1, f))
        // Past the curve (endless particles): carry on at the final speed.
        const endSpeed =
          s.length > 1 ? s[s.length - 1].map((v, k) => (v - s[s.length - 2][k]) / (span / (s.length - 1))) : [0, 0, 0]
        turned = at.map(
          (deg, k) => THREE.MathUtils.degToRad(deg + (f > 1 ? endSpeed[k] * (p.age - span) : 0)) * (p.spinMul![k] ?? 1),
        )
      } else {
        turned = [0, 1, 2].map((k) => (p.spin3?.[k] ?? 0) * p.age)
      }
      const e = new THREE.Euler(p.rot3[0] + turned[0], p.rot3[1] + turned[1], p.rot3[2] + turned[2])
      q.multiply(new THREE.Quaternion().setFromEuler(e))
    }
    return q
  }

  get count(): number {
    return this.particles.length
  }

  get spec_(): PreviewEmitter {
    return this.spec
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.ribbonGeometry?.dispose()
    ;(this.ribbon?.material as THREE.Material | undefined)?.dispose()
  }
}
