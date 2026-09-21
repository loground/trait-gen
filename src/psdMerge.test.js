import assert from 'node:assert/strict'
import test from 'node:test'
import { mergePsdSources } from './psdMerge.js'

function source(name, categories, baseLayers = []) {
  return { type: 'psd', name, width: 100, height: 100, baseLayers, categories }
}

test('merges matching folders while keeping every trait ID distinct', () => {
  const firstTrait = { id: 'Hats::0:Blue', name: 'Blue' }
  const secondTrait = { id: 'Hats::0:Blue', name: 'Blue' }
  const merged = mergePsdSources([
    source('one.psd', [{ name: 'Hats', traits: [firstTrait] }], ['first base']),
    source('two.psd', [{ name: 'Hats', traits: [secondTrait] }, { name: 'Eyes', traits: [{ id: 'Eyes::0:Open' }] }], ['second base']),
  ])
  assert.deepEqual(merged.categories.map((category) => category.name), ['Hats', 'Eyes'])
  assert.deepEqual(merged.categories[0].traits.map((trait) => trait.id), ['Hats::0:Blue', 'Hats::0:Blue#2'])
  assert.deepEqual(merged.baseLayers, ['first base'])
})

test('uses the first available base and accepts a base-only PSD', () => {
  const merged = mergePsdSources([
    source('base.psd', [], ['base']),
    source('traits.psd', [{ name: 'Hats', traits: [{ id: 'Hats::0:Blue' }] }]),
  ])
  assert.deepEqual(merged.baseLayers, ['base'])
  assert.equal(merged.categories.length, 1)
})

test('rejects mismatched canvas sizes', () => {
  const second = { ...source('two.psd', []), width: 200 }
  assert.throws(() => mergePsdSources([source('one.psd', []), second]), /canvases must match/)
})
