import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRandomCombination, buildUniqueRandomCombinations, buildCombinationsUpTo, countValidCombinations, getActiveCategories } from './combinations.js'
import { hasPairRule } from './ruleIndex.js'

const category = (name, count) => ({ name, selectionMode: 'weighted', traits: Array.from({ length: count }, (_, index) => ({ id: `${name}::${index}`, category: name, name: String(index), weight: 1 })) })
const keys = (combos) => combos.map(combo => combo.map(t => t.id).join('|')).sort()

test('pair rules block either selection order, including the single-image preview', async () => {
  const categories = [category('a', 1), category('z', 2)]
  for (const ordered of [categories, [...categories].reverse()]) {
    for (const rule of [{ first: 'a::0', second: 'z::0' }, { first: 'z::0', second: 'a::0' }]) {
      const rules = { incompatibilities: [rule] }
      const preview = buildRandomCombination(ordered, 'regression', 0, rules)
      assert.ok(!preview.some(t => t.id === 'a::0') || !preview.some(t => t.id === 'z::0'))
      const combos = await buildUniqueRandomCombinations(ordered, 2, 'regression', rules, 10)
      assert.equal(combos.length, 1)
      assert.ok(combos[0].some(t => t.id === 'z::1'))
      assert.deepEqual(keys(await buildCombinationsUpTo(ordered, rules)), keys(combos))
      assert.equal(countValidCombinations(ordered, rules).count, 1)
    }
  }
})

test('indexes refresh after rules are added or removed and do not collide on delimiters', () => {
  const original = [{ first: 'a||b', second: 'c' }]
  assert.ok(hasPairRule(original, 'c', 'a||b'))
  assert.equal(hasPairRule(original, 'a', 'b||c'), false)
  const added = [...original, { first: 'a', second: 'b||c' }]
  assert.ok(hasPairRule(added, 'a', 'b||c'))
  assert.equal(hasPairRule(added.slice(0, 1), 'a', 'b||c'), false)
})

test('large rule sets produce unique, reproducible, valid collections while yielding', async () => {
  const categories = [category('a', 30), category('b', 30), category('c', 30)]
  const rules = { incompatibilities: Array.from({ length: 10629 }, (_, i) => ({ first: `unused::${i}`, second: 'b::0' })) }
  rules.incompatibilities.push({ first: 'a::0', second: 'b::0' })
  let heartbeat = 0
  const timer = setInterval(() => heartbeat++, 0)
  try {
    const combos = await buildUniqueRandomCombinations(categories, 10000, 'large-rules', rules)
    assert.equal(combos.length, 10000)
    assert.equal(new Set(keys(combos)).size, 10000)
    assert.ok(heartbeat > 1, 'selection should allow other event-loop work')
    // Independent check, without the production validator or rule index.
    for (const combo of combos) {
      assert.ok(!(combo[0].id === 'a::0' && combo[1].id === 'b::0'))
    }
    assert.deepEqual(keys(await buildUniqueRandomCombinations(categories, 10000, 'large-rules', rules)), keys(combos))
  } finally {
    clearInterval(timer)
  }
})

test('empty choices, disabled traits, folder conflicts and requirements keep their semantics', async () => {
  const categories = getActiveCategories([
    category('a', 2),
    { ...category('b', 1), noneWeight: 1 },
    { ...category('c', 1), enabled: false },
    { ...category('d', 1), traits: [{ id: 'd::0', category: 'd', weight: 0 }] },
  ])
  const rules = {
    categoryRequirements: [{ category: 'b', requiredTrait: 'a::0' }],
    traitCategoryConflicts: [{ trait: 'a::0', category: 'b' }],
  }
  const combos = await buildCombinationsUpTo(categories, rules)
  assert.deepEqual(keys(combos), ['a::0|b::__none__', 'a::1'])
  assert.equal(countValidCombinations(categories, rules).count, 2)
  assert.equal((await buildCombinationsUpTo(categories, { categoryConflicts: [{ first: 'b', second: 'a' }] })).length, 2)
})
