export function restoreRenderOrder(sourceCategories, restoredCategoriesInBackupOrder, restoredCategoryByCurrentCategory) {
  return [
    ...restoredCategoriesInBackupOrder,
    ...sourceCategories.filter((category) => !restoredCategoryByCurrentCategory.has(category)),
  ]
}
