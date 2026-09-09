import assert from 'node:assert/strict'
import test from 'node:test'

import { findCombinationViolation } from './ruleValidation.js'

const hat = { id: 'Hats::Crown', category: 'Hats', name: 'Crown' }
const laserEyes = { id: 'Eyes::Laser', category: 'Eyes', name: 'Laser' }
const smile = { id: 'Mouth::Smile', category: 'Mouth', name: 'Smile' }

test('an item-to-folder rule blocks every item from the selected folder', () => {
  const rules = { traitCategoryConflicts: [{ trait: laserEyes.id, category: 'Hats' }] }

  assert.match(findCombinationViolation([hat, laserEyes], rules), /Hats cannot appear/)
  assert.match(findCombinationViolation([laserEyes, hat], rules), /Hats cannot appear/)
})

test('an item-to-folder rule allows unrelated folders', () => {
  const rules = { traitCategoryConflicts: [{ trait: laserEyes.id, category: 'Hats' }] }

  assert.equal(findCombinationViolation([laserEyes, smile], rules), '')
})

test('a none choice in the blocked folder is allowed', () => {
  const none = { id: 'Hats::__none__', category: 'Hats', name: 'None', isNone: true }
  const rules = { traitCategoryConflicts: [{ trait: laserEyes.id, category: 'Hats' }] }

  assert.equal(findCombinationViolation([laserEyes, none], rules), '')
})

test('a can-only-appear-with rule requires at least one selected companion', () => {
  const rules = { traitRequirements: [{ trait: laserEyes.id, requiredTraits: [hat.id, smile.id] }] }

  assert.match(findCombinationViolation([laserEyes], rules), /can only appear with/)
  assert.equal(findCombinationViolation([laserEyes, hat], rules), '')
  assert.equal(findCombinationViolation([laserEyes, smile], rules), '')
})

test('a can-only-appear-with rule does not affect combinations without its trigger', () => {
  const rules = { traitRequirements: [{ trait: laserEyes.id, requiredTraits: [hat.id] }] }

  assert.equal(findCombinationViolation([smile], rules), '')
})
