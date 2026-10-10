/**
 * The character viewer of the Animations and Enemies pages: the player in
 * the chosen equipment (or another character in its own model) playing an
 * animation or a combo, with DS Anim Studio's helper overlays (dummy polys,
 * bones, glue joints, root motion) and the animation's events acted out:
 * hitboxes, bullets, effects and sounds.
 *
 * Skinning: one THREE.Bone per skeleton bone, bound at the skeleton's
 * reference pose; armor meshes are skinned to it, weapons ride on their
 * attach bone (R_Weapon / L_Weapon). Root motion moves the whole actor.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { startViewLoop } from '../lib/viewloop.ts'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { WeaponPlacement, BuffRun, ClipView, RetargetRequest, SimAction } from '../../shared/api.ts'
import { call } from '../lib/ipc.ts'
import { SoundPlayer } from './sound.ts'
import { probeLighting } from '../lib/envlight.ts'
import { FxManager } from '../fx/fxruns.ts'
import { FX_EXPOSURE, FX_LIGHT_GAIN, fxExposure } from '../fx/constants.ts'
import { EmitterSim } from '../fx/EmitterSim.ts'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { errorMessage } from '../../shared/errors.ts'
import { useLatest } from '../lib/hooks.ts'
import type { PlayClock } from './PlayClock.ts'
import type { EquipPrefs, LightingPrefs, WeaponStyle, HelperPrefs } from './prefs.ts'
import { effectMaskShows, speedAt, opacityAt, maskShows, type ModelMasks, type EventEffects } from './eventEffects.ts'
import type { ViewerState, Segment } from './scene/state.ts'
import { mergeLights } from './sim/lights.ts'
import { buildRuns } from './sim/runs.ts'
import { Legend } from './Legend.tsx'
import { updateActiveList } from './scene/activeList.ts'
import { drawHelpers, drawText, HELPER_SEGMENTS } from './scene/overlays.ts'
import { resolveStyle, placeWeapons } from './scene/weapons.ts'
import { poseWeapon, setOpacity, makePart, removePart } from './scene/parts.ts'
import { buildTrail, clipLength, decodeClip, pose, resetPose, segmentAt, setupSkeleton } from './scene/pose.ts'
import { exportGlb, type ViewportExport } from './exportGlb.ts'
import { partOf, FACE_PART_KEYS } from './equipment.ts'
import { EffectGizmo, type GizmoResult, type GizmoTarget } from './scene/effectGizmo.ts'

/** No weapon buffs: one array, so the render loop sees no change between renders. */
const NO_BUFFS: BuffRun[] = []

/** One animation of a combo (F8), cut at `to` seconds into it (null: played to its end). */
export interface ComboStep {
  animation: string
  to: number | null
}

