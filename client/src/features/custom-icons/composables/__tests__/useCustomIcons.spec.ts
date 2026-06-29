import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCustomIcons } from '../useCustomIcons'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) }
}

describe('useCustomIcons management API', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('loads catalog as {items, total} and exposes catalogTruncated', async () => {
    const star = {
      slug: 'star',
      name: 'Star',
      svgUrl: '/api/v1/custom-icons/star.svg?v=abc',
      fileHash: 'abc',
      fileSize: 10,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    apiMock.mockResolvedValue(jsonResponse({ items: [star], total: 1500 }))
    const { refreshCustomIcons, icons, catalogTotal, catalogTruncated } = useCustomIcons()

    await refreshCustomIcons()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/custom-icons')
    expect(icons.value).toHaveLength(1)
    expect(catalogTotal.value).toBe(1500)
    expect(catalogTruncated.value).toBe(true)
  })

  it('catalogTruncated is false when total matches loaded icons', async () => {
    const star = {
      slug: 'star',
      name: 'Star',
      svgUrl: '/api/v1/custom-icons/star.svg?v=abc',
      fileHash: 'abc',
      fileSize: 10,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    apiMock.mockResolvedValue(jsonResponse({ items: [star], total: 1 }))
    const { refreshCustomIcons, catalogTruncated } = useCustomIcons()

    await refreshCustomIcons()

    expect(catalogTruncated.value).toBe(false)
  })

  it('builds the manage query string from params', async () => {
    apiMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 2, size: 48 }))
    const { fetchIconPage } = useCustomIcons()

    const result = await fetchIconPage({ q: 'star', sort: 'name', page: 2, size: 48 })

    const url = apiMock.mock.calls[0]![0] as string
    expect(url).toContain('/api/v1/custom-icons/manage?')
    expect(url).toContain('q=star')
    expect(url).toContain('sort=name')
    expect(url).toContain('page=2')
    expect(url).toContain('size=48')
    expect(result.total).toBe(0)
  })

  it('omits the q param when search is empty', async () => {
    apiMock.mockResolvedValue(jsonResponse({ items: [], total: 0, page: 0, size: 48 }))
    const { fetchIconPage } = useCustomIcons()

    await fetchIconPage({ sort: 'newest', page: 0, size: 48 })

    const url = apiMock.mock.calls[0]![0] as string
    expect(url).not.toContain('q=')
  })

  it('posts staged files to the stage endpoint as FormData', async () => {
    apiMock.mockResolvedValue(jsonResponse({ items: [] }))
    const { stageIcons } = useCustomIcons()

    await stageIcons([new File(['<svg></svg>'], 'a.svg', { type: 'image/svg+xml' })])

    const [url, init] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/custom-icons/stage')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('includes per-file name metadata when uploading', async () => {
    apiMock.mockResolvedValue(jsonResponse({ items: [{ filename: 'a.svg', status: 'created' }] }))
    const { uploadStagedIcons } = useCustomIcons()

    await uploadStagedIcons([{ file: new File(['<svg></svg>'], 'a.svg', { type: 'image/svg+xml' }), name: 'Alpha' }])

    const [url, init] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/custom-icons')
    const meta = JSON.parse((init.body as FormData).get('meta') as string)
    expect(meta).toEqual([{ filename: 'a.svg', name: 'Alpha' }])
  })

  it('posts slugs to the bulk-delete endpoint', async () => {
    apiMock.mockResolvedValue(jsonResponse({ deleted: ['a', 'b'], failed: [] }))
    const { bulkDeleteCustomIcons } = useCustomIcons()

    const result = await bulkDeleteCustomIcons(['a', 'b'])

    const [url, init] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/custom-icons/bulk-delete')
    expect(JSON.parse(init.body as string)).toEqual({ slugs: ['a', 'b'] })
    expect(result.deleted).toEqual(['a', 'b'])
  })

  it('throws the server message when a request fails', async () => {
    apiMock.mockResolvedValue(jsonResponse({ message: 'nope' }, false))
    const { bulkDeleteCustomIcons } = useCustomIcons()

    await expect(bulkDeleteCustomIcons(['a'])).rejects.toThrow('nope')
  })
})
