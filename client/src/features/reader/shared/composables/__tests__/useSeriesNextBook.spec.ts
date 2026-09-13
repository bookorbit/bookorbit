import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => vi.fn<(path: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({ api }))

const { useSeriesNextBook } = await import('../useSeriesNextBook')

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body }
}

describe('useSeriesNextBook', () => {
  beforeEach(() => {
    api.mockReset()
  })

  it('asks only for books the requesting reader can open', async () => {
    api.mockResolvedValue(jsonResponse({ next: null }))
    const { load } = useSeriesNextBook('cbx')

    await load(42, 90)

    expect(api).toHaveBeenCalledWith('/api/v1/series/42/books/90/next?formatGroup=cbx')
  })

  it('exposes the resolved next book', async () => {
    const next = { bookId: 91, fileId: 501, format: 'cbz', title: 'Issue 10', seriesIndex: '10' }
    api.mockResolvedValue(jsonResponse({ next }))
    const { nextBook, load } = useSeriesNextBook('cbx')

    await load(42, 90)

    expect(nextBook.value).toEqual(next)
  })

  it('skips the request for a book that belongs to no series', async () => {
    const { nextBook, load } = useSeriesNextBook('cbx')

    await load(null, 90)

    expect(api).not.toHaveBeenCalled()
    expect(nextBook.value).toBeNull()
  })

  it('clears a stale next book when the request fails', async () => {
    const { nextBook, load } = useSeriesNextBook('cbx')
    api.mockResolvedValueOnce(jsonResponse({ next: { bookId: 91, fileId: 501, format: 'cbz', title: 'Issue 10', seriesIndex: '10' } }))
    await load(42, 90)

    api.mockResolvedValueOnce(jsonResponse(null, false))
    await load(42, 91)

    expect(nextBook.value).toBeNull()
  })
})
