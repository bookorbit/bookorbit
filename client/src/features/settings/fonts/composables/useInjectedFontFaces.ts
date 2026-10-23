import { onUnmounted, watch, type WatchSource } from 'vue'

/**
 * Uploaded fonts are not part of the app's own CSS, so a page that shows them injects their
 * @font-face rules for names and specimens to render in their own faces, and removes them on leave.
 */
export function useInjectedFontFaces(source: WatchSource, css: () => string, marker: string) {
  let style: HTMLStyleElement | null = null

  watch(
    source,
    () => {
      const text = css()
      if (!style) {
        if (!text) return
        style = document.createElement('style')
        style.setAttribute(marker, '')
        document.head.appendChild(style)
      }
      style.textContent = text
    },
    { immediate: true, deep: false },
  )

  onUnmounted(() => {
    style?.remove()
    style = null
  })
}
