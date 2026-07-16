import { api } from '@/lib/api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBookDuplicateScan,
  deleteDuplicateBooks,
  getActiveBookDuplicateScan,
  getBookDuplicateGroups,
  getBookDuplicateScan,
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

  it('encodes bounded result filters and deletes selected books through the existing bulk route', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ groups: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await getBookDuplicateGroups(7, { page: 2, pageSize: 10, reason: 'isbn' })
    await deleteDuplicateBooks([3, 4])

    expect(api).toHaveBeenNthCalledWith(1, '/api/v1/book-duplicates/scans/7/groups?page=2&pageSize=10&reason=isbn')
    expect(api).toHaveBeenNthCalledWith(2, '/api/v1/books', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ bookIds: [3, 4] }) }))
  })

  it('rejects unsuccessful API responses', async () => {
    vi.mocked(api).mockResolvedValue(new Response(null, { status: 500 }))

    await expect(getBookDuplicateScan(7)).rejects.toThrow('duplicate_scan_status_failed')
    await expect(deleteDuplicateBooks([3])).rejects.toThrow('duplicate_delete_failed')
  })
})
