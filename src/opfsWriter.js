let workerClient = null

export async function createOpfsWritable(fileHandle) {
  if (typeof fileHandle?.createWritable === 'function') return fileHandle.createWritable()
  if (typeof globalThis.Worker !== 'function') {
    throw new Error('This browser cannot write the collection to on-device storage.')
  }

  const client = getWorkerClient()
  const writerId = crypto.randomUUID()
  await client.request('open', { writerId, fileHandle })
  let closed = false

  return {
    async write(value) {
      if (closed) throw new Error('Cannot write to a closed on-device file.')
      const buffer = await toTransferableBuffer(value)
      await client.request('write', { writerId, buffer }, [buffer])
    },
    async close() {
      if (closed) return
      closed = true
      await client.request('close', { writerId })
    },
    async abort() {
      if (closed) return
      closed = true
      await client.request('abort', { writerId })
    },
  }
}

export async function verifyOpfsWritable(directory) {
  const name = `.write-test-${crypto.randomUUID()}`
  const handle = await directory.getFileHandle(name, { create: true })
  let writable = null
  try {
    writable = await createOpfsWritable(handle)
    await writable.write(new Uint8Array([1]))
    await writable.close()
    writable = null
  } finally {
    await writable?.abort?.().catch(() => {})
    await directory.removeEntry(name).catch(() => {})
  }
}

async function toTransferableBuffer(value) {
  if (value instanceof Blob) return value.arrayBuffer()
  if (value instanceof ArrayBuffer) return value.slice(0)
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
  }
  if (typeof value === 'string') return new TextEncoder().encode(value).buffer
  throw new TypeError('Unsupported on-device file data.')
}

function getWorkerClient() {
  if (workerClient) return workerClient
  const worker = new Worker(new URL('./opfsWriter.worker.js', import.meta.url), { type: 'module' })
  const pending = new Map()
  let requestNumber = 0

  worker.addEventListener('message', (event) => {
    const request = pending.get(event.data?.requestId)
    if (!request) return
    pending.delete(event.data.requestId)
    if (event.data.ok) request.resolve()
    else request.reject(new Error(event.data.error || 'Could not write to on-device storage.'))
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'The on-device storage worker failed.')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })

  workerClient = {
    request(operation, payload, transfer = []) {
      requestNumber += 1
      const requestId = requestNumber
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject })
        worker.postMessage({ operation, requestId, ...payload }, transfer)
      })
    },
  }
  return workerClient
}
