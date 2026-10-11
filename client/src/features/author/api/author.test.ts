import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '@/lib/api'
import {
  fetchAuthors,
  fetchAuthor,
  fetchAuthorBooks,
  updateAuthor,
  uploadAuthorImage,
  deleteAuthorImage,
  mergeAuthors,
  deleteAuthors,
  fetchAuthorMetadataCandidates,
  streamAuthorMetadataCandidates,
  bulkRefreshAuthorsMetadata,
  refreshAuthorMetadata,
  MAX_AUTHOR_IMAGE_BYTES,
} from './author'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

const mockedApi = vi.mocked(api)

function mockOkResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Response
}

function mockErrorResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}) } as Response
}

function mockStreamResponse(lines: string[]) {
  let index = 0
  const reader = {
    read: vi.fn<(...args: unknown[]) => unknown>().mockImplementation(() => {
      if (index < lines.length) {
        const value = new TextEncoder().encode(lines[index++] + '\n')
        return Promise.resolve({ done: false, value })
      }
      return Promise.resolve({ done: true, value: undefined })
    }),
  }
  return { ok: true, status: 200, body: { getReader: () => reader }, json: vi.fn<(...args: unknown[]) => unknown>() } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchAuthors', () => {
  it('returns parsed authors page on ok response', async () => {
    const data = { items: [], total: 0 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchAuthors({ page: 1, size: 20, sort: 'name', order: 'asc' })

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/authors'))
    expect(result).toEqual(data)
  })

  it('includes query params in the URL', async () => {
    mockedApi.mockResolvedValue(mockOkResponse({ items: [], total: 0 }))

    await fetchAuthors({ q: 'tolkien', page: 2, size: 10, sort: 'name', order: 'desc', libraryId: 5 })

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('q=tolkien')
    expect(url).toContain('page=2')
    expect(url).toContain('size=10')
    expect(url).toContain('libraryId=5')
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(500))

    await expect(fetchAuthors({ page: 1, size: 20, sort: 'name', order: 'asc' })).rejects.toThrow('Failed to load authors')
  })
})

describe('fetchAuthor', () => {
  it('returns parsed author on ok response', async () => {
    const data = { id: 1, name: 'J.R.R. Tolkien' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchAuthor(1)

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/1')
    expect(result).toEqual(data)
  })

  it('returns null on 404', async () => {
    mockedApi.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response)

    const result = await fetchAuthor(99)

    expect(result).toBeNull()
  })

  it('throws on non-404 error', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchAuthor(1)).rejects.toThrow('Failed to load author')
  })
})

describe('fetchAuthorBooks', () => {
  it('returns parsed books page on ok response', async () => {
    const data = { items: [], total: 0 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchAuthorBooks(1, { page: 1, size: 10, sort: 'title', order: 'asc' })

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/authors/1/books'))
    expect(result).toEqual(data)
  })

  it('includes query params in the URL', async () => {
    mockedApi.mockResolvedValue(mockOkResponse({ items: [], total: 0 }))

    await fetchAuthorBooks(7, { page: 3, size: 5, sort: 'title', order: 'desc', libraryId: 2 })

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/authors/7/books')
    expect(url).toContain('page=3')
    expect(url).toContain('size=5')
    expect(url).toContain('libraryId=2')
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchAuthorBooks(1, { page: 1, size: 10, sort: 'title', order: 'asc' })).rejects.toThrow('Failed to load author books')
  })
})

