import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import type { Library, LibraryAccessEntry, LibraryLastScan, LibraryOverviewEntry, LibraryScanHistoryEntry } from '@bookorbit/types'

// --- Mocks (must be before imports that use them) ---

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: librariesRef,
    fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refreshLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('@/features/library/composables/useLibraryCreationRedirect', () => ({
  useLibraryCreationRedirect: () => ({ handleLibraryCreated: vi.fn<() => void>() }),
}))

vi.mock('@/features/library/composables/useLibraryFileSync', () => ({
  useLibraryFileSync: () => ({ syncAll: vi.fn<() => void>() }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({
    subscribeLibrary: vi.fn<() => void>(),
    getProgress: (libraryId: number) => progressRef.value.get(libraryId),
    isScanning: (libraryId: number) => progressRef.value.get(libraryId)?.status === 'running',
    progressMap: progressRef,
    getCoverRefreshProgress: vi.fn<() => undefined>().mockReturnValue(undefined),
    isRefreshingCovers: vi.fn<() => boolean>().mockReturnValue(false),
  }),
  getSocket: vi.fn<() => void>(),
  claimScanCompletionToasts: vi.fn<() => () => void>(() => vi.fn<() => void>()),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: vi.fn<() => boolean>().mockReturnValue(true) }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: toastSuccess, error: vi.fn<() => void>() },
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: (text: string) => copyMock(text),
}))

vi.mock('@/features/library/components/LibraryCreatorModal.vue', () => ({
  default: { name: 'LibraryCreatorModal', props: ['library', 'initialSection', 'template'], template: '<div data-testid="library-creator" />' },
}))

// --- Module-level mutable state ---

import { ref } from 'vue'
import type { ScanProgressEvent } from '@bookorbit/types'

const librariesRef = ref<Library[]>([])
const progressRef = ref<Map<number, ScanProgressEvent>>(new Map())
const overviewRef = ref<LibraryOverviewEntry[]>([])
const historyRef = ref<LibraryScanHistoryEntry[]>([])
const accessRef = ref<LibraryAccessEntry[]>([])
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()
type ToastOptions = { action?: { label: string; onClick: () => void }; description?: string }
const toastSuccess = vi.hoisted(() => vi.fn<(message: string, options?: ToastOptions) => void>())
const copyMock = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())

// --- Factory helpers ---

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
    type: 'books',
    name: 'Test Library',
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_file',
    addedAtSource: 'imported',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 90,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 500,
    fileWriteAllFiles: false,
    fileWriteReadAlongEnabled: false,
    fileWriteReadAlongMaxFileSizeMb: 1000,
    fileRenameEnabled: false,
    folders: [{ id: 1, path: '/books', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeScan(overrides: Partial<LibraryLastScan> = {}): LibraryLastScan {
  return {
    status: 'completed',
    triggeredBy: 'manual',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    completedAt: new Date().toISOString(),
    addedCount: 0,
    updatedCount: 0,
    missingCount: 0,
    errorMessage: null,
    ...overrides,
  }
}

function makeEntry(overrides: Partial<LibraryOverviewEntry> = {}): LibraryOverviewEntry {
  return { libraryId: 1, totalBooks: 0, totalSizeBytes: 0, formatCounts: {}, lastScan: null, ...overrides }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/library/:id', name: 'library', component: { template: '<div />' } },
      { path: '/settings/appearance/theme', name: 'settings-appearance-theme', component: { template: '<div />' } },
      { path: '/tools/missing-resources', name: 'tools-missing-resources', component: { template: '<div />' } },
    ],
  })
}

import LibrariesSettings from '../LibrariesSettings.vue'
import LibraryAutomationList from '../libraries/components/LibraryAutomationList.vue'
import LibraryDetailPanel from '../libraries/components/LibraryDetailPanel.vue'
import LibraryRowActions from '../libraries/components/LibraryRowActions.vue'

/** Every mount is tracked so a leftover component's watchers cannot react to a later test's state. */
const mounted: ReturnType<typeof mount>[] = []

