import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookMetadataFetchActions } from './useBookMetadataFetchActions'

const apiMock = vi.hoisted(() => vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('useBookMetadataFetchActions', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue({ ok: true, json: async () => ({ queued: 3 }) })
  })

  it('starts a global run with no body unless cached results are ignored', async () => {
    const { triggerGlobal } = useBookMetadataFetchActions()

    await triggerGlobal()
    await triggerGlobal({ ignoreCache: false })
    await triggerGlobal({ ignoreCache: true })

    expect(apiMock.mock.calls).toEqual([
      ['/api/v1/book-metadata-fetch/run', { method: 'POST' }],
      ['/api/v1/book-metadata-fetch/run', { method: 'POST' }],
      [
        '/api/v1/book-metadata-fetch/run',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ignoreCache: true }) },
      ],
    ])
  })

  it('starts a library run with ignoreCache only when asked', async () => {
    const { triggerForLibrary } = useBookMetadataFetchActions()

    await expect(triggerForLibrary(7)).resolves.toEqual({ queued: 3 })
    await triggerForLibrary(7, { ignoreCache: true })

    expect(apiMock.mock.calls[0]).toEqual(['/api/v1/book-metadata-fetch/run/7', { method: 'POST' }])
    expect(apiMock.mock.calls[1]![0]).toBe('/api/v1/book-metadata-fetch/run/7')
    expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toEqual({ ignoreCache: true })
  })
})
