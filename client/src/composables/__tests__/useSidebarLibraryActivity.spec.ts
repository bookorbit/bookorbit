import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ScanProgressEvent } from '@bookorbit/types'
import { useSidebarLibraryActivity } from '../useSidebarLibraryActivity'

const mocks = vi.hoisted(() => ({
  scans: new Map<number, Partial<ScanProgressEvent>>(),
  subscribeScan: undefined as unknown as Mock<(libraryId: number) => void>,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key) }),
}))

vi.mock('@/features/scanner/composables/useScanProgress', () => ({
  useScanProgress: () => ({
    subscribeLibrary: mocks.subscribeScan,
    getProgress: (libraryId: number) => mocks.scans.get(libraryId),
  }),
}))

describe('useSidebarLibraryActivity', () => {
  beforeEach(() => {
    mocks.scans.clear()
    mocks.subscribeScan = vi.fn<(libraryId: number) => void>()
  })

  const library = { id: 1 }

  it('reports nothing unless a scan is running', () => {
    const { activityFor } = useSidebarLibraryActivity()
    expect(activityFor(library)).toBeNull()

    mocks.scans.set(1, { status: 'completed', processed: 10, total: 10 })
    expect(activityFor(library)).toBeNull()
  })

  it('reports a running scan as a floored percentage of its total', () => {
    mocks.scans.set(1, { status: 'running', processed: 1, total: 3 })

    expect(useSidebarLibraryActivity().activityFor(library)).toEqual({
      pct: 33,
      barWidth: '33%',
      label: 'components.sidebar.scanProgress {"processed":"1","total":"3"}',
    })
  })

  it('shows a fixed sliver while the scan has no total yet', () => {
    mocks.scans.set(1, { status: 'running', processed: 0, total: 0 })

    expect(useSidebarLibraryActivity().activityFor(library)).toMatchObject({ pct: 0, barWidth: '30%' })
  })

  it('subscribes to the scan channel', () => {
    useSidebarLibraryActivity().subscribe({ id: 1 })

    expect(mocks.subscribeScan).toHaveBeenCalledWith(1)
  })
})
