/**
 * The viewer's move and rotate tool for an effect event (G, R): a handle at
 * the effect's place, dragged with three's TransformControls. While it's
 * dragged the effect follows (FxManager.adjust); let go, the change goes to
 * the page, which writes it into the effect. With snapping on, moves and
 * turns go in steps (1 cm, 15°), and an effect let go near another dummy
 * poly moves the event to that dummy instead.
 *
 * The scene is mirrored on X (the game's data is left-handed), so the
 * effect's frame in the scene, W·F, is a reflection. The handle uses W·F·M
 * (M the X mirror), a proper rotation the controls can turn, and a dragged
 * handle H maps back to the effect's frame as W⁻¹·H·M.
 */
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { DummySource } from '../../../shared/api.ts'
import { dummyIdOn } from '../../../shared/dummyIds.ts'
import { dummyWorld } from './dummies.ts'
import type { LoadedPart, ViewerState } from './state.ts'

export type GizmoMode = 'translate' | 'rotate'

/** The effect event the tool works on, and how. */
export interface GizmoTarget {
  /** The event's index in the animation. */
  event: number
  mode: GizmoMode
  snap: boolean
  /** The DummyPolyID the event names now. */
  dummy: number
}

/** What a drag did: the effect turned and moved in its own axes, or moved to another dummy poly. */
export interface GizmoResult {
  event: number
  /** A 3×3 rotation, row-major, in the game's axes. */
  rotation: number[]
  /** Metres, in the effect's own axes. */
  offset: number[]
  /** With snapping on, let go near another dummy poly: the DummyPolyID to move the event to. */
  dummy?: number
}

const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1)
const ONE = new THREE.Vector3(1, 1, 1)
/** How near another dummy poly the effect must be let go, with snapping on, to move there. */
const SNAP_DISTANCE = 0.06
const SNAP_MOVE = 0.01
const SNAP_TURN = THREE.MathUtils.degToRad(15)
/** The parts whose dummy polys events name: the body and the held weapons. */
const DUMMY_PARTS: DummySource[] = ['right', 'left', 'right:1', 'left:1']

/** A rotation as the row-major 3×3 the effect transform takes. */
function rowMajor(q: THREE.Quaternion): number[] {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
}

export class EffectGizmo {
  private readonly s: ViewerState
  /** Called as a drag begins (the viewer pauses, so the effect holds still). */
  private readonly onDragStart: () => void
  private readonly controls: TransformControls
  private readonly handle = new THREE.Object3D()
  private target: GizmoTarget | null = null
  private commit: ((r: GizmoResult) => Promise<void>) | null = null
  /** The effect's frame (in the character's space) when the drag began. */
  private start: THREE.Matrix4 | null = null
  /** A change being written: the handle stays hidden until the effect shows it. */
  private writing = false

  constructor(s: ViewerState, camera: THREE.Camera, dom: HTMLElement, onDragStart: () => void) {
    this.s = s
    this.onDragStart = onDragStart
    this.controls = new TransformControls(camera, dom)
    this.controls.setSpace('local')
    this.controls.setSize(0.8)
    s.scene.add(this.handle)
    s.scene.add(this.controls.getHelper())
    this.controls.attach(this.handle)
    this.show(false)
    this.controls.addEventListener('dragging-changed', (e) => {
      if (e.value) this.begin()
      else void this.end()
    })
    this.controls.addEventListener('objectChange', () => this.drag())
  }

  /** Whether the pointer is on the handle: the viewer doesn't orbit then. */
  busy(): boolean {
    return this.controls.enabled && (this.controls.dragging || this.controls.axis !== null)
  }

  /** The event to work on (null: none), and where a finished drag goes. */
  set(target: GizmoTarget | null, commit: ((r: GizmoResult) => Promise<void>) | null): void {
    if (this.target && (!target || target.event !== this.target.event)) this.s.fx.adjust(this.key(this.target), null)
    this.target = target
    this.commit = commit
    if (!target) return this.show(false)
    this.controls.setMode(target.mode)
    this.controls.setTranslationSnap(target.snap ? SNAP_MOVE : null)
    this.controls.setRotationSnap(target.snap ? SNAP_TURN : null)
  }

