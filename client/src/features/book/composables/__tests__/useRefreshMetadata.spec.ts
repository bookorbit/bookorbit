import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail, MetadataCacheUsage } from '@bookorbit/types'
import { activateI18nLocale } from '@/i18n'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>(),
  toastSuccess: vi.fn<(message: string) => void>(),
  toastError: vi.fn<(message: string) => void>(),
  toastWarning: vi.fn<(message: string, options?: unknown) => void>(),
  bumpVersion: vi.fn<(bookId: number) => void>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

vi.mock('vue-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: mocks.toastWarning },
}))

vi.mock('../useCoverVersions', () => ({
  useCoverVersions: () => ({ bumpVersion: mocks.bumpVersion }),
}))

vi.mock('../useRefreshingBooks', () => ({
  useRefreshingBooks: () => ({ markRefreshing: vi.fn<(ids: number[]) => void>(), clearRefreshing: vi.fn<(ids: number[]) => void>() }),
}))

import { useRefreshMetadata } from '../useRefreshMetadata'

function detailResponse(metadataCache?: MetadataCacheUsage) {
  const detail = { id: 9, title: 'Dune' } as unknown as BookDetail
  return { ok: true, json: async () => (metadataCache ? { ...detail, metadataCache } : detail) }
}

describe('useRefreshMetadata', () => {
  beforeEach(() => {
    activateI18nLocale('en')
    vi.clearAllMocks()
  })

  it('reports a plain refresh with one success toast', async () => {
    mocks.api.mockResolvedValue(detailResponse({ fallbackProviders: [] }))
    const { refreshWithFeedback } = useRefreshMetadata()

    const updated = await refreshWithFeedback(9)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/9/refresh-metadata', { method: 'POST' })
    expect(updated).toEqual({ id: 9, title: 'Dune' })
    expect(mocks.bumpVersion).toHaveBeenCalledWith(9)
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Metadata refreshed')
    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it('warns which providers were answered from saved results and keeps the report off the book', async () => {
    mocks.api.mockResolvedValue(
      detailResponse({
        fallbackProviders: [
          { provider: 'google', source: 'fallback', stale: true, cachedAt: '2026-10-01T00:00:00.000Z' },
          { provider: 'amazon', source: 'cache', stale: false, cachedAt: '2026-10-02T00:00:00.000Z' },
          { provider: 'goodreads', source: 'fallback', stale: false, cachedAt: '2026-10-03T00:00:00.000Z' },
        ],
      }),
    )
    const { refreshWithFeedback } = useRefreshMetadata()

    const updated = await refreshWithFeedback(9)

    expect(updated).not.toHaveProperty('metadataCache')
    expect(mocks.toastWarning).toHaveBeenCalledTimes(1)
    const [message] = mocks.toastWarning.mock.calls[0]!
    expect(message).toContain('Google Books')
    expect(message).toContain('Goodreads')
    expect(message).not.toContain('Amazon')
  })

  it('reports a failed refresh without a fallback warning', async () => {
    mocks.api.mockResolvedValue({ ok: false, json: async () => ({}) })
    const { refreshWithFeedback } = useRefreshMetadata()

    await expect(refreshWithFeedback(9)).resolves.toBeNull()
    expect(mocks.toastError).toHaveBeenCalledWith('Metadata refresh failed')
    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it('returns the book without the cache report from refreshAndSave', async () => {
    mocks.api.mockResolvedValue(detailResponse({ fallbackProviders: [] }))
    const { refreshAndSave } = useRefreshMetadata()

    await expect(refreshAndSave(9)).resolves.toEqual({ id: 9, title: 'Dune' })
  })
})
