import test from 'node:test'
import assert from 'node:assert/strict'
import { restorePsdOneOfOneFolder, selectPsdOneOfOneFolder } from './psdOneOfOnes.js'

const source = {
  type: 'psd', width: 500, height: 600,
  categories: [
    { name: 'Body', traits: [{ id: 'body', name: 'Body' }] },
    { name: 'Specials', traits: [{ id: 'special', name: 'Special', layers: [{ left: 20 }] }] },
  ],
  oneOfOnes: [{ id: 'uploaded', name: 'Uploaded' }],
  incompatibilities: [{ first: 'body', second: 'special' }],
  categoryRequirements: [{ category: 'Body', requiredTrait: 'special' }],
}

test('PSD artworks are isolated from combinations and retain canvas dimensions and layers', () => {
  const selected = selectPsdOneOfOneFolder(source, 1)
  assert.deepEqual(selected.categories.map((category) => category.name), ['Body'])
  assert.equal(selected.oneOfOnes.length, 2)
  assert.equal(selected.oneOfOnes[1].trait, source.categories[1].traits[0])
  assert.equal(selected.oneOfOnes[1].width, 500)
  assert.equal(selected.oneOfOnes[1].height, 600)
  assert.deepEqual(selected.incompatibilities, [])
  assert.deepEqual(selected.categoryRequirements, [])
  assert.equal(source.categories.length, 2)
})

test('clearing or switching the selection restores render order and preserves uploaded artworks', () => {
  const selected = selectPsdOneOfOneFolder(source, 1)
  const restored = restorePsdOneOfOneFolder(selected)
  assert.deepEqual(restored.categories, source.categories)
  assert.deepEqual(restored.oneOfOnes, source.oneOfOnes)
  const switched = selectPsdOneOfOneFolder(selected, 0)
  assert.deepEqual(switched.categories.map((category) => category.name), ['Specials'])
  assert.deepEqual(switched.oneOfOnes.map((artwork) => artwork.id), ['uploaded', 'psd-one-of-one::body'])
  assert.deepEqual(selectPsdOneOfOneFolder(switched, null).categories, source.categories)
})
