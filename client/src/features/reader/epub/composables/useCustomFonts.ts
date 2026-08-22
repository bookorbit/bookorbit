import { computed, getCurrentInstance, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import { api } from '@/lib/api'
import type { UserFont, FontFormat, FontScope, FontUploadResult, ServerFontPreferences } from '@bookorbit/types'
import { FONT_FORMAT_CSS_FORMAT, fontCssFamilyGroupName, fontScopeFromCssFamily, isVariableFont, maxFontsForScope } from '@bookorbit/types'

const ACCEPTED_EXTENSIONS = '.ttf,.otf,.woff,.woff2'

const ENDPOINTS: Record<FontScope, string> = {
  user: '/api/v1/fonts',
  server: '/api/v1/server-fonts',
}

const SERVER_FONT_PREFERENCES_ENDPOINT = '/api/v1/user-preferences/server-fonts'

export interface FontFamily {
  name: string
  cssFamilyName: string
  scope: FontScope
  variants: UserFont[]
}

/** A font paired with the collection it came from, since ids are only unique per scope. */
interface ScopedFont {
  scope: FontScope
  font: UserFont
}

/** Everything a font management screen needs for one collection. */
export interface FontScopeStore {
  scope: FontScope
  fonts: Ref<UserFont[]>
  families: ComputedRef<FontFamily[]>
  loading: Ref<boolean>
  uploading: Ref<boolean>
  maxFonts: number
  fetchFonts: () => Promise<void>
  uploadFont: (file: File) => Promise<FontUploadResult | null>
  updateFont: (fontId: number, data: FontUpdate) => Promise<UserFont | null>
  deleteFont: (fontId: number) => Promise<boolean>
  /** Replaces the list outright, for optimistic UI updates that may need rolling back. */
  setFonts: (list: UserFont[]) => void
  generateFontFaceCSS: () => string
}

export interface FontUpdate {
  familyName?: string
  weight?: number
  style?: 'normal' | 'italic'
}

export function useCustomFonts() {
  const fonts = ref<UserFont[]>([])
  const serverFonts = ref<UserFont[]>([])
  const loading = ref(false)
  const serverLoading = ref(false)
  const uploading = ref(false)
  const serverUploading = ref(false)
  const hiddenServerFamilies = ref<string[]>([])

  // Keyed by scope and id together: a user font and a server font can share an id.
  const fontBlobUrls = new Map<string, string>()
  let requestedCssFamily: string | null = null

  const listFor = (scope: FontScope): Ref<UserFont[]> => (scope === 'server' ? serverFonts : fonts)
  const loadingFor = (scope: FontScope): Ref<boolean> => (scope === 'server' ? serverLoading : loading)
  const uploadingFor = (scope: FontScope): Ref<boolean> => (scope === 'server' ? serverUploading : uploading)
  const blobKey = (scope: FontScope, fontId: number): string => `${scope}:${fontId}`

  function allScopedFonts(): ScopedFont[] {
    return [
      ...fonts.value.map((font) => ({ scope: 'user' as const, font })),
      ...serverFonts.value.map((font) => ({ scope: 'server' as const, font })),
    ]
  }

  function revokeFontBlobUrl(scope: FontScope, fontId: number) {
    const key = blobKey(scope, fontId)
    const url = fontBlobUrls.get(key)
    if (url) {
      URL.revokeObjectURL(url)
      fontBlobUrls.delete(key)
    }
  }

  async function cacheFontBlobUrl(scope: FontScope, fontId: number): Promise<void> {
    try {
      const res = await api(`${ENDPOINTS[scope]}/${fontId}/file`)
      if (!res.ok) return
      const blob = await res.blob()
      revokeFontBlobUrl(scope, fontId)
      fontBlobUrls.set(blobKey(scope, fontId), URL.createObjectURL(blob))
    } catch {
      // Font will fall back to API URL in CSS
    }
  }

  async function fetchScope(scope: FontScope): Promise<void> {
    const list = listFor(scope)
    const isLoading = loadingFor(scope)
    isLoading.value = true
    try {
      const res = await api(ENDPOINTS[scope])
      if (res.ok) {
        const newFonts: UserFont[] = await res.json()
        const newFontIds = new Set(newFonts.map((f) => f.id))
        for (const key of fontBlobUrls.keys()) {
          const [keyScope, keyId] = key.split(':')
          if (keyScope === scope && !newFontIds.has(Number(keyId))) revokeFontBlobUrl(scope, Number(keyId))
        }
        list.value = newFonts
      }
    } finally {
      isLoading.value = false
    }
  }

  const fetchFonts = () => fetchScope('user')
  const fetchServerFonts = () => fetchScope('server')

  /** Loads this reader's opt-outs from the server collection. */
  async function fetchServerFontVisibility(): Promise<void> {
    try {
      const res = await api(SERVER_FONT_PREFERENCES_ENDPOINT)
      if (!res.ok) return
      const body: { settings?: ServerFontPreferences } = await res.json()
      hiddenServerFamilies.value = body.settings?.hiddenFamilies ?? []
    } catch {
      // Preference is an opt-out; failing to read it just shows everything.
    }
  }

  /** Loads both collections plus the reader's opt-outs, for the font picker. */
  async function fetchAllFonts(): Promise<void> {
    await Promise.all([fetchFonts(), fetchServerFonts(), fetchServerFontVisibility()])
  }

  function isServerFamilyHidden(familyName: string): boolean {
    return hiddenServerFamilies.value.includes(familyName)
  }

  /**
   * Hides or restores one server family for this reader. Writes the whole list back,
   * matching how the other user-preference categories are persisted.
   */
  async function setServerFamilyHidden(familyName: string, hidden: boolean): Promise<boolean> {
    const previous = hiddenServerFamilies.value
    const next = hidden ? [...new Set([...previous, familyName])] : previous.filter((name) => name !== familyName)
    if (next.length === previous.length && hidden === previous.includes(familyName)) return true

    hiddenServerFamilies.value = next
    try {
      const res = await api(SERVER_FONT_PREFERENCES_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { hiddenFamilies: next } }),
      })
      if (!res.ok) {
        hiddenServerFamilies.value = previous
        return false
      }
      return true
    } catch {
      hiddenServerFamilies.value = previous
      return false
    }
  }

  function variantsOf(cssFamilyName: string | null): ScopedFont[] {
    const scope = fontScopeFromCssFamily(cssFamilyName)
    if (!scope || !cssFamilyName) return []
    return listFor(scope)
      .value.filter((f) => fontCssFamilyGroupName(f.familyName, scope) === cssFamilyName)
      .map((font) => ({ scope, font }))
  }

  /** Releases every blob URL not belonging to the most recently requested family. */
  function revokeUnrequestedBlobUrls() {
    const keep = new Set(variantsOf(requestedCssFamily).map(({ scope, font }) => blobKey(scope, font.id)))
    for (const key of fontBlobUrls.keys()) {
      if (!keep.has(key)) {
        const [keyScope, keyId] = key.split(':')
        revokeFontBlobUrl(keyScope as FontScope, Number(keyId))
      }
    }
  }

  /**
   * Loads blob URLs for one family and releases every other family's, across both
   * scopes: switching from a user font to a server font must not strand the old one.
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
    await Promise.allSettled(
      variants.filter(({ scope, font }) => !fontBlobUrls.has(blobKey(scope, font.id))).map(({ scope, font }) => cacheFontBlobUrl(scope, font.id)),
    )

    // Switching families mid-download would otherwise leave the superseded family
    // resident, since its downloads land after the newer request already pruned.
    revokeUnrequestedBlobUrls()
  }

  async function uploadToScope(scope: FontScope, file: File): Promise<FontUploadResult | null> {
    const isUploading = uploadingFor(scope)
    isUploading.value = true
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await api(`${ENDPOINTS[scope]}/upload`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: 'Upload failed' }))
        throw new Error(err.message || 'Upload failed')
      }
      const result: FontUploadResult = await res.json()
      const list = listFor(scope)
      list.value = [...list.value, result.font]
      return result
    } finally {
      isUploading.value = false
    }
  }

  async function updateInScope(scope: FontScope, fontId: number, data: FontUpdate): Promise<UserFont | null> {
    const res = await api(`${ENDPOINTS[scope]}/${fontId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null
    const updated: UserFont = await res.json()
    const list = listFor(scope)
    list.value = list.value.map((f) => (f.id === fontId ? updated : f))
    return updated
  }

  async function deleteFromScope(scope: FontScope, fontId: number): Promise<boolean> {
    const res = await api(`${ENDPOINTS[scope]}/${fontId}`, { method: 'DELETE' })
    if (!res.ok) return false
    revokeFontBlobUrl(scope, fontId)
    const list = listFor(scope)
    list.value = list.value.filter((f) => f.id !== fontId)
    return true
  }

  const uploadFont = (file: File) => uploadToScope('user', file)
  const updateFont = (fontId: number, data: FontUpdate) => updateInScope('user', fontId, data)
  const deleteFont = (fontId: number) => deleteFromScope('user', fontId)
  const uploadServerFont = (file: File) => uploadToScope('server', file)
  const updateServerFont = (fontId: number, data: FontUpdate) => updateInScope('server', fontId, data)
  const deleteServerFont = (fontId: number) => deleteFromScope('server', fontId)

  function groupIntoFamilies(list: UserFont[], scope: FontScope): FontFamily[] {
    const map = new Map<string, UserFont[]>()
    for (const font of list) {
      const existing = map.get(font.familyName)
      if (existing) {
        existing.push(font)
      } else {
        map.set(font.familyName, [font])
      }
    }
    return Array.from(map.entries()).map(([name, variants]) => ({
      name,
      cssFamilyName: fontCssFamilyGroupName(name, scope),
      scope,
      variants,
    }))
  }

  const families = computed<FontFamily[]>(() => groupIntoFamilies(fonts.value, 'user'))

  /** Every server family, including hidden ones. Drives the opt-out list in settings. */
  const serverFamilies = computed<FontFamily[]>(() => groupIntoFamilies(serverFonts.value, 'server'))

  /** The server families this reader has kept. Drives every font picker. */
  const visibleServerFamilies = computed<FontFamily[]>(() => serverFamilies.value.filter((family) => !isServerFamilyHidden(family.name)))

  function fontFaceRules({ scope, font }: ScopedFont): string {
    const cssFormat = FONT_FORMAT_CSS_FORMAT[font.format as FontFormat]
    const src = fontBlobUrls.get(blobKey(scope, font.id)) ?? `${ENDPOINTS[scope]}/${font.id}/file`
    // A variable font declares the span of its weight axis, which is what tells the
    // browser to interpolate a real face for every weight in it rather than synthesising
    // one from the default instance.
    const weight = isVariableFont(font) ? `${font.weightMin} ${font.weightMax}` : `${font.weight}`
    const styles = new Set([font.style, ...(isVariableFont(font) ? (font.instances ?? []).map((instance) => instance.style) : [])])
    return [...styles]
      .map(
        (style) => `@font-face {
  font-family: "${fontCssFamilyGroupName(font.familyName, scope)}";
  src: url("${src}") format("${cssFormat}");
  font-weight: ${weight};
  font-style: ${style};
  font-display: swap;
}`,
      )
      .join('\n')
  }

  /**
   * Generates @font-face CSS where all variants of a family share one CSS
   * font-family name (differentiated by font-weight/font-style). This lets the
   * browser automatically pick bold/italic variants. Prefers a blob URL when the
   * family has been loaded via ensureCssFamilyLoaded, since the reader iframe cannot
   * send auth headers in CSS url(); elsewhere the API URL authenticates by cookie.
   *
   * Scoped prefixes keep a user font and a server font of the same name apart, so
   * neither overrides the other.
   */
  function generateFontFaceCSS(): string {
    return allScopedFonts().map(fontFaceRules).join('\n')
  }

  function generateScopeFontFaceCSS(scope: FontScope): string {
    return listFor(scope)
      .value.map((font) => fontFaceRules({ scope, font }))
      .join('\n')
  }

  function isFontFamilySelected(familyName: string, currentFontFamily: string | null, scope: FontScope = 'user'): boolean {
    if (!currentFontFamily) return false
    return currentFontFamily === fontCssFamilyGroupName(familyName, scope)
  }

  function getCssFamilyForDisplay(familyName: string, scope: FontScope = 'user'): string | null {
    const exists = listFor(scope).value.some((f) => f.familyName === familyName)
    return exists ? fontCssFamilyGroupName(familyName, scope) : null
  }

  /** True when the given CSS family still resolves to an installed font in either scope. */
  function cssFamilyExists(cssFamilyName: string | null): boolean {
    return variantsOf(cssFamilyName).length > 0
  }

  /**
   * True when the family is installed and this reader has not hidden it. Saved selections
   * are checked against this, so hiding a family also clears it as a saved default.
   */
  function cssFamilyAvailable(cssFamilyName: string | null): boolean {
    if (!cssFamilyExists(cssFamilyName)) return false
    if (fontScopeFromCssFamily(cssFamilyName) !== 'server') return true
    return visibleServerFamilies.value.some((family) => family.cssFamilyName === cssFamilyName)
  }

  function scopeStore(scope: FontScope): FontScopeStore {
    return {
      scope,
      fonts: listFor(scope),
      families: scope === 'server' ? serverFamilies : families,
      loading: loadingFor(scope),
      uploading: uploadingFor(scope),
      maxFonts: maxFontsForScope(scope),
      fetchFonts: () => fetchScope(scope),
      uploadFont: (file: File) => uploadToScope(scope, file),
      updateFont: (fontId: number, data: FontUpdate) => updateInScope(scope, fontId, data),
      deleteFont: (fontId: number) => deleteFromScope(scope, fontId),
      setFonts: (list: UserFont[]) => {
        listFor(scope).value = list
      },
      generateFontFaceCSS: () => generateScopeFontFaceCSS(scope),
    }
  }

  if (getCurrentInstance()) {
    onUnmounted(() => {
      for (const url of fontBlobUrls.values()) URL.revokeObjectURL(url)
      fontBlobUrls.clear()
    })
  }

  return {
    fonts,
    serverFonts,
    families,
    serverFamilies,
    visibleServerFamilies,
    hiddenServerFamilies,
    loading,
    serverLoading,
    uploading,
    serverUploading,
    fetchFonts,
    fetchServerFonts,
    fetchServerFontVisibility,
    fetchAllFonts,
    isServerFamilyHidden,
    setServerFamilyHidden,
    ensureCssFamilyLoaded,
    uploadFont,
    updateFont,
    deleteFont,
    uploadServerFont,
    updateServerFont,
    deleteServerFont,
    generateFontFaceCSS,
    isFontFamilySelected,
    getCssFamilyForDisplay,
    cssFamilyExists,
    cssFamilyAvailable,
    scopeStore,
    ACCEPTED_EXTENSIONS,
  }
}
