/** The row editor's field order: Smithbox's groups where a param has a layout, else the paramdefs' SortID. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { loadFieldLayouts, orderFields, OTHER_GROUP } from '../src/core/params/fieldLayout.ts'

const ER = path.resolve(import.meta.dirname, '..', 'data', 'er')

test('a layout lists its groups in order, each field once, then the rest under Other by SortID', () => {
  const fields = [
    { name: 'c', sortId: 30 },
    { name: 'a', sortId: 10 },
    { name: 'z', sortId: 5 },
    { name: 'b', sortId: 20 },
    { name: 'y' },
  ]
  const order = orderFields(fields, [
    { name: 'First', fields: ['b', 'a', 'missing'] },
    { name: 'Second', fields: ['a', 'c'] },
  ])
  assert.deepEqual(
    order.map((o) => `${o.group}:${o.field.name}`),
    ['First:b', 'First:a', 'Second:c', `${OTHER_GROUP}:z`, `${OTHER_GROUP}:y`],
  )
})

test('without a layout, fields follow SortID with no headings, ties and unsorted ones keeping their order', () => {
  const order = orderFields([
    { name: 'x' },
    { name: 'b', sortId: 2 },
    { name: 'a', sortId: 1 },
    { name: 'c', sortId: 2 },
  ])
  assert.deepEqual(
    order.map((o) => o.field.name),
    ['a', 'b', 'c', 'x'],
  )
  assert.ok(order.every((o) => o.group === undefined))
})

test('the weapon layout keeps the nine Correction Type fields together', () => {
  const layouts = loadFieldLayouts(ER)
  const weapon = layouts.get('EquipParamWeapon')
  assert.ok(weapon, 'EquipParamWeapon has a layout')
  const group = weapon.find((g) => g.fields.includes('correctType_Physics'))
  assert.ok(group)
  for (const f of ['Magic', 'Fire', 'Thunder', 'Dark', 'Poison', 'Blood', 'Sleep', 'Madness'])
    assert.ok(group.fields.includes(`correctType_${f}`), `correctType_${f} is with correctType_Physics`)
  // AtkParam's layout serves both of its params (one meta file).
  assert.ok(layouts.get('AtkParam')?.some((g) => g.fields.includes('hit0_Radius')))
})
