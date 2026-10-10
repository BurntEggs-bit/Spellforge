/**
 * The effect preview's scene, live: three.js, lit like the game.
 *
 * Driven by the sampled PreviewSpec from the main process. Each emitter is an
 * instanced batch of camera-facing quads; particles are simulated on the CPU
 * (spawn timing, spread, speed, gravity, colour/size over life, flipbook
 * frames) and drawn with the effect's blend mode.
 *
 * Lighting: the scene is lit and backed by one of the game's own light
 * probes (core/effects/environment.ts) and rendered in HDR, then bloomed and
 * ACES tone mapped. Effect colours stay in the game's HDR units; the area is
 * scaled by a partial eye adaptation, so effects stand out more in caves and
 * at night, as they do in game. FXR point/spot lights become real lights that
 * light the ground, models and "Lit" particles. FXR's extra bloom
 * (bloom + bloomColor) is added to the bloom input only.
 *
 * Axes: the effect's forward is +Z. The default camera looks from the side so
 * "Fly forward" moves the effect left to right.
 */
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { EnvironmentView, PreviewEmitter, PreviewSpec } from '../../../shared/api.ts'
import { dotTexture, fadeTexture, shardTexture } from '../../fx/canvasTextures.ts'
import { FX_EXPOSURE, FX_LIGHT_GAIN, GROUND_Y, MAX_LIGHTS, fxExposure } from '../../fx/constants.ts'
import { EmitterSim } from '../../fx/EmitterSim.ts'
import { FlareBatch } from '../../fx/FlareBatch.ts'
import { ModelPool } from '../../fx/ModelPool.ts'
import { decodeRig } from '../../fx/rig.ts'
import { MIX_FRAGMENT, MIX_VERTEX, SCREEN_FX } from '../../fx/shaders.ts'
import { lateTexture, loadTexture, type TextureRef } from '../../fx/textures.ts'
import { clamp } from '../../lib/math.ts'
import { call } from '../../lib/ipc.ts'
import { DAY_TARGET, probeLighting } from '../../lib/envlight.ts'
import { startViewLoop } from '../../lib/viewloop.ts'
import type { PreviewLighting } from './previewPrefs.ts'

/** What the preview's controls say now; the scene reads it every frame. */
export interface PreviewControls {
  playing: boolean
  fly: boolean
  /** Metres a second, flying forward. */
  flySpeed: number
  lighting: PreviewLighting
}

/** The camera's orbit, kept while the same effect is shown again (edits, a new size). */
export interface PreviewOrbit {
  id: number
  yaw: number
  pitch: number
  dist: number
}

/** A running preview: what the page changes from outside its frame loop. */
export interface PreviewScene {
  /** The area's light probe (null: none, a dark backdrop). */
  setEnvironment(env: EnvironmentView | null): void
  dispose(): void
}

/**
 * Builds the preview of an effect in `el` and runs it until disposed. With
 * `scale`, the effect is as scaling it would make it, framed as the unscaled
 * one is (it visibly grows or shrinks).
 */
