import { shallowMount } from '@vue/test-utils'
import { ref, type Component } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import LibrariesView from '@/features/library/views/LibrariesView.vue'
import SmartScopesView from '@/features/smart-scope/views/SmartScopesView.vue'
import CollectionsView from '@/features/collection/views/CollectionsView.vue'

const mocks = vi.hoisted(() => ({
  fetchLibraries: vi.fn<() => Promise<void>>(),
  fetchSmartScopes: vi.fn<() => Promise<void>>(),
  fetchCollections: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    loading: ref(false),
    fetchLibraries: mocks.fetchLibraries,
  }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    smartScopes: ref([]),
    loading: ref(false),
    fetchSmartScopes: mocks.fetchSmartScopes,
  }),
}))

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    collections: ref([]),
    loading: ref(false),
    fetchCollections: mocks.fetchCollections,
  }),
}))

vi.mock('@/features/library/composables/useLibraryCreationRedirect', () => ({
  useLibraryCreationRedirect: () => ({ handleLibraryCreated: vi.fn<() => Promise<void>>() }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

const views: [string, Component][] = [
  ['libraries', LibrariesView],
  ['smart scopes', SmartScopesView],
  ['collections', CollectionsView],
]

describe.each(views)('%s index view', (_name, view) => {
  it('renders an element root that can participate in cached page transitions', () => {
    const wrapper = shallowMount(view)

    expect(wrapper.vm.$el.nodeType).toBe(Node.ELEMENT_NODE)
  })
})
