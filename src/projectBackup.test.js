import test from 'node:test'
import assert from 'node:assert/strict'
import { restoreRenderOrder } from './projectBackup.js'

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
