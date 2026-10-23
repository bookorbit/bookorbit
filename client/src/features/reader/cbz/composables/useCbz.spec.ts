import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useCbz } from './useCbz'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

describe('page image document loading', () => {
  const scopes: ReturnType<typeof effectScope>[] = []
  beforeEach(() => vi.resetAllMocks())
  afterEach(() => {
    for (const scope of scopes.splice(0)) scope.stop()
  })

  function reader(source: 'djvu' | 'cbz' = 'djvu') {
    const scope = effectScope()
    scopes.push(scope)
    return scope.run(() => useCbz(22, 11, source))!
  }

  it('uses DjVu routes and loads title and primary series', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ pageCount: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Scanned book', seriesMemberships: [{ displayOrder: 1, seriesId: 9 }] })))
    const document = reader()
    await document.load()
    expect(document.loading.value).toBe(false)
    expect(document.error.value).toBeNull()
    expect(document.pageCount.value).toBe(2)
    expect(document.bookTitle.value).toBe('Scanned book')
    expect(document.seriesId.value).toBe(9)
    expect(document.pageUrl(1)).toBe('/api/v1/djvu/files/22/pages/1?size=2560')
  })

  it('opens the pages when only the book detail request fails', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ pageCount: 4 })))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    const document = reader('cbz')
    await document.load()
    expect(document.error.value).toBeNull()
    expect(document.pageCount.value).toBe(4)
    expect(document.bookTitle.value).toBe('')
    expect(document.seriesId.value).toBeNull()
  })

  it('keeps existing comic routes', () => {
    expect(reader('cbz').pageUrl(0)).toBe('/api/v1/cbz/files/22/pages/0')
  })

  it('exposes a translated error key and allows retry after failed requests', async () => {
    vi.mocked(api).mockRejectedValue(new Error('offline'))
    const document = reader()
    await document.load()
    expect(document.loading.value).toBe(false)
    expect(document.error.value).toBe('reader.pageImages.loadFailed')
    vi.mocked(api)
      .mockResolvedValueOnce(new Response(JSON.stringify({ pageCount: 3 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: 'Restored book' })))
    await document.load()
    expect(document.error.value).toBeNull()
    expect(document.pageCount.value).toBe(3)
  })

  it('aborts outstanding requests when disposed and ignores late responses', async () => {
    const releases: Array<(value: Response) => void> = []
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve)
        }),
    )
    const document = reader()
    const loading = document.load()
    const firstSignal = vi.mocked(api).mock.calls[0]?.[1]?.signal
    scopes[0]!.stop()
    expect(firstSignal?.aborted).toBe(true)
    releases[0]!(new Response(JSON.stringify({ pageCount: 2 })))
    releases[1]!(new Response(JSON.stringify({ title: 'late' })))
    await loading
    expect(document.bookTitle.value).toBe('')
    expect(document.pageCount.value).toBe(0)
  })
})
