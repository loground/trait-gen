import { hasPairRule } from './ruleIndex.js'
import { findCombinationViolation } from './ruleValidation.js'
import { isFaceCategory } from './smartRarities.js'

const COMBO_COUNT_TIME_BUDGET_MS = 32
const waitForPaint = () => new Promise((resolve) => setTimeout(resolve, 0))

export async function buildUniqueRandomCombinations(categories, count, seed, rules = {}, attemptLimit = Math.max(count * 50, 1000)) {
  const combos = []
  const seen = new Set()
  let attempt = 0
  let yieldedAt = performance.now()
  await waitForPaint()
  while (combos.length < count && attempt < attemptLimit) {
    if (performance.now() - yieldedAt >= 16) {
      await waitForPaint()
      yieldedAt = performance.now()
    }
    const combo = buildRandomCombination(categories, seed, attempt, rules, combos.length)
    if ((!combo.length && categories.length) || findCombinationViolation(combo, rules)) {
      attempt += 1
      continue
    }
    const key = makeCombinationKey(combo)
    if (!seen.has(key)) {
      seen.add(key)
      combos.push(combo)
    }
    attempt += 1
  }
  if (combos.length < count && !hasOrderedCategories(categories)) {
    for (const combo of await buildCombinationsUpTo(categories, rules, count)) {
      const key = makeCombinationKey(combo)
      if (!seen.has(key)) {
        seen.add(key)
        combos.push(combo)
      }
      if (combos.length >= count) break
    }
  }
  return combos
}

export function buildRandomCombination(categories, seed, index, rules = {}, balancedIndex = index) {
  const random = mulberry32(hashString(`${seed}:${index}`))
  const combo = []
  for (const category of categories) {
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) continue
    const availableTraits = getCategoryChoices(category).filter((trait) => (
      isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities, rules.traitCategoryConflicts)
    ))
    if (!availableTraits.length) return []
    const orderedTraits = getCategorySelectionMode(category) === 'ordered'
      ? availableTraits.filter((trait) => !trait.isNone)
      : []
    const selectedTrait = orderedTraits.length
      ? orderedTraits[balancedIndex % orderedTraits.length]
      : pickWeightedTrait(availableTraits, random)
    combo.push(selectedTrait)
  }
  return rules.traitRequirements?.length && findCombinationViolation(combo, rules) ? [] : combo
}

export async function buildCombinationsUpTo(categories, rules = {}, limit = Number.POSITIVE_INFINITY) {
  const combos = []

  let yieldedAt = performance.now()
  await waitForPaint()
  async function addCategory(categoryIndex, combo) {
    if (performance.now() - yieldedAt >= 16) {
      await waitForPaint()
      yieldedAt = performance.now()
    }
    if (combos.length >= limit) return
    if (categoryIndex >= categories.length) {
      if (!findCombinationViolation(combo, rules)) combos.push(combo)
      return
    }

    const category = categories[categoryIndex]
    if (!shouldApplyCategory(category, combo, rules.categoryRequirements, rules.categoryConflicts)) {
      await addCategory(categoryIndex + 1, combo)
      return
    }

    for (const trait of getCategoryChoices(category)) {
      if (isTraitCompatibleWithCombo(trait, combo, rules.incompatibilities, rules.traitCategoryConflicts)) {
        await addCategory(categoryIndex + 1, [...combo, trait])
      }
    }
  }

  await addCategory(0, [])
  return combos
}

export function countValidCombinations(categories, rules = {}, limit = Number.POSITIVE_INFINITY, timeBudgetMs = COMBO_COUNT_TIME_BUDGET_MS) {
  if (!rules.incompatibilities?.length && !rules.traitCategoryConflicts?.length && !rules.categoryRequirements?.length && !rules.categoryConflicts?.length && !rules.traitRequirements?.length) {
    let orderedCycleLength = 1
    let mixedCombinationCount = 1
    for (const category of categories) {
      const choiceCount = getCategoryChoices(category).filter((trait) => (
        getCategorySelectionMode(category) !== 'ordered' || !trait.isNone
      )).length
      if (getCategorySelectionMode(category) === 'ordered') {
        orderedCycleLength = leastCommonMultiple(orderedCycleLength, choiceCount)
      } else {
        mixedCombinationCount *= choiceCount
      }
      if (orderedCycleLength * mixedCombinationCount > limit) return { count: limit, capped: true }
    }
    const count = orderedCycleLength * mixedCombinationCount
    return { count, capped: false }
  }

  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const categoryRequirements = new Map((rules.categoryRequirements || []).map((rule) => [rule.category, rule.requiredTrait]))
  let operations = 0
  let timedOut = false

  function exceededTimeBudget() {
    operations += 1
    if (timedOut) return true
    if ((operations & 255) !== 0) return false
    const now = globalThis.performance?.now?.() ?? Date.now()
    timedOut = now - startedAt >= timeBudgetMs
    return timedOut
  }

  function isCompatible(trait, combo) {
    if (trait.isNone) return true
    const traitId = makeTraitKey(trait)
    if (!combo.every((selectedTrait) => selectedTrait.isNone || !hasPairRule(rules.incompatibilities, traitId, makeTraitKey(selectedTrait)))) {
      return false
    }
    return isTraitCategoryCompatibleWithCombo(trait, combo, rules.traitCategoryConflicts)
  }

  function shouldApply(category, combo) {
    const requirement = categoryRequirements.get(category.name)
    if (requirement && !combo.some((trait) => makeTraitKey(trait) === requirement)) return false
    return !combo.some((trait) => !trait.isNone && hasPairRule(rules.categoryConflicts, category.name, trait.category))
  }

  function countFrom(categoryIndex, combo) {
    if (exceededTimeBudget()) return 0
    if (categoryIndex >= categories.length) return rules.traitRequirements?.length && findCombinationViolation(combo, rules) ? 0 : 1
    const category = categories[categoryIndex]
    if (!shouldApply(category, combo)) {
      return countFrom(categoryIndex + 1, combo)
    }

    let count = 0
    for (const trait of getCategoryChoices(category)) {
      if (exceededTimeBudget()) break
      if (isCompatible(trait, combo)) {
        count += countFrom(categoryIndex + 1, [...combo, trait])
        if (timedOut) break
        if (count > limit) return count
      }
    }
    return count
  }

  const count = countFrom(0, [])
  if (timedOut) return { count: Math.min(count, limit), capped: true, approximate: true }
  return { count: Math.min(count, limit), capped: count > limit, approximate: false }
}

