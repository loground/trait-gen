import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { extractProcreatePreview, isProcreateFile } from './procreate.js'

test('recognizes Procreate files by extension and known MIME types', () => {
  assert.equal(isProcreateFile({ name: 'Traits.PROCREATE', type: '' }), true)
  assert.equal(isProcreateFile({ name: 'Traits', type: 'application/x-procreate' }), true)
  assert.equal(isProcreateFile({ name: 'Traits.psd', type: 'image/vnd.adobe.photoshop' }), false)
})

test('extracts the preferred Quick Look preview from a Procreate archive', async () => {
  const zip = new JSZip()
  zip.file('Document.archive', new Uint8Array([0x62, 0x70, 0x6c, 0x69, 0x73, 0x74]))
  zip.file('QuickLook/Thumbnail.png', new Uint8Array([1]))
  zip.file('QuickLook/Preview.png', new Uint8Array([2, 3]))
  const archive = await zip.generateAsync({ type: 'blob' })
  archive.name = 'traits.procreate'

  const preview = await extractProcreatePreview(archive)
  assert.equal(preview.type, 'image/png')
  assert.deepEqual([...new Uint8Array(await preview.arrayBuffer())], [2, 3])
})

test('rejects ZIP files without Procreate document metadata', async () => {
  const zip = new JSZip()
  zip.file('QuickLook/Thumbnail.png', new Uint8Array([1]))
  const archive = await zip.generateAsync({ type: 'blob' })
  archive.name = 'fake.procreate'

  await assert.rejects(extractProcreatePreview(archive), /missing Procreate document data/)
})
