function traitId(trait) {
  return trait.id || `${trait.category}::${trait.originalName || trait.name}`
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

function overlapScore(candidateIds, recentIdSets, fixedTraitIds) {
  let score = 0
  for (let distance = 0; distance < recentIdSets.length; distance += 1) {
    const recentIds = recentIdSets[recentIdSets.length - 1 - distance]
    const distanceWeight = distance === 0 ? 1000 : 6 - distance
    for (const id of candidateIds) {
      if (!fixedTraitIds.has(id) && recentIds.has(id)) score += distanceWeight
    }
  }
  return score
}

/**
 * Reorders complete combinations without changing their contents or frequency.
 * The deterministic greedy pass strongly avoids shared traits in consecutive
 * editions and lightly spreads repeats across the previous few editions.
 */
export function spreadSimilarCombinations(combinations, seed = '') {
  if (combinations.length < 2) return [...combinations]

  const random = mulberry32(hashString(`${seed}:adjacency-shuffle`))
  const remaining = combinations.map((combo) => ({
    combo,
    ids: new Set(combo.filter((trait) => !trait.isNone).map(traitId)),
  }))
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const swappedItem = remaining[index]
    remaining[index] = remaining[swapIndex]
    remaining[swapIndex] = swappedItem
  }

  const appearances = new Map()
  for (const item of remaining) {
    for (const id of item.ids) appearances.set(id, (appearances.get(id) || 0) + 1)
  }
  const fixedTraitIds = new Set(
    [...appearances].filter(([, count]) => count === combinations.length).map(([id]) => id),
  )

  const ordered = [remaining.pop()]
  while (remaining.length) {
    const recentIdSets = ordered.slice(-5).map((item) => item.ids)
    const candidateCount = Math.min(128, remaining.length)
    let bestIndex = remaining.length - 1
    let bestScore = Number.POSITIVE_INFINITY
    for (let offset = 0; offset < candidateCount; offset += 1) {
      const index = remaining.length - 1 - offset
      const score = overlapScore(remaining[index].ids, recentIdSets, fixedTraitIds)
      if (score < bestScore) {
        bestScore = score
        bestIndex = index
        if (score === 0) break
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0])
  }

  return ordered.map((item) => item.combo)
}

export function countAdjacentTraitRepeats(combinations) {
  let repeats = 0
  for (let index = 1; index < combinations.length; index += 1) {
    const previousIds = new Set(combinations[index - 1].filter((trait) => !trait.isNone).map(traitId))
    repeats += combinations[index].filter((trait) => !trait.isNone && previousIds.has(traitId(trait))).length
  }
  return repeats
}
