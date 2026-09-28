const pairKey = (first, second) => JSON.stringify([first, second].sort())

// Index blocks once so walking large folder pairs doesn't scan every rule.
export function createPositionPairFilter(source) {
  const categories = new Map((source?.categories || []).flatMap((category) =>
    category.traits.map((trait) => [trait.id || `${trait.category}::${trait.originalName || trait.name}`, category.name]),
  ))
  const pairs = new Set((source?.incompatibilities || []).map(({ first, second }) => pairKey(first, second)))
  const folders = new Set((source?.categoryConflicts || []).map(({ first, second }) => pairKey(first, second)))
  const traitFolders = new Set((source?.traitCategoryConflicts || []).map(({ trait, category }) => JSON.stringify([trait, category])))
  return (first, second) => {
    const firstCategory = categories.get(first)
    const secondCategory = categories.get(second)
    return Boolean(firstCategory && secondCategory && firstCategory !== secondCategory &&
      !pairs.has(pairKey(first, second)) &&
      !folders.has(pairKey(firstCategory, secondCategory)) &&
      !traitFolders.has(JSON.stringify([first, secondCategory])) &&
      !traitFolders.has(JSON.stringify([second, firstCategory])))
  }
}

export function getPositionPairs(firstOptions, secondOptions, isAllowed) {
  return firstOptions.flatMap((firstOption) => secondOptions
    .filter((secondOption) => isAllowed(firstOption.key, secondOption.key))
    .map((secondOption) => ({ firstOption, secondOption })))
}
