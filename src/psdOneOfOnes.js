// Keep the original folder so choosing “None” restores its traits and render order.
export function restorePsdOneOfOneFolder(source) {
  if (!source.psdOneOfOneFolder) return source
  const categories = [...source.categories]
  categories.splice(Math.min(source.psdOneOfOneFolder.index, categories.length), 0, source.psdOneOfOneFolder.category)
  return { ...source, categories, psdOneOfOneFolder: null, oneOfOnes: (source.oneOfOnes || []).filter((artwork) => !artwork.psdFolderArtwork) }
}

export function selectPsdOneOfOneFolder(source, index) {
  const restored = restorePsdOneOfOneFolder(source)
  if (index === null) return restored
  const category = restored.categories[index]
  if (source.type !== 'psd' || !category?.traits.length) throw new Error('Choose a PSD folder containing artworks.')
  const ids = new Set(category.traits.map((trait) => trait.id))
  const pairAllowed = (rule) => !ids.has(rule.first) && !ids.has(rule.second)
  return {
    ...restored,
    categories: restored.categories.filter((_, categoryIndex) => categoryIndex !== index),
    psdOneOfOneFolder: { index, category },
    oneOfOnes: [...(restored.oneOfOnes || []), ...category.traits.map((trait) => ({
      id: `psd-one-of-one::${trait.id}`, originalName: trait.originalName, name: trait.name,
      psdFolderArtwork: true, trait, width: source.width, height: source.height,
    }))],
    incompatibilities: (restored.incompatibilities || []).filter(pairAllowed),
    positionRules: (restored.positionRules || []).filter(pairAllowed),
    traitCategoryConflicts: (restored.traitCategoryConflicts || []).filter((rule) => !ids.has(rule.trait) && rule.category !== category.name),
    categoryRequirements: (restored.categoryRequirements || []).filter((rule) => !ids.has(rule.requiredTrait) && rule.category !== category.name),
    categoryConflicts: (restored.categoryConflicts || []).filter((rule) => rule.first !== category.name && rule.second !== category.name),
  }
}
