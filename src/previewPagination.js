export const PREVIEW_BATCH_SIZE = 16

export function selectPreviewPage(combinations, offset) {
  const page = combinations.slice(offset, offset + PREVIEW_BATCH_SIZE)
  return {
    page,
    hasMore: combinations.length > offset + page.length,
  }
}

export function selectGifFrameIndexes(previewCount, frameCount, generationCount) {
  if (previewCount < frameCount || frameCount < 1) return []
  return Array.from({ length: frameCount }, (_, index) => (
    (generationCount * frameCount + index) % previewCount
  ))
}
