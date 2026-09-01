const droppedFilePaths = new WeakMap()

function splitPath(path = '') {
  return String(path).replaceAll('\\', '/').split('/').filter(Boolean)
}

export function getFileImportPath(file) {
  return file?.webkitRelativePath || droppedFilePaths.get(file) || file?.droppedRelativePath || file?.name || ''
}

export function rememberDroppedFilePath(file, path) {
  if (file && typeof file === 'object') droppedFilePaths.set(file, path)
  return file
}

export function planFolderCategories(files) {
  const mapped = files.map((file) => ({ file, path: getFileImportPath(file) }))
  const paths = mapped.map((item) => splitPath(item.path))
  const commonRoot = paths[0]?.[0]
  const shouldStripRoot = Boolean(
    commonRoot &&
    paths.every((parts) => parts[0] === commonRoot) &&
    paths.some((parts) => parts.length > 2),
  )

  const candidates = mapped.flatMap((item) => {
    const parts = splitPath(item.path)
    const relativeParts = shouldStripRoot ? parts.slice(1) : parts
    if (relativeParts.length < 2) return []
    const categoryParts = relativeParts.slice(0, -1)
    return [{
      ...item,
      path: relativeParts.join('/'),
      categoryPath: categoryParts.join('/'),
      categoryParts,
      fileName: relativeParts.at(-1),
    }]
  })

  const leafPaths = new Map()
  for (const item of candidates) {
    const leaf = item.categoryParts.at(-1)
    const pathsForLeaf = leafPaths.get(leaf) || new Set()
    pathsForLeaf.add(item.categoryPath)
    leafPaths.set(leaf, pathsForLeaf)
  }

  return candidates.map((item) => {
    const leaf = item.categoryParts.at(-1)
    const categoryLabel = leafPaths.get(leaf).size === 1
      ? leaf
      : item.categoryParts.join(' / ')
    return { ...item, categoryLabel }
  })
}
