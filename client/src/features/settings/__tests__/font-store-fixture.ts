import { computed, ref } from 'vue'
import { vi } from 'vitest'
import type { FontScope, UserFont } from '@bookorbit/types'
import { fontCssFamilyGroupName, maxFontsForScope } from '@bookorbit/types'

export function mockFont(id: number, familyName: string, weight = 400, style: 'normal' | 'italic' = 'normal'): UserFont {
  return {
    id,
    familyName,
    originalFileName: `${familyName}-${weight}.ttf`,
    format: 'ttf',
    weight,
    style,
    fileSize: 50000,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Stands in for one scope's slice of useCustomFonts, with the same reactive shape. */
export function makeFontStore(scope: FontScope, initialFonts: UserFont[] = []) {
  const fonts = ref<UserFont[]>(initialFonts)
  const loading = ref(false)
  const uploading = ref(false)

  const families = computed(() => {
    const map = new Map<string, UserFont[]>()
    for (const f of fonts.value) {
      const arr = map.get(f.familyName) ?? []
      arr.push(f)
      map.set(f.familyName, arr)
    }
    return Array.from(map.entries()).map(([name, variants]) => ({
      name,
      cssFamilyName: fontCssFamilyGroupName(name, scope),
      scope,
      variants,
    }))
  })

  return {
    scope,
    fonts,
    families,
    loading,
    uploading,
    maxFonts: maxFontsForScope(scope),
    fetchFonts: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    uploadFont: vi.fn<(file: File) => Promise<unknown>>(),
    updateFont: vi.fn<(id: number, data: object) => Promise<UserFont | null>>(),
    deleteFont: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    setFonts: vi.fn<(list: UserFont[]) => void>((list: UserFont[]) => {
      fonts.value = list
    }),
    generateFontFaceCSS: vi.fn<() => string>().mockReturnValue(''),
  }
}

export type MockFontStore = ReturnType<typeof makeFontStore>

/**
 * Stands in for useCustomFonts(). Any scope not supplied gets an empty store, so a spec
 * only has to build the collection it actually exercises.
 */
export function makeCustomFontsMock(stores: { user?: MockFontStore; server?: MockFontStore } = {}) {
  const user = stores.user ?? makeFontStore('user')
  const server = stores.server ?? makeFontStore('server')

  const hiddenServerFamilies = ref<string[]>([])
  const isServerFamilyHidden = (familyName: string) => hiddenServerFamilies.value.includes(familyName)
  const visibleServerFamilies = computed(() => server.families.value.filter((family) => !isServerFamilyHidden(family.name)))

  return {
    fonts: user.fonts,
    serverFonts: server.fonts,
    families: user.families,
    serverFamilies: server.families,
    visibleServerFamilies,
    hiddenServerFamilies,
    loading: user.loading,
    serverLoading: server.loading,
    uploading: user.uploading,
    serverUploading: server.uploading,
    fetchFonts: user.fetchFonts,
    fetchServerFonts: server.fetchFonts,
    fetchServerFontVisibility: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fetchAllFonts: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    isServerFamilyHidden,
    setServerFamilyHidden: vi.fn<(familyName: string, hidden: boolean) => Promise<boolean>>(async (familyName, hidden) => {
      hiddenServerFamilies.value = hidden
        ? [...new Set([...hiddenServerFamilies.value, familyName])]
        : hiddenServerFamilies.value.filter((name) => name !== familyName)
      return true
    }),
    generateFontFaceCSS: vi.fn<() => string>().mockReturnValue(''),
    scopeStore: vi.fn<(scope: FontScope) => MockFontStore>((scope: FontScope) => (scope === 'server' ? server : user)),
  }
}
