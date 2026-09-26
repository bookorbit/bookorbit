// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { api } from '@/lib/api'
import { usePodcastBulkDelete } from './usePodcastBulkDelete'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  NetworkError: class NetworkError extends Error {},
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const apiMock = vi.mocked(api)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function lastRequest() {
  const call = apiMock.mock.calls.at(-1)
  if (!call) throw new Error('expected a request')
  return { url: String(call[0]), body: JSON.parse(String(call[1]?.body ?? '{}')) as { podcastIds: number[] } }
}

beforeEach(() => {
  apiMock.mockReset()
})

describe('usePodcastBulkDelete', () => {
  it('previews the selection and opens the confirmation', async () => {
    apiMock.mockResolvedValue(jsonResponse({ shows: 2, files: 0, bytes: 0 }))
    const bulkDelete = usePodcastBulkDelete(ref(7))

    const opened = await bulkDelete.prepare([3, 4])

    expect(opened).toBe(true)
    expect(bulkDelete.open.value).toBe(true)
    expect(bulkDelete.preview.value).toEqual({ shows: 2, files: 0, bytes: 0 })
    expect(lastRequest()).toEqual({ url: '/api/v1/podcast-libraries/7/shows/bulk-purge-preview', body: { podcastIds: [3, 4] } })
  })

  it('asks for typed confirmation only when the selection has files to destroy', async () => {
    apiMock.mockResolvedValue(jsonResponse({ shows: 1, files: 0, bytes: 0 }))
    const bulkDelete = usePodcastBulkDelete(ref(7))
    await bulkDelete.prepare([3])
    expect(bulkDelete.needsTypedConfirmation.value).toBe(false)

    apiMock.mockResolvedValue(jsonResponse({ shows: 1, files: 4, bytes: 2048 }))
    await bulkDelete.prepare([3])
    expect(bulkDelete.needsTypedConfirmation.value).toBe(true)
  })

  it('does nothing at all for an empty selection', async () => {
    const bulkDelete = usePodcastBulkDelete(ref(7))

    expect(await bulkDelete.prepare([])).toBe(false)
    expect(await bulkDelete.confirm([])).toBeNull()
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('deletes the ids given at confirm time, not the ones the preview described', async () => {
    apiMock.mockResolvedValue(jsonResponse({ shows: 2, files: 0, bytes: 0 }))
    const bulkDelete = usePodcastBulkDelete(ref(7))
    await bulkDelete.prepare([3, 4])

    apiMock.mockResolvedValue(jsonResponse({ completed: 1, failed: 0, skipped: 0 }))
    const result = await bulkDelete.confirm([4])

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 0 })
    expect(lastRequest()).toEqual({ url: '/api/v1/podcast-libraries/7/shows/bulk-delete', body: { podcastIds: [4] } })
  })

  it('closes and clears the preview once the delete is queued', async () => {
    apiMock.mockResolvedValue(jsonResponse({ shows: 1, files: 0, bytes: 0 }))
    const bulkDelete = usePodcastBulkDelete(ref(7))
    await bulkDelete.prepare([3])

    apiMock.mockResolvedValue(jsonResponse({ completed: 1, failed: 0, skipped: 0 }))
    await bulkDelete.confirm([3])

    expect(bulkDelete.open.value).toBe(false)
    expect(bulkDelete.preview.value).toBeNull()
  })

  it('keeps the dialog open and reports the failure when the delete is refused', async () => {
    apiMock.mockResolvedValue(jsonResponse({ shows: 1, files: 0, bytes: 0 }))
    const bulkDelete = usePodcastBulkDelete(ref(7))
    await bulkDelete.prepare([3])

    apiMock.mockResolvedValue(jsonResponse({ message: 'nope' }, 409))
    const result = await bulkDelete.confirm([3])

    expect(result).toBeNull()
    expect(bulkDelete.open.value).toBe(true)
    // `errorMessage` resolves through the real catalog rather than the mocked `useI18n`, so this
    // also proves the key exists.
    expect(bulkDelete.error.value).toBe('Could not delete the selected shows')
    expect(bulkDelete.deleting.value).toBe(false)
  })

  it('leaves the confirmation shut when the preview itself fails', async () => {
    apiMock.mockResolvedValue(jsonResponse({ message: 'nope' }, 403))
    const bulkDelete = usePodcastBulkDelete(ref(7))

    expect(await bulkDelete.prepare([3])).toBe(false)
    expect(bulkDelete.open.value).toBe(false)
    expect(bulkDelete.error.value).toBe('Could not work out what deleting these shows would remove')
  })

  it('reports partial failures separately from a clean run', () => {
    const bulkDelete = usePodcastBulkDelete(ref(7))

    expect(bulkDelete.resultMessage({ completed: 3, failed: 0, skipped: 0 })).toBe('podcast.bulkDelete.queued')
    expect(bulkDelete.resultMessage({ completed: 2, failed: 1, skipped: 0 })).toBe('podcast.bulkDelete.queuedWithFailures')
  })
})
