import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastImportScanJob, PodcastImportScanStatus } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastImport } from './usePodcastImport'
import { jsonResponse } from '../test/fixtures'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('./usePodcastEvents', () => ({
  usePodcastEvents: () => ({ onImportProgress: () => () => undefined }),
}))

const apiMock = vi.mocked(api)

function job(overrides: Partial<PodcastImportScanJob> = {}): PodcastImportScanJob {
  return {
    id: 1,
    status: 'processing',
    dryRun: true,
    progressCurrent: 10,
    progressTotal: 100,
    lastError: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function scanStatus(overrides: Partial<PodcastImportScanStatus> = {}): PodcastImportScanStatus {
  return { job: job(), report: null, ...overrides }
}

describe('usePodcastImport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a scan read that resolves after the library changed', async () => {
    let resolveRead!: (response: Response) => void
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve
      }),
    )
    const libraryId = ref(7)
    const scope = effectScope()
    const importer = scope.run(() => usePodcastImport(libraryId))!

    const pending = importer.refresh()
    libraryId.value = 9
    await nextTick()
    resolveRead(jsonResponse(scanStatus()))
    await pending

    expect(importer.status.value).toEqual({ job: null, report: null })
    expect(importer.loading.value).toBe(false)
    scope.stop()
  })

  it('does not stack automatic re-reads while one is still open', async () => {
    vi.useFakeTimers()
    apiMock.mockResolvedValueOnce(jsonResponse(scanStatus()))
    const scope = effectScope()
    const importer = scope.run(() => usePodcastImport(ref(7)))!
    await importer.refresh()
    expect(importer.running.value).toBe(true)

    apiMock.mockReturnValue(new Promise<Response>(() => undefined))
    await vi.advanceTimersByTimeAsync(10_000)

    // The first poll is still open, so the four that followed it stood down.
    expect(apiMock).toHaveBeenCalledTimes(2)
    scope.stop()
  })
})
