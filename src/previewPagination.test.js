import assert from 'node:assert/strict'
import test from 'node:test'
import { selectGifFrameIndexes, selectPreviewPage } from './previewPagination.js'

test('advances through distinct preview batches and includes the final partial batch', () => {
  const combinations = Array.from({ length: 35 }, (_, index) => index + 1)
  const first = selectPreviewPage(combinations.slice(0, 17), 0)
  const second = selectPreviewPage(combinations.slice(0, 33), 16)
  const third = selectPreviewPage(combinations, 32)
  assert.deepEqual(first, { page: combinations.slice(0, 16), hasMore: true })
  assert.deepEqual(second, { page: combinations.slice(16, 32), hasMore: true })
  assert.deepEqual(third, { page: combinations.slice(32), hasMore: false })
})

test('successive GIF generations select new frames from the current preview batch', () => {
  assert.deepEqual(selectGifFrameIndexes(16, 7, 0), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(selectGifFrameIndexes(16, 7, 1), [7, 8, 9, 10, 11, 12, 13])
  assert.deepEqual(selectGifFrameIndexes(4, 5, 0), [])
})