describe('updateAuthor', () => {
  it('returns updated author on ok response', async () => {
    const data = { id: 1, name: 'New Name' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await updateAuthor(1, { name: 'New Name' })

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/1', expect.objectContaining({ method: 'PATCH' }))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(updateAuthor(1, { name: 'New Name' })).rejects.toThrow('Failed to update author')
  })
})

describe('uploadAuthorImage', () => {
  it('returns updated author on successful upload', async () => {
    const data = { id: 1, name: 'Author' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    const result = await uploadAuthorImage(1, file)

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/1/image', expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(data)
  })

  it('throws immediately for non-image mime type without calling api', async () => {
    const file = new File(['data'], 'doc.pdf', { type: 'application/pdf' })

    await expect(uploadAuthorImage(1, file)).rejects.toThrow('File must be an image')
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('throws immediately for files exceeding 20 MB without calling api', async () => {
    const bigFile = new File([new ArrayBuffer(MAX_AUTHOR_IMAGE_BYTES + 1)], 'big.jpg', { type: 'image/jpeg' })

    await expect(uploadAuthorImage(1, bigFile)).rejects.toThrow('Image exceeds 20 MB limit')
    expect(mockedApi).not.toHaveBeenCalled()
  })

  it('throws with message from payload on non-ok response', async () => {
    mockedApi.mockResolvedValue({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ message: 'Corrupt image' }),
    } as Response)

    const file = new File(['data'], 'bad.jpg', { type: 'image/jpeg' })
    await expect(uploadAuthorImage(1, file)).rejects.toThrow('Corrupt image')
  })

  it('throws fallback message when payload has no message on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(500))

    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' })
    await expect(uploadAuthorImage(1, file)).rejects.toThrow('Failed to upload author image')
  })
})

describe('deleteAuthorImage', () => {
  it('returns updated author on ok response', async () => {
    const data = { id: 1, name: 'Author' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await deleteAuthorImage(1)

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/1/image', expect.objectContaining({ method: 'DELETE' }))
    expect(result).toEqual(data)
  })

  it('throws with message extracted from payload on non-ok response', async () => {
    mockedApi.mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ message: 'No image to delete' }),
    } as Response)

    await expect(deleteAuthorImage(1)).rejects.toThrow('No image to delete')
  })

  it('throws fallback message when payload has no message', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(deleteAuthorImage(1)).rejects.toThrow('Failed to remove author image')
  })
})

describe('mergeAuthors', () => {
  it('returns merge result on ok response', async () => {
    const data = { mergedIntoAuthorId: 1, removedAuthorIds: [2, 3] }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await mergeAuthors({ targetAuthorId: 1, sourceAuthorIds: [2, 3] })

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/merge', expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(mergeAuthors({ targetAuthorId: 1, sourceAuthorIds: [2] })).rejects.toThrow('Failed to merge authors')
  })
})

describe('deleteAuthors', () => {
  it('returns delete result on ok response', async () => {
    const data = { deletedAuthorIds: [1, 2], affectedBookCount: 5 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await deleteAuthors({ authorIds: [1, 2] })

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors', expect.objectContaining({ method: 'DELETE' }))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(deleteAuthors({ authorIds: [1] })).rejects.toThrow('Failed to delete authors')
  })
})

describe('fetchAuthorMetadataCandidates', () => {
  it('returns candidates on ok response', async () => {
    const data = [{ id: 'openlibrary:OL1A', name: 'Tolkien' }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchAuthorMetadataCandidates({ q: 'tolkien' })

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/authors/metadata/search'))
    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('q=tolkien'))
    expect(result).toEqual(data)
  })

  it('includes optional params in the URL', async () => {
    mockedApi.mockResolvedValue(mockOkResponse([]))

    await fetchAuthorMetadataCandidates({ q: 'tolkien', region: 'en', limit: 5, providers: ['audnexus'] })

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('region=en')
    expect(url).toContain('limit=5')
    expect(url).toContain('providers=audnexus')
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchAuthorMetadataCandidates({ q: 'tolkien' })).rejects.toThrow('Failed to load author metadata')
  })

  it('asks for a live search only when cache=refresh is requested', async () => {
    mockedApi.mockResolvedValue(mockOkResponse([]))

    await fetchAuthorMetadataCandidates({ q: 'tolkien' })
    await fetchAuthorMetadataCandidates({ q: 'tolkien', cache: 'refresh' })

    expect(mockedApi.mock.calls[0]![0]).toBe('/api/v1/authors/metadata/search?q=tolkien')
    expect(mockedApi.mock.calls[1]![0]).toBe('/api/v1/authors/metadata/search?q=tolkien&cache=refresh')
  })
})

