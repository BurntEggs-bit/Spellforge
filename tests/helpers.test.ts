/** Small shared helpers: bounded caches, error text, file names, placeholder names. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BoundedMap } from '../src/shared/collections.ts'
import { errorMessage } from '../src/shared/errors.ts'
import { fileNameOf } from '../src/core/formats/paths.ts'
import { entryFileName } from '../src/core/formats/bnd4.ts'
import { isPlaceholderName } from '../src/core/project/text.ts'

test('a bounded map drops its oldest entry', () => {
  const m = new BoundedMap<string, number>(2)
  m.set('a', 1).set('b', 2).set('c', 3)
  assert.deepEqual([...m.keys()], ['b', 'c'])
  // Setting a key it has doesn't drop anything.
  m.set('b', 20)
  assert.deepEqual(
    [...m.entries()],
    [
      ['b', 20],
      ['c', 3],
    ],
  )
})

test('error text', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom')
  assert.equal(errorMessage('plain'), 'plain')
  assert.equal(errorMessage({ message: 'from IPC' }), 'from IPC')
  assert.equal(errorMessage(42), '42')
})

test('file names in game paths', () => {
  assert.equal(fileNameOf('N:\\GR\\data\\INTERROOT_win64\\chr\\c0000.anibnd'), 'c0000.anibnd')
  assert.equal(fileNameOf('sfx/model/s88072.flver'), 's88072.flver')
  assert.equal(fileNameOf('plain.txt'), 'plain.txt')
  assert.equal(entryFileName({ name: 'N:\\GR\\data\\A00.TAE' }), 'a00.tae')
})

test('placeholder names', () => {
  for (const name of ['', '   ', '%null%', '[ERROR]', '[Weapon] Flaming Strike', null, undefined])
    assert.ok(isPlaceholderName(name), String(name))
  for (const name of ['Uchigatana', 'Glintstone Pebble']) assert.ok(!isPlaceholderName(name), name)
})
