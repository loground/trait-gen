const writers = new Map()

self.addEventListener('message', async (event) => {
  const { operation, requestId, writerId, fileHandle, buffer } = event.data || {}
  try {
    if (operation === 'open') {
      if (typeof fileHandle?.createSyncAccessHandle !== 'function') {
        throw new Error('This Safari version does not support writable on-device files.')
      }
      const accessHandle = await fileHandle.createSyncAccessHandle()
      accessHandle.truncate(0)
      writers.set(writerId, { accessHandle, position: 0 })
    } else if (operation === 'write') {
      const writer = requireWriter(writerId)
      const bytes = new Uint8Array(buffer)
      const written = writer.accessHandle.write(bytes, { at: writer.position })
      if (written !== bytes.byteLength) throw new Error('The browser did not write the complete file chunk.')
      writer.position += written
    } else if (operation === 'close') {
      const writer = requireWriter(writerId)
      writer.accessHandle.flush()
      writer.accessHandle.close()
      writers.delete(writerId)
    } else if (operation === 'abort') {
      const writer = writers.get(writerId)
      if (writer) {
        writer.accessHandle.truncate(0)
        writer.accessHandle.flush()
        writer.accessHandle.close()
        writers.delete(writerId)
      }
    } else {
      throw new Error('Unknown on-device storage operation.')
    }
    self.postMessage({ requestId, ok: true })
  } catch (error) {
    const writer = writers.get(writerId)
    try {
      writer?.accessHandle?.close()
    } catch {
      // Preserve the original storage error.
    }
    writers.delete(writerId)
    self.postMessage({ requestId, ok: false, error: error?.message || 'Could not write to on-device storage.' })
  }
})

function requireWriter(writerId) {
  const writer = writers.get(writerId)
  if (!writer) throw new Error('The on-device file is no longer open.')
  return writer
}
