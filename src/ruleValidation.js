function getTraitId(trait) {
  return trait.id || `${trait.category}::${trait.originalName || trait.name}`
}

function getTraitName(trait) {
  return String(trait.name || trait.originalName || 'Untitled').trim() || 'Untitled'
}

function normalizePair(first, second) {
  return [first, second].sort((left, right) => left.localeCompare(right))
}

function categoriesConflict(firstCategory, secondCategory, categoryConflicts = []) {
  const [currentFirst, currentSecond] = normalizePair(firstCategory, secondCategory)
  return categoryConflicts.some((rule) => {
    const [first, second] = normalizePair(rule.first, rule.second)
    return currentFirst === first && currentSecond === second
  })
}

export function findCombinationViolation(combo, rules = {}) {
  for (let firstIndex = 0; firstIndex < combo.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < combo.length; secondIndex += 1) {
      const firstTrait = combo[firstIndex]
      const secondTrait = combo[secondIndex]
      if (firstTrait.isNone || secondTrait.isNone) continue
      const firstId = getTraitId(firstTrait)
      const secondId = getTraitId(secondTrait)
      const conflict = (rules.incompatibilities || []).some(
        (rule) =>
          (rule.first === firstId && rule.second === secondId) ||
          (rule.first === secondId && rule.second === firstId),
      )
      if (conflict) {
        return `${firstTrait.category} / ${getTraitName(firstTrait)} cannot appear with ${secondTrait.category} / ${getTraitName(secondTrait)}.`
      }
    }
  }

  for (const rule of rules.categoryRequirements || []) {
    const categoryApplied = combo.some((trait) => trait.category === rule.category)
    const requiredTraitApplied = combo.some((trait) => getTraitId(trait) === rule.requiredTrait)
    if (categoryApplied && !requiredTraitApplied) {
      return `${rule.category} was applied without its required trait.`
    }
  }

  const selectedCategories = [...new Set(combo.filter((trait) => !trait.isNone).map((trait) => trait.category))]
  for (let firstIndex = 0; firstIndex < selectedCategories.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < selectedCategories.length; secondIndex += 1) {
      if (categoriesConflict(selectedCategories[firstIndex], selectedCategories[secondIndex], rules.categoryConflicts)) {
        return `${selectedCategories[firstIndex]} cannot appear with ${selectedCategories[secondIndex]}.`
      }
    }
  }
  return ''
}

export function findInvalidCombination(combos, rules = {}) {
  for (let index = 0; index < combos.length; index += 1) {
    const reason = findCombinationViolation(combos[index], rules)
    if (reason) return { index, reason }
  }
  return null
}
