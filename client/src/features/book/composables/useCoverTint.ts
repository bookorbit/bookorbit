import { ref, watch, type Ref } from 'vue'
import { extractCoverTint, type CoverTint } from '../lib/cover-tint'

// Covers are immutable per URL (the URL carries a version token), so a decoded
// result stays valid; revisiting a book costs nothing.
const cache = new Map<string, CoverTint | null>()

export function useCoverTint(src: Ref<string | null>) {
  const tint = ref<CoverTint | null>(null)
  let requestId = 0

  function load(url: string | null) {
    const current = ++requestId
    if (!url) {
      tint.value = null
      return
    }

    const cached = cache.get(url)
    if (cached !== undefined) {
      tint.value = cached
      return
    }

    // The cover is already displayed on this page, so this resolves from the
    // browser cache rather than issuing a second request.
    const image = new Image()
    image.decoding = 'async'
    image.addEventListener(
      'load',
      () => {
        const extracted = extractCoverTint(image)
        cache.set(url, extracted)
        if (current === requestId) tint.value = extracted
      },
      { once: true },
    )
    image.addEventListener(
      'error',
      () => {
        cache.set(url, null)
        if (current === requestId) tint.value = null
      },
      { once: true },
    )
    image.src = url
  }

  watch(src, load, { immediate: true })

  return { tint }
}
