import assert from 'node:assert/strict'
import test from 'node:test'

import { countAdjacentTraitRepeats, spreadSimilarCombinations } from './combinationOrder.js'

function combo(background, hat) {
  return [
    { id: `Background::${background}`, category: 'Background', name: background },
    { id: `Hat::${hat}`, category: 'Hat', name: hat },
  ]
}

test('spreads repeated traits away from consecutive editions', () => {
  const combinations = [
    combo('Blue', 'Cap'),
    combo('Blue', 'Crown'),
    combo('Blue', 'Beanie'),
    combo('Red', 'Cap'),
    combo('Red', 'Crown'),
    combo('Red', 'Beanie'),
  ]

  const ordered = spreadSimilarCombinations(combinations, 'test-seed')

  assert.ok(countAdjacentTraitRepeats(ordered) < countAdjacentTraitRepeats(combinations))
  assert.deepEqual(
    ordered.map((item) => item.map((trait) => trait.id).join('|')).sort(),
    combinations.map((item) => item.map((trait) => trait.id).join('|')).sort(),
  )
})

test('uses the seed deterministically', () => {
  const combinations = [combo('Blue', 'Cap'), combo('Blue', 'Crown'), combo('Red', 'Cap')]
  assert.deepEqual(
    spreadSimilarCombinations(combinations, 'same-seed'),
    spreadSimilarCombinations(combinations, 'same-seed'),
  )
})
