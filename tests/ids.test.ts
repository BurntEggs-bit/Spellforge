/** Id arithmetic the game's data relies on: dummy polys, BehaviorParam rows, animation names. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dummyLocation,
  dummySourceOf,
  gripInDummyFrame,
  parseDummyId,
  pointInDummyFrame,
  weaponDummyId,
} from '../src/core/animation/dummies.ts'
import {
  behaviorCategoryOf,
  behaviorRowId,
  behaviorVariationOf,
  judgeCategory,
  judgeOfBehaviorRow,
} from '../src/core/params/behaviorIds.ts'
import {
  animationIdText,
  animationName,
  animationNameOfFullId,
  categoryLabel,
  fullAnimationId,
  parseAnimationName,
} from '../src/shared/animIds.ts'

test('dummy ids: hand, model and point', () => {
  assert.deepEqual(parseDummyId(220), { on: 'body', model: 0, point: 220 })
  assert.deepEqual(parseDummyId(10120), { on: 'right', model: 0, point: 120 })
  assert.deepEqual(parseDummyId(11300), { on: 'right', model: 1, point: 300 })
  assert.deepEqual(parseDummyId(20120), { on: 'left', model: 0, point: 120 })
  assert.deepEqual(parseDummyId(21300), { on: 'left', model: 1, point: 300 })
  assert.equal(weaponDummyId('left', 120), 20120)
  assert.equal(weaponDummyId('right', 300, 1), 11300)
  assert.equal(dummySourceOf(parseDummyId(21300)), 'left:1')
  assert.deepEqual(dummyLocation(100, 'right'), { dummy: 100, source: 'right' })
  assert.deepEqual(dummyLocation(20100, 'body'), { dummy: 100, source: 'left' })
})

/** Rounded to a nanometre, with −0 as 0, so vectors compare exactly. */
const rounded = (v: number[]): number[] => v.map((x) => Math.round(x * 1e9) / 1e9 + 0)

test('a point in a dummy frame: +Z forward, +Y up', () => {
  const dummy = { position: [1, 2, 3], forward: [1, 0, 0], up: [0, 1, 0] }
  assert.deepEqual(rounded(pointInDummyFrame(dummy, [1, 2, 3])), [0, 0, 0])
  // One metre along the dummy's forward is +1 on its Z.
  assert.deepEqual(rounded(pointInDummyFrame(dummy, [2, 2, 3])), [0, 0, 1])
  // The grip is the weapon model's origin.
  assert.deepEqual(rounded(gripInDummyFrame({ position: [0, 0, 1], forward: [0, 0, 1], up: [0, 1, 0] })), [0, 0, -1])
})

test('BehaviorParam rows: category × 100,000,000 + variation × 1000 + judge', () => {
  const id = behaviorRowId(3, 12345, 570)
  assert.equal(id, 312_345_570)
  assert.equal(behaviorCategoryOf(id), 3)
  assert.equal(behaviorVariationOf(id), 12345)
  assert.equal(judgeOfBehaviorRow(id), 3570)
  assert.equal(judgeOfBehaviorRow(behaviorRowId(1, 100, 40)), 40)
  assert.equal(judgeCategory(3570, 'BehaviorParam_PC'), 3)
  assert.equal(judgeCategory(40, 'BehaviorParam_PC'), 1)
  assert.equal(judgeCategory(40, 'BehaviorParam'), 2)
})

test('animation names', () => {
  assert.equal(categoryLabel(30), 'a030')
  assert.equal(animationIdText(30000), '030000')
  assert.equal(animationName(30, 30000), 'a030_030000')
  assert.deepEqual(parseAnimationName('a681_030010'), { category: 681, id: 30010 })
  assert.equal(parseAnimationName('a30_30000'), null)
  assert.equal(fullAnimationId(2, 3027), 2_003_027)
  assert.equal(animationNameOfFullId(2_003_027), 'a002_003027')
})