export function startPreviewScene(
  el: HTMLElement,
  spec: PreviewSpec,
  {
    effectId,
    scale,
    upright,
    controls,
    restart,
    orbit,
    onStats,
  }: {
    effectId: number
    scale: number
    /** The effect's +Z points up (an item glow), not forward (a projectile). */
    upright: boolean
    controls: { readonly current: PreviewControls }
    /** Bumped to start the effect again from its beginning. */
    restart: { readonly current: number }
    orbit: { current: PreviewOrbit | null }
    onStats: (text: string) => void
  },
): PreviewScene {
  // Effect axes: +Z up turns local +Z to the scene's +Y (and local +Y to -Z).
  EmitterSim.frame.setFromAxisAngle(new THREE.Vector3(1, 0, 0), upright ? -Math.PI / 2 : 0)
  // Force fields, in scene axes (relative to the effect root).
  EmitterSim.forces = (spec.forces ?? []).map((f) => ({
    pos: new THREE.Vector3(...f.position).applyQuaternion(EmitterSim.frame),
    dir: new THREE.Vector3(...f.direction).applyQuaternion(EmitterSim.frame).normalize(),
    strength: f.strength,
    shape: f.shape,
    size: f.size,
  }))
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  el.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const darkBackground = new THREE.Color(0.006, 0.0055, 0.005)
  scene.background = darkBackground
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500)

  // Ground with a faint metre grid, a forward arrow and an optional figure for scale.
  const fade = fadeTexture()
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x8a8178,
    roughness: 0.92,
    metalness: 0,
    transparent: true,
    alphaMap: fade,
  })
  const ground = new THREE.Mesh(new THREE.CircleGeometry(14, 64), groundMat)
  ground.rotation.x = -Math.PI / 2
  ground.position.y = GROUND_Y
  ground.renderOrder = -1
  scene.add(ground)
  const grid = new THREE.GridHelper(16, 16, 0x6b5a3e, 0x3a342c)
  const gridMat = grid.material as THREE.Material
  gridMat.transparent = true
  gridMat.opacity = 0.35
  grid.position.y = GROUND_Y + 0.003
  scene.add(grid)
  const axis = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, GROUND_Y + 0.01, 0),
    1,
    0x8a6d37,
    0.15,
    0.08,
  )
  scene.add(axis)
  const figureMat = new THREE.MeshStandardMaterial({ color: 0x7a7570, roughness: 0.8 })
  const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.25, 6, 16), figureMat)
  figure.position.set(0, GROUND_Y + 0.875, -1.6)
  scene.add(figure)

  // Effect lights: a fixed set, so shaders never recompile mid-play.
  const lights = Array.from({ length: MAX_LIGHTS }, () => {
    const l = new THREE.PointLight(0xffffff, 0, 10, 1)
    scene.add(l)
    return l
  })

  // HDR pipeline: a bloom render (with FXR's extra bloom) and the final render.
  const bloomPassUniform = { value: 0 }
  const bloomComposer = new EffectComposer(renderer)
  bloomComposer.renderToScreen = false
  bloomComposer.addPass(new RenderPass(scene, camera))
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, 0.6, 1)
  bloomComposer.addPass(bloomPass)
  const finalComposer = new EffectComposer(renderer)
  finalComposer.addPass(new RenderPass(scene, camera))
  // Screen effects: distortion and radial blur bend or smear what's behind them.
  const screenScene = new THREE.Scene()
  const hasScreen = spec.emitters.some((e) => e.appearance.screen)
  const fxTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tFx: { value: fxTarget.texture } },
    vertexShader: MIX_VERTEX,
    fragmentShader: SCREEN_FX,
  })
  if (hasScreen) finalComposer.addPass(new ShaderPass(screenMaterial, 'tDiffuse'))
  const mixMaterial = new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      // The bloom alone (UnrealBloomPass composites its mips here).
      bloomTexture: { value: bloomPass.renderTargetsHorizontal[0].texture },
      uStrength: { value: 1 },
    },
    vertexShader: MIX_VERTEX,
    fragmentShader: MIX_FRAGMENT,
  })
  const mixPass = new ShaderPass(mixMaterial, 'baseTexture')
  finalComposer.addPass(mixPass)
  finalComposer.addPass(new OutputPass())

  // Area lighting from the game's light probes.
  const pmrem = new THREE.PMREMGenerator(renderer)
  let envTexture: THREE.DataTexture | null = null
  let envTarget: THREE.WebGLRenderTarget | null = null
  const ambient = new THREE.Vector3(DAY_TARGET, DAY_TARGET, DAY_TARGET)
  // Eye adaptation relative to daylight: effects are exposed by it too.
  let adaptation = 1
  const setEnvironment = (view: EnvironmentView | null): void => {
    envTarget?.dispose()
    envTexture?.dispose()
    envTexture = null
    envTarget = null
    scene.environment = null
    adaptation = 1
    if (!view) return
    const lit = probeLighting(view)
    adaptation = lit.adaptation
    ambient.copy(lit.ambient)
    envTexture = lit.texture
    envTarget = pmrem.fromEquirectangular(lit.texture)
    scene.environment = envTarget.texture
  }

  // Orbit: drag to rotate, wheel to zoom.
  let yaw = Math.PI / 2
  let pitch = 0.25
  // Frame the effect: projectiles with a model are small, area effects big.
  // Use a typical emitter, so one huge flash sprite doesn't push the camera away.
  const extents = spec.emitters
    .filter((e) => e.appearance.kind !== 'light')
    .map((e) => Math.max(...e.size.samples.flat().map(Math.abs)) + Math.max(...e.shape.size.map(Math.abs)))
    .sort((a, b) => a - b)
  const biggest = Math.max(0.2, (extents[Math.floor(extents.length * 0.75)] ?? 0) / scale)
  const hasModel = spec.emitters.some((e) => e.appearance.kind === 'model')
  let dist = hasModel ? 1.6 : clamp(biggest * 4, 1.5, 12)
  const kept = orbit.current?.id === effectId ? orbit.current : null
  if (kept) {
    yaw = kept.yaw
    pitch = kept.pitch
    dist = kept.dist
  }
  const keep = () => (orbit.current = { id: effectId, yaw, pitch, dist })
  const target = new THREE.Vector3(0, 0, 0)
  const placeCamera = () => {
    camera.position.set(
      target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    )
    camera.lookAt(target)
  }
  let dragging = false
  let lx = 0
  let ly = 0
  const onDown = (e: PointerEvent) => {
    dragging = true
    lx = e.clientX
    ly = e.clientY
    el.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    yaw -= (e.clientX - lx) * 0.01
    pitch = Math.max(-1.4, Math.min(1.4, pitch + (e.clientY - ly) * 0.01))
    lx = e.clientX
    ly = e.clientY
    keep()
  }
  const onUp = () => (dragging = false)
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    dist = Math.max(0.5, Math.min(60, dist * (e.deltaY > 0 ? 1.1 : 0.9)))
    keep()
  }
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('wheel', onWheel, { passive: false })

  const pools = new Map<EmitterSim, ModelPool>()
  const flares = new Map<EmitterSim, FlareBatch>()
  let disposed = false
  const fallback = dotTexture()
  const shard = shardTexture()
  // Each texture once per model, its image arriving when loaded.
  const modelTextures = new Map<string, THREE.Texture>()
  const modelTexture = (ref: TextureRef | null | undefined): THREE.Texture | null => {
    if (!ref) return null
    const key = `${ref.id}_${ref.type}`
    let tex = modelTextures.get(key)
    if (!tex) {
      tex = lateTexture(loadTexture(ref), () => !disposed)
      modelTextures.set(key, tex)
    }
    return tex
  }
  /** Longest play-once model animation (seconds, 0 = none), and a restart hook set below. */
  const onceAnimation: { length: number; restart?: () => void } = { length: 0 }
  const sims = spec.emitters.map((e) => {
    const isModel = e.appearance.kind === 'model'
    const sim = new EmitterSim(e, isModel ? shard : fallback, bloomPassUniform)
    ;(sim.screen ? screenScene : scene).add(sim.mesh)
    if (e.appearance.flare) {
      const batch = new FlareBatch(e, bloomPassUniform, (ref, apply) =>
        loadTexture(ref, { greyAsAlpha: true }).then((t) => t && !disposed && apply(t)),
      )
      flares.set(sim, batch)
      scene.add(batch.group)
    }
    const nm = e.appearance.screen?.normalMap
    if (nm) {
      loadTexture(nm, { srgb: false }).then((t) => t && !disposed && sim.setNormalMap(t))
    }
    if (sim.ribbon) scene.add(sim.ribbon)
    const tex = e.appearance.texture
    if (tex && !isModel) {
      loadTexture(tex, { greyAsAlpha: true }).then((t) => t && !disposed && sim.setTexture(t))
    }
    const mask = e.appearance.mask
    if (mask && !isModel) {
      loadTexture(mask, { greyAsAlpha: 'mask', size: 128, srgb: false }).then((t) => t && !disposed && sim.setMask(t))
    }
    // Models: swap the shard for the real mesh once it loads.
    const modelId = e.appearance.model
    if (isModel && modelId) {
      const anim = e.appearance.modelAnimation
      Promise.all([
        call('model:mesh', { id: modelId }),
        anim
          ? call('model:rig', { model: modelId, anibnd: anim.anibnd, animation: anim.animation }).catch(() => null)
          : null,
      ]).then(([meshes, rig]) => {
        if (!meshes || disposed) return
        const pool = new ModelPool(meshes, e.appearance, modelTexture, rig && anim ? decodeRig(rig, anim) : null)
        // A model animation that plays once sets the loop: the whole clip, then a beat.
        if (rig && anim && !anim.loop) {
          onceAnimation.length = Math.max(onceAnimation.length, rig.duration / Math.max(0.01, anim.speed) + 0.5)
          onceAnimation.restart?.()
        }
        pools.set(sim, pool)
        scene.add(pool.root)
        sim.mesh.visible = false
      })
    }
    return sim
  })

  // The canvas fills the view; its buffer follows the size (see viewloop.ts).
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  const resize = (w: number, h: number, ratio: number) => {
    renderer.setPixelRatio(ratio)
    renderer.setSize(w, h, false)
    bloomComposer.setPixelRatio(ratio)
    finalComposer.setPixelRatio(ratio)
    bloomComposer.setSize(w, h)
    const buf = renderer.getDrawingBufferSize(new THREE.Vector2())
    fxTarget.setSize(buf.x, buf.y)
    EmitterSim.resolution.value.copy(buf)
    finalComposer.setSize(w, h)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }

  let t = 0
  let last = performance.now()
  let frame = 0
  let seenRestart = restart.current
  const root = new THREE.Vector3()
  const lightAt = new THREE.Vector3()
  // Continuous effects (emitters that run until the effect is stopped, like a
  // fog gate or a barrier) are shown in their steady state: pre-warmed, and
  // not looped unless they are flying.
  // Only when every part keeps running: effects with a one-time burst (a
  // cast flash, an impact) keep looping so the burst stays visible.
  const persistent = (e: PreviewEmitter) =>
    e.nodeDuration <= 0 && (e.emission.kind === 'once' ? e.lifetime <= 0 : e.emission.total <= 0)
  const continuous = spec.emitters.length > 0 && spec.emitters.every(persistent)
  const warmup = continuous
    ? Math.min(
        10,
        Math.max(0, ...spec.emitters.filter((e) => e.nodeDuration <= 0).map((e) => (e.lifetime > 0 ? e.lifetime : 0))),
      )
    : 0
  const begin = () => {
    t = 0
    sims.forEach((s) => s.reset())
    // Models that play their animation once (Agheel's dragon head) restart
    // from the top with the effect, without pre-warming.
    if (!continuous || controls.current.fly || onceAnimation.length > 0) return
    root.set(0, 0, 0)
    EmitterSim.camera.copy(camera.position)
    const step = 1 / 30
    for (let w = 0; w < warmup; w += step) {
      t += step
      sims.forEach((s) => s.update(t, step, root))
    }
  }
  begin()
  onceAnimation.restart = begin
  const tick = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
    last = now
    const st = controls.current
    const p = st.lighting
    if (restart.current !== seenRestart) {
      seenRestart = restart.current
      begin()
    }
    fxExposure.value = FX_EXPOSURE * adaptation
    if (st.playing) {
      t += dt
      const loopLength = Math.max(spec.loop, onceAnimation.length)
      if (t > loopLength && (!continuous || st.fly || onceAnimation.length > 0)) begin()
      const travel = st.fly ? st.flySpeed : 0
      root.set(0, 0, -spec.loop * travel * 0.5 + t * travel)
      EmitterSim.camera.copy(camera.position)
      EmitterSim.cameraQuat.copy(camera.quaternion)
      sims.forEach((s) => {
        s.update(t, dt, root)
        pools.get(s)?.update(s.instances)
      })
    }

    // Effect lights. Colour is HDR (FXR units); brightness goes into intensity.
    const active = sims.filter((s) => s.lightOut).slice(0, MAX_LIGHTS)
    lights.forEach((l, i) => {
      const out = active[i]?.lightOut
      if (!out) {
        l.intensity = 0
        return
      }
      const [r, g, b, a = 1] = out.color
      const peak = Math.max(r, g, b, 1e-6)
      l.color.setRGB(r / peak, g / peak, b / peak)
      l.intensity = peak * Math.max(0, a) * fxExposure.value * FX_LIGHT_GAIN * Math.PI
      l.distance = active[i].spec_.appearance.light?.radius ?? 10
      l.position.copy(out.pos)
    })
    // "Lit" particles: the area's ambient light plus nearby effect lights,
    // relative to daylight (1 = the average of a day sky).
    for (const s of sims) {
      if (!s.spec_.appearance.lit) continue
      lightAt.copy(ambient)
      for (const l of lights) {
        if (l.intensity <= 0) continue
        const d = l.position.distanceTo(s.center)
        if (d > l.distance) continue
        const k = ((l.intensity / Math.PI) * (1 - d / l.distance)) / (1 + d * d)
        lightAt.x += l.color.r * k
        lightAt.y += l.color.g * k
        lightAt.z += l.color.b * k
      }
      s.setLight(lightAt.multiplyScalar(1 / DAY_TARGET))
    }

    // Scene options.
    const turn = THREE.MathUtils.degToRad(p.turn)
    scene.backgroundRotation.y = turn
    scene.environmentRotation.y = turn
    scene.background = p.backdrop && envTexture ? envTexture : darkBackground
    // Probes are 128 px: soften them like a depth-of-field blur instead of showing texels.
    scene.backgroundBlurriness = 0.06
    ground.visible = p.ground
    grid.visible = p.ground
    axis.visible = p.ground
    figure.visible = p.figure
    renderer.toneMappingExposure = Math.pow(2, p.ev)

    // Follow the effect while it flies.
    target.lerp(root, 0.2)
    placeCamera()
    if (p.bloom > 0) {
      bloomPassUniform.value = 1
      bloomComposer.render()
      bloomPassUniform.value = 0
    }
    mixMaterial.uniforms.uStrength.value = 0.6 * p.bloom
    flares.forEach((b, sim) => b.update(sim.flareSources, camera, st.playing ? dt : 0))
    if (hasScreen) {
      // Fill the effects buffer, then the screen pass applies it.
      const clear = renderer.getClearColor(new THREE.Color())
      const alpha = renderer.getClearAlpha()
      renderer.setRenderTarget(fxTarget)
      renderer.setClearColor(0x000000, 0)
      renderer.clear()
      renderer.render(screenScene, camera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(clear, alpha)
    }
    finalComposer.render()
    const n = sims.reduce((k, s) => k + s.count, 0)
    if (++frame % 15 === 0)
      onStats(
        continuous && !st.fly
          ? `${t.toFixed(1)} s, continuous, ${n} particles`
          : `${t.toFixed(2)} s of ${spec.loop.toFixed(1)} s, ${n} particles`,
      )
  }
  const loop = startViewLoop(el, { resize, frame: tick })

  const dispose = () => {
    loop.stop()
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('wheel', onWheel)
    disposed = true
    sims.forEach((s) => s.dispose())
    flares.forEach((b) => b.dispose())
    fxTarget.dispose()
    screenMaterial.dispose()
    pools.forEach((p) => p.dispose())
    modelTextures.forEach((t) => t.dispose())
    fallback.dispose()
    shard.dispose()
    fade.dispose()
    ground.geometry.dispose()
    groundMat.dispose()
    figure.geometry.dispose()
    figureMat.dispose()
    grid.dispose()
    axis.dispose()
    envTarget?.dispose()
    envTexture?.dispose()
    pmrem.dispose()
    bloomPass.dispose()
    mixMaterial.dispose()
    bloomComposer.dispose()
    finalComposer.dispose()
    renderer.dispose()
    el.removeChild(renderer.domElement)
  }
  return { setEnvironment, dispose }
}
