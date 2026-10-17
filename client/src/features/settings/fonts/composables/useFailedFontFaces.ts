import { onMounted, onUnmounted, ref } from 'vue'
import { FONT_CSS_FAMILY_PREFIXES } from '@bookorbit/types'

/**
 * CSS family names of uploaded fonts this browser refused to load. A file can pass the server's checks
 * and still be rejected by the browser's font sanitizer (some system fonts carry tables it will not
 * accept), and then every reader silently gets a fallback face instead.
 */
export function useFailedFontFaces() {
  const failed = ref(new Set<string>())

  function collect() {
    if (typeof document === 'undefined' || !document.fonts) return
    const next = new Set<string>()
    document.fonts.forEach((face) => {
      const family = face.family.replace(/^["']|["']$/g, '')
      if (face.status === 'error' && Object.values(FONT_CSS_FAMILY_PREFIXES).some((prefix) => family.startsWith(prefix))) next.add(family)
    })
    if (next.size !== failed.value.size || [...next].some((family) => !failed.value.has(family))) failed.value = next
  }

  onMounted(() => {
    document.fonts?.addEventListener('loadingerror', collect)
    document.fonts?.addEventListener('loadingdone', collect)
    collect()
  })
  onUnmounted(() => {
    document.fonts?.removeEventListener('loadingerror', collect)
    document.fonts?.removeEventListener('loadingdone', collect)
  })

  return { failed, collect }
}
