export function orderRestoredCategories(backupCategories, restoredByBackupIndex, unmatchedCategories = []) {
  const ordered = backupCategories.map((category, index) => {
    const restored = restoredByBackupIndex.get(category.categoryIndex ?? index)
    if (!restored) throw new Error(`Could not restore the saved position of group "${category.name}".`)
    return restored
  })
  return [...ordered, ...unmatchedCategories]
}

export function resolveRestoredTraitId(id, matches, idByBackupId, idByBackupLocation) {
  for (const match of matches || []) {
    const restoredId = idByBackupLocation.get(`${match.categoryIndex}:${match.traitIndex}`)
    if (restoredId) return restoredId
  }
  return idByBackupId.get(id) || id
}
