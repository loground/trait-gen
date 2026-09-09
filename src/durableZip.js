const EXPORT_DIRECTORY = 'trait-forge-exports-v1'
const LATEST_EXPORT_FILE = 'latest.json'

export function supportsDurableZipStorage() {
  return typeof globalThis.navigator?.storage?.getDirectory === 'function'
}

export async function restoreLatestDurableZip() {
  if (!supportsDurableZipStorage()) return null

  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(EXPORT_DIRECTORY)
    const metadataHandle = await directory.getFileHandle(LATEST_EXPORT_FILE)
    const metadata = JSON.parse(await (await metadataHandle.getFile()).text())
    if (!metadata?.storageName || !metadata?.downloadName) return null
    const archiveHandle = await directory.getFileHandle(metadata.storageName)
    const file = await archiveHandle.getFile()
    if (!file.size) return null
    return { file, name: metadata.downloadName }
  } catch {
    return null
  }
}

export async function createDurableZipSession(downloadName) {
  if (!supportsDurableZipStorage()) return null

  // A persisted origin is less likely to have a long export evicted while the
  // browser is under storage pressure. Browsers may decline without prompting.
  navigator.storage.persist?.().catch(() => {})

  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(EXPORT_DIRECTORY, { create: true })
  const sessionId = `${Date.now()}-${globalThis.crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`
  const workName = `work-${sessionId}`
  const archiveName = `export-${sessionId}.zip`
  const workDirectory = await directory.getDirectoryHandle(workName, { create: true })
  let stagedFileCount = 0
  let finished = false

  async function stageBlob(blob) {
    const fileName = `${String(stagedFileCount).padStart(6, '0')}.bin`
    stagedFileCount += 1
    const handle = await workDirectory.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    try {
      await writable.write(blob)
      await writable.close()
    } catch (error) {
      await writable.abort?.().catch(() => {})
      throw error
    }
    return handle.getFile()
  }

  async function finish(zip, onUpdate) {
    const archiveHandle = await directory.getFileHandle(archiveName, { create: true })
    const writable = await archiveHandle.createWritable()
    try {
      await writeZipToWritable(zip, writable, onUpdate)
      await writable.close()
    } catch (error) {
      await writable.abort?.().catch(() => {})
      await directory.removeEntry(archiveName).catch(() => {})
      throw error
    }

    const archive = await archiveHandle.getFile()
    if (!archive.size) throw new Error('The ZIP archive was empty.')

    await writeJsonFile(directory, LATEST_EXPORT_FILE, {
      storageName: archiveName,
      downloadName,
      completedAt: new Date().toISOString(),
      size: archive.size,
    })
    finished = true
    await directory.removeEntry(workName, { recursive: true }).catch(() => {})
    await removeOldExports(directory, archiveName)
    return archive
  }

  async function abort() {
    await directory.removeEntry(workName, { recursive: true }).catch(() => {})
    if (!finished) await directory.removeEntry(archiveName).catch(() => {})
  }

  return { stageBlob, finish, abort }
}

export function writeZipToWritable(zip, writable, onUpdate) {
  return new Promise((resolve, reject) => {
    const stream = zip.generateInternalStream({
      type: 'uint8array',
      streamFiles: true,
      // Artwork formats are already compressed, so recompressing wastes CPU
      // and memory without materially shrinking the archive.
      compression: 'STORE',
    })
    let settled = false

    const fail = (error) => {
      if (settled) return
      settled = true
      reject(error)
    }

    stream
      .on('data', (chunk, metadata) => {
        stream.pause()
        Promise.resolve(writable.write(chunk)).then(() => {
          onUpdate?.(metadata)
          if (!settled) stream.resume()
        }, fail)
      })
      .on('error', fail)
      .on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      .resume()
  })
}

async function writeJsonFile(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  try {
    await writable.write(JSON.stringify(value))
    await writable.close()
  } catch (error) {
    await writable.abort?.().catch(() => {})
    throw error
  }
}

async function removeOldExports(directory, currentArchiveName) {
  try {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'directory' && name.startsWith('work-')) {
        await directory.removeEntry(name, { recursive: true }).catch(() => {})
      } else if (handle.kind === 'file' && name.startsWith('export-') && name !== currentArchiveName) {
        await directory.removeEntry(name).catch(() => {})
      }
    }
  } catch {
    // Cleanup is best effort; it must never invalidate a completed export.
  }
}
