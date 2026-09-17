export function restoreRenderOrder(sourceCategories, restoredCategoriesInBackupOrder, restoredCategoryByCurrentCategory) {
  return [
    ...restoredCategoriesInBackupOrder,
    ...sourceCategories.filter((category) => !restoredCategoryByCurrentCategory.has(category)),
  ]
}

export function matchBackupCategory(currentCategories, backupCategory, getTraitId = (trait) => trait.id) {
  const backupIds = new Set(backupCategory.traits.map((trait) => trait.id).filter(Boolean))
  const backupNames = new Set(backupCategory.traits.map(getBackupTraitName).filter(Boolean))
  const ranked = currentCategories.map((category) => ({
    category,
    idMatches: category.traits.filter((trait) => backupIds.has(getTraitId(trait))).length,
    nameMatches: category.traits.filter((trait) => backupNames.has(getCurrentTraitName(trait))).length,
    categoryNameMatches: normalizeMatchName(category.name) === normalizeMatchName(backupCategory.name),
  })).sort((first, second) => (
    second.idMatches - first.idMatches ||
    Number(second.categoryNameMatches) - Number(first.categoryNameMatches) ||
    second.nameMatches - first.nameMatches
  ))

  const best = ranked[0]
  if (!best || (!best.idMatches && !best.categoryNameMatches && !best.nameMatches)) return null
  const equallyGood = ranked.filter((candidate) => (
    candidate.idMatches === best.idMatches &&
    candidate.categoryNameMatches === best.categoryNameMatches &&
    candidate.nameMatches === best.nameMatches
  ))
  return equallyGood.length === 1 ? best.category : null
}

export function matchBackupTraits(currentTraits, backupTraits, getTraitId = (trait) => trait.id) {
  const matches = Array(backupTraits.length).fill(null)
  const unusedTraits = new Set(currentTraits)

  assignUniqueMatches(matches, unusedTraits, backupTraits, (currentTrait, backupTrait) => (
    Boolean(backupTrait.id) && getTraitId(currentTrait) === backupTrait.id
  ))
  assignUniqueMatches(matches, unusedTraits, backupTraits, (currentTrait, backupTrait) => (
    getCurrentTraitName(currentTrait) === getBackupTraitName(backupTrait)
  ))

  const unmatchedNames = backupTraits
    .filter((_, index) => !matches[index])
    .map((trait) => trait.originalName || trait.name || trait.id || 'Unknown trait')
  if (unmatchedNames.length) {
    const examples = unmatchedNames.slice(0, 3).join(', ')
    const remainder = unmatchedNames.length > 3 ? ` and ${unmatchedNames.length - 3} more` : ''
    throw new Error(`Could not safely match ${unmatchedNames.length} backed-up ${unmatchedNames.length === 1 ? 'trait' : 'traits'}: ${examples}${remainder}. Check that the original files are still present and uniquely named.`)
  }

  return { matches, extras: currentTraits.filter((trait) => unusedTraits.has(trait)) }
}

function assignUniqueMatches(matches, unusedTraits, backupTraits, isMatch) {
  let changed = true
  while (changed) {
    changed = false
    backupTraits.forEach((backupTrait, backupIndex) => {
      if (matches[backupIndex]) return
      const candidates = [...unusedTraits].filter((currentTrait) => isMatch(currentTrait, backupTrait))
      if (candidates.length !== 1) return
      matches[backupIndex] = candidates[0]
      unusedTraits.delete(candidates[0])
      changed = true
    })
  }
}

function getCurrentTraitName(trait) {
  return normalizeMatchName(trait.originalName || trait.fileName || trait.name)
}

function getBackupTraitName(trait) {
  return normalizeMatchName(trait.originalName || trait.name)
}

function normalizeMatchName(value = '') {
  return String(value)
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}
