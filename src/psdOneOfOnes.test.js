import test from 'node:test'
import assert from 'node:assert/strict'
import { restorePsdOneOfOneFolder, selectPsdOneOfOneFolder, selectPsdOneOfOneFolders, getPsdOneOfOneFolderIndices } from './psdOneOfOnes.js'

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


test('selects multiple folders, excludes their rules, and restores their original order', () => {
  const expanded = { ...source, categories: [...source.categories, { name: 'XOX x PEPE', traits: [{ id: 'pepe', name: 'Pepe' }] }],
    categoryConflicts: [{ first: 'Body', second: 'XOX x PEPE' }],
    traitCategoryConflicts: [{ trait: 'body', category: 'Specials' }],
  }
  const selected = selectPsdOneOfOneFolders(expanded, [2, 1, 2])
  assert.deepEqual(selected.categories.map((c) => c.name), ['Body'])
  assert.deepEqual(getPsdOneOfOneFolderIndices(selected), [1, 2])
  assert.deepEqual(selected.oneOfOnes.map((a) => a.id), ['uploaded', 'psd-one-of-one::special', 'psd-one-of-one::pepe'])
  assert.deepEqual(selected.categoryConflicts, [])
  assert.deepEqual(selected.traitCategoryConflicts, [])
  assert.deepEqual(restorePsdOneOfOneFolder(selected).categories, expanded.categories)
  assert.deepEqual(selectPsdOneOfOneFolders(selected, []).oneOfOnes, source.oneOfOnes)
})

test('toggling a folder preserves renamed and removed artwork in remaining folders', () => {
  const selected = selectPsdOneOfOneFolders(source, [1])
  selected.oneOfOnes[1] = { ...selected.oneOfOnes[1], name: 'Renamed' }
  const both = selectPsdOneOfOneFolders(selected, [0, 1])
  assert.equal(both.oneOfOnes.find((a) => a.trait?.id === 'special').name, 'Renamed')
  both.oneOfOnes = both.oneOfOnes.filter((a) => a.trait?.id !== 'special')
  const remaining = selectPsdOneOfOneFolders(both, [1])
  assert.deepEqual(remaining.oneOfOnes, source.oneOfOnes)
  assert.deepEqual(remaining.categories, [source.categories[0]])
})

test('legacy single-folder state still restores and can become a multi-folder selection', () => {
  const legacy = { ...source, categories: [source.categories[0]], psdOneOfOneFolder: { index: 1, category: source.categories[1] } }
  assert.deepEqual(getPsdOneOfOneFolderIndices(legacy), [1])
  assert.deepEqual(restorePsdOneOfOneFolder(legacy).categories, source.categories)
  assert.deepEqual(getPsdOneOfOneFolderIndices(selectPsdOneOfOneFolders(legacy, [0, 1])), [0, 1])
})
