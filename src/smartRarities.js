const CORE_CATEGORY = /^(bg|background|backdrop|base|scene|sky|floor|body|skin|character|person|face|eyes|clothes|clothing|outfit|shirt|jacket)\b/i
const HAIR_CATEGORY = /^(hair|hairstyle)\b/i

/**
 * Build a useful rarity profile instead of assigning unrelated random numbers.
 * Every category totals exactly 100, so the values shown in the editor are
 * real percentage chances (including "No trait").
 */
export function buildSmartRarityProfile(categories, options = {}) {
  const targetCount = Math.max(1, Math.round(Number(options.targetCount) || 2000))
  const seed = String(options.seed || 'trait-forge')

  const profiledCategories = categories.map((category, categoryIndex) => {
    if (category.enabled === false || !category.traits.length) return category

    const noTraitChance = getRecommendedNoTraitChance(category.name)
    const traitBudget = 100 - noTraitChance
    const weights = distributeTraitChances(
      category.traits.length,
      traitBudget,
      `${seed}:${categoryIndex}:${category.name}`,
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
  const traitWeights = activeCategories.flatMap((category) => category.traits.map((trait) => Number(trait.weight) || 0))
  const lowestExpectedCount = traitWeights.length
    ? Math.max(1, Math.round((Math.min(...traitWeights) / 100) * targetCount))
    : 0

  return {
    categories: profiledCategories,
    summary: {
      targetCount,
      optionalCategoryCount: optionalCategories.length,
      activeCategoryCount: activeCategories.length,
      rareTraitCount: traitWeights.filter((weight) => weight > 0 && weight <= 1).length,
      lowestExpectedCount,
    },
  }
}

export function getRecommendedNoTraitChance(categoryName) {
  const name = String(categoryName || '').trim()
  if (CORE_CATEGORY.test(name)) return 0
  if (HAIR_CATEGORY.test(name)) return 6
  if (/^(pet|pets|companion|companions)\b/i.test(name)) return 72
  if (/^(smoke|effect|effects|aura)\b/i.test(name)) return 62
  if (/^(chain|chains|necklace|jewelry|jewellery)\b/i.test(name)) return 58
  if (/^(bandana|mask|masks)\b/i.test(name)) return 55
  if (/^(on the head|hat|hats|headwear|head accessory)\b/i.test(name)) return 48
  if (/^(accessory|accessories|weapon|weapons|glasses|eyewear)\b/i.test(name)) return 45
  return 18
}

function distributeTraitChances(traitCount, budget, seed) {
  if (!traitCount) return []

  const spread = traitCount >= 20 ? 7 : traitCount >= 12 ? 5 : traitCount >= 7 ? 3.5 : traitCount >= 4 ? 2.5 : 1.6
  const random = mulberry32(hashString(seed))
  const rankedScores = Array.from({ length: traitCount }, (_, index) => {
    const position = traitCount === 1 ? 1 : index / (traitCount - 1)
    const rarityCurve = Math.pow(spread, position)
    return rarityCurve * (0.88 + random() * 0.24)
  })
  shuffle(rankedScores, random)

  const budgetUnits = Math.round(budget * 10)
  const minimumUnits = 1
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
