const MAX_CACHED_COVER_URLS = 5000

const loadedCoverRatios = new Map<string, number | null>()

export function rememberLoadedCover(src: string | null, ratio: number | null) {
  if (!src) return
  if (loadedCoverRatios.size >= MAX_CACHED_COVER_URLS) loadedCoverRatios.clear()
  loadedCoverRatios.set(src, ratio)
}

export function getCachedCoverRatio(src: string | null): { ratio: number | null } | null {
  if (!src) return null
  if (!loadedCoverRatios.has(src)) return null
  return { ratio: loadedCoverRatios.get(src) ?? null }
}

export function clearCoverLoadCache() {
  loadedCoverRatios.clear()
}