function isTraitCompatibleWithCombo(trait, combo, incompatibilities = [], traitCategoryConflicts = []) {
  if (trait.isNone) return true
  return combo.every((selectedTrait) => !areTraitsIncompatible(trait, selectedTrait, incompatibilities)) &&
    isTraitCategoryCompatibleWithCombo(trait, combo, traitCategoryConflicts)
}

function isTraitCategoryCompatibleWithCombo(trait, combo, traitCategoryConflicts = []) {
  if (trait.isNone) return true
  const traitId = makeTraitKey(trait)
  return !(traitCategoryConflicts || []).some((rule) => (
    (rule.trait === traitId && combo.some((selectedTrait) => !selectedTrait.isNone && selectedTrait.category === rule.category)) ||
    (rule.category === trait.category && combo.some((selectedTrait) => !selectedTrait.isNone && makeTraitKey(selectedTrait) === rule.trait))
  ))
}

function shouldApplyCategory(category, combo, categoryRequirements = [], categoryConflicts = []) {
  const requirement = categoryRequirements.find((rule) => rule.category === category.name)
  if (requirement && !combo.some((trait) => makeTraitKey(trait) === requirement.requiredTrait)) return false
  return !combo.some((trait) => !trait.isNone && areCategoriesIncompatible(category.name, trait.category, categoryConflicts))
}

function areTraitsIncompatible(firstTrait, secondTrait, incompatibilities = []) {
  if (firstTrait.isNone || secondTrait.isNone) return false
  return hasPairRule(incompatibilities, makeTraitKey(firstTrait), makeTraitKey(secondTrait))
}

export function getActiveCategories(categories) {
  return categories
    .filter((category) => category.enabled !== false)
    .map((category) => ({ ...category, traits: getWeightedTraits(category) }))
    .filter((category) => category.traits.length)
}

export function getWeightedTraits(category) {
  return getCategoryChoices(category).filter((trait) => getTraitWeight(trait) > 0)
}

function getCategoryChoices(category) {
  const choices = [...category.traits]
  if (choices.some((trait) => trait.isNone)) return choices
  const noneWeight = getCategoryNoneWeight(category)
  if (noneWeight > 0) {
    choices.push({
      type: 'none',
      isNone: true,
      id: makeTraitId(category.name, '__none__'),
      category: category.name,
      originalName: 'None',
      name: 'None',
      weight: noneWeight,
    })
  }
  return choices
}

export function getTraitWeight(trait) {
  const weight = Number(trait.weight ?? 1)
  return Number.isFinite(weight) ? Math.max(0, weight) : 0
}

function pickWeightedTrait(traits, random) {
  const total = traits.reduce((sum, trait) => sum + getTraitWeight(trait), 0)
  if (total <= 0) return traits[0]
  let target = random() * total
  for (const trait of traits) {
    target -= getTraitWeight(trait)
    if (target <= 0) return trait
  }
  return traits[traits.length - 1]
}

function makeCombinationKey(combo) {
  return combo.map((trait) => getTraitId(trait)).join('|')
}

export function makeTraitKey(trait) {
  return getTraitId(trait)
}

export function getTraitId(trait) {
  return trait.id || makeTraitId(trait.category, trait.originalName || trait.name)
}

export function makeTraitId(category, name) {
  return `${category}::${name}`
}

export function normalizeRule(first, second) {
  return [first, second].sort((left, right) => left.localeCompare(right))
}

export function makeRuleKey(rule) {
  const [first, second] = normalizeRule(rule.first, rule.second)
  return `${first}||${second}`
}

function areCategoriesIncompatible(firstCategory, secondCategory, categoryConflicts = []) {
  return hasPairRule(categoryConflicts, firstCategory, secondCategory)
}

export function getCategoryNoneWeight(category) {
  const weight = Number(category.noneWeight ?? 0)
  return Number.isFinite(weight) ? Math.max(0, weight) : 0
}

export function getCategorySelectionMode(category) {
  if (category?.selectionMode === 'ordered') return 'ordered'
  if (category?.selectionMode === 'weighted') return 'weighted'
  return isFaceCategory(category?.name) ? 'ordered' : 'weighted'
}

export function hasOrderedCategories(categories = []) {
  return categories.some((category) => getCategorySelectionMode(category) === 'ordered')
}

function leastCommonMultiple(first, second) {
  if (!first || !second) return 0
  let left = Math.abs(first)
  let right = Math.abs(second)
  while (right) [left, right] = [right, left % right]
  return Math.abs(first * second) / left
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
