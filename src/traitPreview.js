export function togglePreviewTraitKeys(selectedKeys, traitKey, categoryTraitKeys) {
  if (selectedKeys.includes(traitKey)) {
    return selectedKeys.filter((key) => key !== traitKey)
  }

  const categoryKeys = new Set(categoryTraitKeys)
  return [...selectedKeys.filter((key) => !categoryKeys.has(key)), traitKey]
}
