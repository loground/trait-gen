export function buildTraitUsageSummary(categories, combos, getTraitKey, getTraitName) {
  const counts = new Map()
  for (const combo of combos) {
    for (const trait of combo) {
      const key = getTraitKey(trait)
      counts.set(key, (counts.get(key) || 0) + 1)
    }
  }
  const total = Math.max(1, combos.length)
  return categories.map((category) => {
    const traits = category.traits.filter((trait) => !trait.isNone).map((trait) => {
      const count = counts.get(getTraitKey(trait)) || 0
      return {
        key: getTraitKey(trait),
        name: getTraitName(trait),
        count,
        percent: (count / total) * 100,
      }
    })
    const usedCount = traits.reduce((sum, trait) => sum + trait.count, 0)
    const blankCount = Math.max(0, combos.length - usedCount)
    if (blankCount > 0) {
      traits.push({
        key: `${category.name}::__summary-none__`,
        name: 'No trait (empty)',
        count: blankCount,
        percent: (blankCount / total) * 100,
      })
    }
    return { name: category.name, usedCount, traits }
  })
}