  dispose(): void {
    this.controls.detach()
    this.controls.dispose()
    this.s.scene.remove(this.controls.getHelper())
    this.s.scene.remove(this.handle)
  }

  /** Every frame: the handle sits on the effect while it isn't being dragged. */
  update(t: number): void {
    const target = this.target
    if (!target || this.writing) return this.show(false)
    if (this.controls.dragging) return
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    if (!this.s.fx.placement(this.key(target), t, pos, quat)) return this.show(false)
    const frame = new THREE.Matrix4().compose(pos, quat, ONE)
    this.s.world.updateMatrixWorld()
    new THREE.Matrix4()
      .multiplyMatrices(this.s.world.matrixWorld, frame)
      .multiply(MIRROR)
      .decompose(this.handle.position, this.handle.quaternion, this.handle.scale)
    this.handle.scale.copy(ONE)
    this.show(true)
  }

  private key(target: GizmoTarget): string {
    return `f${target.event}`
  }

  private show(on: boolean): void {
    this.controls.enabled = on
    this.controls.getHelper().visible = on
  }

  /** The effect's frame, in the character's space, for a handle at `h`. */
  private frameOf(h: THREE.Matrix4): THREE.Matrix4 {
    return this.s.world.matrixWorld.clone().invert().multiply(h).multiply(MIRROR)
  }

  private begin(): void {
    this.onDragStart()
    this.handle.updateMatrixWorld()
    this.start = this.frameOf(this.handle.matrixWorld)
  }

  /** The drag so far, in the effect's own axes: where it moved, and how it turned. */
  private adjustment(): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    if (!this.start) return null
    this.handle.updateMatrixWorld()
    const change = this.start.clone().invert().multiply(this.frameOf(this.handle.matrixWorld))
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    change.decompose(pos, quat, new THREE.Vector3())
    return { pos, quat }
  }

  private drag(): void {
    const a = this.adjustment()
    if (a && this.target) this.s.fx.adjust(this.key(this.target), a)
  }

  private async end(): Promise<void> {
    const a = this.adjustment()
    const target = this.target
    this.start = null
    if (!a || !target) return
    const moved = a.pos.length() > 1e-5 || 1 - Math.abs(a.quat.w) > 1e-8
    if (!moved || !this.commit) return this.s.fx.adjust(this.key(target), null)
    const result: GizmoResult = {
      event: target.event,
      rotation: rowMajor(a.quat),
      offset: [a.pos.x, a.pos.y, a.pos.z],
    }
    if (target.snap && target.mode === 'translate') {
      const dummy = this.nearestDummy(target.dummy)
      if (dummy !== null) result.dummy = dummy
    }
    this.writing = true
    try {
      await this.commit(result)
    } finally {
      this.writing = false
      this.s.fx.adjust(this.key(target), null)
    }
  }

  /** The DummyPolyID of the dummy poly nearest the handle, if one other than `current` is within reach. */
  private nearestDummy(current: number): number | null {
    const at = new THREE.Vector3().setFromMatrixPosition(this.handle.matrixWorld)
    const p = new THREE.Vector3()
    let best: { id: number; d: number } | null = null
    const parts: [DummySource, LoadedPart | null][] = [
      ['body', this.s.body],
      ...DUMMY_PARTS.map((k): [DummySource, LoadedPart | null] => [k, this.s.parts.get(k) ?? null]),
    ]
    for (const [source, part] of parts) {
      if (!part) continue
      for (let i = 0; i < part.view.dummies.length; i++) {
        const d = p.setFromMatrixPosition(dummyWorld(this.s, part, i)).distanceTo(at)
        const id = dummyIdOn(source, part.view.dummies[i].id)
        if (d <= SNAP_DISTANCE && id !== current && (!best || d < best.d)) best = { id, d }
      }
    }
    return best?.id ?? null
  }
}