export function CharacterView({
  animation,
  clock,
  equipment,
  helpers,
  lighting,
  actions,
  buffs,
  focus,
  onFocusEnd,
  placements,
  onStatus,
  chr = 'c0000',
  retarget = null,
  masks = null,
  effects = null,
  combo = null,
  onCombo,
  exportRef,
  gizmo = null,
  onGizmo,
}: {
  /** The move or rotate tool on an effect event (G, R), or none. */
  gizmo?: GizmoTarget | null
  /** A drag of the tool finished: write it into the effect (or move the event to another dummy). */
  onGizmo?: (r: GizmoResult) => Promise<void>
  /** Filled with the viewport's export functions while it's shown. */
  exportRef?: { current: ViewportExport | null }
  /** Where each animation of the combo starts on its clock (seconds), once its clips have loaded. */
  onCombo?: (starts: number[]) => void
  /** A combo (F8): these animations one after another, each cut at `to` (seconds into it; null: its end), instead of `animation`. */
  combo?: ComboStep[] | null
  /** What the animation's events do to speed, opacity, held weapons and model parts. */
  effects?: EventEffects | null
  /** Whose model and animations: c0000 the player, else another character (remount to change it). */
  chr?: string
  /** The animation is `retarget.chr`'s, fitted to the player. */
  retarget?: RetargetRequest | null
  /** Another character's model parts by time. */
  masks?: ModelMasks | null
  /** What the animation's events do (hitboxes, bullets, effects), for simulation. */
  actions: SimAction[]
  /** Weapon buff coatings to show on the held weapons. */
  buffs?: BuffRun[]
  /** A held weapon to frame side-on and follow; null: the whole character. */
  focus?: 'right' | 'left' | null
  /** Where the game hangs each held weapon's models (WepAbsorpPosParam). */
  placements?: { right: WeaponPlacement | null; left: WeaponPlacement | null }
  /** The user left the weapon view (panned or reset the camera). */
  onFocusEnd?: () => void
  animation: string | null
  clock: PlayClock
  equipment: EquipPrefs
  helpers: HelperPrefs
  lighting: LightingPrefs
  onStatus?: (s: { clip: ClipView | null; error: string | null; loading: boolean }) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const textCanvas = useRef<HTMLCanvasElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const state = useRef<ViewerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The error shown is a piece of equipment that didn't load (cleared when the outfit changes). */
  const equipError = useRef(false)
  // The render loop and the loaders run outside React: they read the props as they are now.
  const placementsRef = useLatest(placements)
  const onFocusEndRef = useLatest(onFocusEnd)
  const helpersRef = useLatest(helpers)
  // The animation playing, for weapons that animate with it (a katana's scabbard).
  const animationRef = useLatest(animation)
  const masksRef = useLatest(masks)
  const effectsRef = useLatest(effects)
  // How the weapons are held: the equipment's choice, or (auto) as the animation id says.
  const equipStyleRef = useLatest<WeaponStyle>(equipment.style ?? 'auto')
  const lightingRef = useLatest(lighting)
  const actionsRef = useLatest(actions)
  const buffsRef = useLatest(buffs ?? NO_BUFFS)
  const gizmoRef = useRef<EffectGizmo | null>(null)
  const gizmoTargetRef = useLatest(gizmo)
  const onGizmoRef = useLatest(onGizmo)
  // The tool follows the selected effect event and its mode; a drag's result goes to the page.
  const gizmoKey = gizmo ? `${gizmo.event}:${gizmo.mode}:${gizmo.snap}:${gizmo.dummy}` : ''
  useEffect(() => {
    gizmoRef.current?.set(gizmoTargetRef.current ?? null, onGizmoRef.current ?? null)
  }, [gizmoKey, onGizmo, gizmoTargetRef, onGizmoRef])
  // The weapon to frame. Leaving the weapon view clears it at once, before the page hears of it.
  const focusRef = useRef(focus ?? null)
  useLayoutEffect(() => {
    focusRef.current = focus ?? null
  }, [focus])
  useEffect(() => {
    if (state.current) state.current.runsDirty = true
  }, [helpers.simFx, helpers.targetDistance])
  // Root motion scaled: the trail follows, and bullets and effects are placed again.
  useEffect(() => {
    if (!state.current) return
    buildTrail(state.current, helpers)
    state.current.runsDirty = true
  }, [helpers.rootScaleXZ, helpers.rootScaleY, helpers.rootRotation])
  // By value: the same lighting set again (a new object) changes nothing.
  const lightKey = JSON.stringify(lighting)
  useEffect(() => {
    state.current?.setLighting(lighting)
  }, [lightKey])

  // Sound events play as the clock passes them (the render loop calls them), from
  // the banks of the character whose animation it is.
  const soundRef = useRef<SoundPlayer | null>(null)
  const soundChrRef = useLatest(retarget?.chr ?? chr)
  useEffect(() => {
    const p = new SoundPlayer()
    soundRef.current = p
    return () => {
      p.dispose()
      soundRef.current = null
    }
  }, [])
  useEffect(() => soundRef.current?.setVolume(helpers.soundVolume ?? 0.6), [helpers.soundVolume])
  // Another animation: the last one's sounds stop.
  useEffect(() => () => soundRef.current?.stop(), [animation])
  // Decoded before they're due.
  useEffect(() => {
    const p = soundRef.current
    if (!p || !helpers.sound) return
    for (const a of actions)
      if (a.kind === 'sound' && a.sound) void p.prepare(soundChrRef.current, a.sound.type, a.sound.id)
  }, [actions, helpers.sound, retarget?.chr, chr, soundChrRef])

  // Scene setup, render loop, camera controls.
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    el.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#14120f',
    )
    const camera = new THREE.PerspectiveCamera(43, 1, 0.05, 2000)
    const plainBackground = scene.background
    // Fallback lights until (or unless) a probe loads.
    const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x3a3128, 1.1)
    scene.add(hemi)
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.2)
    rim.position.set(-3, 3, -4)
    scene.add(rim)
    // The sun: the probe's brightest direction, casting soft shadows.
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2)
    sun.position.set(2.5, 5, 4)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -2.5
    sun.shadow.camera.right = 2.5
    sun.shadow.camera.top = 2.8
    sun.shadow.camera.bottom = -1.2
    sun.shadow.camera.near = 0.1
    sun.shadow.camera.far = 30
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.02
    sun.shadow.radius = 4
    scene.add(sun)
    scene.add(sun.target)
    const sunDir = new THREE.Vector3(2.5, 5, 4).normalize()
    // Shadow catcher on the floor.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.45 }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.002
    floor.receiveShadow = true
    scene.add(floor)
    const pmrem = new THREE.PMREMGenerator(renderer)
    let envTarget: THREE.WebGLRenderTarget | null = null
    let envKey = ''
    let envSeq = 0
    // Eye adaptation relative to daylight: effects are exposed by it too.
    let adaptation = 1
    const setLighting = (l: LightingPrefs) => {
      renderer.toneMappingExposure = 1.05 * Math.pow(2, l.ev)
      renderer.shadowMap.enabled = l.shadows
      sun.castShadow = l.shadows
      floor.visible = l.shadows
      const key = `${l.area}:${l.time}:${l.probe}`
      const applyBackdrop = () => {
        if (l.backdrop && envTarget) {
          scene.background = envTarget.texture
          scene.backgroundBlurriness = 0.55
          scene.backgroundIntensity = 0.55
        } else scene.background = plainBackground
      }
      if (key === envKey) {
        applyBackdrop()
        sun.intensity = sun.userData.base * l.sun
        return
      }
      envKey = key
      const seq = ++envSeq
      call('env:get', { area: l.area, time: l.time, probe: l.probe })
        .then((view) => {
          if (seq !== envSeq || !state.current) return
          const lit = probeLighting(view)
          adaptation = lit.adaptation
          envTarget?.dispose()
          envTarget = pmrem.fromEquirectangular(lit.texture)
          lit.texture.dispose()
          scene.environment = envTarget.texture
          scene.environmentIntensity = 1
          hemi.intensity = 0.12
          rim.intensity = 0.15
          // Sun: from the probe's brightest region, strongest where the sky is clear.
          sunDir.copy(lit.sunDirection)
          sun.color.copy(lit.sunColor)
          sun.userData.base = 2.4 * Math.min(1.4, Math.max(0.35, lit.sunContrast / 10))
          sun.intensity = sun.userData.base * l.sun
          applyBackdrop()
        })
        .catch(() => {
          envKey = ''
          adaptation = 1
          scene.environment = null
          hemi.intensity = 1.1
          rim.intensity = 1.2
          sun.userData.base = 2.2
          sun.intensity = 2.2 * l.sun
          applyBackdrop()
        })
    }
    sun.userData.base = 2.2

    // Ground grid: 1 m cells, brighter every 10 m, axis lines through the origin.
    const grid = new THREE.Group()
    const minor = new THREE.GridHelper(40, 40, 0x3a4a3a, 0x2a332a)
    ;(minor.material as THREE.Material).transparent = true
    ;(minor.material as THREE.Material).opacity = 0.7
    grid.add(minor)
    const axisMat = new THREE.LineBasicMaterial({ color: 0xc9a64a })
    const axes = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-20, 0.001, 0),
      new THREE.Vector3(20, 0.001, 0),
      new THREE.Vector3(0, 0.001, -20),
      new THREE.Vector3(0, 0.001, 20),
    ])
    grid.add(new THREE.LineSegments(axes, axisMat))
    scene.add(grid)

    // The game's data is left-handed; three.js is right-handed. Mirroring X
    // keeps the character facing the camera with its right side on screen-left.
    const world = new THREE.Group()
    world.scale.set(-1, 1, 1)
    scene.add(world)
    const actor = new THREE.Group()
    world.add(actor)

    // Helpers: screen-space thick lines (fixed capacity, rewritten each frame).
    const helperGeom = new LineSegmentsGeometry()
    helperGeom.setPositions(new Float32Array(HELPER_SEGMENTS * 6))
    helperGeom.setColors(new Float32Array(HELPER_SEGMENTS * 6))
    const helperMat = new LineMaterial({
      vertexColors: true,
      linewidth: 2.5,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    })
    const helperLines = new LineSegments2(helperGeom, helperMat)
    helperLines.renderOrder = 10
    helperLines.frustumCulled = false
    scene.add(helperLines)
    const trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x5ad16e, depthTest: false, transparent: true }),
    )
    trail.renderOrder = 9
    trail.frustumCulled = false
    world.add(trail)

    const orbit = { yaw: Math.PI, pitch: 0.18, dist: 4.2, target: new THREE.Vector3(0, 1, 0) }
    const s: ViewerState = {
      scene,
      camera,
      orbit,
      setLighting,
      world,
      actor,
      bones: [],
      skeleton: null,
      skel: null,
      ref: [],
      invRef: [],
      refPose: [],
      parts: new Map(),
      body: null,
      clip: null,
      segments: null,
      helperLines,
      trail,
      time: 0,
      actions: [],
      buffs: [],
      fx: new FxManager(world, 0),
      bullets: [],
      targets: [],
      runsDirty: true,
      capsule: null,
      reach: null,
    }
    state.current = s
    setLighting(lightingRef.current)
    // The effect move/rotate tool: a drag holds the animation still while it's on.
    const effectTool = new EffectGizmo(s, camera, renderer.domElement, () => {
      clock.playing = false
      clock.emit()
    })
    gizmoRef.current = effectTool
    effectTool.set(gizmoTargetRef.current ?? null, onGizmoRef.current ?? null)
    if (exportRef) exportRef.current = { glb: (what) => exportGlb(s, what, helpersRef.current) }

    const placeCamera = () => {
      const { yaw, pitch, dist, target } = orbit
      camera.position.set(
        target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        target.y + Math.sin(pitch) * dist,
        target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
      )
      camera.lookAt(target)
    }
    const reset = () => {
      orbit.yaw = Math.PI
      orbit.pitch = 0.18
      orbit.dist = 4.2
      const at = actor.getWorldPosition(new THREE.Vector3())
      orbit.target.set(at.x, 1, at.z)
    }

    // Framing a held weapon (F): the camera turns side-on to the blade, then
    // keeps it in the middle of the view as it moves.
    let framed: 'right' | 'left' | null = null
    let settle: { yaw: number; pitch: number; dist: number; until: number } | null = null
    const weaponPose = (slot: string): { center: THREE.Vector3; axis: THREE.Vector3; length: number } | null => {
      const p = s.parts.get(slot)
      if (!p) return null
      const box = new THREE.Box3()
      const corner = new THREE.Vector3()
      let best: { length: number; axis: THREE.Vector3 } | null = null
      for (const o of p.objects) {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry) continue
        mesh.updateWorldMatrix(true, false)
        // A scabbard its own clip scales away doesn't count.
        if (mesh.matrixWorld.getMaxScaleOnAxis() < 0.01) continue
        const g = mesh.geometry
        if (!g.boundingBox) g.computeBoundingBox()
        const b = g.boundingBox!
        for (let i = 0; i < 8; i++)
          box.expandByPoint(
            corner
              .set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
              .applyMatrix4(mesh.matrixWorld),
          )
        // The blade runs along the mesh's longest side.
        const size = b.getSize(new THREE.Vector3())
        const k = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2
        const axis = new THREE.Vector3().setFromMatrixColumn(mesh.matrixWorld, k)
        const length = [size.x, size.y, size.z][k] * axis.length()
        if (!best || length > best.length) best = { length, axis: axis.normalize() }
      }
      if (!best || box.isEmpty()) return null
      return { center: box.getCenter(new THREE.Vector3()), axis: best.axis, length: best.length }
    }
    const endFocus = () => {
      if (!framed) return
      framed = null
      settle = null
      focusRef.current = null
      onFocusEndRef.current?.()
    }
    const startFocus = (slot: 'right' | 'left') => {
      framed = slot
      const w = weaponPose(slot)
      if (!w) return endFocus()
      // From the blade towards the camera, at right angles to the blade and as close to the current view as can be.
      const view = camera.position.clone().sub(orbit.target).normalize()
      const side = view.clone().addScaledVector(w.axis, -view.dot(w.axis))
      if (side.lengthSq() < 0.04) side.crossVectors(w.axis, new THREE.Vector3(0, 1, 0))
      if (side.lengthSq() < 1e-6) side.set(0, 0, 1)
      side.normalize()
      settle = {
        yaw: Math.atan2(side.x, side.z),
        pitch: Math.max(-1.2, Math.min(1.2, Math.asin(side.y))),
        dist: Math.max(0.5, Math.min(3.5, w.length * 1.35)),
        until: performance.now() + 1200,
      }
    }
    const followFocus = (dt: number, now: number) => {
      const want = focusRef.current
      if (want !== framed) {
        if (want) startFocus(want)
        else {
          // Turned off with the button or F: back to the whole character.
          framed = null
          settle = null
          reset()
        }
      }
      if (!framed) return
      const w = weaponPose(framed)
      if (!w) return
      const k = 1 - Math.exp(-dt * 9)
      orbit.target.lerp(w.center, settle ? k : Math.min(1, k * 2))
      if (settle) {
        const dy = Math.atan2(Math.sin(settle.yaw - orbit.yaw), Math.cos(settle.yaw - orbit.yaw))
        orbit.yaw += dy * k
        orbit.pitch += (settle.pitch - orbit.pitch) * k
        orbit.dist += (settle.dist - orbit.dist) * k
        if (now > settle.until) settle = null
      }
    }

    // Mouse: left drag orbits, right drag pans (Ctrl: forward/back), wheel zooms, middle click resets.
    let drag: { button: number; x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      // On the move/rotate tool's handle: it drags, the camera stays.
      if (effectTool.busy()) return
      if (e.button === 1) {
        endFocus()
        reset()
        e.preventDefault()
        return
      }
      drag = { button: e.button, x: e.clientX, y: e.clientY }
      try {
        renderer.domElement.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      if (drag.button === 0) {
        // Orbiting a framed weapon keeps following it.
        settle = null
        orbit.yaw -= dx * 0.008
        orbit.pitch = Math.max(-1.45, Math.min(1.45, orbit.pitch + dy * 0.008))
      } else {
        endFocus()
        const k = orbit.dist * 0.0018
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
        const up = e.ctrlKey
          ? new THREE.Vector3(Math.sin(orbit.yaw), 0, Math.cos(orbit.yaw)).multiplyScalar(-1)
          : new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
        orbit.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k)
      }
    }
    const onUp = () => {
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      settle = null
      const f = e.shiftKey ? 1.35 : e.ctrlKey ? 1.04 : 1.12
      orbit.dist = Math.max(0.3, Math.min(200, orbit.dist * (e.deltaY > 0 ? f : 1 / f)))
    }
    const onContext = (e: Event) => e.preventDefault()
    const dom = renderer.domElement
    dom.addEventListener('pointerdown', onDown)
    dom.addEventListener('pointermove', onMove)
    dom.addEventListener('pointerup', onUp)
    dom.addEventListener('wheel', onWheel, { passive: false })
    dom.addEventListener('contextmenu', onContext)

    // HDR render with bloom, so effects glow as in the effect preview.
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }))
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 0.92)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())
    // Effect lights light the character and the floor.
    const fxLights = Array.from({ length: 4 }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2)
      world.add(l)
      return l
    })

    // The canvases fill the view; their buffers follow the size (see viewloop.ts).
    dom.style.width = '100%'
    dom.style.height = '100%'
    const resize = (w: number, h: number, ratio: number) => {
      renderer.setPixelRatio(ratio)
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      helperMat.resolution.set(w, h)
      composer.setPixelRatio(ratio)
      composer.setSize(w, h)
      EmitterSim.resolution.value.set(w, h)
      const c = textCanvas.current
      if (c) {
        c.width = w * ratio
        c.height = h * ratio
        c.style.width = '100%'
        c.style.height = '100%'
      }
    }

    let last = performance.now()
    let lastRoot = new THREE.Vector3()
    let lastYaw = 0
    let lastOpacity = 1
    let soundWasOn = false
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000))
      last = now
      const eff = effectsRef.current
      // AnimSpeedGradient events speed playback up or slow it down while they run.
      const before = clock.time
      clock.tick(dt * speedAt(eff, clock.time))
      // Sounds whose events the clock just passed (on the frame playback starts, one right there too).
      // A pause or a jump stops what's playing; the end of a clip played once lets it ring out.
      const sounds = soundRef.current
      const soundOn = clock.playing && !!helpersRef.current.sound
      if (sounds && soundOn) {
        const from = soundWasOn ? before : before - 1e-4
        const to = clock.time
        const wrapped = to < from
        for (const a of actionsRef.current) {
          if (a.kind !== 'sound' || !a.sound) continue
          if (wrapped ? a.start > from || a.start <= to : a.start > from && a.start <= to)
            sounds.play(soundChrRef.current, a.sound.type, a.sound.id)
        }
      } else if (sounds && soundWasOn && clock.time < clock.duration - 1e-4) sounds.stop()
      soundWasOn = soundOn
      pose(s, clock.time, helpersRef.current)
      // A combo's current animation, for the weapon's own clips and the way it's held.
      const seg = s.segments?.length ? s.segments[segmentAt(s.segments, clock.time)] : null
      const playing = seg?.clip ?? s.clip
      const current = seg ? seg.clip.view.animation : animationRef.current
      const style = resolveStyle(equipStyleRef.current, current)
      const weaponNames = [current, playing?.view.hkx?.replace(/\.hkx$/i, '')]
      for (const p of s.parts.values()) poseWeapon(p, weaponNames, clock.time)
      // Camera follows the root motion (translation, and turning if asked).
      const rootNow = actor.getWorldPosition(new THREE.Vector3())
      if (helpersRef.current.followCamera) {
        const d = rootNow.clone().sub(lastRoot)
        d.y = 0
        orbit.target.add(d)
      }
      lastRoot = rootNow
      // The world is mirrored on X: a turn of the actor by +a shows as -a.
      const yawNow = actor.rotation.y
      if (helpersRef.current.followRotation && Math.abs(yawNow - lastYaw) < 1) orbit.yaw -= yawNow - lastYaw
      lastYaw = yawNow
      followFocus(dt, now)
      sun.target.position.copy(rootNow)
      sun.position.copy(rootNow).addScaledVector(sunDir, 12)
      placeCamera()
      const models = helpersRef.current.models
      for (const p of s.parts.values())
        for (const o of p.objects) o.visible = models && effectMaskShows(eff, o.userData.mask, clock.time)
      // Weapons where the way they're held puts them (one- or two-handed, hung), hidden by events or in game.
      placeWeapons(s, placementsRef.current, style, models, eff, clock.time)
      // Another character's model: its parts by mask group, as its NPC row and the animation's events show them.
      if (s.body)
        for (const o of s.body.objects)
          o.visible =
            models &&
            maskShows(masksRef.current, o.userData.mask, clock.time) &&
            effectMaskShows(eff, o.userData.mask, clock.time)
      // SetOpacityKeyframe: the whole character fades.
      const op = opacityAt(eff, clock.time)
      if (Math.abs(op - lastOpacity) > 1e-3) {
        lastOpacity = op
        for (const p of [...(s.body ? [s.body] : []), ...s.parts.values()]) setOpacity(p.objects, op)
      }
      grid.visible = helpersRef.current.grid
      s.time = clock.time
      if (s.actions !== actionsRef.current) {
        s.actions = actionsRef.current
        s.runsDirty = true
      }
      if (s.buffs !== buffsRef.current) {
        s.buffs = buffsRef.current
        s.runsDirty = true
      }
      const hp = helpersRef.current
      if (s.runsDirty && s.clip && s.skeleton && s.body) {
        s.runsDirty = false
        const fxRuns = buildRuns(s, hp)
        s.fx.setRuns(hp.simFx ? fxRuns : [])
      }
      // Particles face the camera: give the engine the camera in the (mirrored) character space.
      EmitterSim.camera.copy(world.worldToLocal(camera.position.clone()))
      fxExposure.value = FX_EXPOSURE * adaptation
      s.fx.update(clock.time)
      effectTool.update(clock.time)
      const lit = hp.simFx ? mergeLights(s.fx.lights(), fxLights.length) : []
      fxLights.forEach((l, i) => {
        const o = lit[i]
        if (!o) {
          l.intensity = 0
          return
        }
        const [r, g, b, a = 1] = o.color
        const peak = Math.max(r, g, b, 1e-6)
        l.color.setRGB(r / peak, g / peak, b / peak)
        l.intensity = Math.min(60, peak * Math.max(0, a) * fxExposure.value * FX_LIGHT_GAIN * Math.PI)
        l.distance = o.radius
        l.position.copy(o.pos)
      })
      bloom.enabled = hp.bloom
      const labels = drawHelpers(s, hp)
      composer.render()
      drawText(textCanvas.current, labels, camera, helpersRef.current)
      updateActiveList(listRef.current, s, helpersRef.current)
    }
    const loop = startViewLoop(el, { resize, frame })

    return () => {
      loop.stop()
      dom.removeEventListener('pointerdown', onDown)
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('wheel', onWheel)
      dom.removeEventListener('contextmenu', onContext)
      if (exportRef) exportRef.current = null
      effectTool.dispose()
      gizmoRef.current = null
      pmrem.dispose()
      envTarget?.dispose()
      s.fx.dispose()
      composer.dispose()
      renderer.dispose()
      el.removeChild(dom)
      state.current = null
    }
  }, [
    clock,
    actionsRef,
    animationRef,
    buffsRef,
    effectsRef,
    equipStyleRef,
    exportRef,
    gizmoTargetRef,
    helpersRef,
    lightingRef,
    masksRef,
    onFocusEndRef,
    onGizmoRef,
    placementsRef,
    soundChrRef,
  ])

  // Skeleton and the body's dummy polys, once.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const skel = await call('char:skeleton', { chr })
        if (!live || !state.current) return
        setupSkeleton(state.current, skel)
        // Another character: framed by its height (Margit stands twice as tall as you).
        if (chr !== 'c0000') {
          const h = Math.max(1.8, ...state.current.ref.map((m) => m.elements[13]))
          state.current.orbit.target.set(0, h * 0.5, 0)
          state.current.orbit.dist = Math.max(4.2, h * 2.1)
        }
        const body = await call('char:body', { chr })
        if (!live || !state.current) return
        state.current.body = makePart(state.current, 'body', body, false)
        const capsule = await call('char:capsule', { chr }).catch(() => null)
        if (live && state.current) state.current.capsule = capsule
      } catch (e) {
        setError(errorMessage(e))
      }
    })()
    return () => {
      live = false
    }
  }, [])

  /** Loads a weapon's model 1; placeSecondModels puts it at its dummy poly every frame. */
  const loadSecond = async (s: ViewerState, key: string, part: string, attach: string) => {
    try {
      const view = await call('char:part', { part, attach, model: 1 })
      if (!state.current) return
      const p = makePart(s, key, view, true)
      // Its own clips are for the hand: hung on the body it keeps its bind pose.
      p.weaponClips = null
      for (const o of p.objects) {
        o.parent?.remove(o)
        s.world.add(o)
        o.matrixAutoUpdate = false
        o.visible = false
      }
      s.parts.set(key, p)
    } catch {
      /* a weapon without a second model: nothing to hang */
    }
  }

  // Equipment.
  const equipKey = JSON.stringify(equipment)
  useEffect(() => {
    let live = true
    const want: [string, string | null, string][] = [
      ['head', partOf(equipment.head), 'R_Weapon'],
      ['body', partOf(equipment.body), 'R_Weapon'],
      ['arms', partOf(equipment.arms), 'R_Weapon'],
      ['legs', partOf(equipment.legs), 'R_Weapon'],
      ['right', partOf(equipment.right), 'R_Weapon'],
      ['left', partOf(equipment.left), 'L_Weapon'],
      // The bare head (no helmet): face, eyes, hair, eyebrows, beard, eyelashes, accessories (skinned like armour).
      ...FACE_PART_KEYS.map((k): [string, string | null, string] => [
        `face:${k}`,
        equipment.head ? null : (equipment.faceParts?.[k] ?? null),
        'R_Weapon',
      ]),
    ]
    if (equipError.current) {
      equipError.current = false
      setError(null)
    }
    ;(async () => {
      // Another character wears its own model (its body), nothing else.
      if (chr !== 'c0000') return
      // Wait for the skeleton.
      for (let i = 0; i < 100 && live && !state.current?.skeleton; i++) await new Promise((r) => setTimeout(r, 50))
      const s = state.current
      if (!live || !s?.skeleton) return
      for (const [slot, part, attach] of want) {
        const cur = s.parts.get(slot)
        // A weapon's second model (its scabbard, or the other of a pair), hung where the game puts it.
        const second = slot === 'right' || slot === 'left' ? `${slot}:1` : null
        const wantSecond = !!part && /^wp_/i.test(part) && equipment.sheaths !== false
        if (cur && cur.view.name === part) {
          const had = second ? s.parts.get(second) : undefined
          if (second && had && !wantSecond) {
            removePart(had)
            s.parts.delete(second)
          } else if (second && !had && wantSecond && (cur.view.models ?? 1) > 1) {
            await loadSecond(s, second, part!, attach)
          }
          continue
        }
        if (cur) removePart(cur)
        s.parts.delete(slot)
        if (second && s.parts.has(second)) {
          removePart(s.parts.get(second)!)
          s.parts.delete(second)
        }
        if (!part) continue
        try {
          const view = await call('char:part', { part, attach })
          if (!live || !state.current) return
          s.parts.set(slot, makePart(s, slot, view, /^wp_/i.test(part)))
          if (second && wantSecond && (view.models ?? 1) > 1) await loadSecond(s, second, part, attach)
          // Effects placed on equipment (a buff's coating) follow the new model.
          s.runsDirty = true
        } catch (e) {
          if (!live) return
          equipError.current = true
          setError(errorMessage(e))
        }
      }
    })()
    return () => {
      live = false
    }
  }, [equipKey])

  // Animation clip (or a combo's clips).
  const retargetKey = retarget ? JSON.stringify(retarget) : ''
  const comboKey = combo?.length ? JSON.stringify(combo) : ''
  useEffect(() => {
    let live = true
    const s = state.current
    if (s) {
      s.segments = null
      s.reach = null
    }
    if (comboKey && combo) {
      // A combo (F8): every animation's clip, played one after another.
      onStatus?.({ clip: null, error: null, loading: true })
      Promise.all(combo.map((c) => call('char:clip', { animation: c.animation, chr })))
        .then((views) => {
          if (!live || !state.current) return
          const st = state.current
          let t = 0
          const segs: Segment[] = views.map((view, i) => {
            const clip = decodeClip(view)
            const length = clipLength(view)
            const to = Math.max(0.05, Math.min(length, combo[i].to ?? length))
            const seg: Segment = { clip, t0: t, from: 0, to, frozen: null }
            t += to
            return seg
          })
          st.clip = segs[0].clip
          st.segments = segs
          onCombo?.(segs.map((x) => x.t0))
          resetPose(st)
          clock.load(t, views[0].frameDuration)
          buildTrail(st, helpersRef.current)
          st.runsDirty = true
          clock.emit()
          onStatus?.({ clip: views[0], error: null, loading: false })
        })
        .catch((e) => {
          if (!live) return
          if (state.current) state.current.clip = null
          clock.unload()
          onStatus?.({ clip: null, error: errorMessage(e), loading: false })
        })
      return () => {
        live = false
      }
    }
    if (!animation) {
      if (s) s.clip = null
      clock.unload()
      onStatus?.({ clip: null, error: null, loading: false })
      return
    }
    onStatus?.({ clip: null, error: null, loading: true })
    call('char:clip', { animation, chr, retarget: retarget ?? undefined })
      .then((view) => {
        if (!live || !state.current) return
        const st = state.current
        st.clip = decodeClip(view)
        resetPose(st)
        clock.load(clipLength(view), view.frameDuration)
        buildTrail(st, helpersRef.current)
        st.runsDirty = true
        clock.emit()
        onStatus?.({ clip: view, error: null, loading: false })
      })
      .catch((e) => {
        if (!live) return
        if (state.current) state.current.clip = null
        clock.unload()
        onStatus?.({ clip: null, error: errorMessage(e), loading: false })
      })
    return () => {
      live = false
    }
  }, [animation, retargetKey, comboKey])

  return (
    <div className="char-view" ref={host}>
      <canvas ref={textCanvas} className="char-text" />
      <div className="sim-list" ref={listRef} />
      {helpers.all && helpers.legend && (helpers.dummyAxes || helpers.hkxBones || helpers.rootTrail) && (
        <Legend helpers={helpers} />
      )}
      {error && <div className="char-error">{error}</div>}
    </div>
  )
}
