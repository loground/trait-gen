import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { createStoredZip } from './storedZip.js'

test('creates a readable store-only ZIP from blobs and strings', async () => {
  const progress = []
  const archive = await createStoredZip([
    { name: 'images/1.webp', data: new Blob([new Uint8Array([1, 2, 3, 4])]) },
    { name: 'metadata-file.csv', data: 'id,name\n1,First' },
    { name: 'nested/ü.txt', data: 'unicode path' },
  ], { onProgress: ({ processedBytes }) => progress.push(processedBytes) })

  const zip = await JSZip.loadAsync(await archive.arrayBuffer())
  assert.deepEqual([...await zip.file('images/1.webp').async('uint8array')], [1, 2, 3, 4])
  assert.equal(await zip.file('metadata-file.csv').async('string'), 'id,name\n1,First')
  assert.equal(await zip.file('nested/ü.txt').async('string'), 'unicode path')
  assert.ok(progress.length >= 3)
  assert.equal(progress.at(-1), archive.size - 30 * 3 - 46 * 3 - 22 - encoderLength([
    'images/1.webp', 'metadata-file.csv', 'nested/ü.txt',
  ]) * 2)
})

function encoderLength(names) {
  const encoder = new TextEncoder()
  return names.reduce((sum, name) => sum + encoder.encode(name).length, 0)
}

test('reports completion for an empty-file archive', async () => {
  let lastProgress
  await createStoredZip([{ name: 'empty.txt', data: '' }], { onProgress: (value) => { lastProgress = value } })
  assert.equal(lastProgress.processedBytes, 0)
  assert.equal(lastProgress.totalBytes, 0)
  assert.equal(lastProgress.fileIndex, 1)
})
