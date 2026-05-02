import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

function makeResponse(overrides?: Partial<Response> & { headers?: Headers }): Response {
  const headers = overrides?.headers ?? new Headers()
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers,
    json: async () => ({}),
    text: async () => '',
    blob: async () => new Blob([]),
    ...overrides,
  } as Response
}

describe('useBookMetadataExport', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.api.mockReset()
  })

  it('builds preflight payload for all-matching query selection', async () => {
    const expected = {
      schemaVersion: 1,
      rowCount: 12,
      estimatedBytes: 3456,
      sizeCategory: 'small',
      fileName: 'bookorbit-library-all-matching-2026-05-07.csv',
      scope: 'all-matching',
      format: 'csv',
    }
    mocks.api.mockResolvedValue(makeResponse({ json: async () => expected }))

    const { useBookMetadataExport } = await import('../useBookMetadataExport')
    const { preflight } = useBookMetadataExport()

    const result = await preflight({
      scope: 'all-matching',
      format: 'csv',
      viewType: 'library',
      selectedBookIds: [],
      allMatchingQuery: {
        libraryId: 5,
        q: 'dune',
        sort: [{ field: 'title', dir: 'asc' }],
      },
      options: {
        includePersonalData: false,
        includeFilePaths: false,
        includeContextMeta: true,
        columnsMode: 'canonical',
        visibleColumns: [],
      },
    })

    expect(result).toEqual(expected)
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/metadata-export/preflight',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          query: {
            libraryId: 5,
            q: 'dune',
            sort: [{ field: 'title', dir: 'asc' }],
          },
          format: 'csv',
          viewType: 'library',
          options: {
            includePersonalData: false,
            includeFilePaths: false,
            includeContextMeta: true,
            columnsMode: 'canonical',
            visibleColumns: [],
          },
        }),
      }),
    )
  })

  it('throws before request when all-matching scope has no query payload', async () => {
    const { useBookMetadataExport } = await import('../useBookMetadataExport')
    const { preflight } = useBookMetadataExport()

    await expect(
      preflight({
        scope: 'all-matching',
        format: 'csv',
        viewType: 'library',
        selectedBookIds: [],
        options: {
          includePersonalData: false,
          includeFilePaths: false,
          includeContextMeta: true,
          columnsMode: 'canonical',
          visibleColumns: [],
        },
      }),
    ).rejects.toThrow('All-matching metadata export requires a query payload')

    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('parses backend error payloads for preflight failures', async () => {
    mocks.api.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'Too many rows selected' }),
      }),
    )

    const { useBookMetadataExport } = await import('../useBookMetadataExport')
    const { preflight } = useBookMetadataExport()

    await expect(
      preflight({
        scope: 'selected',
        format: 'json',
        viewType: 'collection',
        selectedBookIds: [1],
        options: {
          includePersonalData: true,
          includeFilePaths: false,
          includeContextMeta: true,
          columnsMode: 'visible',
          visibleColumns: ['title'],
        },
      }),
    ).rejects.toThrow('Too many rows selected')
  })

  it('downloads exported blob and uses UTF-8 filename when provided', async () => {
    const appendSpy = vi.spyOn(document.body, 'append')
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove')
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    mocks.api.mockResolvedValue(
      makeResponse({
        headers: new Headers({
          'Content-Disposition': `attachment; filename*=UTF-8''bookorbit-library-selected-%E2%9C%85.csv`,
        }),
        blob: async () => new Blob(['bookId,title\n1,Dune'], { type: 'text/csv' }),
      }),
    )

    const { useBookMetadataExport } = await import('../useBookMetadataExport')
    const { download, loading } = useBookMetadataExport()

    const result = await download({
      scope: 'selected',
      format: 'csv',
      viewType: 'library',
      selectedBookIds: [1],
      options: {
        includePersonalData: false,
        includeFilePaths: false,
        includeContextMeta: true,
        columnsMode: 'canonical',
        visibleColumns: [],
      },
    })

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.download).toBe('bookorbit-library-selected-✅.csv')
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:test-url')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
    expect(result.fileName).toBe('bookorbit-library-selected-✅.csv')
    expect(loading.value).toBe(false)

    appendSpy.mockRestore()
    clickSpy.mockRestore()
    removeSpy.mockRestore()
    createObjectUrlSpy.mockRestore()
    revokeObjectUrlSpy.mockRestore()
  })

  it('surfaces download failure and clears loading state', async () => {
    mocks.api.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: 'Forbidden' }),
      }),
    )

    const { useBookMetadataExport } = await import('../useBookMetadataExport')
    const { download, loading } = useBookMetadataExport()

    await expect(
      download({
        scope: 'selected',
        format: 'json',
        viewType: 'smartScope',
        selectedBookIds: [2],
        options: {
          includePersonalData: true,
          includeFilePaths: true,
          includeContextMeta: false,
          columnsMode: 'visible',
          visibleColumns: ['title', 'authors'],
        },
      }),
    ).rejects.toThrow('Forbidden')

    expect(loading.value).toBe(false)
  })
})
