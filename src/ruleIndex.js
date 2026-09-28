// Rule arrays are replaced on edits. Weak keys let old project indexes be collected.
const indexes = new WeakMap()
const emptyRules = []

export function getPairRuleIndex(rules = emptyRules) {
  let index = indexes.get(rules)
  if (!index) {
    index = new Map()
    for (const { first, second } of rules) {
      if (!index.has(first)) index.set(first, new Set())
      if (!index.has(second)) index.set(second, new Set())
      index.get(first).add(second)
      index.get(second).add(first)
    }
    indexes.set(rules, index)
  }
  return index
}

export function hasPairRule(rules, first, second) {
  return getPairRuleIndex(rules).get(first)?.has(second) || false
}
