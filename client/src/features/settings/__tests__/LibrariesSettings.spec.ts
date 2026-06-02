import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import type { Library, LibraryStats } from '@bookorbit/types'

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
    getProgress: vi.fn<() => null>().mockReturnValue(null),
    isScanning: vi.fn<() => boolean>().mockReturnValue(false),
    progressMap: ref(new Map()),
    getCoverRefreshProgress: vi.fn<() => null>().mockReturnValue(null),
    isRefreshingCovers: vi.fn<() => boolean>().mockReturnValue(false),
  }),
  getSocket: vi.fn<() => void>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: vi.fn<() => boolean>().mockReturnValue(true) }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))

vi.mock('./SettingsPageHeader.vue', () => ({
  default: { template: '<div />' },
}))

vi.mock('@/features/library/components/LibraryCreatorModal.vue', () => ({
  default: { template: '<div />' },
}))

// --- Module-level mutable state ---

import { ref } from 'vue'

const librariesRef = ref<Library[]>([])
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json: () => Promise<LibraryStats> }>>()

// --- Factory helpers ---

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 1,
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
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 90,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 100,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 500,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 500,
    fileRenameEnabled: false,
    folders: [{ id: 1, path: '/books', createdAt: '2024-01-01T00:00:00.000Z' }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/library/:id', name: 'library', component: { template: '<div />' } },
      { path: '/settings/appearance', name: 'settings-appearance', component: { template: '<div />' } },
    ],
  })
}

import LibrariesSettings from '../LibrariesSettings.vue'

function mountComponent() {
  return mount(LibrariesSettings, {
    global: {
      plugins: [makeRouter()],
      stubs: {
        Teleport: true,
        TooltipProvider: { template: '<div><slot /></div>' },
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('LibrariesSettings - feature badges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    librariesRef.value = []
    apiMock.mockResolvedValue({
      ok: false,
      json: async () => ({ totalBooks: 0, totalSizeBytes: 0, formatCounts: {} }),
    })
  })

  describe('organization mode badge', () => {
    it('shows "File mode" for book_per_file', async () => {
      librariesRef.value = [makeLibrary({ organizationMode: 'book_per_file' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('File mode')
    })

    it('shows "Folder mode" for book_per_folder', async () => {
      librariesRef.value = [makeLibrary({ organizationMode: 'book_per_folder' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('Folder mode')
    })

    it('does not show both mode badges at the same time', async () => {
      librariesRef.value = [makeLibrary({ organizationMode: 'book_per_file' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('Folder mode')
    })
  })

  describe('folders badge', () => {
    it('shows "1 folder" for a single folder', async () => {
      librariesRef.value = [makeLibrary({ folders: [{ id: 1, path: '/books', createdAt: '2024-01-01T00:00:00.000Z' }] })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('1 folder')
    })

    it('shows "3 folders" for three folders', async () => {
      librariesRef.value = [
        makeLibrary({
          folders: [
            { id: 1, path: '/books/a', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 2, path: '/books/b', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 3, path: '/books/c', createdAt: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      ]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('3 folders')
    })

    it('does not render the folder badge when folders array is empty', async () => {
      librariesRef.value = [makeLibrary({ folders: [] })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toMatch(/\d+ folder/)
    })

    it('renders folder paths inside the tooltip content', async () => {
      librariesRef.value = [
        makeLibrary({
          folders: [
            { id: 1, path: '/books/fiction', createdAt: '2024-01-01T00:00:00.000Z' },
            { id: 2, path: '/books/nonfiction', createdAt: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      ]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.html()).toContain('/books/fiction')
      expect(wrapper.html()).toContain('/books/nonfiction')
    })
  })

  describe('scheduled scan badge', () => {
    it('does not show a schedule badge when autoScanCronExpression is null', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: null })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('AM')
      expect(wrapper.text()).not.toContain('Every')
    })

    it('shows a human-readable schedule when autoScanCronExpression is set', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: '0 2 * * *' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('02:00 AM')
    })

    it('shows schedule for every 5 minutes cron', async () => {
      librariesRef.value = [makeLibrary({ autoScanCronExpression: '*/5 * * * *' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('Every 5 minutes')
    })
  })

  describe('file write badge', () => {
    it('does not show "File write" when fileWriteEnabled is false', async () => {
      librariesRef.value = [makeLibrary({ fileWriteEnabled: false })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('File write')
    })

    it('shows "File write" when fileWriteEnabled is true', async () => {
      librariesRef.value = [makeLibrary({ fileWriteEnabled: true })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('File write')
    })
  })

  describe('file rename badge', () => {
    it('does not show "File rename" when fileRenameEnabled is false', async () => {
      librariesRef.value = [makeLibrary({ fileRenameEnabled: false })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('File rename')
    })

    it('shows "File rename" when fileRenameEnabled is true', async () => {
      librariesRef.value = [makeLibrary({ fileRenameEnabled: true })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('File rename')
    })
  })

  describe('watching badge (regression)', () => {
    it('shows "Watching" when watch is true', async () => {
      librariesRef.value = [makeLibrary({ watch: true })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('Watching')
    })

    it('does not show "Watching" when watch is false', async () => {
      librariesRef.value = [makeLibrary({ watch: false })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('Watching')
    })
  })

  describe('stats row (regression)', () => {
    it('shows book count and size when stats are loaded', async () => {
      librariesRef.value = [makeLibrary({ id: 99 })]
      apiMock.mockResolvedValue({
        ok: true,
        json: async () => ({ totalBooks: 42, totalSizeBytes: 1024 * 1024 * 5, formatCounts: {} }),
      })
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('42 books')
      expect(wrapper.text()).toContain('5')
    })

    it('shows "Added" date when stats have not loaded', async () => {
      librariesRef.value = [makeLibrary({ createdAt: '2024-03-15T00:00:00.000Z' })]
      apiMock.mockResolvedValue({ ok: false, json: async () => ({ totalBooks: 0, totalSizeBytes: 0, formatCounts: {} }) })
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('Added')
    })
  })

  describe('empty state (regression)', () => {
    it('shows empty state when there are no libraries', async () => {
      librariesRef.value = []
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('No libraries yet')
    })

    it('hides the empty state when libraries exist', async () => {
      librariesRef.value = [makeLibrary()]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).not.toContain('No libraries yet')
    })
  })

  describe('multiple libraries', () => {
    it('renders a card for each library', async () => {
      librariesRef.value = [makeLibrary({ id: 1, name: 'Fiction' }), makeLibrary({ id: 2, name: 'Non-Fiction' })]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('Fiction')
      expect(wrapper.text()).toContain('Non-Fiction')
    })

    it('shows independent badge states per card', async () => {
      librariesRef.value = [
        makeLibrary({ id: 1, name: 'Lib A', fileWriteEnabled: true, fileRenameEnabled: false }),
        makeLibrary({ id: 2, name: 'Lib B', fileWriteEnabled: false, fileRenameEnabled: true }),
      ]
      const wrapper = mountComponent()
      await flushPromises()
      expect(wrapper.text()).toContain('File write')
      expect(wrapper.text()).toContain('File rename')
    })
  })
})