function mountComponent(options: { realTeleport?: boolean } = {}) {
  const wrapper = mount(LibrariesSettings, {
    attachTo: document.body,
    global: {
      plugins: [makeRouter()],
      stubs: {
        // Dialogs portal to the body, so the delete test opts into the real Teleport.
        ...(options.realTeleport ? {} : { Teleport: true as const }),
        TooltipProvider: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
  mounted.push(wrapper)
  return wrapper
}

/** The ledger and the mobile cards both render under jsdom, so assertions read the ledger alone. */
function tableText(wrapper: ReturnType<typeof mountComponent>): string {
  return wrapper.get('[data-testid="libraries-ledger-list"]').text()
}

function ledgerRows(wrapper: ReturnType<typeof mountComponent>) {
  return wrapper.findAll('[data-testid="library-row-toggle"]').map((toggle) => toggle.element.closest('.rounded-xl')!)
}

async function mountLoaded(options: { realTeleport?: boolean } = {}) {
  const wrapper = mountComponent(options)
  await flushPromises()
  return wrapper
}

describe('LibrariesSettings ledger', () => {
  afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.unmount()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    librariesRef.value = []
    progressRef.value = new Map()
    overviewRef.value = []
    historyRef.value = []
    accessRef.value = []
    apiMock.mockImplementation(async (path: unknown) => {
      const url = String(path)
      if (url.endsWith('/libraries/overview')) return { ok: true, json: async () => overviewRef.value }
      if (url.includes('/scan-history')) return { ok: true, json: async () => historyRef.value }
      if (url.endsWith('/access')) return { ok: true, json: async () => accessRef.value }
      return { ok: true, json: async () => ({}) }
    })
  })

  describe('stats loading', () => {
    it('loads every library from a single overview request instead of one call each', async () => {
      librariesRef.value = [makeLibrary({ id: 1 }), makeLibrary({ id: 2, name: 'Second' }), makeLibrary({ id: 3, name: 'Third' })]
      await mountLoaded()
      const statsCalls = apiMock.mock.calls.filter((call) => String(call[0]).includes('stats') || String(call[0]).includes('overview'))
      expect(statsCalls).toHaveLength(1)
      expect(statsCalls[0]?.[0]).toBe('/api/v1/libraries/overview')
    })

    it('surfaces an error instead of leaving rows silently blank when the overview fails', async () => {
      librariesRef.value = [makeLibrary()]
      apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })
      const wrapper = await mountLoaded()
      expect(wrapper.get('[role="alert"]').text()).toContain('Could not load library counts')
    })

    it('renders counts and size from the overview payload', async () => {
      librariesRef.value = [makeLibrary({ id: 99 })]
      overviewRef.value = [makeEntry({ libraryId: 99, totalBooks: 42, totalSizeBytes: 5 * 1024 * 1024 })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('42')
      expect(tableText(wrapper)).toContain('5 MB')
    })
  })

  describe('identity cell', () => {
    it('names the organization the way the editor does', async () => {
      librariesRef.value = [makeLibrary({ organizationMode: 'book_per_folder' })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('Folder as Book')
      expect(tableText(wrapper)).not.toContain('File as Book')
      expect(tableText(wrapper)).not.toContain('Folder mode')
    })

    it('cuts a long path from the start so the folder that names the library stays visible', async () => {
      librariesRef.value = [
        makeLibrary({
          folders: [{ id: 1, path: '/mnt/user/media/bookorbit/books/Novels', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }],
        }),
      ]
      const wrapper = await mountLoaded()
      const path = wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="library-path"]')
      expect(path.classes()).toContain('library-path')
      expect(path.get('bdi').attributes('dir')).toBe('ltr')
      expect(path.get('bdi span').text()).toBe('Novels')
      expect(path.text()).toBe('/mnt/user/media/bookorbit/books/Novels')
    })

    it('does not show both mode badges at the same time', async () => {
      librariesRef.value = [makeLibrary({ organizationMode: 'book_per_file' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('Folder mode')
    })

    it('prints the whole folder path in the ledger rather than hiding it behind a hover', async () => {
      librariesRef.value = [
        makeLibrary({ folders: [{ id: 1, path: '/srv/media/books/novels', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }] }),
      ]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('/srv/media/books/novels')
    })

    it('keeps the identifying tail of the path on the narrower mobile card', async () => {
      librariesRef.value = [
        makeLibrary({ folders: [{ id: 1, path: '/srv/media/books/novels', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }] }),
      ]
      const wrapper = await mountLoaded()
      expect(wrapper.get('[data-testid="libraries-ledger-cards"]').text()).toContain('…/books/novels')
    })
  })

  describe('folders badge', () => {
    it('leaves the count out for a single folder, which the path line already shows', async () => {
      librariesRef.value = [makeLibrary({ folders: [{ id: 1, path: '/books', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }] })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).not.toContain('1 folder')
    })

    it('shows "3 folders" for three folders', async () => {
      librariesRef.value = [
        makeLibrary({
          folders: [
            { id: 1, path: '/books/a', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 2, path: '/books/b', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 3, path: '/books/c', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      ]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('3 folders')
    })

    it('counts the remaining folders and keeps every path in the tooltip', async () => {
      librariesRef.value = [
        makeLibrary({
          folders: [
            { id: 1, path: '/books/fiction', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 2, path: '/books/nonfiction', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      ]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('+1 folder')
      expect(wrapper.html()).toContain('/books/fiction')
      expect(wrapper.html()).toContain('/books/nonfiction')
    })
  })

  describe('automation', () => {
    it('spells out all four settings with their state, on or off', async () => {
      librariesRef.value = [makeLibrary({ watch: true, autoScanCronExpression: null, fileWriteEnabled: false, fileRenameEnabled: true })]
      const wrapper = await mountLoaded()
      const items = wrapper.get('[data-testid="libraries-ledger-list"]').findAll('li')
      expect(items).toHaveLength(4)
      expect(items.map((item) => item.text().replace(/\s+/g, ' '))).toEqual([
        'Watch foldersOn',
        'Scheduled scanOff',
        'Write to fileOff',
        'Rename filesOn',
      ])
    })

    it('makes every setting except the schedule a switch, so its state is not colour-only', async () => {
      librariesRef.value = [makeLibrary({ watch: true, fileWriteEnabled: false, fileRenameEnabled: true })]
      const wrapper = await mountLoaded()
      const list = wrapper.get('[data-testid="libraries-ledger-list"]')
      const switchFor = (key: string) => list.get(`[data-testid="automation-${key}"] [role="switch"]`)
      expect(switchFor('watch').attributes('aria-checked')).toBe('true')
      expect(switchFor('fileWrite').attributes('aria-checked')).toBe('false')
      expect(switchFor('fileRename').attributes('aria-checked')).toBe('true')
      expect(switchFor('watch').attributes('aria-label')).toBe('Watch folders for Test Library')
    })

    it('names a schedule the way the editor does, with the full description on hover', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: '0 2 * * *' })]
      const wrapper = await mountLoaded()
      const trigger = wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="schedule-trigger"]')
      expect(trigger.text()).toBe('Daily · 2:00 AM')
      expect(trigger.attributes('title')).toContain('02:00 AM')
    })

    it('names a weekly schedule with its day and time', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: '0 0 * * 1' })]
      const wrapper = await mountLoaded()
      expect(wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="schedule-trigger"]').text()).toBe('Weekly · Mon 12:00 AM')
    })

    it('keeps the full description for a schedule the presets cannot name', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: '15 3 1 * *' })]
      const wrapper = await mountLoaded()
      expect(wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="schedule-trigger"]').text()).toContain('03:15 AM')
    })

    it('saves a switch straight from the row and offers to undo it', async () => {
      librariesRef.value = [makeLibrary({ id: 3, name: 'Comics', watch: false })]
      const wrapper = await mountLoaded()
      await wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="automation-watch"] [role="switch"]').trigger('click')
      await flushPromises()

      const patch = () => apiMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
      expect(patch()).toHaveLength(1)
      expect(patch()[0]![0]).toBe('/api/v1/libraries/3')
      expect(JSON.parse(String((patch()[0]![1] as RequestInit).body))).toEqual({ watch: true })

      const [message, options] = toastSuccess.mock.calls.at(-1)!
      expect(message).toBe('Watching folders for "Comics"')
      expect(options?.action?.label).toBe('Undo')
      options!.action!.onClick()
      await flushPromises()
      expect(JSON.parse(String((patch()[1]![1] as RequestInit).body))).toEqual({ watch: false })
    })

    it('sends only the setting that changed, so nothing else about the library is touched', async () => {
      librariesRef.value = [makeLibrary({ id: 3, fileRenameEnabled: false })]
      const wrapper = await mountLoaded()
      await wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="automation-fileRename"] [role="switch"]').trigger('click')
      await flushPromises()
      const call = apiMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ fileRenameEnabled: true })
    })

    it('saves a schedule preset picked from the row', async () => {
      librariesRef.value = [makeLibrary({ id: 3, name: 'Comics', autoScanCronExpression: null })]
      const wrapper = await mountLoaded()
      wrapper.findComponent(LibraryAutomationList).vm.$emit('setSchedule', librariesRef.value[0]!, '0 0 * * 1')
      await flushPromises()
      const call = apiMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH')!
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ autoScanCronExpression: '0 0 * * 1' })
      expect(toastSuccess.mock.calls.at(-1)?.[0]).toBe('Scheduled scan for "Comics": Weekly · Mon 12:00 AM')
    })

    it('opens the editor on Automation for a custom schedule', async () => {
      librariesRef.value = [makeLibrary({ id: 3 })]
      const wrapper = await mountLoaded()
      wrapper.findComponent(LibraryAutomationList).vm.$emit('editSchedule', librariesRef.value[0]!)
      await flushPromises()
      expect(wrapper.findComponent({ name: 'LibraryCreatorModal' }).props('initialSection')).toBe('schedule')
    })
  })

  describe('format bar', () => {
    it('uses formatCounts the row has room for, as a labelled bar', async () => {
      librariesRef.value = [makeLibrary({ id: 7 })]
      overviewRef.value = [makeEntry({ libraryId: 7, totalBooks: 381, formatCounts: { epub: 305, azw3: 34, mobi: 23 } })]
      const wrapper = await mountLoaded()
      const bar = wrapper.get('[data-testid="libraries-ledger-list"] [role="img"]')
      expect(bar.attributes('aria-label')).toBe('EPUB 305, AZW3 34, MOBI 23')
      expect(bar.findAll('span')).toHaveLength(3)
    })

    it('spells the breakdown out on mobile, where there is width for it', async () => {
      librariesRef.value = [makeLibrary({ id: 7 })]
      overviewRef.value = [makeEntry({ libraryId: 7, totalBooks: 381, formatCounts: { epub: 305, azw3: 34, mobi: 23, fb2: 13 } })]
      const wrapper = await mountLoaded()
      const cards = wrapper.get('[data-testid="libraries-ledger-cards"]').text()
      expect(cards).toContain('EPUB')
      expect(cards).toContain('305')
      expect(cards).toContain('+2 more formats')
    })

    it('keeps an empty library on the same track rather than swapping in a text line', async () => {
      librariesRef.value = [makeLibrary({ id: 7 })]
      overviewRef.value = [makeEntry({ libraryId: 7 })]
      const wrapper = await mountLoaded()
      const bar = wrapper.get('[data-testid="libraries-ledger-list"] [role="img"]')
      expect(bar.attributes('aria-label')).toBe('No files indexed')
      expect(bar.findAll('span')).toHaveLength(0)
      expect(wrapper.get('[data-testid="libraries-ledger-cards"]').text()).toContain('No files indexed')
    })
  })

  describe('last scan', () => {
    it('reports a completed scan with its trigger and deltas', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan({ triggeredBy: 'watcher', addedCount: 3 }) })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('Watcher')
      expect(tableText(wrapper)).toContain('+3 added')
    })

    it('reads the trigger as a description and colours what was added and what went missing', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan({ triggeredBy: 'schedule', addedCount: 2, missingCount: 11 }) })]
      const wrapper = await mountLoaded()
      const status = wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="scan-status"]')
      expect(status.text()).toContain('Scheduled · +2 added, 11 missing')
      expect(
        status
          .findAll('span')
          .find((span) => span.text() === '+2 added')!
          .classes(),
      ).toContain('text-[var(--pill-success)]')
      expect(
        status
          .findAll('span')
          .find((span) => span.text() === '11 missing')!
          .classes(),
      ).toContain('text-[var(--pill-warning)]')
    })

    it('opens the last ten scans from the last-scan line', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan() })]
      // The popover portals to the body, so this test opts into the real Teleport.
      const wrapper = await mountLoaded({ realTeleport: true })
      await wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="scan-status"]').trigger('click')
      await flushPromises()
      const call = apiMock.mock.calls.find((c) => String(c[0]).includes('scan-history'))
      expect(String(call?.[0])).toBe('/api/v1/scanner/libraries/4/scan-history?limit=10')
    })

    it('shows what a running scan has found so far', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan() })]
      progressRef.value = new Map([[4, { jobId: 1, libraryId: 4, status: 'running', processed: 40, total: 100, added: 3, updated: 2, missing: 0 }]])
      const wrapper = await mountLoaded()
      expect(wrapper.get('[data-testid="libraries-ledger-list"] [data-testid="scan-live"]').text()).toContain('+3 added, 2 updated')
    })

    it('offers the one repair a failed or never-scanned library needs, inside its row', async () => {
      librariesRef.value = [makeLibrary({ id: 4, name: 'Novels' }), makeLibrary({ id: 5, name: 'Manga' })]
      overviewRef.value = [
        makeEntry({ libraryId: 4, lastScan: makeScan({ status: 'failed', errorMessage: 'Server restarted during scan' }) }),
        makeEntry({ libraryId: 5 }),
      ]
      const wrapper = await mountLoaded()
      const strips = wrapper.get('[data-testid="libraries-ledger-list"]').findAll('[data-testid="library-problem"]')
      expect(strips).toHaveLength(2)
      expect(strips[0]!.text()).toContain('The last scan failed')
      expect(strips[0]!.text()).toContain('Server restarted during scan')
      expect(strips[0]!.text()).toContain('Retry scan')
      expect(strips[1]!.text()).toContain('Never scanned.')

      await strips[1]!.get('button').trigger('click')
      await flushPromises()
      expect(apiMock.mock.calls.some((c) => String(c[0]) === '/api/v1/scanner/libraries/5/scan')).toBe(true)
    })

    it('adds no strip for a scan that only found missing books', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan({ missingCount: 11 }) })]
      const wrapper = await mountLoaded()
      expect(wrapper.get('[data-testid="libraries-ledger-list"]').find('[data-testid="library-problem"]').exists()).toBe(false)
    })

    it('says "no change" rather than going blank when a scan found nothing', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan({ triggeredBy: 'schedule' }) })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('no change')
    })

    it('flags a library that has never been scanned', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: null })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('Never scanned')
      expect(ledgerRows(wrapper)[0]!.className).toContain('pill-warning')
    })

    it('shows the failure and its error text', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan({ status: 'failed', errorMessage: 'ENOENT: /books' }) })]
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('Failed')
      expect(tableText(wrapper)).toContain('ENOENT: /books')
      expect(ledgerRows(wrapper)[0]!.className).toContain('destructive')
    })

    it('replaces the cell with live progress while a scan runs, without adding a row', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan() })]
      progressRef.value = new Map([[4, { jobId: 1, libraryId: 4, status: 'running', processed: 620, total: 1000, added: 0, updated: 0, missing: 0 }]])
      const wrapper = await mountLoaded()
      expect(tableText(wrapper)).toContain('Scanning 62%')
      expect(tableText(wrapper)).toContain('620 of 1,000')
      expect(ledgerRows(wrapper)).toHaveLength(1)
      expect(wrapper.get('[data-testid="libraries-ledger-list"] [role="progressbar"]').attributes('aria-valuenow')).toBe('62')
    })
  })

  describe('filtering and sorting', () => {
    beforeEach(() => {
      librariesRef.value = [
        makeLibrary({ id: 1, name: 'Novels', folders: [{ id: 1, path: '/srv/novels', role: 'downloads', createdAt: '2024-01-01T00:00:00.000Z' }] }),
        makeLibrary({ id: 2, name: 'Comics', folders: [{ id: 2, path: '/srv/comics', role: 'downloads', createdAt: '2024-01-01T00:00:00.000Z' }] }),
      ]
      overviewRef.value = [makeEntry({ libraryId: 1, totalBooks: 381 }), makeEntry({ libraryId: 2, totalBooks: 23 })]
    })

    it('filters by name', async () => {
      const wrapper = await mountLoaded()
      await wrapper.get('input[type="search"]').setValue('comi')
      expect(tableText(wrapper)).toContain('Comics')
      expect(tableText(wrapper)).not.toContain('Novels')
    })

    it('filters by folder path', async () => {
      const wrapper = await mountLoaded()
      await wrapper.get('input[type="search"]').setValue('/srv/novels')
      expect(tableText(wrapper)).toContain('Novels')
      expect(tableText(wrapper)).not.toContain('Comics')
    })

    it('offers a way back when nothing matches', async () => {
      const wrapper = await mountLoaded()
      await wrapper.get('input[type="search"]').setValue('nothing here')
      expect(wrapper.text()).toContain('No libraries match that filter')
      expect(wrapper.find('[data-testid="libraries-ledger-list"]').exists()).toBe(false)
    })

    it('reorders rows when the sort changes', async () => {
      const wrapper = await mountLoaded()
      const names = () => ledgerRows(wrapper).map((row) => row.textContent ?? '')
      expect(names()[0]).toContain('Novels')
      await wrapper.get('select').setValue('name')
      expect(names()[0]).toContain('Comics')
    })

    it('summarises the collection in the toolbar', async () => {
      const wrapper = await mountLoaded()
      expect(wrapper.text()).toContain('2 libraries')
      expect(wrapper.text()).toContain('404 books')
      expect(wrapper.text()).toContain('2 folders')
    })
  })

  describe('empty state', () => {
    it('shows the empty state when there are no libraries', async () => {
      const wrapper = await mountLoaded()
      expect(wrapper.text()).toContain('No libraries yet')
    })

    it('hides the empty state when libraries exist', async () => {
      librariesRef.value = [makeLibrary()]
      const wrapper = await mountLoaded()
      expect(wrapper.text()).not.toContain('No libraries yet')
    })
  })

  describe('scan completion', () => {
    it('reacts once per finished job however many socket ticks carry it', async () => {
      librariesRef.value = [makeLibrary({ id: 4 })]
      overviewRef.value = [makeEntry({ libraryId: 4 })]
      const wrapper = await mountLoaded()
      const overviewCalls = () => apiMock.mock.calls.filter((call) => String(call[0]).endsWith('/libraries/overview')).length
      const before = overviewCalls()

      const done: ScanProgressEvent = { jobId: 77, libraryId: 4, status: 'completed', processed: 5, total: 5, added: 1, updated: 0, missing: 0 }
      progressRef.value = new Map([[4, done]])
      await flushPromises()
      // The same completed event is re-published while it lingers in the map.
      progressRef.value = new Map([[4, { ...done }]])
      await flushPromises()
      progressRef.value = new Map([[4, { ...done }]])
      await flushPromises()

      // The overview reload is debounced by 750ms.
      await new Promise((resolve) => setTimeout(resolve, 900))
      await flushPromises()

      expect(overviewCalls() - before).toBe(1)
      wrapper.unmount()
    })
  })

  describe('detail panel', () => {
    beforeEach(() => {
      librariesRef.value = [makeLibrary({ id: 4, name: 'Novels' })]
      overviewRef.value = [makeEntry({ libraryId: 4, totalBooks: 381, lastScan: makeScan() })]
    })

    async function expandFirst(wrapper: ReturnType<typeof mountComponent>) {
      await wrapper.get('[data-testid="library-row-toggle"]').trigger('click')
      await flushPromises()
    }

    it('fetches nothing until a row is opened', async () => {
      const wrapper = await mountLoaded()
      expect(apiMock.mock.calls.filter((call) => String(call[0]).includes('scan-history'))).toHaveLength(0)
      await expandFirst(wrapper)
      expect(apiMock.mock.calls.filter((call) => String(call[0]).includes('scan-history'))).toHaveLength(1)
    })

    it('caps the history request so a caller cannot ask for an unbounded page', async () => {
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const call = apiMock.mock.calls.find((c) => String(c[0]).includes('scan-history'))
      expect(String(call?.[0])).toBe('/api/v1/scanner/libraries/4/scan-history?limit=5')
    })

    it('shows configuration the row cannot hold', async () => {
      librariesRef.value = [
        makeLibrary({
          id: 4,
          name: 'Novels',
          excludePatterns: ['*.tmp'],
          metadataPrecedence: ['embedded', 'opfFile'],
          readingThreshold: 0.25,
          markAsFinishedPercentComplete: 98,
        }),
      ]
      accessRef.value = [
        { userId: 1, username: 'maya', name: 'Maya Ortiz', accessLevel: 'viewer' },
        { userId: 2, username: 'sam', name: 'Sam Whitfield', accessLevel: 'viewer' },
      ]
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.get('[id="library-detail-4"]').text()
      expect(panel).toContain('Embedded metadata, OPF files')
      expect(panel).toContain('All supported')
      expect(panel).toContain('1 pattern')
      expect(panel).toContain('0.25%')
      expect(panel).toContain('98%')
      expect(panel).toContain('Maya Ortiz')
      expect(panel).toContain('Sam Whitfield')
    })

    it.each([
      { threshold: 0.05, expected: '0.05%' },
      { threshold: 0.25, expected: '0.25%' },
      { threshold: 0.5, expected: '0.5%' },
      { threshold: 1, expected: '1%' },
      { threshold: 5, expected: '5%' },
    ])('shows a $threshold% reading threshold as $expected', async ({ threshold, expected }) => {
      librariesRef.value = [makeLibrary({ id: 4, readingThreshold: threshold, markAsFinishedPercentComplete: 98 })]
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.get('[id="library-detail-4"]')
      const startedLabel = panel.findAll('dt').find((label) => label.text() === 'Counts as started')
      const finishedLabel = panel.findAll('dt').find((label) => label.text() === 'Counts as finished')
      expect(startedLabel?.element.nextElementSibling?.textContent?.trim()).toBe(expected)
      expect(finishedLabel?.element.nextElementSibling?.textContent?.trim()).toBe('98%')
    })

    it.each([
      { threshold: 90, expected: '90%' },
      { threshold: 98.05, expected: '98.05%' },
      { threshold: 99.95, expected: '99.95%' },
      { threshold: 100, expected: '100%' },
    ])('shows a $threshold% finished threshold as $expected', async ({ threshold, expected }) => {
      librariesRef.value = [makeLibrary({ id: 4, readingThreshold: 0.25, markAsFinishedPercentComplete: threshold })]
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.get('[id="library-detail-4"]')
      const finishedLabel = panel.findAll('dt').find((label) => label.text() === 'Counts as finished')
      expect(finishedLabel?.element.nextElementSibling?.textContent?.trim()).toBe(expected)
    })

    it('renders the scan history with trigger and deltas', async () => {
      historyRef.value = [
        { id: 9, ...makeScan({ triggeredBy: 'watcher', addedCount: 3, updatedCount: 1 }) },
        { id: 8, ...makeScan({ status: 'failed', errorMessage: 'ENOENT: /books' }) },
      ]
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.get('[id="library-detail-4"]').text()
      expect(panel).toContain('Watcher')
      expect(panel).toContain('+3 added')
      expect(panel).toContain('ENOENT: /books')
      expect(panel).toContain('Failed')
      expect(panel).toContain('Completed')
    })

    it('says so when a library has never been scanned', async () => {
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      expect(wrapper.get('[id="library-detail-4"]').text()).toContain('never been scanned')
    })

    it('surfaces a failed detail fetch instead of showing an empty panel', async () => {
      apiMock.mockImplementation(async (path: unknown) => {
        const url = String(path)
        if (url.endsWith('/libraries/overview')) return { ok: true, json: async () => overviewRef.value }
        return { ok: false, json: async () => ({}) }
      })
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      expect(wrapper.get('[id="library-detail-4"]').text()).toContain('Could not load the scan history')
    })

    it('opens the editor at the section beside each Edit button', async () => {
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.findComponent(LibraryDetailPanel)
      const editor = () => wrapper.findComponent({ name: 'LibraryCreatorModal' })

      panel.vm.$emit('edit', librariesRef.value[0]!, 'folders')
      await flushPromises()
      expect(editor().props('initialSection')).toBe('folders')
      expect(editor().props('library')).toEqual(librariesRef.value[0])
    })

    it('shows the whole path and copies it', async () => {
      librariesRef.value = [
        makeLibrary({
          id: 4,
          folders: [{ id: 9, path: '/mnt/user/media/bookorbit/books/Novels', role: 'downloads' as const, createdAt: '2024-01-01T00:00:00.000Z' }],
        }),
      ]
      copyMock.mockResolvedValue(true)
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const panel = wrapper.get('[id="library-detail-4"]')
      expect(panel.get('[data-testid="library-full-path"]').classes()).toContain('break-all')
      await panel.get('button[aria-label="Copy path"]').trigger('click')
      await flushPromises()
      expect(copyMock).toHaveBeenCalledWith('/mnt/user/media/bookorbit/books/Novels')
      expect(toastSuccess).toHaveBeenCalledWith('Path copied')
    })

    it('lists the first people with access and counts the rest', async () => {
      accessRef.value = ['Ana Beck', 'Jules Marchand', 'Maya Ortiz', 'Priya Raman', 'Sam Whitfield'].map((name, index) => ({
        userId: index + 1,
        username: name.toLowerCase(),
        name,
        accessLevel: 'viewer' as const,
      }))
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const people = wrapper.get('[data-testid="library-access-people"]').text()
      expect(people).toContain('Ana Beck')
      expect(people).toContain('Maya Ortiz')
      expect(people).not.toContain('Priya Raman')
      expect(people).toContain('+2 more')
    })

    it('keeps completed scans plain so a failure stands out', async () => {
      historyRef.value = [
        { id: 1, ...makeScan() },
        { id: 2, ...makeScan({ status: 'failed', errorMessage: 'ENOENT: /books' }) },
      ]
      const wrapper = await mountLoaded()
      await expandFirst(wrapper)
      const statusCells = wrapper.get('[id="library-detail-4"] table').findAll('tbody tr td:last-child span')
      expect(statusCells[0]!.classes()).not.toContain('rounded-full')
      expect(statusCells[1]!.classes()).toContain('rounded-full')
    })

    it('opens the details from a click anywhere on the row, but not from its controls', async () => {
      const wrapper = await mountLoaded()
      await wrapper.get('[data-testid="library-row"] .grid').trigger('click')
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(true)

      await wrapper.get('[data-testid="library-row"] a').trigger('click')
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(true)
    })

    it('opens on a click on the chevron icon even when the icon is replaced mid-click', async () => {
      const wrapper = await mountLoaded()
      const row = wrapper.get('[data-testid="library-row"]').element
      const icon = wrapper.get('[data-testid="library-row-toggle"] svg').element
      // A browser can re-render between one click's listeners; detaching the icon before the row's own
      // handler runs reproduces that, and the row must still see that the click came from the button.
      const detach = () => icon.remove()
      row.addEventListener('click', detach, { capture: true, once: true })
      icon.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(true)
    })

    it('opens one row at a time and closes on a second click', async () => {
      librariesRef.value = [makeLibrary({ id: 4, name: 'Novels' }), makeLibrary({ id: 5, name: 'Comics' })]
      overviewRef.value = [makeEntry({ libraryId: 4 }), makeEntry({ libraryId: 5 })]
      const wrapper = await mountLoaded()
      const toggles = () => wrapper.findAll('[data-testid="library-row-toggle"]')

      await toggles()[0]!.trigger('click')
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(true)

      await toggles()[1]!.trigger('click')
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(false)
      expect(wrapper.find('[id="library-detail-5"]').exists()).toBe(true)

      await toggles()[1]!.trigger('click')
      await flushPromises()
      expect(wrapper.find('[id="library-detail-5"]').exists()).toBe(false)
    })

    it('marks the toggle as controlling its panel', async () => {
      const wrapper = await mountLoaded()
      const toggle = wrapper.get('[data-testid="library-row-toggle"]')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.attributes('aria-controls')).toBe('library-detail-4')
      await expandFirst(wrapper)
      expect(wrapper.get('[data-testid="library-row-toggle"]').attributes('aria-expanded')).toBe('true')
    })
  })

  describe('delete confirmation', () => {
    it('uses the shared dialog and only enables delete once the name matches', async () => {
      const headerTarget = document.createElement('div')
      headerTarget.id = 'settings-header-actions'
      document.body.appendChild(headerTarget)
      librariesRef.value = [makeLibrary({ id: 5, name: 'Novels' })]
      const wrapper = await mountLoaded({ realTeleport: true })

      wrapper.findComponent(LibraryRowActions).vm.$emit('remove', librariesRef.value[0]!)
      await flushPromises()

      const dialog = document.querySelector('[role="dialog"]')
      expect(dialog).not.toBeNull()
      expect(dialog!.textContent).toContain('Delete "Novels"?')

      const confirmButton = () => [...dialog!.querySelectorAll('button')].find((button) => button.textContent?.includes('Delete Library'))
      expect(confirmButton()?.disabled).toBe(true)

      const input = dialog!.querySelector('input') as HTMLInputElement
      input.value = 'Novels'
      input.dispatchEvent(new Event('input'))
      await flushPromises()
      expect(confirmButton()?.disabled).toBe(false)

      wrapper.unmount()
      headerTarget.remove()
    })

    it('closes the editor before asking to delete from its menu, so the dialog is not stacked on it', async () => {
      const headerTarget = document.createElement('div')
      headerTarget.id = 'settings-header-actions'
      document.body.appendChild(headerTarget)
      librariesRef.value = [makeLibrary({ id: 5, name: 'Novels' })]
      const wrapper = await mountLoaded({ realTeleport: true })

      wrapper.findComponent(LibraryRowActions).vm.$emit('edit', librariesRef.value[0]!)
      await flushPromises()
      const editor = wrapper.findComponent({ name: 'LibraryCreatorModal' })
      expect(editor.props('library')).toEqual(librariesRef.value[0])

      editor.vm.$emit('remove', librariesRef.value[0]!)
      await flushPromises()

      expect(wrapper.find('[data-testid="library-creator"]').exists()).toBe(false)
      expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Delete "Novels"?')

      wrapper.unmount()
      headerTarget.remove()
    })

    it("opens a new library seeded from an existing one's settings", async () => {
      librariesRef.value = [makeLibrary({ id: 5, name: 'Novels' })]
      const wrapper = await mountLoaded()
      wrapper.findComponent(LibraryRowActions).vm.$emit('duplicate', librariesRef.value[0]!)
      await flushPromises()
      const editor = wrapper.findComponent({ name: 'LibraryCreatorModal' })
      expect(editor.props('template')).toEqual(librariesRef.value[0])
      expect(editor.props('library')).toBeNull()
    })

    it('announces a finished scan with its outcome and a way to see it', async () => {
      librariesRef.value = [makeLibrary({ id: 4, name: 'Novels' })]
      overviewRef.value = [makeEntry({ libraryId: 4, lastScan: makeScan() })]
      const wrapper = await mountLoaded()
      progressRef.value = new Map([[4, { jobId: 81, libraryId: 4, status: 'completed', processed: 5, total: 5, added: 3, updated: 1, missing: 0 }]])
      await flushPromises()

      const [message, options] = toastSuccess.mock.calls.at(-1)!
      expect(message).toBe('Scan finished for "Novels": +3 added, 1 updated')
      expect(options?.action?.label).toBe('View changes')
      options!.action!.onClick()
      await flushPromises()
      expect(wrapper.find('[id="library-detail-4"]').exists()).toBe(true)
    })

    it('puts the page actions in the settings header slot when one exists', async () => {
      const headerTarget = document.createElement('div')
      headerTarget.id = 'settings-header-actions'
      document.body.appendChild(headerTarget)
      librariesRef.value = [makeLibrary()]
      const wrapper = await mountLoaded({ realTeleport: true })

      expect(headerTarget.textContent).toContain('Add library')
      expect(headerTarget.textContent).toContain('Scan all')

      wrapper.unmount()
      headerTarget.remove()
    })
  })
})
