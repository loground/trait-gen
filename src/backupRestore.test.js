import test from 'node:test'
import assert from 'node:assert/strict'
import { orderRestoredCategories, resolveRestoredTraitId } from './backupRestore.js'

test('restores categories in backup order instead of source-file order', () => {
  const hats = { name: 'Hats' }
  const body = { name: 'Body' }
  const background = { name: 'Background' }
  const backup = [
    { categoryIndex: 0, name: 'Background' },
    { categoryIndex: 1, name: 'Body' },
    { categoryIndex: 2, name: 'Hats' },
  ]
  const restoredByBackupIndex = new Map([[0, background], [1, body], [2, hats]])

  assert.deepEqual(orderRestoredCategories(backup, restoredByBackupIndex), [background, body, hats])
})

test('uses a saved trait location before an ambiguous trait id when restoring rules', () => {
  const idByBackupId = new Map([['duplicate-id', 'wrong-trait']])
  const idByBackupLocation = new Map([['0:1', 'correct-trait'], ['2:1', 'wrong-trait']])

  assert.equal(
    resolveRestoredTraitId('duplicate-id', [{ categoryIndex: 0, traitIndex: 1 }], idByBackupId, idByBackupLocation),
    'correct-trait',
  )
})

test('keeps compatibility with backups that only contain trait ids', () => {
  assert.equal(
    resolveRestoredTraitId('saved-id', undefined, new Map([['saved-id', 'restored-id']]), new Map()),
    'restored-id',
  )
})
