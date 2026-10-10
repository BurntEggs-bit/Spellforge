/** Effect node transforms: rotations about Z, then X, then Y, and turning or moving a whole effect. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BasicNode, FXR, StaticNodeTransform } from '@cccode/fxr'
import {
  IDENTITY,
  apply3,
  eulerToMatrix,
  matrixToEuler,
  mul3,
  shiftEffect,
  transformEffect,
} from '../src/core/effects/nodeTransforms.ts'

const close = (a: number[], b: number[], eps = 1e-9) =>
  assert.ok(
    a.every((v, i) => Math.abs(v - b[i]) < eps),
    `${a.map((v) => v.toFixed(6))} vs ${b.map((v) => v.toFixed(6))}`,
  )

test('rotations happen about Z, then X, then Y', () => {
  // A quarter about Z takes +X to +Y; then a quarter about X takes +Y to +Z.
  close(apply3(eulerToMatrix([90, 0, 90]), [1, 0, 0]), [0, 0, 1])
  // The other way round (X first) would leave +X on the Z axis's side, not there.
  close(apply3(eulerToMatrix([0, 90, 0]), [0, 0, 1]), [1, 0, 0])
})

test('degrees round trip through a matrix', () => {
  let seed = 3
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let n = 0; n < 300; n++) {
    const e = [random() * 170 - 85, random() * 340 - 170, random() * 340 - 170]
    close(eulerToMatrix(matrixToEuler(eulerToMatrix(e))), eulerToMatrix(e))
    close(matrixToEuler(eulerToMatrix(e)), e, 1e-7)
  }
  // A quarter turn about X (where Y and Z turn about the same axis) still comes back.
  close(eulerToMatrix(matrixToEuler(eulerToMatrix([90, 30, 20]))), eulerToMatrix([90, 30, 20]))
})

/** An effect with one node, its transform as given. */
function effect(offset: [number, number, number], rotation: [number, number, number]): FXR {
  const fxr = new FXR(1)
  fxr.root.nodes = [new BasicNode([new StaticNodeTransform({ offset, rotation })], [])]
  return fxr
}
const transformOf = (fxr: FXR) => (fxr.root.nodes[0] as BasicNode).configs[0].nodeTransform as StaticNodeTransform

test('turning a whole effect turns its nodes and their offsets', () => {
  const fxr = effect([0, 0, 1], [0, 0, 0])
  const half = eulerToMatrix([0, 180, 0])
  transformEffect(fxr, half, [0.5, 0, 0])
  const tr = transformOf(fxr)
  // The node was 1 m ahead; turned half a turn about Y it's 1 m behind, then moved 0.5 m on X.
  close(tr.offset, [0.5, 0, -1], 1e-6)
  close(eulerToMatrix(tr.rotation), half, 1e-6)
})

test('moving a whole effect leaves its rotations as written', () => {
  const fxr = effect([0, 0, 0], [-180, 0, 180])
  shiftEffect(fxr, [0, 0, -0.2])
  const tr = transformOf(fxr)
  assert.deepEqual([...tr.rotation], [-180, 0, 180])
  close(tr.offset, [0, 0, -0.2])
  // And composing with no turn is the identity.
  close(mul3(IDENTITY, eulerToMatrix([10, 20, 30])), eulerToMatrix([10, 20, 30]))
})
