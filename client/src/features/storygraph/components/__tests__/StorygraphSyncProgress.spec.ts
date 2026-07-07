import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import type { StorygraphActiveSyncStatus, StorygraphSettings, StorygraphSyncFailure } from '@bookorbit/types'
import StorygraphSyncProgress from '../StorygraphSyncProgress.vue'

const activeSyncStatus = ref<StorygraphActiveSyncStatus | null>(null)
const lastRunSummary = ref<StorygraphActiveSyncStatus | null>(null)
const syncFailures = ref<StorygraphSyncFailure[]>([])
const syncing = ref(false)
const pendingSummary = ref({ totalBooks: 0, pendingBooks: 0 })
const loadingPending = ref(false)
const error = ref<string | null>(null)
const settings = ref<StorygraphSettings | null>(null)
const isSyncing = computed(() => activeSyncStatus.value?.status === 'running')
const syncProgress = computed(() => {
  const status = activeSyncStatus.value
  if (!status || status.totalBooks === 0) return 0
  return Math.round((status.processedBooks / status.totalBooks) * 100)
})

const mocks = vi.hoisted(() => ({
  startSync: vi.fn<() => Promise<void>>(),
  cancelSync: vi.fn<() => Promise<void>>(),
  fetchStatus: vi.fn<() => Promise<void>>(),
  fetchPendingSummary: vi.fn<() => Promise<void>>(),
  fetchSyncFailures: vi.fn<() => Promise<void>>(),
  stopSyncTracking: vi.fn<() => void>(),
}))

vi.mock('../../composables/useStorygraphSettings', () => ({
  useStorygraphSettings: () => ({ settings }),
}))

vi.mock('../../composables/useStorygraphSync', () => ({
  useStorygraphSync: () => ({
    activeSyncStatus,
    lastRunSummary,
    syncFailures,
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
    fetchSyncFailures: mocks.fetchSyncFailures,
    stopSyncTracking: mocks.stopSyncTracking,
  }),
}))

function makeSettings(overrides: Partial<StorygraphSettings> = {}): StorygraphSettings {
  return {
    cookiesConfigured: true,
    enabled: true,
    effectiveEnabled: true,
    disabledReason: null,
    bookSyncMode: 'all_eligible',
    autoSyncOnStatusChange: true,
    autoSyncOnProgressUpdate: true,
    lastSyncedAt: null,
    ...overrides,
  }
}

function makeStatus(overrides: Partial<StorygraphActiveSyncStatus> = {}): StorygraphActiveSyncStatus {
  return {
    runId: 1,
    status: 'running',
    syncedBooks: 0,
    skippedBooks: 0,
    failedBooks: 0,
    processedBooks: 0,
    totalBooks: 19,
    ...overrides,
  }
}

describe('StorygraphSyncProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activeSyncStatus.value = null
    lastRunSummary.value = null
    syncFailures.value = []
    syncing.value = false
    pendingSummary.value = { totalBooks: 0, pendingBooks: 0 }
    loadingPending.value = false
    error.value = null
    settings.value = makeSettings()
  })

  it('shows processed progress that advances with skipped and failed books', async () => {
    activeSyncStatus.value = makeStatus({ processedBooks: 7, syncedBooks: 4, skippedBooks: 2, failedBooks: 1 })
    const wrapper = mount(StorygraphSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('7 / 19 books')
    expect(wrapper.text()).toContain('4 synced')
    expect(wrapper.text()).toContain('2 skipped')
    expect(wrapper.text()).toContain('1 failed')
    const bar = wrapper.find('.bg-primary.transition-all')
    expect(bar.attributes('style')).toContain('37%')
  })

  it('hides the failed counter while no book has failed', async () => {
    activeSyncStatus.value = makeStatus({ processedBooks: 3, syncedBooks: 3 })
    const wrapper = mount(StorygraphSyncProgress)
    await flushPromises()

    expect(wrapper.text()).not.toContain('failed')
  })

  it('shows the last run summary after a completed sync', async () => {
    lastRunSummary.value = makeStatus({ status: 'completed', processedBooks: 19, syncedBooks: 15, skippedBooks: 3, failedBooks: 1 })
    const wrapper = mount(StorygraphSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('Last run: 15 synced · 3 skipped · 1 failed')
  })

  it('lists books that failed to sync with readable reasons', async () => {
    syncFailures.value = [
      { bookId: 7, title: 'Broken Book', authorName: 'Some Author', syncError: 'no_match', lastAttemptAt: null },
      { bookId: 8, title: 'Expired Book', authorName: null, syncError: 'storygraph_session_expired', lastAttemptAt: null },
    ]
    const wrapper = mount(StorygraphSyncProgress)
    await flushPromises()

    expect(wrapper.text()).toContain('2 books failed to sync')
    expect(wrapper.text()).toContain('Broken Book')
    expect(wrapper.text()).toContain('No StoryGraph match found')
    expect(wrapper.text()).toContain('Expired Book')
    expect(wrapper.text()).toContain('re-paste your cookies')
  })

  it('hides the failure list while a sync is running', async () => {
    syncFailures.value = [{ bookId: 7, title: 'Broken Book', authorName: null, syncError: 'no_match', lastAttemptAt: null }]
    activeSyncStatus.value = makeStatus({ processedBooks: 1 })
    const wrapper = mount(StorygraphSyncProgress)
    await flushPromises()

    expect(wrapper.text()).not.toContain('failed to sync')
  })
})
