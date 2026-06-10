import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { KoreaderAnnotationItem } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeAnnotation(overrides: Partial<KoreaderAnnotationItem> = {}): KoreaderAnnotationItem {
  return {
    id: 1,
    drawer: 'lighten',
    color: null,
    text: 'highlighted text',
    note: null,
    chapter: 'Chapter 1',
    pageno: 12,
    posFormat: 'xpointer',
    deviceCreatedAt: '2026-06-01 21:14:03',
    deviceUpdatedAt: null,
    ...overrides,
  }
}

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useKoreaderAnnotations', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetches annotations for the book on init', async () => {
    const annotations = [makeAnnotation(), makeAnnotation({ id: 2, drawer: 'underscore' })]
    apiMock.mockResolvedValueOnce(makeResponse(annotations))

    const { useKoreaderAnnotations } = await import('../useKoreaderAnnotations')
    const { items, error } = useKoreaderAnnotations(ref(42))
    await flushAsync()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/42/annotations')
    expect(items.value).toEqual(annotations)
    expect(error.value).toBeNull()
  })

  it('treats a 403 as empty without surfacing an error', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'forbidden' }, { ok: false, status: 403 }))

    const { useKoreaderAnnotations } = await import('../useKoreaderAnnotations')
    const { items, error, loading } = useKoreaderAnnotations(ref(42))
    await flushAsync()

    expect(items.value).toEqual([])
    expect(error.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('surfaces an error on server failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

    const { useKoreaderAnnotations } = await import('../useKoreaderAnnotations')
    const { items, error } = useKoreaderAnnotations(ref(42))
    await flushAsync()

    expect(items.value).toEqual([])
    expect(error.value).toBe('Failed to fetch KOReader annotations')
  })

  it('refetches when the book id changes', async () => {
    apiMock.mockResolvedValue(makeResponse([]))

    const { useKoreaderAnnotations } = await import('../useKoreaderAnnotations')
    const bookId = ref(1)
    useKoreaderAnnotations(bookId)
    await flushAsync()

    bookId.value = 2
    await flushAsync()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/1/annotations')
    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/2/annotations')
  })
})
