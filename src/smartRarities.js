const ACCESSORY_CATEGORY = /^(accessory|accessories|accesory|accesories)\b/i
const FACE_CATEGORY = /^faces?\b/i

export function isAccessoryCategory(categoryName) {
  return ACCESSORY_CATEGORY.test(String(categoryName || '').trim())
}

export function isFaceCategory(categoryName) {
  return FACE_CATEGORY.test(String(categoryName || '').trim())
}

/**
 * Build a useful rarity profile instead of assigning unrelated random numbers.
 * Every category totals exactly 100, so the values shown in the editor are
 * real percentage chances (including "No trait").
 */
export function buildSmartRarityProfile(categories, options = {}) {
  const targetCount = Math.max(1, Math.round(Number(options.targetCount) || 3333))
  const seed = String(options.seed || 'trait-forge')
  const zeroNoneCategoryIndexes = Array.isArray(options.zeroNoneCategoryIndexes)
    ? new Set(options.zeroNoneCategoryIndexes.map(Number))
    : null

  const profiledCategories = categories.map((category, categoryIndex) => {
    if (category.enabled === false || !category.traits.length) return category

    if (category.selectionMode === 'ordered' || isFaceCategory(category.name)) {
      const weights = distributeEvenChances(category.traits.length, 100)
      return {
        ...category,
        selectionMode: 'ordered',
        noneWeight: 0,
        traits: category.traits.map((trait, traitIndex) => ({
          ...trait,
          weight: weights[traitIndex],
        })),
      }
    }

    const noTraitChance = zeroNoneCategoryIndexes
      ? zeroNoneCategoryIndexes.has(categoryIndex) ? 0 : getRecommendedOptionalNoTraitChance(category.traits.length)
      : getRecommendedNoTraitChance(category.name, category.traits.length)
    const traitBudget = 100 - noTraitChance
    const weights = distributeTraitChances(
      category.traits.length,
      traitBudget,
      `${seed}:${categoryIndex}:${category.name}`,
      targetCount,
    )

    return {
      ...category,
      noneWeight: noTraitChance,
      traits: category.traits.map((trait, traitIndex) => ({
        ...trait,
        weight: weights[traitIndex],
      })),
    }
  })

  const activeCategories = profiledCategories.filter((category) => category.enabled !== false && category.traits.length)
  const optionalCategories = activeCategories.filter((category) => Number(category.noneWeight) > 0)
  const balancedFaceCategories = activeCategories.filter((category) => isFaceCategory(category.name))
  const traitWeights = activeCategories.flatMap((category) => category.traits.map((trait) => Number(trait.weight) || 0))
  const lowestExpectedCount = traitWeights.length
    ? Math.max(1, Math.round((Math.min(...traitWeights) / 100) * targetCount))
    : 0

  return {
    categories: profiledCategories,
    summary: {
      targetCount,
      optionalCategoryCount: optionalCategories.length,
      balancedFaceCategoryCount: balancedFaceCategories.length,
      activeCategoryCount: activeCategories.length,
      rareTraitCount: traitWeights.filter((weight) => weight > 0 && weight <= 1).length,
      lowestExpectedCount,
    },
  }
}

function distributeEvenChances(traitCount, budget) {
  if (!traitCount) return []
  const budgetUnits = Math.round(budget * 10)
  const baseUnits = Math.floor(budgetUnits / traitCount)
  const extraUnits = budgetUnits - baseUnits * traitCount
  return Array.from({ length: traitCount }, (_, index) => (baseUnits + (index < extraUnits ? 1 : 0)) / 10)
}

export function getRecommendedNoTraitChance(categoryName, traitCount = 0) {
  if (!isAccessoryCategory(categoryName)) return 0

  return getRecommendedOptionalNoTraitChance(traitCount)
}

function getRecommendedOptionalNoTraitChance(traitCount) {
  // Keep accessories optional without letting blank accessories dominate the set.
  // A small folder needs a little more empty space because each included trait is
  // otherwise extremely common.
  if (traitCount <= 5) return 40
  if (traitCount <= 10) return 35
  if (traitCount <= 20) return 25
  if (traitCount <= 40) return 18
  return 15
}

function distributeTraitChances(traitCount, budget, seed, targetCount) {
  if (!traitCount) return []

  // Reserve about 10% of each folder as true rares, then keep the remaining
  // traits on a moderate curve so common traits do not dominate combinations.
  const spread = traitCount >= 30 ? 3.2 : traitCount >= 18 ? 2.8 : traitCount >= 10 ? 2.3 : 1.8
  const random = mulberry32(hashString(seed))
  const rareTraitCount = traitCount >= 5 ? Math.max(1, Math.round(traitCount * 0.1)) : 0
  const commonTraitCount = traitCount - rareTraitCount
  const rankedScores = Array.from({ length: traitCount }, (_, index) => {
    if (index < rareTraitCount) return 0
    const commonIndex = index - rareTraitCount
    const position = commonTraitCount <= 1 ? 1 : commonIndex / (commonTraitCount - 1)
    const rarityCurve = Math.pow(spread, position)
    return rarityCurve * (0.88 + random() * 0.24)
  })
  shuffle(rankedScores, random)

  const budgetUnits = Math.round(budget * 10)
  // Use tenths of a percent, with a floor of roughly 20 expected appearances.
  // The floor is capped at half of an even share so it also works for very large
  // folders or small collection sizes.
  const expectedAppearanceFloor = (20 / targetCount) * 100
  const evenShare = budget / traitCount
  const minimumUnits = Math.max(1, Math.round(Math.min(expectedAppearanceFloor, evenShare / 2) * 10))
  const remainingUnits = Math.max(0, budgetUnits - minimumUnits * traitCount)
  const scoreTotal = rankedScores.reduce((total, score) => total + score, 0)
  const rawShares = rankedScores.map((score) => (remainingUnits * score) / scoreTotal)
  const allocated = rawShares.map((share) => Math.floor(share))
  let unitsLeft = remainingUnits - allocated.reduce((total, units) => total + units, 0)
  const remainderOrder = rawShares
    .map((share, index) => ({ index, remainder: share - allocated[index] }))
    .sort((first, second) => second.remainder - first.remainder)

  for (let index = 0; index < unitsLeft; index += 1) {
    allocated[remainderOrder[index].index] += 1
  }

  return allocated.map((units) => (units + minimumUnits) / 10)
}

function shuffle(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[items[index], items[swapIndex]] = [items[swapIndex], items[index]]
  }
}

function hashString(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed) {
  return function random() {
    let value = (seed += 0x6d2b79f5)
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
