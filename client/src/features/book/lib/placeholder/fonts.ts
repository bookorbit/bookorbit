import { ref } from 'vue'
import { clearMeasureCache } from './typeset'

/** Bumps whenever a webfont finishes loading, since layouts measured against a fallback face are wrong. */
export const placeholderFontsVersion = ref(0)

const FACES = ['800 16px "Inter Variable"', '600 16px "Fraunces Variable"', 'italic 400 16px "Fraunces Variable"']
let watching = false

export function watchPlaceholderFonts(): void {
  if (watching || typeof document === 'undefined' || !document.fonts) return
  watching = true
  const refresh = () => {
    clearMeasureCache()
    placeholderFontsVersion.value++
  }
  void Promise.allSettled(FACES.map((face) => document.fonts.load(face))).then(refresh)
  document.fonts.addEventListener('loadingdone', refresh)
}
