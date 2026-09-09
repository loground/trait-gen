import assert from 'node:assert/strict'
import test from 'node:test'
import { planFolderCategories } from './folderImport.js'

function file(path) {
  return { name: path.split('/').at(-1), webkitRelativePath: path }
}

test('uses image-containing leaf directories as categories in nested uploads', () => {
  const plan = planFolderCategories([
    file('omni-g assets/1 extra/1 item/1.png'),
    file('omni-g assets/1 extra/1 item/2.png'),
    file('omni-g assets/1 extra/2 effects/1.png'),
    file('omni-g assets/2 base/3 eyes/1.png'),
    file('omni-g assets/3 back/1.png'),
  ])

  assert.deepEqual(plan.map((item) => item.categoryLabel), [
    '1 item',
    '1 item',
    '2 effects',
    '3 eyes',
    '3 back',
  ])
})

test('keeps same-named leaf directories separate by showing their parent paths', () => {
  const plan = planFolderCategories([
    file('collection/adults/hats/blue.png'),
    file('collection/kids/hats/red.png'),
  ])

  assert.deepEqual(plan.map((item) => item.categoryLabel), [
    'adults / hats',
    'kids / hats',
  ])
})

test('supports several top-level folders supplied in one drop', () => {
  const plan = planFolderCategories([
    { name: 'blue.png', droppedRelativePath: 'Hats/blue.png' },
    { name: 'laser.png', droppedRelativePath: 'Eyes/laser.png' },
  ])

  assert.deepEqual(plan.map((item) => item.categoryLabel), ['Hats', 'Eyes'])
})
