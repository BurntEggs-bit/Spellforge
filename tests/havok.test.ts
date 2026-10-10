/** The animation decoder's building blocks: B-spline evaluation and quantised rotations. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { basisFunctions, evaluate, findSpan } from '../src/core/formats/havok/bspline.ts'
import { ROTATION, decodeRotation, dequantize, encodeThreeComp40 } from '../src/core/formats/havok/quantization.ts'

test('knot spans, including before the start and at the end', () => {
  // Three control points, degree 1: knots 0 0 1 2 2.
  const knots = [0, 0, 1, 2, 2]
  assert.equal(findSpan(knots, 1, 3, 0), 1)
  assert.equal(findSpan(knots, 1, 3, 0.5), 1)
  assert.equal(findSpan(knots, 1, 3, 1), 2)
  assert.equal(findSpan(knots, 1, 3, 2), 2)
  assert.equal(findSpan(knots, 1, 3, 5), 2)
})

test('basis functions sum to one', () => {
  const knots = [0, 0, 0, 1, 2, 3, 3, 3]
  for (const u of [0, 0.3, 1, 1.7, 2.9]) {
    const span = findSpan(knots, 2, 5, u)
    const sum = basisFunctions(knots, span, 2, u).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 1e-12, `at ${u}: ${sum}`)
  }
})

test('a degree-1 spline interpolates its control points', () => {
  const spline = { degree: 1, knots: [0, 0, 1, 2, 2], points: Float32Array.from([0, 10, 20]), dims: 1 }
  const out = new Float32Array(1)
  for (const [u, want] of [
    [0, 0],
    [0.5, 5],
    [1, 10],
    [1.25, 12.5],
    [2, 20],
  ]) {
    evaluate(spline, u, out, 0)
    assert.ok(Math.abs(out[0] - want) < 1e-5, `at ${u}: ${out[0]}`)
  }
})

test('THREECOMP40 round trip, within its step', () => {
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let n = 0; n < 500; n++) {
    const q = [random(), random(), random(), random()]
    const l = Math.hypot(...q)
    const unit = q.map((v) => v / l)
    const back = decodeRotation(ROTATION.threeComp40, encodeThreeComp40(unit[0], unit[1], unit[2], unit[3]))
    const dot = Math.abs(unit.reduce((a, v, i) => a + v * back[i], 0))
    assert.ok(dot > 1 - 1e-6, `rotation ${unit.join(',')} came back as ${back.join(',')}`)
  }
})

test('POLAR32 sign bits and the identity', () => {
  // r = 0 (w = 1), no axis, no signs: the identity.
  assert.deepEqual(decodeRotation(ROTATION.polar32, [0, 0, 0, 0]), [0, 0, 0, 1])
  const negW = decodeRotation(ROTATION.polar32, [0, 0, 0, 0x80])
  assert.equal(negW[3], -1)
})

test('positions dequantize across their range', () => {
  assert.equal(dequantize(0, 1, -2, 2), -2)
  assert.equal(dequantize(0xffff, 1, -2, 2), 2)
  assert.equal(dequantize(0xff, 0, 0, 10), 10)
})
