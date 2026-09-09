import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSmartRarityProfile, isFaceCategory } from './smartRarities.js'

test('recognizes face folders with descriptive suffixes', () => {
  assert.equal(isFaceCategory('Face'), true)
  assert.equal(isFaceCategory('Faces Big'), true)
  assert.equal(isFaceCategory('Facial Accessories'), false)
  assert.equal(isFaceCategory('Background'), false)
})

test('distributes face rarity evenly with no blank face', () => {
  const traits = Array.from({ length: 7 }, (_, index) => ({ name: `Face ${index + 1}`, weight: 1 }))
  const profile = buildSmartRarityProfile([
    { name: 'Faces Big', traits, noneWeight: 40 },
  ], { targetCount: 1000, seed: 'test' })
  const category = profile.categories[0]
  const weights = category.traits.map((trait) => trait.weight)

  assert.equal(category.noneWeight, 0)
  assert.equal(category.selectionMode, 'ordered')
  assert.equal(weights.reduce((total, weight) => total + weight, 0), 100)
  assert.ok(Math.max(...weights) - Math.min(...weights) <= 0.100001)
})

test('keeps non-face traits on a varied rarity curve', () => {
  const traits = Array.from({ length: 12 }, (_, index) => ({ name: `Hat ${index + 1}`, weight: 1 }))
  const profile = buildSmartRarityProfile([
    { name: 'Hats', traits, noneWeight: 0 },
  ], { targetCount: 1000, seed: 'test' })
  const weights = profile.categories[0].traits.map((trait) => trait.weight)

  assert.ok(new Set(weights).size > 1)
})
