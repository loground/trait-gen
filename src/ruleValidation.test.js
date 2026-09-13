import assert from 'node:assert/strict'
import test from 'node:test'
import { findCombinationViolation, findInvalidCombination } from './ruleValidation.js'

const blueHat = { id: 'hats/blue', category: 'Hats', name: 'Blue' }
const redShirt = { id: 'shirts/red', category: 'Shirts', name: 'Red' }
const noShirt = { id: 'shirts/none', category: 'Shirts', name: 'None', isNone: true }

test('blocks a selected trait from appearing with any trait in a conflicting folder', () => {
  const rules = { traitCategoryConflicts: [{ trait: blueHat.id, category: 'Shirts' }] }

  assert.match(findCombinationViolation([blueHat, redShirt], rules), /cannot appear with the Shirts folder/)
  assert.deepEqual(findInvalidCombination([[blueHat, redShirt]], rules), {
    index: 0,
    reason: 'Hats / Blue cannot appear with the Shirts folder.',
  })
})

test('allows a conflicting folder to be empty beside the selected trait', () => {
  const rules = { traitCategoryConflicts: [{ trait: blueHat.id, category: 'Shirts' }] }

  assert.equal(findCombinationViolation([blueHat, noShirt], rules), '')
})

test('allows the folder when a different trait is selected', () => {
  const greenHat = { id: 'hats/green', category: 'Hats', name: 'Green' }
  const rules = { traitCategoryConflicts: [{ trait: blueHat.id, category: 'Shirts' }] }

  assert.equal(findCombinationViolation([greenHat, redShirt], rules), '')
})