describe('streamAuthorMetadataCandidates', () => {
  it('hands the cache marker over beside each candidate rather than on it', async () => {
    const fetchedAt = '2026-10-05T08:00:00.000Z'
    mockedApi.mockResolvedValue(
      mockStreamResponse([
        `data: ${JSON.stringify({ provider: 'goodreads', providerId: 'g1', name: 'Tolkien', cache: { fetchedAt, stale: true } })}\n`,
        `data: ${JSON.stringify({ provider: 'audnexus', providerId: 'a1', name: 'Tolkien' })}\n`,
      ]),
    )
    const onCandidate = vi.fn<(...args: unknown[]) => void>()

    await streamAuthorMetadataCandidates({ q: 'tolkien', cache: 'refresh' }, onCandidate)

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/metadata/stream?q=tolkien&cache=refresh', { signal: undefined })
    expect(onCandidate).toHaveBeenNthCalledWith(1, { provider: 'goodreads', providerId: 'g1', name: 'Tolkien' }, { fetchedAt, stale: true })
    expect(onCandidate).toHaveBeenNthCalledWith(2, { provider: 'audnexus', providerId: 'a1', name: 'Tolkien' }, null)
  })
})

describe('bulkRefreshAuthorsMetadata', () => {
  it('returns zero counts immediately when authorIds is empty', async () => {
    const result = await bulkRefreshAuthorsMetadata([])

    expect(mockedApi).not.toHaveBeenCalled()
    expect(result).toEqual({ processed: 0, failed: 0, updated: 0 })
  })

  it('returns summary from done SSE event', async () => {
    const lines = ['data: {"authorId":1,"updated":true}', 'data: {"done":true,"processed":1,"failed":0,"updated":1}']
    mockedApi.mockResolvedValue(mockStreamResponse(lines))

    const result = await bulkRefreshAuthorsMetadata([1])

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/bulk-refresh-metadata', expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual({ processed: 1, failed: 0, updated: 1 })
  })

  it('calls onProgress for each progress event', async () => {
    const lines = [
      'data: {"authorId":10,"updated":true,"imageUpdated":false}',
      'data: {"authorId":11,"updated":false,"error":"timeout"}',
      'data: {"done":true,"processed":2,"failed":1,"updated":1}',
    ]
    mockedApi.mockResolvedValue(mockStreamResponse(lines))

    const onProgress = vi.fn<(...args: unknown[]) => unknown>()
    await bulkRefreshAuthorsMetadata([10, 11], onProgress)

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, expect.objectContaining({ authorId: 10, updated: true }))
    expect(onProgress).toHaveBeenNthCalledWith(2, expect.objectContaining({ authorId: 11, error: 'timeout' }))
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(bulkRefreshAuthorsMetadata([1])).rejects.toThrow('Failed to refresh author metadata')
  })

  it('sends ignoreCache only when cached results are ignored', async () => {
    mockedApi.mockImplementation(async () => mockStreamResponse(['data: {"done":true,"processed":0,"failed":0,"updated":0}']))

    await bulkRefreshAuthorsMetadata([1, 2])
    await bulkRefreshAuthorsMetadata([1, 2], undefined, { ignoreCache: false })
    await bulkRefreshAuthorsMetadata([1, 2], undefined, { ignoreCache: true })

    const bodies = mockedApi.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    expect(bodies).toEqual([{ authorIds: [1, 2] }, { authorIds: [1, 2] }, { authorIds: [1, 2], ignoreCache: true }])
  })
})

describe('refreshAuthorMetadata', () => {
  it('returns updated author on ok response', async () => {
    const data = { id: 1, name: 'Author' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await refreshAuthorMetadata(1)

    expect(mockedApi).toHaveBeenCalledWith('/api/v1/authors/1/enrichment/refresh', expect.objectContaining({ method: 'POST' }))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(refreshAuthorMetadata(1)).rejects.toThrow('Failed to refresh author metadata')
  })
})
