import { computed, getCurrentInstance, onUnmounted, ref } from 'vue'
import { api } from '@/lib/api'
import type { UserFont, FontFormat, FontUploadResult } from '@bookorbit/types'
import { FONT_FORMAT_CSS_FORMAT, fontCssFamilyGroupName } from '@bookorbit/types'

const ACCEPTED_EXTENSIONS = '.ttf,.otf,.woff,.woff2'

export interface FontFamily {
  name: string
  cssFamilyName: string
  variants: UserFont[]
}

export function useCustomFonts() {
  const fonts = ref<UserFont[]>([])
  const loading = ref(false)
  const uploading = ref(false)
  const fontBlobUrls = new Map<number, string>()
  let requestedCssFamily: string | null = null

  function revokeFontBlobUrl(fontId: number) {
    const url = fontBlobUrls.get(fontId)
    if (url) {
      URL.revokeObjectURL(url)
      fontBlobUrls.delete(fontId)
    }
  }

  async function cacheFontBlobUrl(fontId: number): Promise<void> {
    try {
      const res = await api(`/api/v1/fonts/${fontId}/file`)
      if (!res.ok) return
      const blob = await res.blob()
      revokeFontBlobUrl(fontId)
      fontBlobUrls.set(fontId, URL.createObjectURL(blob))
    } catch {
      // Font will fall back to API URL in CSS
    }
  }

  async function fetchFonts() {
    loading.value = true
    try {
      const res = await api('/api/v1/fonts')
      if (res.ok) {
        const newFonts: UserFont[] = await res.json()
        const newFontIds = new Set(newFonts.map((f) => f.id))
        for (const id of fontBlobUrls.keys()) {
          if (!newFontIds.has(id)) revokeFontBlobUrl(id)
        }
        fonts.value = newFonts
      }
    } finally {
      loading.value = false
    }
  }

  function variantsOf(cssFamilyName: string | null): UserFont[] {
    if (!cssFamilyName) return []
    return fonts.value.filter((f) => fontCssFamilyGroupName(f.familyName) === cssFamilyName)
  }

  /** Releases every blob URL not belonging to the most recently requested family. */
  function revokeUnrequestedBlobUrls() {
    const keep = new Set(variantsOf(requestedCssFamily).map((f) => f.id))
    for (const id of fontBlobUrls.keys()) {
      if (!keep.has(id)) revokeFontBlobUrl(id)
    }
  }

  /**
   * Loads blob URLs for one family and releases every other family's.
   *
   * Individual fonts run to tens of megabytes, so holding a whole library of them in
   * memory is not viable. The reader renders one family at a time, and everywhere else
   * (settings previews) runs in the main document, where generateFontFaceCSS falls back
   * to the API URL and the browser fetches only what it actually renders.
   */
  async function ensureCssFamilyLoaded(cssFamilyName: string | null): Promise<void> {
    requestedCssFamily = cssFamilyName
    revokeUnrequestedBlobUrls()

    const variants = variantsOf(cssFamilyName)
    await Promise.allSettled(variants.filter((f) => !fontBlobUrls.has(f.id)).map((f) => cacheFontBlobUrl(f.id)))

    // Switching families mid-download would otherwise leave the superseded family
    // resident, since its downloads land after the newer request already pruned.
    revokeUnrequestedBlobUrls()
  }

  async function uploadFont(file: File): Promise<FontUploadResult | null> {
    uploading.value = true
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api('/api/v1/fonts/upload', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }))
        throw new Error(err.message || 'Upload failed')
      }
      const result: FontUploadResult = await res.json()
      fonts.value = [...fonts.value, result.font]
      return result
    } finally {
      uploading.value = false
    }
  }

  async function updateFont(fontId: number, data: { familyName?: string; weight?: number; style?: 'normal' | 'italic' }): Promise<UserFont | null> {
    const res = await api(`/api/v1/fonts/${fontId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null
    const updated: UserFont = await res.json()
    fonts.value = fonts.value.map((f) => (f.id === fontId ? updated : f))
    return updated
  }

  async function deleteFont(fontId: number): Promise<boolean> {
    const res = await api(`/api/v1/fonts/${fontId}`, { method: 'DELETE' })
    if (!res.ok) return false
    revokeFontBlobUrl(fontId)
    fonts.value = fonts.value.filter((f) => f.id !== fontId)
    return true
  }

  const families = computed<FontFamily[]>(() => {
    const map = new Map<string, UserFont[]>()
    for (const font of fonts.value) {
      const existing = map.get(font.familyName)
      if (existing) {
        existing.push(font)
      } else {
        map.set(font.familyName, [font])
      }
    }
    return Array.from(map.entries()).map(([name, variants]) => ({
      name,
      cssFamilyName: fontCssFamilyGroupName(name),
      variants,
    }))
  })

  /**
   * Generates @font-face CSS where all variants of a family share one CSS
   * font-family name (differentiated by font-weight/font-style). This lets the
   * browser automatically pick bold/italic variants. Prefers a blob URL when the
   * family has been loaded via ensureCssFamilyLoaded, since the reader iframe cannot
   * send auth headers in CSS url(); elsewhere the API URL authenticates by cookie.
   */
  function generateFontFaceCSS(): string {
    if (fonts.value.length === 0) return ''
    return fonts.value
      .map((f) => {
        const cssFormat = FONT_FORMAT_CSS_FORMAT[f.format as FontFormat]
        const src = fontBlobUrls.get(f.id) ?? `/api/v1/fonts/${f.id}/file`
        return `@font-face {
  font-family: "${fontCssFamilyGroupName(f.familyName)}";
  src: url("${src}") format("${cssFormat}");
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: swap;
}`
      })
      .join('\n')
  }

  function isFontFamilySelected(familyName: string, currentFontFamily: string | null): boolean {
    if (!currentFontFamily) return false
    return currentFontFamily === fontCssFamilyGroupName(familyName)
  }

  function getCssFamilyForDisplay(familyName: string): string | null {
    const exists = fonts.value.some((f) => f.familyName === familyName)
    return exists ? fontCssFamilyGroupName(familyName) : null
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      for (const url of fontBlobUrls.values()) URL.revokeObjectURL(url)
      fontBlobUrls.clear()
    })
  }

  return {
    fonts,
    families,
    loading,
    uploading,
    fetchFonts,
    ensureCssFamilyLoaded,
    uploadFont,
    updateFont,
    deleteFont,
    generateFontFaceCSS,
    isFontFamilySelected,
    getCssFamilyForDisplay,
    ACCEPTED_EXTENSIONS,
  }
}
