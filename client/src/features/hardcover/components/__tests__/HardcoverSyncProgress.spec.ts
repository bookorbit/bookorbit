import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { HardcoverActiveSyncStatus, HardcoverSettings } from '@bookorbit/types'
import HardcoverSyncProgress from '../HardcoverSyncProgress.vue'

const activeSyncStatus = ref<HardcoverActiveSyncStatus | null>(null)
const syncing = ref(false)
const pendingSummary = ref({ totalBooks: 0, pendingBooks: 0 })
const loadingPending = ref(false)
const error = ref<string | null>(null)
const settings = ref<HardcoverSettings | null>(null)
const isSyncing = computed(() => activeSyncStatus.value?.status === 'running')
const syncProgress = computed(() => {
  const status = activeSyncStatus.value
  if (!status || status.totalBooks === 0) return 0
  return Math.round((status.syncedBooks / status.totalBooks) * 100)
})

const mocks = vi.hoisted(() => ({
  startSync: vi.fn<() => Promise<void>>(),
  cancelSync: vi.fn<() => Promise<void>>(),
  fetchStatus: vi.fn<() => Promise<void>>(),
  fetchPendingSummary: vi.fn<() => Promise<void>>(),
  stopSyncTracking: vi.fn<() => void>(),
}))

vi.mock('../../composables/useHardcoverSettings', () => ({
  useHardcoverSettings: () => ({ settings }),
}))

vi.mock('../../composables/useHardcoverSync', () => ({
  useHardcoverSync: () => ({
    activeSyncStatus,
    syncing,
    pendingSummary,
    loadingPending,
    error,
    isSyncing,
    syncProgress,
    startSync: mocks.startSync,
    cancelSync: mocks.cancelSync,
    fetchStatus: mocks.fetchStatus,
    fetchPendingSummary: mocks.fetchPendingSummary,
    stopSyncTracking: mocks.stopSyncTracking,
  }),
}))

function makeSettings(overrides: Partial<HardcoverSettings> = {}): HardcoverSettings {
  return {
    tokenConfigured: true,
    enabled: true,
    effectiveEnabled: true,
    disabledReason: null,
    bookSyncMode: 'all_eligible',
    autoSyncOnStatusChange: true,
    autoSyncOnProgressUpdate: true,
    autoSyncOnRatingChange: true,
    privacySettingId: 3,
    excludedLibraryIds: [],
    lastSyncedAt: null,
    ...overrides,
  }
}

describe('HardcoverSyncProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settings.value = makeSettings()
    activeSyncStatus.value = null
    pendingSummary.value = { totalBooks: 0, pendingBooks: 0 }
    loadingPending.value = false
    error.value = null
  })

  it('renders selected-only manual sync state', async () => {
    settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    pendingSummary.value = { totalBooks: 5, pendingBooks: 3 }

    const wrapper = mount(HardcoverSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('selected books')
    expect(wrapper.text()).toContain('Sync now (3)')
    expect(wrapper.text()).not.toContain('Cancel')
  })

  it('renders running progress and cancel controls', async () => {
    settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    activeSyncStatus.value = { runId: 9, status: 'running', totalBooks: 5, syncedBooks: 2 }
    pendingSummary.value = { totalBooks: 5, pendingBooks: 3 }

    const wrapper = mount(HardcoverSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('2 / 5 books')
    expect(wrapper.text()).toContain('Cancel')
  })

  it('shows unavailable sync copy when Hardcover sync is paused', async () => {
    settings.value = makeSettings({ enabled: false, effectiveEnabled: false, disabledReason: 'user_disabled' })
    pendingSummary.value = { totalBooks: 4, pendingBooks: 0 }
    settings.value.lastSyncedAt = '2026-06-24T15:00:00.000Z'

    const wrapper = mount(HardcoverSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('Sync unavailable')
    expect(wrapper.text()).toContain('Last successful sync')
  })

  it('shows the empty-scope copy when there are no books to sync', async () => {
    settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    pendingSummary.value = { totalBooks: 0, pendingBooks: 0 }

    const wrapper = mount(HardcoverSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('No books in sync scope.')
  })
})
