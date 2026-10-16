import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ScanProgressEvent } from '@bookorbit/types'
import type { PodcastImportState } from '@/features/podcast/composables/usePodcastImportProgress'
import { useSidebarLibraryActivity } from '../useSidebarLibraryActivity'

interface ImportLane {
  subscribeLibrary: (libraryId: number) => void
  getImport: (libraryId: number) => PodcastImportState | null
  importPct: (libraryId: number) => number
  importBarWidth: (libraryId: number) => string
}

const mocks = vi.hoisted(() => ({
  features: { podcasts: true },
  scans: new Map<number, Partial<ScanProgressEvent>>(),
  imports: new Map<number, PodcastImportState>(),
  subscribeScan: undefined as unknown as Mock<(libraryId: number) => void>,
  subscribeImport: undefined as unknown as Mock<(libraryId: number) => void>,
  usePodcastImportProgress: undefined as unknown as Mock<() => ImportLane>,
}))

vi.mock('@bookorbit/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bookorbit/types')>()
  return { ...actual, APP_FEATURES: mocks.features }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({
    subscribeLibrary: mocks.subscribeScan,
    getProgress: (libraryId: number) => mocks.scans.get(libraryId),
  }),
}))

vi.mock('@/features/podcast/composables/usePodcastImportProgress', () => ({
  usePodcastImportProgress: () => mocks.usePodcastImportProgress(),
}))

function importState(libraryId: number, overrides: Partial<PodcastImportState> = {}): PodcastImportState {
  return { libraryId, processed: 0, total: null, failed: 0, active: true, ...overrides }
}

describe('useSidebarLibraryActivity', () => {
  beforeEach(() => {
    mocks.features.podcasts = true
    mocks.scans.clear()
    mocks.imports.clear()
    mocks.subscribeScan = vi.fn<(libraryId: number) => void>()
    mocks.subscribeImport = vi.fn<(libraryId: number) => void>()
    mocks.usePodcastImportProgress = vi.fn<() => ImportLane>(() => ({
      subscribeLibrary: mocks.subscribeImport,
      getImport: (libraryId: number) => mocks.imports.get(libraryId) ?? null,
      importPct: () => 25,
      importBarWidth: () => '25%',
    }))
  })

  describe('book libraries', () => {
    const library = { id: 1, type: 'books' }

    it('report nothing unless a scan is running', () => {
      const { activityFor } = useSidebarLibraryActivity()
      expect(activityFor(library)).toBeNull()

      mocks.scans.set(1, { status: 'completed', processed: 10, total: 10 })
      expect(activityFor(library)).toBeNull()
    })

    it('report a running scan as a floored percentage of its total', () => {
      mocks.scans.set(1, { status: 'running', processed: 1, total: 3 })

      expect(useSidebarLibraryActivity().activityFor(library)).toEqual({
        pct: 33,
        barWidth: '33%',
        label: 'components.sidebar.scanProgress {"processed":"1","total":"3"}',
      })
    })

    it('show a fixed sliver while the scan has no total yet', () => {
      mocks.scans.set(1, { status: 'running', processed: 0, total: 0 })

      expect(useSidebarLibraryActivity().activityFor(library)).toMatchObject({ pct: 0, barWidth: '30%' })
    })
  })

  describe('podcast libraries', () => {
    const library = { id: 20, type: 'podcasts' }

    it('read the import lane, never the book scan', () => {
      mocks.scans.set(20, { status: 'running', processed: 5, total: 10 })
      const { activityFor } = useSidebarLibraryActivity()
      expect(activityFor(library)).toBeNull()

      mocks.imports.set(20, importState(20, { processed: 1, total: 4 }))
      expect(activityFor(library)).toEqual({
        pct: 25,
        barWidth: '25%',
        label: 'components.sidebar.podcastImportProgress {"processed":"1","total":"4"}',
      })
    })

    it('say the import is still counting until it knows its total', () => {
      mocks.imports.set(20, importState(20, { total: null }))

      expect(useSidebarLibraryActivity().activityFor(library)?.label).toBe('components.sidebar.podcastImportCounting')
    })

    it('drop the readout once the import settles', () => {
      mocks.imports.set(20, importState(20, { processed: 4, total: 4, active: false }))

      expect(useSidebarLibraryActivity().activityFor(library)).toBeNull()
    })

    it('report nothing, and never open the import lane, while the podcasts feature is off', () => {
      mocks.features.podcasts = false
      mocks.imports.set(20, importState(20, { processed: 1, total: 4 }))

      expect(useSidebarLibraryActivity().activityFor(library)).toBeNull()
      expect(mocks.usePodcastImportProgress).not.toHaveBeenCalled()
    })
  })

  describe('subscribe', () => {
    it('watches only the scan channel for a book library', () => {
      useSidebarLibraryActivity().subscribe({ id: 1, type: 'books' })

      expect(mocks.subscribeScan).toHaveBeenCalledWith(1)
      expect(mocks.subscribeImport).not.toHaveBeenCalled()
    })

    it('watches both channels for a podcast library', () => {
      useSidebarLibraryActivity().subscribe({ id: 20, type: 'podcasts' })

      expect(mocks.subscribeScan).toHaveBeenCalledWith(20)
      expect(mocks.subscribeImport).toHaveBeenCalledWith(20)
    })
  })
})
