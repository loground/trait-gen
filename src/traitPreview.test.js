import test from 'node:test'
import assert from 'node:assert/strict'
import { togglePreviewTraitKeys } from './traitPreview.js'

test('adds traits from different folders to the same preview', () => {
  const selected = togglePreviewTraitKeys(['face-a'], 'eyes-a', ['eyes-a', 'eyes-b'])

  assert.deepEqual(selected, ['face-a', 'eyes-a'])
})

test('replaces the selected trait when another trait in the same folder is chosen', () => {
  const selected = togglePreviewTraitKeys(['face-a', 'eyes-a'], 'eyes-b', ['eyes-a', 'eyes-b'])

  assert.deepEqual(selected, ['face-a', 'eyes-b'])
})

test('removes an already selected trait', () => {
  const selected = togglePreviewTraitKeys(['face-a', 'eyes-a'], 'eyes-a', ['eyes-a', 'eyes-b'])

  assert.deepEqual(selected, ['face-a'])
})
