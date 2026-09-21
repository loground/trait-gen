export function mergePsdSources(sources) {
  if (!sources.length) throw new Error('Choose at least one PSD file.')

  const [first] = sources
  const categories = []
  const byName = new Map()
  const usedIds = new Set()
  let baseLayers = []

  for (const source of sources) {
    if (source.width !== first.width || source.height !== first.height) {
      throw new Error(`${source.name} is ${source.width} × ${source.height}px, but ${first.name} is ${first.width} × ${first.height}px. PSD canvases must match to merge.`)
    }
    if (!baseLayers.length && source.baseLayers?.length) baseLayers = source.baseLayers

    for (const category of source.categories || []) {
      let target = byName.get(category.name)
      if (!target) {
        target = { ...category, traits: [] }
        byName.set(category.name, target)
        categories.push(target)
      }
      for (const trait of category.traits) {
        const originalId = trait.id
        let id = originalId
        let suffix = 2
        while (usedIds.has(id)) id = `${originalId}#${suffix++}`
        usedIds.add(id)
        target.traits.push(id === originalId ? trait : { ...trait, id })
      }
    }
  }

  if (!categories.length) {
    throw new Error('No trait folders found. Put traits inside root-level PSD groups.')
  }

  return {
    ...first,
    name: sources.map((source) => source.name).join(' + '),
    baseLayers,
    categories,
  }
}
