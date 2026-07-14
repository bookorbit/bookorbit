import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import KoreaderSettings from '../KoreaderSettings.vue'
import type { BookCard, KoreaderCredentials, KoreaderManualHashLink, KoreaderSyncStatus, KoreaderUnmatchedBook } from '@bookorbit/types'
import { copyToClipboard } from '@/lib/clipboard'

const routerState = vi.hoisted(() => ({
  currentQuery: {} as Record<string, string>,
  replacedQuery: null as Record<string, string> | null,
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routerState.currentQuery }),
  useRouter: () => ({
    replace: vi.fn<(to: { name: string; query: Record<string, string> }) => void>((to) => {
      routerState.replacedQuery = to.query
    }),
  }),
}))

const koreaderMock = vi.hoisted(() => ({
  credentials: { __v_isRef: true, value: null as KoreaderCredentials | null },
  syncStatus: { __v_isRef: true, value: null as KoreaderSyncStatus | null },
  unmatchedBooks: { __v_isRef: true, value: [] as KoreaderUnmatchedBook[] },
  manualHashLinks: { __v_isRef: true, value: [] as KoreaderManualHashLink[] },
  loading: { __v_isRef: true, value: false },
  unmatchedLoading: { __v_isRef: true, value: false },
  manualLinksLoading: { __v_isRef: true, value: false },
  fetchSyncStatus: vi.fn<() => Promise<void>>(),
  fetchUnmatchedBooks: vi.fn<() => Promise<void>>(),
  fetchManualHashLinks: vi.fn<() => Promise<void>>(),
  createCredentials: vi.fn<() => Promise<void>>(),
  updateCredentials: vi.fn<() => Promise<void>>(),
  deleteCredentials: vi.fn<() => Promise<void>>(),
  getSyncUrl: vi.fn<() => string>(),
  downloadPluginPackage: vi.fn<() => Promise<void>>(),
  linkUnmatchedBook: vi.fn<() => Promise<void>>(),
  dismissUnmatchedBook: vi.fn<() => Promise<void>>(),
  dismissAllUnmatchedBooks: vi.fn<() => Promise<{ count: number }>>(),
  relinkManualHashLink: vi.fn<() => Promise<void>>(),
  unlinkManualHashLink: vi.fn<() => Promise<void>>(),
  removeDevice: vi.fn<() => Promise<void>>(),
}))

const searchMock = vi.hoisted(() => ({
  results: { __v_isRef: true, value: [] as BookCard[] },
  total: { __v_isRef: true, value: 0 },
  loading: { __v_isRef: true, value: false },
  loadingMore: { __v_isRef: true, value: false },
  settled: { __v_isRef: true, value: true },
  hasMore: { __v_isRef: true, value: false },
  loadMore: vi.fn<() => Promise<void>>(),
  clear: vi.fn<() => void>(),
}))

vi.mock('@/features/koreader/composables/useKoreaderSync', () => ({
  useKoreaderSync: () => koreaderMock,
}))

vi.mock('@/features/book/composables/useGlobalSearch', () => ({
  useGlobalSearch: () => searchMock,
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
}))

vi.mock('../SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('../KoreaderFileNamingSettings.vue', () => ({
  default: { template: '<div data-testid="file-naming-settings" />' },
}))

