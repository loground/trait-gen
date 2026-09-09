import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { writeZipToWritable } from './durableZip.js'

test('streams ZIP chunks to a writable in order with backpressure', async () => {
  const events = new Map()
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5])]
  let index = 0
  let paused = false
  const stream = {
    on(event, callback) {
      events.set(event, callback)
      return this
    },
    pause() {
      paused = true
      return this
    },
    resume() {
      paused = false
      queueMicrotask(() => {
        if (paused) return
        if (index < chunks.length) events.get('data')(chunks[index++], { percent: index * 25 })
        else events.get('end')()
      })
      return this
    },
  }
  const zip = {
    generateInternalStream(options) {
      assert.deepEqual(options, { type: 'uint8array', streamFiles: true, compression: 'STORE' })
      return stream
    },
  }
  const writes = []
  const updates = []

  await writeZipToWritable(zip, { async write(chunk) { writes.push([...chunk]) } }, (metadata) => updates.push(metadata.percent))

  assert.deepEqual(writes, [[1, 2], [3], [4, 5]])
  assert.deepEqual(updates, [25, 50, 75])
})

test('rejects when the destination cannot write a chunk', async () => {
  const events = new Map()
  const stream = {
    on(event, callback) { events.set(event, callback); return this },
    pause() { return this },
    resume() { queueMicrotask(() => events.get('data')(new Uint8Array([1]), {})); return this },
  }
  const zip = { generateInternalStream: () => stream }

  await assert.rejects(
    writeZipToWritable(zip, { write: async () => { throw new Error('quota exceeded') } }),
    /quota exceeded/,
  )
})

test('produces a valid archive when streaming a real JSZip instance', async () => {
  const zip = new JSZip()
  zip.file('images/1.webp', new Uint8Array([10, 20, 30]))
  zip.file('manifest.json', '{"editions":1}')
  const chunks = []

  await writeZipToWritable(zip, { write: async (chunk) => chunks.push(chunk.slice()) })

  const archive = await JSZip.loadAsync(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))))
  assert.deepEqual([...await archive.file('images/1.webp').async('uint8array')], [10, 20, 30])
  assert.equal(await archive.file('manifest.json').async('string'), '{"editions":1}')
})
