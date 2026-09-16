import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTraitUsageSummary } from './traitUsage.js'

test('lists every trait, including traits used zero times', () => {
  const red = { id: 'color::red', name: 'Red' }
  const blue = { id: 'color::blue', name: 'Blue' }
  const green = { id: 'color::green', name: 'Green' }
  const summary = buildTraitUsageSummary(
    [{ name: 'Color', traits: [red, blue, green] }],
    [[red], [red]],
    (trait) => trait.id,
    (trait) => trait.name,
  )

  assert.deepEqual(summary[0].traits.map(({ name, count }) => ({ name, count })), [
    { name: 'Red', count: 2 },
    { name: 'Blue', count: 0 },
    { name: 'Green', count: 0 },
  ])
})
