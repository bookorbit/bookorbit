import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount, type VueWrapper } from '@vue/test-utils'
import { ref, type Ref } from 'vue'
import type { Library, SmartScope } from '@bookorbit/types'

import DashboardView from './DashboardView.vue'
import DashboardWelcome from '@/features/dashboard/components/DashboardWelcome.vue'
import DashboardWidgetRow from '@/features/dashboard/components/DashboardWidgetRow.vue'

const mocks = vi.hoisted(() => ({
  user: null as unknown as Ref<{ username: string; name: string; settings: Record<string, unknown> }>,
  libraries: null as unknown as Ref<Library[]>,
  librariesLoading: null as unknown as Ref<boolean>,
  librariesLoaded: null as unknown as Ref<boolean>,
  librariesError: null as unknown as Ref<string | null>,
  fetchLibraries: vi.fn<() => Promise<void>>(),
  smartScopes: null as unknown as Ref<SmartScope[]>,
  smartScopesLoaded: null as unknown as Ref<boolean>,
  fetchSmartScopes: vi.fn<() => Promise<void>>(),
  scrollers: null as unknown as Ref<never[]>,
  shelfLayout: null as unknown as Ref<string>,
  pruneDeletedSmartScopeScrollers: vi.fn<(ids: number[]) => void>(),
  maybeStartTour: vi.fn<() => void>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user: mocks.user }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: mocks.libraries,
    loading: mocks.librariesLoading,
    loaded: mocks.librariesLoaded,
    error: mocks.librariesError,
    fetchLibraries: mocks.fetchLibraries,
  }),
}))

vi.mock('@/features/smart-scope/composables/useSmartScopes', () => ({
  useSmartScopes: () => ({
    smartScopes: mocks.smartScopes,
    loaded: mocks.smartScopesLoaded,
    fetchSmartScopes: mocks.fetchSmartScopes,
  }),
}))

vi.mock('@/features/dashboard/composables/useDashboardConfig', () => ({
  SHELF_LAYOUT: { WIDE: 'wide', TWO_COLUMNS: 'two-columns' },
  useDashboardConfig: () => ({
    scrollers: mocks.scrollers,
    shelfLayout: mocks.shelfLayout,
    pruneDeletedSmartScopeScrollers: mocks.pruneDeletedSmartScopeScrollers,
  }),
}))

vi.mock('@/features/dashboard/composables/useDashboardLabels', () => ({
  useDashboardLabels: () => ({ shelfTitle: () => '' }),
}))

vi.mock('@/features/onboarding/composables/useOnboardingTour', () => ({
  useOnboardingTour: () => ({ maybeStartTour: mocks.maybeStartTour }),
}))

async function mountView(): Promise<VueWrapper> {
  const wrapper = shallowMount(DashboardView)
  await flushPromises()
  return wrapper
}

describe('DashboardView library loading states', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.user = ref({ username: 'reader', name: 'Test Reader', settings: {} })
    mocks.libraries = ref([])
    mocks.librariesLoading = ref(false)
    mocks.librariesLoaded = ref(false)
    mocks.librariesError = ref(null)
    mocks.smartScopes = ref([])
    mocks.smartScopesLoaded = ref(false)
    mocks.scrollers = ref([])
    mocks.shelfLayout = ref('wide')
    mocks.fetchLibraries.mockReset().mockResolvedValue()
    mocks.fetchSmartScopes.mockReset().mockResolvedValue()
    mocks.pruneDeletedSmartScopeScrollers.mockReset()
    mocks.maybeStartTour.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('shows a loading status until the first library request completes', async () => {
    wrapper = await mountView()

    expect(wrapper.get('[role="status"]').text()).toContain('Loading')
    expect(wrapper.findComponent(DashboardWelcome).exists()).toBe(false)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(false)
  })

  it('shows a retryable error instead of the empty-library welcome when the initial load fails', async () => {
    mocks.librariesError.value = 'HTTP 503'
    wrapper = await mountView()
    mocks.fetchLibraries.mockClear()

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('Unable to load your libraries')
    expect(alert.text()).toContain('Your library data has not been removed')
    expect(wrapper.findComponent(DashboardWelcome).exists()).toBe(false)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(false)

    await alert.get('button').trigger('click')

    expect(mocks.fetchLibraries).toHaveBeenCalledTimes(1)
  })

  it('renders the empty-library welcome only after a successful empty response', async () => {
    mocks.librariesLoaded.value = true
    wrapper = await mountView()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.getComponent(DashboardWelcome).props('canCreate')).toBe(true)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(false)
  })

  it('renders dashboard content when libraries have loaded', async () => {
    mocks.libraries.value = [{ id: 7 } as Library]
    mocks.librariesLoaded.value = true
    wrapper = await mountView()

    expect(wrapper.findComponent(DashboardWelcome).exists()).toBe(false)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(true)
  })

  it('keeps dashboard content visible when a background refresh fails', async () => {
    mocks.libraries.value = [{ id: 7 } as Library]
    mocks.librariesLoaded.value = true
    mocks.librariesError.value = 'HTTP 504'
    wrapper = await mountView()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(true)
  })

  it('moves from the error state to dashboard content after a successful retry', async () => {
    mocks.librariesError.value = 'Network request failed'
    wrapper = await mountView()
    mocks.fetchLibraries.mockImplementationOnce(async () => {
      mocks.librariesLoading.value = true
      mocks.librariesError.value = null
      mocks.libraries.value = [{ id: 7 } as Library]
      mocks.librariesLoaded.value = true
      mocks.librariesLoading.value = false
    })

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.findComponent(DashboardWidgetRow).exists()).toBe(true)
  })
})
