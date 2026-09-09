import { createOpfsWritable } from './opfsWriter.js'

const SESSION_DIRECTORY = 'trait-forge-session-v1'
const SNAPSHOT_FILE = 'session.json'
const knownAssetNames = new WeakMap()

export function supportsSessionStorage() {
  return typeof globalThis.navigator?.storage?.getDirectory === 'function'
}

export async function saveSessionSnapshot(snapshot, assetFiles) {
  if (!supportsSessionStorage()) return false
  navigator.storage.persist?.().catch(() => {})
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(SESSION_DIRECTORY, { create: true })

  for (const [storageName, file] of assetFiles) {
    const handle = await directory.getFileHandle(storageName, { create: true })
    const existing = await handle.getFile()
    if (existing.size === file.size && existing.lastModified >= file.lastModified) continue
    const writable = await createOpfsWritable(handle)
    try {
      await writable.write(file)
      await writable.close()
    } catch (error) {
      await writable.abort?.().catch(() => {})
      throw error
    }
  }

  const snapshotHandle = await directory.getFileHandle(SNAPSHOT_FILE, { create: true })
  const writable = await createOpfsWritable(snapshotHandle)
  try {
    await writable.write(JSON.stringify(snapshot))
    await writable.close()
  } catch (error) {
    await writable.abort?.().catch(() => {})
    throw error
  }
  await removeUnusedAssets(directory, new Set(snapshot.assetNames))
  return true
}

export async function loadSessionSnapshot() {
  if (!supportsSessionStorage()) return null
  try {
    const root = await navigator.storage.getDirectory()
    const directory = await root.getDirectoryHandle(SESSION_DIRECTORY)
    const snapshotHandle = await directory.getFileHandle(SNAPSHOT_FILE)
    const snapshot = JSON.parse(await (await snapshotHandle.getFile()).text())
    if (snapshot?.version !== 1 || !snapshot.backup || !Array.isArray(snapshot.assetNames)) return null
    const assets = new Map()
    for (const name of snapshot.assetNames) {
      const handle = await directory.getFileHandle(name)
      const file = await handle.getFile()
      knownAssetNames.set(file, name)
      assets.set(name, file)
    }
    return { snapshot, assets }
  } catch {
    return null
  }
}

export function getSessionAssetName(file) {
  const knownName = knownAssetNames.get(file)
  if (knownName) return knownName
  const fingerprint = [file.name, file.size, file.lastModified, file.type].join('\0')
  let hash = 2166136261
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const extension = file.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.bin'
  const name = `asset-${(hash >>> 0).toString(36)}-${file.size}${extension}`
  knownAssetNames.set(file, name)
  return name
}

async function removeUnusedAssets(directory, activeNames) {
  try {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'file' && name.startsWith('asset-') && !activeNames.has(name)) {
        await directory.removeEntry(name).catch(() => {})
      }
    }
  } catch {
    // Cleanup is best effort and must not make autosave fail.
  }
}
