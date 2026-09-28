function selectedFolders(source) {
  return source.psdOneOfOneFolders || (source.psdOneOfOneFolder ? [source.psdOneOfOneFolder] : [])
}

// Reinsert selected folders at their saved positions, retaining render order.
export function restorePsdOneOfOneFolder(source) {
  const folders = selectedFolders(source)
  if (!folders.length) return source
  const categories = [...source.categories]
  for (const folder of [...folders].sort((a, b) => a.index - b.index)) {
    categories.splice(Math.min(folder.index, categories.length), 0, folder.category)
  }
  return { ...source, categories, psdOneOfOneFolder: null, psdOneOfOneFolders: [], oneOfOnes: (source.oneOfOnes || []).filter((artwork) => !artwork.psdFolderArtwork) }
}

export function getPsdOneOfOneFolderIndices(source) {
  const restored = restorePsdOneOfOneFolder(source)
  return selectedFolders(source).map(({ category }) => restored.categories.indexOf(category)).sort((a, b) => a - b)
}

// Accept the legacy single-folder call as well as the multiple-folder API.
export function selectPsdOneOfOneFolder(source, index) {
  return selectPsdOneOfOneFolders(source, index === null ? [] : [index])
}

export function selectPsdOneOfOneFolders(source, indices) {
  const restored = restorePsdOneOfOneFolder(source)
  const uniqueIndices = [...new Set(indices)].sort((a, b) => a - b)
  if (!uniqueIndices.length) return restored
  const folders = uniqueIndices.map((index) => {
    const category = restored.categories[index]
    if (source.type !== 'psd' || !Number.isInteger(index) || !category?.traits.length) throw new Error('Choose a PSD folder containing artworks.')
    return { index, category }
  })
  const ids = new Set(folders.flatMap(({ category }) => category.traits.map((trait) => trait.id)))
  const names = new Set(folders.map(({ category }) => category.name))
  const previousIds = new Set(selectedFolders(source).flatMap(({ category }) => category.traits.map((trait) => trait.id)))
  const previousArtworks = new Map((source.oneOfOnes || []).filter((artwork) => artwork.psdFolderArtwork).map((artwork) => [artwork.trait.id, artwork]))
  const pairAllowed = (rule) => !ids.has(rule.first) && !ids.has(rule.second)
  return {
    ...restored,
    categories: restored.categories.filter((_, index) => !uniqueIndices.includes(index)),
    psdOneOfOneFolder: null,
    psdOneOfOneFolders: folders,
    oneOfOnes: [...(restored.oneOfOnes || []), ...folders.flatMap(({ category }) => category.traits
      // Retain renames and removals in folders that remain selected.
      .filter((trait) => !previousIds.has(trait.id) || previousArtworks.has(trait.id))
      .map((trait) => previousArtworks.get(trait.id) || ({
        id: `psd-one-of-one::${trait.id}`, originalName: trait.originalName, name: trait.name,
        psdFolderArtwork: true, trait, width: source.width, height: source.height,
      })))],
    incompatibilities: (restored.incompatibilities || []).filter(pairAllowed),
    traitRequirements: (restored.traitRequirements || []).filter((rule) => !ids.has(rule.trait) && !ids.has(rule.requiredTrait)),
    positionRules: (restored.positionRules || []).filter(pairAllowed),
    traitCategoryConflicts: (restored.traitCategoryConflicts || []).filter((rule) => !ids.has(rule.trait) && !names.has(rule.category)),
    categoryRequirements: (restored.categoryRequirements || []).filter((rule) => !ids.has(rule.requiredTrait) && !names.has(rule.category)),
    categoryConflicts: (restored.categoryConflicts || []).filter((rule) => !names.has(rule.first) && !names.has(rule.second)),
  }
}
