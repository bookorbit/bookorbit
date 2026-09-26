import { nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastDownloadBatch, PodcastDownloadCompleteEvent, PodcastDownloadProgressEvent } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastDownloadBatches } from './usePodcastDownloadBatches'
import { jsonResponse } from '../test/fixtures'

const mockUsePodcastEvents = vi.hoisted(() => vi.fn<() => unknown>())
const connected = ref(false)
let progressCallback: ((event: PodcastDownloadProgressEvent) => void) | null = null
let completeCallback: ((event: PodcastDownloadCompleteEvent) => void) | null = null

vi.mock('@/lib/api', () => ({ api: vi.fn<(input: RequestInfo | URL) => Promise<Response>>() }))
vi.mock('./usePodcastEvents', () => ({
  usePodcastEvents: mockUsePodcastEvents,
}))

const apiMock = vi.mocked(api)
const downloads = usePodcastDownloadBatches()

describe('usePodcastDownloadBatches', () => {
  beforeEach(() => {
    vi.useRealTimers()
    apiMock.mockReset()
    connected.value = false
    progressCallback = null
    completeCallback = null
    mockUsePodcastEvents.mockReturnValue({
      connected,
      onDownloadProgress: (callback: (event: PodcastDownloadProgressEvent) => void) => {
        progressCallback = callback
        return () => {
          progressCallback = null
        }
      },
      onDownloadComplete: (callback: (event: PodcastDownloadCompleteEvent) => void) => {
        completeCallback = callback
        return () => {
          completeCallback = null
        }
      },
    })
    downloads.stop()
    downloads.resetForUserChange()
    localStorage.clear()
  })

  afterEach(() => downloads.stop())

  it('restores bounded active batches and refreshes them after a reconnect', async () => {
    apiMock.mockResolvedValue(jsonResponse([batch()]))

    downloads.start()
    await flushPromises()

    expect(downloads.batches.value).toHaveLength(1)
    expect(downloads.batches.value[0]).toMatchObject({ podcastTitle: 'Orbit Radio', total: 2, downloading: 1 })

    connected.value = true
    await nextTick()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/podcast-download-batches')
  })

  it('updates byte and terminal progress from realtime events and removes a successful batch after a grace period', async () => {
    vi.useFakeTimers()
    apiMock.mockResolvedValue(jsonResponse([batch()]))
    downloads.start()
    await flushPromises()

    progressCallback?.({
      libraryId: 7,
      podcastId: 3,
      episodeId: 43,
      batchId: BATCH_ID,
      status: 'downloading',
      receivedBytes: 50,
      totalBytes: 100,
    })

    expect(downloads.batches.value[0]).toMatchObject({ receivedBytes: 150, totalBytes: 200, downloading: 1 })

    completeCallback?.({
      libraryId: 7,
      podcastId: 3,
      episodeId: 43,
      batchId: BATCH_ID,
      jobStatus: 'completed',
      mediaStatus: 'local',
      localSizeBytes: 100,
    })

    expect(downloads.batches.value[0]).toMatchObject({ completed: 2, downloading: 0 })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(downloads.batches.value).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(downloads.batches.value).toHaveLength(0)
  })

  it('keeps retriable failures queued instead of presenting them as terminal failures', async () => {
    apiMock.mockResolvedValue(jsonResponse([batch()]))
    downloads.start()
    await flushPromises()

    completeCallback?.({
      libraryId: 7,
      podcastId: 3,
      episodeId: 43,
      batchId: BATCH_ID,
      jobStatus: 'queued',
      mediaStatus: 'failed',
      localSizeBytes: null,
    })

    expect(downloads.batches.value[0]).toMatchObject({ queued: 1, completed: 1, failed: 0 })
  })

  it("ignores another user's library-wide batch events after the scoped endpoint rejects the batch", async () => {
    apiMock.mockImplementation(async (input) =>
      String(input) === '/api/v1/podcast-download-batches' ? jsonResponse([]) : new Response(null, { status: 404 }),
    )
    downloads.start()
    await flushPromises()
    const event = {
      libraryId: 7,
      podcastId: 3,
      episodeId: 43,
      batchId: OTHER_BATCH_ID,
      status: 'downloading' as const,
      receivedBytes: 25,
      totalBytes: 100,
    }

    progressCallback?.(event)
    progressCallback?.(event)
    expect(apiMock).toHaveBeenCalledTimes(2)
    await flushPromises()
    progressCallback?.(event)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(apiMock).toHaveBeenLastCalledWith(`/api/v1/podcast-download-batches/${OTHER_BATCH_ID}`)
    expect(downloads.batches.value).toHaveLength(0)
  })

  it('does not let a response from the previous user repopulate global batch state', async () => {
    const pending: Array<(response: Response) => void> = []
    apiMock.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)))
    downloads.start()
    expect(pending).toHaveLength(1)

    downloads.resetForUserChange()
    expect(pending).toHaveLength(2)
    const current = batch()
    current.id = OTHER_BATCH_ID
    current.podcastTitle = 'Current User Show'
    pending[1]!(jsonResponse([current]))
    await flushPromises()

    pending[0]!(jsonResponse([batch()]))
    await flushPromises()

    expect(downloads.batches.value).toHaveLength(1)
    expect(downloads.batches.value[0]).toMatchObject({ id: OTHER_BATCH_ID, podcastTitle: 'Current User Show' })
  })

  it('persists dismissed failed batches so reconnects do not reopen them', async () => {
    const failed = batch()
    failed.items[1]!.status = 'failed'
    failed.downloading = 0
    failed.failed = 1
    apiMock.mockResolvedValue(jsonResponse([failed]))
    downloads.start()
    await flushPromises()

    downloads.dismiss(BATCH_ID)
    await downloads.loadActive()

    expect(downloads.batches.value).toHaveLength(0)
    expect(localStorage.getItem('bookorbit:dismissed-podcast-download-batches')).toContain(BATCH_ID)
  })
})

const BATCH_ID = '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115'
const OTHER_BATCH_ID = 'b4afdd4e-bc3d-42a1-a6eb-f4e8cb6dca0f'

function batch(): PodcastDownloadBatch {
  return {
    id: BATCH_ID,
    libraryId: 7,
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    total: 2,
    queued: 0,
    downloading: 1,
    completed: 1,
    failed: 0,
    cancelled: 0,
    receivedBytes: 125,
    totalBytes: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:02:00.000Z',
    items: [
      { episodeId: 42, title: 'Launch', status: 'completed', receivedBytes: 100, totalBytes: 100 },
      { episodeId: 43, title: 'Landing', status: 'downloading', receivedBytes: 25, totalBytes: null },
    ],
  }
}
