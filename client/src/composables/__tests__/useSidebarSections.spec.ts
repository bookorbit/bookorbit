import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { reactive, ref } from 'vue'
import { useSidebarSections } from '../useSidebarSections'

type Reorder = (order: { id: number; displayOrder: number }[]) => Promise<void>

interface Row {
  id: number
  displayOrder: number
  name: string
  isOwner?: boolean
}

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  activityFor: () => null,
  reorderLibraries: undefined as unknown as Mock<Reorder>,
  reorderSmartScopes: undefined as unknown as Mock<Reorder>,
  reorderCollections: undefined as unknown as Mock<Reorder>,
}))

const route = reactive<{ name: string; params: Record<string, string> }>({ name: 'dashboard', params: {} })
const libraries = ref<Row[]>([])
const scopes = ref<Row[]>([])
const collections = ref<Row[]>([])

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

vi.mock('vue-router', () => ({ useRoute: () => route }))

vi.mock('@/composables/useSidebarLibraryActivity', () => ({ useSidebarLibraryActivity: () => ({ activityFor: mocks.activityFor }) }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, reorderLibraries: mocks.reorderLibraries }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    smartScopes: scopes,
    reorderSmartScopes: mocks.reorderSmartScopes,
  }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    collections,
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
    mocks.permissions.clear()
    mocks.reorderLibraries = vi.fn<Reorder>().mockResolvedValue(undefined)
    mocks.reorderSmartScopes = vi.fn<Reorder>().mockResolvedValue(undefined)
    mocks.reorderCollections = vi.fn<Reorder>().mockResolvedValue(undefined)
    route.name = 'dashboard'
    route.params = {}
    libraries.value = [row(1), row(2)]
    scopes.value = []
    collections.value = []
  })

  it('lists libraries, smart scopes and collections, in that order', () => {
    const { sections } = useSidebarSections()

    expect(sections.value.map((candidate) => candidate.id)).toEqual(['libraries', 'smartScopes', 'collections'])
  })

  it('lists every library', () => {
    expect(section('libraries').props.items.map((item) => item.id)).toEqual([1, 2])
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

  it('tracks run progress on library rows only', () => {
    expect(section('libraries').activity).toBe(mocks.activityFor)
    expect(section('smartScopes').activity).toBeUndefined()
    expect(section('collections').activity).toBeUndefined()
  })

  it('names the dialog its add button opens', () => {
    const { sections } = useSidebarSections()

    expect(sections.value.map(({ kind }) => kind)).toEqual(['library', 'smartScope', 'collection'])
  })

  it('persists only the scopes the user owns', async () => {
    scopes.value = [row(1, { isOwner: true }), row(2, { isOwner: false }), row(3, { isOwner: true })]

    await section('smartScopes').persistOrder([
      { id: 3, displayOrder: 0 },
      { id: 2, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])

    expect(mocks.reorderSmartScopes).toHaveBeenCalledWith([
      { id: 3, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])
  })

  it('persists only the collections the user can change', async () => {
    collections.value = [row(1, { isOwner: true }), row(2, { isOwner: false }), row(3, { isOwner: true })]

    await section('collections').persistOrder([
      { id: 2, displayOrder: 0 },
      { id: 3, displayOrder: 1 },
      { id: 1, displayOrder: 2 },
    ])

    expect(mocks.reorderCollections).toHaveBeenCalledWith([
      { id: 3, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])
  })

  it('persists a library reorder in one request', async () => {
    mocks.permissions.add('manage_libraries')

    await section('libraries').persistOrder([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])

    expect(mocks.reorderLibraries).toHaveBeenCalledWith([
      { id: 2, displayOrder: 0 },
      { id: 1, displayOrder: 1 },
    ])
  })
})
