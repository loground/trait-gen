import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBackupRules } from './aiBackup.js'
import { findCombinationViolation } from './ruleValidation.js'
import { buildRandomCombination, buildUniqueRandomCombinations, getActiveCategories, countValidCombinations } from './combinations.js'
const red = { id: 'red', name: 'Red', category: 'hat', weight: 1 }
const blue = { id: 'blue', name: 'Blue', category: 'hat', weight: 1 }
const clown = { id: 'clown', name: 'Clown', category: 'clothes', weight: 1 }
const plain = { id: 'plain', name: 'Plain', category: 'clothes', weight: 1 }
const categories = [{ name: 'hat', noneWeight: 1, traits: [red, blue] }, { name: 'clothes', traits: [clown, plain] }]
const rules = { traitRequirements: [{ trait: 'clown', requiredTrait: 'red' }] }

test('requirements are directional and cannot be satisfied by None or an omitted category', () => {
  assert.equal(findCombinationViolation([red, clown], rules), '')
  assert.equal(findCombinationViolation([red, plain], rules), '')
  for (const combo of [[clown], [blue, clown], [{ ...red, isNone: true }, clown]]) {
    assert.match(findCombinationViolation(combo, rules), /requires/)
  }
})

test('generation and combination counts enforce requirements in either render order', async () => {
  for (const stack of [categories, [...categories].reverse()]) {
    const active = getActiveCategories(stack)
    for (let i = 0; i < 100; i++) {
      const combo = buildRandomCombination(active, 'requirements', i, rules)
      if (combo.length) assert.equal(findCombinationViolation(combo, rules), '')
    }
    assert.equal(countValidCombinations(active, rules).count, 4)
    const all = await buildUniqueRandomCombinations(active, 4, 'requirements', rules)
    assert.equal(all.length, 4)
    assert(all.some(combo => combo.some(t => t.id === 'clown')))
    for (const combo of all) assert.equal(findCombinationViolation(combo, rules), '')
  }
})

test('unavailable required artwork never produces its dependent trait', async () => {
  const active = getActiveCategories([{ ...categories[0], traits: [{ ...red, weight: 0 }, blue] }, categories[1]])
  const all = await buildUniqueRandomCombinations(active, 2, 'requirements', rules)
  assert.equal(all.length, 2)
  assert(all.every(combo => !combo.some(t => t.id === 'clown')))
})

test('backup validation rejects unknown or malformed required traits', () => {
  validateBackupRules({ categories, ...rules })
  assert.throws(() => validateBackupRules({ categories, traitRequirements: [{ trait: 'clown', requiredTrait: 'missing' }] }), /unknown trait/)
  assert.throws(() => validateBackupRules({ categories, traitRequirements: null }), /must be an array/)
})
