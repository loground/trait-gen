import test from 'node:test'
import assert from 'node:assert/strict'
import { createPositionPairFilter, getPositionPairs } from './positionPairs.js'

const source = {
  categories: [
    { name: 'Hair', traits: [{ id: 'hair-a' }, { id: 'hair-b' }] },
    { name: 'Hats', traits: [{ id: 'hat-a' }, { id: 'hat-b' }] },
  ],
  incompatibilities: [{ first: 'hat-a', second: 'hair-a' }],
}
const firstOptions = [{ key: 'hair-a' }, { key: 'hair-b' }]
const secondOptions = [{ key: 'hat-a' }, { key: 'hat-b' }]

test('imported blocks are symmetric and skipped in position navigation and counts', () => {
  const allowed = createPositionPairFilter(source)
  assert.equal(allowed('hair-a', 'hat-a'), false)
  assert.equal(allowed('hat-a', 'hair-a'), false)
  const pairs = getPositionPairs(firstOptions, secondOptions, allowed)
  assert.deepEqual(pairs.map(({ firstOption, secondOption }) => [firstOption.key, secondOption.key]), [
    ['hair-a', 'hat-b'], ['hair-b', 'hat-a'], ['hair-b', 'hat-b'],
  ])
  const saved = [{ first: 'hair-a', second: 'hat-a' }, { first: 'hair-b', second: 'hat-b' }]
  assert.deepEqual(saved.filter(({ first, second }) => allowed(first, second)), [saved[1]])
})

test('folder and trait-folder blocks exclude pairs in either direction', () => {
  const allowed = createPositionPairFilter({ ...source, traitCategoryConflicts: [{ trait: 'hair-b', category: 'Hats' }] })
  assert.equal(allowed('hair-b', 'hat-b'), false)
  assert.equal(allowed('hat-b', 'hair-b'), false)
  assert.equal(getPositionPairs(firstOptions, secondOptions, allowed).length, 1)
  const noneAllowed = createPositionPairFilter({ ...source, categoryConflicts: [{ first: 'Hats', second: 'Hair' }] })
  assert.deepEqual(getPositionPairs(firstOptions, secondOptions, noneAllowed), [])
})

test('unblocking restores availability; missing and same-folder traits are unavailable', () => {
  const allowed = createPositionPairFilter({ ...source, incompatibilities: [] })
  assert.equal(getPositionPairs(firstOptions, secondOptions, allowed).length, 4)
  assert.equal(allowed('hair-a', 'hair-b'), false)
  assert.equal(allowed('', 'hat-a'), false)
  assert.equal(allowed('missing', 'hat-a'), false)
})
