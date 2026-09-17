import test from 'node:test'
import assert from 'node:assert/strict'
import { matchBackupCategory, matchBackupTraits, restoreRenderOrder } from './projectBackup.js'

test('restores the saved render order and appends newly imported folders', () => {
  const currentBackground = { name: 'Background' }
  const currentBody = { name: 'Body' }
  const currentEyes = { name: 'Eyes' }
  const newAccessory = { name: 'Accessory' }
  const restoredBackground = { name: 'Background restored' }
  const restoredBody = { name: 'Body restored' }
  const restoredEyes = { name: 'Eyes restored' }

  const restoredByCurrent = new Map([
    [currentBackground, restoredBackground],
    [currentBody, restoredBody],
    [currentEyes, restoredEyes],
  ])

  const result = restoreRenderOrder(
    [currentEyes, newAccessory, currentBackground, currentBody],
    [restoredBackground, restoredBody, restoredEyes],
    restoredByCurrent,
  )

  assert.deepEqual(result, [restoredBackground, restoredBody, restoredEyes, newAccessory])
})

test('matches backed-up traits by filename when a new trait is inserted in the middle', () => {
  const currentTraits = [
    { id: 'new-path/alpha', originalName: 'Alpha.png' },
    { id: 'new-path/bonus', originalName: 'Bonus.png' },
    { id: 'new-path/beta', originalName: 'Beta.png' },
    { id: 'new-path/gamma', originalName: 'Gamma.png' },
  ]
  const backupTraits = [
    { id: 'old-path/alpha', originalName: 'Alpha.png', name: 'Alpha custom' },
    { id: 'old-path/beta', originalName: 'Beta.png', name: 'Beta custom' },
    { id: 'old-path/gamma', originalName: 'Gamma.png', name: 'Gamma custom' },
  ]

  const result = matchBackupTraits(currentTraits, backupTraits)

  assert.deepEqual(result.matches.map((trait) => trait.originalName), ['Alpha.png', 'Beta.png', 'Gamma.png'])
  assert.deepEqual(result.extras.map((trait) => trait.originalName), ['Bonus.png'])
})

test('matches a backed-up folder by identity instead of its old array index', () => {
  const extra = { name: 'Accessories', traits: [{ id: 'accessories/new.png', originalName: 'New.png' }] }
  const eyes = { name: 'Eyes', traits: [{ id: 'new-root/eyes/blue.png', originalName: 'Blue.png' }] }
  const backupEyes = {
    categoryIndex: 0,
    name: 'Eyes',
    traits: [{ id: 'old-root/eyes/blue.png', originalName: 'Blue.png' }],
  }

  assert.equal(matchBackupCategory([extra, eyes], backupEyes), eyes)
})

test('refuses to shift backup data onto a missing trait', () => {
  const currentTraits = [
    { id: 'alpha', originalName: 'Alpha.png' },
    { id: 'new-extra', originalName: 'Extra.png' },
  ]
  const backupTraits = [
    { id: 'old-alpha', originalName: 'Alpha.png' },
    { id: 'old-beta', originalName: 'Beta.png' },
  ]

  assert.throws(
    () => matchBackupTraits(currentTraits, backupTraits),
    /Could not safely match 1 backed-up trait: Beta\.png/,
  )
})

test('refuses an ambiguous filename instead of assigning names by order', () => {
  const currentTraits = [
    { id: 'first-copy', originalName: 'Same.png' },
    { id: 'second-copy', originalName: 'Same.png' },
  ]
  const backupTraits = [{ id: 'old-copy', originalName: 'Same.png' }]

  assert.throws(
    () => matchBackupTraits(currentTraits, backupTraits),
    /Could not safely match 1 backed-up trait: Same\.png/,
  )
})
