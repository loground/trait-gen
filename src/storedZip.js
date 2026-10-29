const ZIP32_MAX = 0xffffffff
const ZIP16_MAX = 0xffff
const UTF8_FLAG = 0x0800
const encoder = new TextEncoder()

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  crcTable[index] = value >>> 0
}

function makeRecord(size) {
  const bytes = new Uint8Array(size)
  return { bytes, view: new DataView(bytes.buffer) }
}

function setUint16(view, offset, value) {
  view.setUint16(offset, value, true)
}

function setUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true)
}

function getDosDateTime(date) {
  const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  const year = Math.max(1980, safeDate.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((safeDate.getMonth() + 1) << 5) | safeDate.getDate(),
    time: (safeDate.getHours() << 11) | (safeDate.getMinutes() << 5) | Math.floor(safeDate.getSeconds() / 2),
  }
}

async function inspectBlob(blob, onBytes) {
  let crc = 0xffffffff
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (let index = 0; index < value.length; index += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ value[index]) & 0xff]
      onBytes(value.length)
    }
  } else {
    const value = new Uint8Array(await blob.arrayBuffer())
    for (let index = 0; index < value.length; index += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ value[index]) & 0xff]
    onBytes(value.length)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function normalizeEntry(entry) {
  if (!entry?.name) throw new Error('Every ZIP entry needs a file name.')
  const nameBytes = encoder.encode(String(entry.name).replace(/^\/+/, ''))
  if (!nameBytes.length || nameBytes.length > ZIP16_MAX) throw new Error(`ZIP file name is too long: ${entry.name}`)
  const blob = entry.data instanceof Blob ? entry.data : new Blob([entry.data ?? ''])
  if (blob.size > ZIP32_MAX) throw new Error(`ZIP file is larger than 4 GB: ${entry.name}`)
  return { name: String(entry.name), nameBytes, blob, modified: entry.modified }
}

/**
 * Builds an uncompressed ZIP without concatenating every file into a second
 * in-memory byte array. Image exports are compressed already, so STORE is both
 * faster and substantially less memory hungry than deflating them again.
 */
export async function createStoredZip(rawEntries, { onProgress } = {}) {
  const entries = rawEntries.map(normalizeEntry)
  if (entries.length > ZIP16_MAX) throw new Error('A ZIP can contain at most 65,535 files.')

  const totalBytes = entries.reduce((sum, entry) => sum + entry.blob.size, 0)
  let processedBytes = 0
  let offset = 0
  const parts = []
  const centralParts = []

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const crc = await inspectBlob(entry.blob, (byteCount) => {
      processedBytes += byteCount
      onProgress?.({ processedBytes, totalBytes, fileIndex: index, fileCount: entries.length })
    })
    const timestamp = getDosDateTime(entry.modified)
    const localOffset = offset
    const local = makeRecord(30)
    setUint32(local.view, 0, 0x04034b50)
    setUint16(local.view, 4, 20)
    setUint16(local.view, 6, UTF8_FLAG)
    setUint16(local.view, 8, 0)
    setUint16(local.view, 10, timestamp.time)
    setUint16(local.view, 12, timestamp.date)
    setUint32(local.view, 14, crc)
    setUint32(local.view, 18, entry.blob.size)
    setUint32(local.view, 22, entry.blob.size)
    setUint16(local.view, 26, entry.nameBytes.length)
    setUint16(local.view, 28, 0)
    parts.push(local.bytes, entry.nameBytes, entry.blob)
    offset += local.bytes.length + entry.nameBytes.length + entry.blob.size

    const central = makeRecord(46)
    setUint32(central.view, 0, 0x02014b50)
    setUint16(central.view, 4, 20)
    setUint16(central.view, 6, 20)
    setUint16(central.view, 8, UTF8_FLAG)
    setUint16(central.view, 10, 0)
    setUint16(central.view, 12, timestamp.time)
    setUint16(central.view, 14, timestamp.date)
    setUint32(central.view, 16, crc)
    setUint32(central.view, 20, entry.blob.size)
    setUint32(central.view, 24, entry.blob.size)
    setUint16(central.view, 28, entry.nameBytes.length)
    setUint16(central.view, 30, 0)
    setUint16(central.view, 32, 0)
    setUint16(central.view, 34, 0)
    setUint16(central.view, 36, 0)
    setUint32(central.view, 38, 0)
    setUint32(central.view, 42, localOffset)
    centralParts.push(central.bytes, entry.nameBytes)
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  if (offset > ZIP32_MAX || offset + centralSize + 22 > ZIP32_MAX) {
    throw new Error('The export is larger than the 4 GB browser ZIP limit. Reduce image dimensions or export quality.')
  }
  const end = makeRecord(22)
  setUint32(end.view, 0, 0x06054b50)
  setUint16(end.view, 4, 0)
  setUint16(end.view, 6, 0)
  setUint16(end.view, 8, entries.length)
  setUint16(end.view, 10, entries.length)
  setUint32(end.view, 12, centralSize)
  setUint32(end.view, 16, offset)
  setUint16(end.view, 20, 0)
  onProgress?.({ processedBytes: totalBytes, totalBytes, fileIndex: entries.length, fileCount: entries.length })
  return new Blob([...parts, ...centralParts, end.bytes], { type: 'application/zip' })
}