function makeCredentials(overrides: Partial<KoreaderCredentials> = {}): KoreaderCredentials {
  return {
    username: 'reader-user',
    syncEnabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeSyncStatus(overrides: Partial<KoreaderSyncStatus> = {}): KoreaderSyncStatus {
  return {
    credentials: makeCredentials(),
    devices: [
      {
        device: 'Kobo Libra 2',
        deviceId: 'device-1',
        lastSyncAt: '2026-01-02T00:00:00.000Z',
        lastBookTitle: 'Project Hail Mary',
      },
    ],
    totalSyncedBooks: 14,
    lastSyncAt: '2026-01-02T00:00:00.000Z',
    latestPluginVersion: '0.5.0',
    pluginUpdateAvailable: true,
    sweeps: [
      {
        deviceId: 'device-1',
        deviceModel: 'Kobo Libra 2',
        pluginVersion: '0.3.0',
        latestPluginVersion: '0.5.0',
        updateAvailable: true,
        lastSweepAt: '2026-01-02T00:00:00.000Z',
        lastSweepBooksMatched: 12,
        lastSweepPageStats: 30,
        lastSweepAnnotations: 8,
      },
    ],
    pluginTotals: {
      matchedBooks: 12,
      pageStatEvents: 30,
      annotations: 8,
      trashedAnnotations: 1,
      pendingDeletes: 2,
      failedPositions: 3,
      unmatchedBooks: 0,
    },
    ...overrides,
  }
}

function makeUnmatchedBook(overrides: Partial<KoreaderUnmatchedBook> = {}): KoreaderUnmatchedBook {
  return {
    hash: 'a'.repeat(32),
    title: 'KOReader Stats Title',
    authors: 'Device Author',
    lastOpen: 1700000000,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeHash(index: number): string {
  return index.toString(16).padStart(32, '0')
}

function makeManualHashLink(overrides: Partial<KoreaderManualHashLink> = {}): KoreaderManualHashLink {
  return {
    hash: 'b'.repeat(32),
    bookId: 70,
    bookFileId: 71,
    bookTitle: 'Linked BookOrbit Title',
    bookAuthors: ['Linked Author'],
    koreaderTitle: 'Linked KOReader Title',
    koreaderAuthors: 'Device Author',
    koreaderLastOpen: 1700000001,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    ...overrides,
  }
}

function makeBookCard(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 55,
    title: 'BookOrbit Title',
    authors: ['BookOrbit Author'],
    files: [{ id: 44, format: 'epub', role: 'main', sizeBytes: 123 }],
    status: 'present',
    seriesName: null,
    seriesIndex: null,
    publishedYear: null,
    language: null,
    genres: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    tags: [],
    customMetadata: [],
    ...overrides,
  } as BookCard
}

function mountComponent() {
  return mount(KoreaderSettings, { props: { embedded: true } })
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text))
}

describe('KoreaderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routerState.currentQuery = {}
    routerState.replacedQuery = null
    koreaderMock.credentials.value = null
    koreaderMock.syncStatus.value = null
    koreaderMock.unmatchedBooks.value = []
    koreaderMock.manualHashLinks.value = []
    koreaderMock.loading.value = false
    koreaderMock.unmatchedLoading.value = false
    koreaderMock.manualLinksLoading.value = false
    koreaderMock.fetchSyncStatus.mockResolvedValue(undefined)
    koreaderMock.fetchUnmatchedBooks.mockResolvedValue(undefined)
    koreaderMock.fetchManualHashLinks.mockResolvedValue(undefined)
    koreaderMock.createCredentials.mockResolvedValue(undefined)
    koreaderMock.updateCredentials.mockResolvedValue(undefined)
    koreaderMock.deleteCredentials.mockResolvedValue(undefined)
    koreaderMock.getSyncUrl.mockReturnValue('https://bookorbit.example')
    koreaderMock.downloadPluginPackage.mockResolvedValue(undefined)
    koreaderMock.linkUnmatchedBook.mockResolvedValue(undefined)
    koreaderMock.dismissUnmatchedBook.mockResolvedValue(undefined)
    koreaderMock.dismissAllUnmatchedBooks.mockResolvedValue({ count: 0 })
    koreaderMock.relinkManualHashLink.mockResolvedValue(undefined)
    koreaderMock.unlinkManualHashLink.mockResolvedValue(undefined)
    koreaderMock.removeDevice.mockResolvedValue(undefined)
    searchMock.results.value = []
    searchMock.loading.value = false
    searchMock.loadingMore.value = false
    searchMock.settled.value = true
    searchMock.hasMore.value = false
    searchMock.loadMore.mockClear()
    searchMock.clear.mockClear()
  })

  it('switches between sync and file naming tabs outside embedded mode', async () => {
    const wrapper = mount(KoreaderSettings)
    await flushPromises()

    expect(routerState.replacedQuery).toEqual({ tab: 'settings' })
    const fileNamingTab = buttonByText(wrapper, 'File Naming')!
    const syncTab = buttonByText(wrapper, 'Sync Settings')!
    expect(syncTab.attributes('aria-pressed')).toBe('true')
    expect(fileNamingTab.attributes('aria-pressed')).toBe('false')
    await fileNamingTab.trigger('click')
    expect(fileNamingTab.classes()).toContain('border-primary')
    expect(fileNamingTab.attributes('aria-pressed')).toBe('true')
    expect(routerState.replacedQuery).toEqual({ tab: 'file-naming' })
    await syncTab.trigger('click')
    expect(syncTab.classes()).toContain('border-primary')
    expect(syncTab.attributes('aria-pressed')).toBe('true')
    expect(routerState.replacedQuery).toEqual({ tab: 'settings' })
  })

  it('opens the tab selected by the URL query', async () => {
    routerState.currentQuery = { tab: 'file-naming' }

    const wrapper = mount(KoreaderSettings)
    await flushPromises()

    expect(buttonByText(wrapper, 'File Naming')!.attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-testid="file-naming-settings"]').isVisible()).toBe(true)
    expect(routerState.replacedQuery).toBeNull()
  })

  it('shows loading state', () => {
    koreaderMock.loading.value = true

    const wrapper = mountComponent()

    expect(wrapper.text()).toContain('Loading KOReader settings...')
  })

  it('shows an error when status loading fails', async () => {
    koreaderMock.fetchSyncStatus.mockRejectedValue(new Error('Failed to load status'))

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load status')
  })

  it('keeps the unconfigured state focused on credential creation', async () => {
    koreaderMock.syncStatus.value = makeSyncStatus({ credentials: null, devices: [], totalSyncedBooks: 0, lastSyncAt: null, sweeps: [] })

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('KOReader sync is not configured')
    expect(wrapper.text()).toContain('Create credentials')
    expect(wrapper.text()).not.toContain('Setup Guide')

    await buttonByText(wrapper, 'Create credentials')!.trigger('click')
    await wrapper.find('input[type="text"]').setValue('new-reader')
    await wrapper.find('input[type="password"]').setValue('secret1')
    await buttonByText(wrapper, 'Create')!.trigger('click')

    expect(koreaderMock.createCredentials).toHaveBeenCalledWith({ username: 'new-reader', password: 'secret1' })
  })

  it('renders configured status, setup, device, activity, guide, and danger sections', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.findAll('.settings-group-label').map((label) => label.text())).toEqual([
      'KOReader Status',
      'Setup',
      'Devices',
      'Plugin Activity',
      'Unmatched KOReader Books',
      'Manual KOReader Links',
      'Setup Guide',
      'Danger Zone',
    ])
    expect(wrapper.text()).toContain('reader-user')
    expect(wrapper.text()).toContain('14 books')
    expect(wrapper.text()).toContain('1 device')
    const syncUrlInput = wrapper.find('input[readonly]').element as HTMLInputElement
    expect(syncUrlInput.value).toBe('https://bookorbit.example')
    expect(wrapper.text()).toContain('Kobo Libra 2')
    expect(wrapper.text()).toContain('Project Hail Mary')
    expect(wrapper.text()).toContain('Latest plugin: v0.5.0')
    expect(wrapper.text()).toContain('Update available')
    expect(wrapper.text()).toContain('latest plugin v0.5.0')
    expect(wrapper.text()).toContain('Matched books')
    expect(wrapper.text()).toContain('No unmatched KOReader books.')
    expect(wrapper.text()).toContain('No manual KOReader links.')
    expect(wrapper.text()).toContain('2 deleted highlights awaiting KOReader plugin acknowledgement.')
    expect(wrapper.text()).toContain('3 highlight positions need attention.')
    expect(wrapper.text()).not.toContain('Download the preconfigured plugin above.')
  })

  it('expands the setup guide only when requested', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).not.toContain('Download the preconfigured plugin above.')

    await buttonByText(wrapper, 'KOReader setup steps')!.trigger('click')

    expect(wrapper.text()).toContain('Download the preconfigured plugin above.')
  })

  it('shows current plugin state without an update warning when reported devices are current', async () => {
    const status = makeSyncStatus({
      pluginUpdateAvailable: false,
      sweeps: [
        {
          deviceId: 'device-1',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.5.0',
          latestPluginVersion: '0.5.0',
          updateAvailable: false,
          lastSweepAt: '2026-01-02T00:00:00.000Z',
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
      ],
    })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Latest plugin: v0.5.0')
    expect(wrapper.text()).toContain('Up to date')
    expect(wrapper.text()).not.toContain('latest plugin v0.5.0')
  })

  it('keeps plugin update state explicit when the server cannot report the latest version', async () => {
    const status = makeSyncStatus({
      latestPluginVersion: null,
      pluginUpdateAvailable: false,
      sweeps: [
        {
          deviceId: 'device-1',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.5.0',
          latestPluginVersion: null,
          updateAvailable: null,
          lastSweepAt: '2026-01-02T00:00:00.000Z',
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
      ],
    })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Latest plugin unavailable')
    expect(wrapper.text()).toContain('Version unknown')
    expect(wrapper.text()).not.toContain('Update available')
  })

  it('calls existing action methods from the refreshed controls', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Refresh')!.trigger('click')
    await wrapper.findComponent({ name: 'ToggleSwitch' }).trigger('click')
    await buttonByText(wrapper, 'Copy URL')!.trigger('click')
    await buttonByText(wrapper, 'Download Plugin')!.trigger('click')
    await buttonByText(wrapper, 'Delete')!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchSyncStatus).toHaveBeenCalledTimes(2)
    expect(koreaderMock.fetchUnmatchedBooks).toHaveBeenCalledTimes(2)
    expect(koreaderMock.fetchManualHashLinks).toHaveBeenCalledTimes(2)
    expect(koreaderMock.updateCredentials).toHaveBeenCalledWith({ syncEnabled: false })
    expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('https://bookorbit.example')
    expect(koreaderMock.downloadPluginPackage).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Delete KOReader credentials?')

    const deleteButtons = wrapper.findAll('button').filter((button) => button.text() === 'Delete')
    await deleteButtons[deleteButtons.length - 1]!.trigger('click')

    expect(koreaderMock.deleteCredentials).toHaveBeenCalledTimes(1)
  })

  it('opens the unmatched link dialog and submits the selected BookOrbit book', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    searchMock.results.value = [makeBookCard()]

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Link')!.trigger('click')
    expect(wrapper.text()).toContain('Link KOReader book')
    const searchInput = wrapper.find('input[type="search"]')
    await searchInput.setValue('BookOrbit')
    expect((searchInput.element as HTMLInputElement).value).toBe('BookOrbit')
    expect(wrapper.text()).toContain('BookOrbit Title')

    const bookResult = wrapper.findAll('button').find((button) => button.text().includes('BookOrbit Title'))!
    await bookResult.trigger('click')
    expect(wrapper.text()).toContain('Confirm KOReader link')
    expect(wrapper.text()).toContain('Already synced stats will stay on their current BookOrbit book.')

    await buttonByText(wrapper, 'Confirm link')!.trigger('click')
    await flushPromises()

    expect(koreaderMock.linkUnmatchedBook).toHaveBeenCalledWith('a'.repeat(32), { bookId: 55 })
  })

  it('confirms before dismissing an unmatched KOReader book', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Dismiss')!
      .trigger('click')

    expect(wrapper.text()).toContain('Dismiss')
    expect(wrapper.text()).toContain('a'.repeat(32))

    const dismissButtons = wrapper.findAll('button').filter((button) => button.text() === 'Dismiss')
    await dismissButtons[dismissButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.dismissUnmatchedBook).toHaveBeenCalledWith('a'.repeat(32))
  })

  it('cancels dismissing an unmatched KOReader book without calling dismissUnmatchedBook', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Dismiss')!
      .trigger('click')
    await buttonByText(wrapper, 'Cancel')!.trigger('click')

    expect(koreaderMock.dismissUnmatchedBook).not.toHaveBeenCalled()
  })

  it('keeps the confirm dialog open and reports an error when dismissing an unmatched book fails', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    koreaderMock.dismissUnmatchedBook.mockRejectedValueOnce(new Error('Failed to dismiss KOReader unmatched book'))

    const wrapper = mountComponent()
    await flushPromises()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Dismiss')!
      .trigger('click')
    const dismissButtons = wrapper.findAll('button').filter((button) => button.text() === 'Dismiss')
    await dismissButtons[dismissButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.dismissUnmatchedBook).toHaveBeenCalledWith('a'.repeat(32))
    expect(wrapper.text()).toContain('a'.repeat(32))
  })

  it('does not show a Dismiss all button when there are no unmatched books', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = []

    const wrapper = mountComponent()
    await flushPromises()

    expect(buttonByText(wrapper, 'Dismiss all')).toBeUndefined()
  })

  it('confirms before dismissing all unmatched KOReader books', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 2 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook({ hash: 'a'.repeat(32) }), makeUnmatchedBook({ hash: 'c'.repeat(32) })]
    koreaderMock.dismissAllUnmatchedBooks.mockResolvedValue({ count: 2 })

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Dismiss all')!.trigger('click')

    expect(wrapper.text()).toContain('Dismiss all 2 unmatched books?')
    expect(wrapper.text()).toContain('clears your entire unmatched books list')

    const dismissAllButtons = wrapper.findAll('button').filter((button) => button.text() === 'Dismiss all')
    await dismissAllButtons[dismissAllButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.dismissAllUnmatchedBooks).toHaveBeenCalledTimes(1)
  })

  it('cancels dismissing all unmatched KOReader books without calling dismissAllUnmatchedBooks', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Dismiss all')!.trigger('click')
    await buttonByText(wrapper, 'Cancel')!.trigger('click')

    expect(koreaderMock.dismissAllUnmatchedBooks).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('clears your entire unmatched books list')
  })

  it('keeps the confirm dialog open and reports an error when dismissing all unmatched books fails', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    koreaderMock.dismissAllUnmatchedBooks.mockRejectedValueOnce(new Error('Failed to dismiss all KOReader unmatched books'))

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Dismiss all')!.trigger('click')
    const dismissAllButtons = wrapper.findAll('button').filter((button) => button.text() === 'Dismiss all')
    await dismissAllButtons[dismissAllButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.dismissAllUnmatchedBooks).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('clears your entire unmatched books list')
  })

  it('loads more BookOrbit search results from the link dialog', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    searchMock.results.value = [makeBookCard()]
    searchMock.hasMore.value = true

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Link')!.trigger('click')
    await buttonByText(wrapper, 'Load more')!.trigger('click')

    expect(searchMock.loadMore).toHaveBeenCalledTimes(1)
  })

  it('renders manual links and can relink with confirmation', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.manualHashLinks.value = [makeManualHashLink()]
    searchMock.results.value = [makeBookCard({ id: 88, title: 'Replacement Book', authors: ['Replacement Author'] })]

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Linked KOReader Title')
    expect(wrapper.text()).toContain('Linked to Linked BookOrbit Title')

    await buttonByText(wrapper, 'Change')!.trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Replacement Book'))!
      .trigger('click')
    await buttonByText(wrapper, 'Confirm link')!.trigger('click')
    await flushPromises()

    expect(koreaderMock.relinkManualHashLink).toHaveBeenCalledWith('b'.repeat(32), { bookId: 88 })
  })

  it('confirms before unlinking a manual hash link', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.manualHashLinks.value = [makeManualHashLink()]

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Unlink')!.trigger('click')

    expect(wrapper.text()).toContain('Unlink KOReader book?')
    expect(wrapper.text()).toContain('Already synced stats will stay on their current BookOrbit book.')

    const unlinkButtons = wrapper.findAll('button').filter((button) => button.text() === 'Unlink')
    await unlinkButtons[unlinkButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.unlinkManualHashLink).toHaveBeenCalledWith('b'.repeat(32))
  })

  it('confirms before removing a device', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Remove')!.trigger('click')

    expect(wrapper.text()).toContain('Remove Kobo Libra 2?')
    expect(wrapper.text()).toContain("permanently deletes this device's synced progress, reading activity, and any unmatched-book entries")

    const removeButtons = wrapper.findAll('button').filter((button) => button.text() === 'Remove')
    await removeButtons[removeButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.removeDevice).toHaveBeenCalledWith('device-1')
    expect(wrapper.text()).not.toContain('Remove Kobo Libra 2?')
  })

  it('cancels removing a device without calling removeDevice', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Remove')!.trigger('click')
    expect(wrapper.text()).toContain('Remove Kobo Libra 2?')

    await buttonByText(wrapper, 'Cancel')!.trigger('click')

    expect(koreaderMock.removeDevice).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Remove Kobo Libra 2?')
  })

  it('keeps the confirm dialog open and reports an error when removing a device fails', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.removeDevice.mockRejectedValueOnce(new Error('Failed to remove KOReader device'))

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Remove')!.trigger('click')
    const removeButtons = wrapper.findAll('button').filter((button) => button.text() === 'Remove')
    await removeButtons[removeButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.removeDevice).toHaveBeenCalledWith('device-1')
    expect(wrapper.text()).toContain('Remove Kobo Libra 2?')
  })

  it('renders hash-only unmatched rows with a distinguishable fallback label', async () => {
    const hash = 'c1aa241d98bcdbc5c52b2eff31c4920e'
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook({ hash, title: null, authors: null, lastOpen: null })]

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('Unknown KOReader file c1aa241d')
    expect(wrapper.text()).toContain('No title or author reported')
  })

  it('paginates unmatched KOReader rows six at a time', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 7 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = Array.from({ length: 7 }, (_, index) =>
      makeUnmatchedBook({
        hash: makeHash(index + 1),
        title: `KOReader Row ${index + 1}`,
      }),
    )

    const wrapper = mountComponent()
    await flushPromises()

    expect(wrapper.text()).toContain('KOReader Row 1')
    expect(wrapper.text()).toContain('KOReader Row 6')
    expect(wrapper.text()).not.toContain('KOReader Row 7')
    expect(wrapper.text()).toContain('Showing 1-6 of 7')
    expect(wrapper.text()).toContain('Page 1 of 2')

    await buttonByText(wrapper, 'Next')!.trigger('click')

    expect(wrapper.text()).not.toContain('KOReader Row 1')
    expect(wrapper.text()).toContain('KOReader Row 7')
    expect(wrapper.text()).toContain('Showing 7-7 of 7')
    expect(wrapper.text()).toContain('Page 2 of 2')

    await buttonByText(wrapper, 'Previous')!.trigger('click')

    expect(wrapper.text()).toContain('KOReader Row 1')
    expect(wrapper.text()).not.toContain('KOReader Row 7')
    expect(wrapper.text()).toContain('Showing 1-6 of 7')
    expect(wrapper.text()).toContain('Page 1 of 2')
  })

  it('refreshes unmatched books and resets to the first page', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 7 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = Array.from({ length: 7 }, (_, index) => makeUnmatchedBook({ hash: makeHash(index + 1) }))
    koreaderMock.fetchUnmatchedBooks.mockResolvedValue(undefined)

    const wrapper = mountComponent()
    await flushPromises()
    await buttonByText(wrapper, 'Next')!.trigger('click')
    expect(wrapper.text()).toContain('Page 2 of 2')

    const refreshButtons = wrapper.findAll('button').filter((button) => button.text() === 'Refresh')
    await refreshButtons[1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchUnmatchedBooks).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Page 1 of 2')
  })

  it('shows an error toast when refreshing unmatched books fails', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    koreaderMock.fetchUnmatchedBooks.mockReset()
    koreaderMock.fetchUnmatchedBooks.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network down'))

    const wrapper = mountComponent()
    await flushPromises()

    const refreshButtons = wrapper.findAll('button').filter((button) => button.text() === 'Refresh')
    await refreshButtons[1]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchUnmatchedBooks).toHaveBeenCalledTimes(2)
  })

  it('refreshes manual KOReader links', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.manualHashLinks.value = [makeManualHashLink()]
    koreaderMock.fetchManualHashLinks.mockResolvedValue(undefined)

    const wrapper = mountComponent()
    await flushPromises()

    const refreshButtons = wrapper.findAll('button').filter((button) => button.text() === 'Refresh')
    await refreshButtons[2]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchManualHashLinks).toHaveBeenCalledTimes(2)
  })

  it('shows an error toast when refreshing manual KOReader links fails', async () => {
    const status = makeSyncStatus()
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.manualHashLinks.value = [makeManualHashLink()]
    koreaderMock.fetchManualHashLinks.mockReset()
    koreaderMock.fetchManualHashLinks.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network down'))

    const wrapper = mountComponent()
    await flushPromises()

    const refreshButtons = wrapper.findAll('button').filter((button) => button.text() === 'Refresh')
    await refreshButtons[2]!.trigger('click')
    await flushPromises()

    expect(koreaderMock.fetchManualHashLinks).toHaveBeenCalledTimes(2)
  })

  it('returns to search results when choosing a different book from the confirm step', async () => {
    const status = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    koreaderMock.credentials.value = status.credentials
    koreaderMock.syncStatus.value = status
    koreaderMock.unmatchedBooks.value = [makeUnmatchedBook()]
    searchMock.results.value = [makeBookCard()]

    const wrapper = mountComponent()
    await flushPromises()

    await buttonByText(wrapper, 'Link')!.trigger('click')
    const bookResult = wrapper.findAll('button').find((button) => button.text().includes('BookOrbit Title'))!
    await bookResult.trigger('click')
    expect(wrapper.text()).toContain('Confirm KOReader link')
    expect(wrapper.text()).toContain('Book ID: 55')

    await buttonByText(wrapper, 'Choose different')!.trigger('click')

    expect(wrapper.text()).not.toContain('Confirm KOReader link')
    expect(wrapper.text()).not.toContain('Book ID: 55')
    expect(wrapper.text()).toContain('BookOrbit Title')
  })
})
