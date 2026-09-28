import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAiBackup, describeRuleChanges, validateBackupRules } from './aiBackup.js'

const source = {
  categories: [
    { name: 'Hair', traits: [{ id: 'hair-long', name: 'Long Hair' }] },
    { name: 'Hats', traits: [{ id: 'hat-red', name: 'Red Hat' }] },
  ],
  incompatibilities: [{ first: 'hair-long', second: 'hat-red' }],
}

test('AI export preserves the restorable backup and its original rules', () => {
  const original = { version: 1, source, project: { name: 'Example' } }
  const result = JSON.parse(JSON.stringify(buildAiBackup(original)))
  const { aiInstructions, ...restorable } = result
  assert.deepEqual(restorable, original)
  assert.ok(aiInstructions.rules.categoryRequirements.meaning.includes('earlier'))
  assert.equal(original.aiInstructions, undefined)
  assert.doesNotThrow(() => validateBackupRules(result.source))
})

test('accepts legacy backups with omitted rule arrays and optional position values', () => {
  assert.doesNotThrow(() => validateBackupRules({ ...source, positionRules: [{ first: 'hair-long', second: 'hat-red' }] }))
})

test('rejects malformed arrays, unknown references, and invalid position values', () => {
  assert.throws(() => validateBackupRules({ ...source, incompatibilities: null }), /must be an array/)
  assert.throws(() => validateBackupRules({ ...source, incompatibilities: [null] }), /missing a required/)
  assert.throws(() => validateBackupRules({ ...source, incompatibilities: [{ first: 'invented', second: 'hat-red' }] }), /unknown trait/)
  assert.throws(() => validateBackupRules({ ...source, categoryConflicts: [{ first: 'Hair', second: 'Missing' }] }), /unknown folder/)
  for (const firstScale of [0, 301, '100', null]) {
    assert.throws(() => validateBackupRules({ ...source, positionRules: [{ first: 'hair-long', second: 'hat-red', firstScale }] }), /invalid firstScale/)
  }
})

test('review identifies edits even when the number of rules stays the same', () => {
  const next = { ...source, incompatibilities: [{ first: 'hat-red', second: 'hair-long' }] }
  assert.match(describeRuleChanges(source, next), /incompatibilities: 1 → 1 \(changed\)/)
  assert.match(describeRuleChanges(source, next), /positionRules: 0 → 0 \(unchanged\)/)
})
