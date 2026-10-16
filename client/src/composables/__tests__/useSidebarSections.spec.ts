import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { computed, reactive, ref } from 'vue'
import type { LibraryType } from '@bookorbit/types'
import { useSidebarSections } from '../useSidebarSections'

type Reorder = (order: { id: number; displayOrder: number }[]) => Promise<void>

interface Row {
  id: number
  displayOrder: number
  name: string
  type?: string
  mediaType?: 'books' | 'podcasts'
  isOwner?: boolean
}

const mocks = vi.hoisted(() => ({
  features: { podcasts: true },
  permissions: new Set<string>(),
  activityFor: () => null,
  reorderLibraries: undefined as unknown as Mock<Reorder>,
  reorderSmartScopes: undefined as unknown as Mock<Reorder>,
  reorderCollections: undefined as unknown as Mock<Reorder>,
}))

const route = reactive<{ name: string; params: Record<string, string> }>({ name: 'dashboard', params: {} })
const mode = ref<LibraryType>('books')
const libraries = ref<Row[]>([])
const scopes = ref<Row[]>([])
const collections = ref<Row[]>([])

vi.mock('@bookorbit/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bookorbit/types')>()
  return { ...actual, APP_FEATURES: mocks.features }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

vi.mock('vue-router', () => ({ useRoute: () => route }))

vi.mock('@/composables/useMediaMode', () => ({ useMediaMode: () => ({ mode }) }))

vi.mock('@/composables/useSidebarLibraryActivity', () => ({ useSidebarLibraryActivity: () => ({ activityFor: mocks.activityFor }) }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, reorderLibraries: mocks.reorderLibraries }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    bookScopes: computed(() => scopes.value.filter((scope) => scope.mediaType !== 'podcasts')),
    podcastScopes: computed(() => scopes.value.filter((scope) => scope.mediaType === 'podcasts')),
    reorderSmartScopes: mocks.reorderSmartScopes,
  }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    bookCollections: computed(() => collections.value.filter((collection) => collection.mediaType !== 'podcasts')),
    podcastCollections: computed(() => collections.value.filter((collection) => collection.mediaType === 'podcasts')),
    reorderCollections: mocks.reorderCollections,
  }),
}))

function row(id: number, overrides: Partial<Row> = {}): Row {
  return { id, displayOrder: id, name: `Row ${id}`, ...overrides }
}

function section(id: string) {
  const { sections } = useSidebarSections()
  const found = sections.value.find((candidate) => candidate.id === id)
  if (!found) throw new Error(`Expected a ${id} section`)
  return found
}

describe('useSidebarSections', () => {
  beforeEach(() => {
    mocks.features.podcasts = true
    mocks.permissions.clear()
    mocks.reorderLibraries = vi.fn<Reorder>().mockResolvedValue(undefined)
    mocks.reorderSmartScopes = vi.fn<Reorder>().mockResolvedValue(undefined)
    mocks.reorderCollections = vi.fn<Reorder>().mockResolvedValue(undefined)
    route.name = 'dashboard'
    route.params = {}
    mode.value = 'books'
    libraries.value = [row(1, { type: 'books' }), row(2, { type: 'books' }), row(20, { type: 'podcasts' })]
    scopes.value = []
    collections.value = []
  })

  it('lists libraries, smart scopes and collections in books mode, in that order', () => {
    const { sections } = useSidebarSections()

    expect(sections.value.map((candidate) => candidate.id)).toEqual(['libraries', 'smartScopes', 'collections'])
  })

  it('lists podcast libraries, playlists and collections in podcasts mode', () => {
    mode.value = 'podcasts'
    const { sections } = useSidebarSections()

    expect(sections.value.map((candidate) => candidate.id)).toEqual(['podcasts', 'podcastScopes', 'podcastCollections'])
  })

  it('splits libraries by medium', () => {
    expect(section('libraries').props.items.map((item) => item.id)).toEqual([1, 2])

    mode.value = 'podcasts'
    expect(section('podcasts').props.items.map((item) => item.id)).toEqual([20])
  })

  it('lights the row the current route names, and only in its own section', () => {
    route.name = 'smartScope'
    route.params = { id: '7' }
    const { sections } = useSidebarSections()

    expect(sections.value.map((candidate) => candidate.props.activeId)).toEqual([null, 7, null])
  })

  it('counts every row in the see-all label, not just the visible ones', () => {
    expect(section('libraries').props.seeAllLabel).toBe('components.sidebar.seeAllLibraries {"count":"2"}')
  })

  it('gates adding and reordering libraries on manage_libraries, but not scopes or collections', () => {
    const scopesSection = section('smartScopes')
    expect([section('libraries').props.canAdd, section('libraries').canReorder]).toEqual([false, false])
    expect([scopesSection.props.canAdd, scopesSection.canReorder]).toEqual([true, true])

    mocks.permissions.add('manage_libraries')

    expect([section('libraries').props.canAdd, section('libraries').canReorder]).toEqual([true, true])
  })

  it('offers new podcast playlists and collections only while podcasts are available', () => {
    mode.value = 'podcasts'
    expect([section('podcastScopes').props.canAdd, section('podcastCollections').props.canAdd]).toEqual([true, true])

    libraries.value = [row(1, { type: 'books' })]
    expect([section('podcastScopes').props.canAdd, section('podcastCollections').props.canAdd]).toEqual([false, false])

    libraries.value = [row(20, { type: 'podcasts' })]
    mocks.features.podcasts = false
    expect(section('podcastScopes').props.canAdd).toBe(false)
  })

  it('reports podcasts as available only with the feature on and a podcast library present', () => {
    expect(useSidebarSections().podcastsAvailable.value).toBe(true)

    mocks.features.podcasts = false
    expect(useSidebarSections().podcastsAvailable.value).toBe(false)
  })

  it('tracks run progress on library rows only', () => {
    expect(section('libraries').activity).toBe(mocks.activityFor)
    expect(section('smartScopes').activity).toBeUndefined()
    expect(section('collections').activity).toBeUndefined()
  })

  it('names the dialog and medium its add button opens', () => {
    mode.value = 'podcasts'
    const { sections } = useSidebarSections()

    expect(sections.value.map(({ kind, medium }) => [kind, medium])).toEqual([
      ['library', 'podcasts'],
      ['smartScope', 'podcasts'],
      ['collection', 'podcasts'],
    ])
  })

  it('persists only the scopes the user owns, keeping the podcast run behind them', async () => {
    scopes.value = [
      row(1, { isOwner: true }),
      row(2, { isOwner: false }),
      row(3, { isOwner: true }),
      row(10, { mediaType: 'podcasts', isOwner: true }),
    ]

    await section('smartScopes').persistOrder([
      { id: 3, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])

    expect(mocks.reorderSmartScopes).toHaveBeenCalledWith([
      { id: 3, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
      { id: 10, displayOrder: 2 },
    ])
  })

  it('persists only the collections the user can change', async () => {
    collections.value = [row(1, { isOwner: true }), row(2, { isOwner: false }), row(10, { mediaType: 'podcasts', isOwner: true })]
    mode.value = 'podcasts'

    await section('podcastCollections').persistOrder([{ id: 10, displayOrder: 0 }])

    expect(mocks.reorderCollections).toHaveBeenCalledWith([
      { id: 1, displayOrder: 0 },
      { id: 10, displayOrder: 1 },
    ])
  })

  it('persists a library reorder across both media in one request', async () => {
    mocks.permissions.add('manage_libraries')

    await section('libraries').persistOrder([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])

    expect(mocks.reorderLibraries).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
      { id: 20, displayOrder: 2 },
    ])
  })
})
