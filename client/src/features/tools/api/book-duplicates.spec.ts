import { api } from '@/lib/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBookDuplicateScan,
  getActiveBookDuplicateScan,
  getBookDuplicateGroups,
  getBookDuplicateResolution,
  getBookDuplicateScan,
  restoreBookDuplicateDismissal,
  startBookDuplicateResolution,
} from './book-duplicates'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

describe('book duplicate API', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('sends scan creation and status requests to the matching routes', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 7 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('null', { status: 200 }))

    await createBookDuplicateScan({ libraryId: 2, similarityPercent: 85 })
    await getBookDuplicateScan(7)
    await expect(getActiveBookDuplicateScan()).resolves.toBeNull()

    expect(api).toHaveBeenNthCalledWith(
      1,
      '/api/v1/book-duplicates/scans',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ libraryId: 2, similarityPercent: 85 }) }),
    )
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/book-duplicates/scans/7')
    expect(api).toHaveBeenNthCalledWith(3, '/api/v1/book-duplicates/scans/active')
  })

  it('encodes bounded result filters and sends the kind only for the other-format list', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] }), { status: 200 }))

    await getBookDuplicateGroups(7, { page: 2, pageSize: 10, reason: 'isbn', kind: 'duplicate' })
    await getBookDuplicateGroups(7, { page: 1, pageSize: 10, kind: 'other_format' })

    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/book-duplicates/scans/7/groups?page=2&pageSize=10&reason=isbn')
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/book-duplicates/scans/7/groups?page=1&pageSize=10&kind=other_format')
  })

  it('restores a dismissal without a kind unless it is an other-format pair', async () => {
    vi.mocked(api).mockResolvedValue(new Response(null, { status: 204 }))

    await restoreBookDuplicateDismissal(3, 4)
    await restoreBookDuplicateDismissal(3, 4, 'other_format')

    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/book-duplicates/dismissals/3/4', { method: 'DELETE' })
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/book-duplicates/dismissals/3/4?kind=other_format', { method: 'DELETE' })
  })

  it('starts a resolution and reads it back by job id', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: 5, total: 1 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 5, status: 'running' }), { status: 200 }))
    const request = { scanId: 7, groups: [{ groupId: 1, keeperId: 3, action: 'merge' as const }] }

    await expect(startBookDuplicateResolution(request)).resolves.toEqual({ jobId: 5, total: 1 })
    await getBookDuplicateResolution(5)

    expect(api).toHaveBeenNthCalledWith(
      1,
      '/api/v1/book-duplicates/resolutions',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(request) }),
    )
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/book-duplicates/resolutions/5')
  })

  it('rejects unsuccessful API responses', async () => {
    vi.mocked(api).mockResolvedValue(new Response(null, { status: 500 }))

    await expect(getBookDuplicateScan(7)).rejects.toThrow('duplicate_scan_status_failed')
    await expect(restoreBookDuplicateDismissal(3, 4)).rejects.toThrow('duplicate_restore_failed')
    await expect(startBookDuplicateResolution({ scanId: 7 })).rejects.toThrow('Could not start resolving the selected groups.')
  })
})
