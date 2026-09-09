import JSZip from 'jszip'

const PROCREATE_EXTENSION = /\.procreate$/i
const QUICK_LOOK_PNG = /^quicklook\/(?:preview|thumbnail)\.png$/i

export function isProcreateFile(file) {
  return PROCREATE_EXTENSION.test(file?.name || '')
    || file?.type === 'application/x-procreate'
    || file?.type === 'application/vnd.procreate'
}

export async function extractProcreatePreview(file) {
  let archive
  try {
    archive = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new Error(`${file.name || 'This file'} is not a valid Procreate document.`)
  }

  const documentArchive = Object.values(archive.files)
    .find((entry) => !entry.dir && entry.name.toLowerCase() === 'document.archive')
  if (!documentArchive) {
    throw new Error(`${file.name || 'This file'} is missing Procreate document data.`)
  }

  const candidates = Object.values(archive.files)
    .filter((entry) => !entry.dir && QUICK_LOOK_PNG.test(entry.name))
    .sort((first, second) => previewPriority(first.name) - previewPriority(second.name))
  const preview = candidates[0]
  if (!preview) {
    throw new Error(`${file.name || 'This Procreate file'} has no embedded artwork preview.`)
  }

  const blob = await preview.async('blob')
  if (!blob.size) throw new Error(`${file.name || 'This Procreate file'} has an empty artwork preview.`)
  return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' })
}

function previewPriority(name) {
  return /\/preview\.png$/i.test(name) ? 0 : 1
}
