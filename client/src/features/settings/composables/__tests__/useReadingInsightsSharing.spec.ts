import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useReadingInsightsSharing } from '../useReadingInsightsSharing'

const apiMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

vi.mock('@/lib/api', () => ({ api: (input: string, init?: RequestInit) => apiMock(input, init) }))

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

const summary = {
  sharingLevel: 'detailed',
  periodDays: 90,
  activeDays: 4,
  readingSeconds: 3600,
  sessionsCount: 5,
  booksStarted: 2,
  booksCompleted: 1,
  formatDistribution: [],
  genreDistribution: [],
  sourceCoverage: [],
  trend: [],
}

const detail = {
  sharingLevel: 'detailed',
  periodDays: 90,
  recentBooks: [],
  topBooks: [],
  topAuthors: [],
  topGenres: [],
  topSeries: [],
  topNarrators: [],
}

describe('useReadingInsightsSharing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads current-user settings and subject-scoped access history', async () => {
    apiMock
      .mockResolvedValueOnce(response({ sharingLevel: 'summary', consentedAt: '2026-07-01T00:00:00.000Z' }))
      .mockResolvedValueOnce(response({ items: [], total: 0, page: 1, pageSize: 20 }))
    const sharing = useReadingInsightsSharing()

    await sharing.load()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reading-insights-sharing/me', undefined)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/reading-insights-sharing/me/access-history?page=1&pageSize=20', undefined)
    expect(sharing.settings.value.sharingLevel).toBe('summary')
  })

  it('updates only the current user and clears previously previewed data', async () => {
    apiMock.mockResolvedValueOnce(response({ summary, detail })).mockResolvedValueOnce(response({ sharingLevel: 'private', consentedAt: null }))
    const sharing = useReadingInsightsSharing()
    await sharing.loadPreview()

    await expect(sharing.update('private')).resolves.toBe(true)

    expect(apiMock.mock.calls[1]).toEqual([
      '/api/v1/reading-insights-sharing/me',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ sharingLevel: 'private' }) }),
    ])
    expect(sharing.previewSummary.value).toBeNull()
    expect(sharing.previewDetail.value).toBeNull()
  })

  it('loads a detailed preview without calling administrator endpoints', async () => {
    apiMock.mockResolvedValue(response({ summary, detail }))
    const sharing = useReadingInsightsSharing()

    await sharing.loadPreview(365)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reading-insights-sharing/me/preview?days=365', undefined)
    expect(sharing.previewSummary.value).toEqual(summary)
    expect(sharing.previewDetail.value).toEqual(detail)
  })

  it('paginates access history with the bounded page size', async () => {
    apiMock.mockResolvedValue(response({ items: [], total: 21, page: 2, pageSize: 20 }))
    const sharing = useReadingInsightsSharing()

    await sharing.loadHistory(2)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/reading-insights-sharing/me/access-history?page=2&pageSize=20', undefined)
    expect(sharing.history.value.page).toBe(2)
  })

  it('exposes stable local error states and clears loading flags', async () => {
    apiMock.mockResolvedValue(response({}, false))
    const sharing = useReadingInsightsSharing()

    await sharing.load()

    expect(sharing.error.value).toBe('load')
    expect(sharing.loading.value).toBe(false)
  })

  it('preserves current data and reports history and update failures', async () => {
    apiMock.mockResolvedValue(response({}, false))
    const sharing = useReadingInsightsSharing()

    await sharing.loadHistory(2)
    await expect(sharing.update('detailed')).resolves.toBe(false)

    expect(sharing.history.value.page).toBe(1)
    expect(sharing.settings.value.sharingLevel).toBe('private')
    expect(sharing.error.value).toBe('save')
    expect(sharing.historyLoading.value).toBe(false)
    expect(sharing.saving.value).toBe(false)
  })

  it('handles private previews and preview failures without stale data', async () => {
    apiMock.mockResolvedValueOnce(response({ sharingLevel: 'private', consentedAt: null })).mockResolvedValueOnce(response({}, false))
    const sharing = useReadingInsightsSharing()

    await sharing.loadPreview()
    expect(sharing.previewSummary.value).toBeNull()
    expect(sharing.previewDetail.value).toBeNull()

    await sharing.loadPreview()
    expect(sharing.error.value).toBe('preview')
    expect(sharing.previewLoading.value).toBe(false)
  })

  it('discards stale load, history, preview, and update responses', async () => {
    const deferred: Array<(value: Response) => void> = []
    apiMock.mockImplementation(() => new Promise((resolve) => deferred.push(resolve)))
    const sharing = useReadingInsightsSharing()

    const oldLoad = sharing.load()
    const newLoad = sharing.load()
    deferred[2](response({ sharingLevel: 'summary', consentedAt: '2026-07-01T00:00:00.000Z' }))
    deferred[3](response({ items: [], total: 2, page: 1, pageSize: 20 }))
    await newLoad
    deferred[0](response({ sharingLevel: 'private', consentedAt: null }))
    deferred[1](response({ items: [], total: 1, page: 1, pageSize: 20 }))
    await oldLoad
    expect(sharing.settings.value.sharingLevel).toBe('summary')

    const oldHistory = sharing.loadHistory(2)
    const newHistory = sharing.loadHistory(3)
    deferred[5](response({ items: [], total: 60, page: 3, pageSize: 20 }))
    await newHistory
    deferred[4](response({ items: [], total: 60, page: 2, pageSize: 20 }))
    await oldHistory
    expect(sharing.history.value.page).toBe(3)

    const oldPreview = sharing.loadPreview(30)
    const newPreview = sharing.loadPreview(365)
    deferred[7](response({ ...summary, periodDays: 365 }))
    await newPreview
    deferred[6](response({ ...summary, periodDays: 30 }))
    await oldPreview
    expect(sharing.previewSummary.value?.periodDays).toBe(365)

    const oldUpdate = sharing.update('private')
    const newUpdate = sharing.update('detailed')
    deferred[9](response({ sharingLevel: 'detailed', consentedAt: '2026-07-02T00:00:00.000Z' }))
    await newUpdate
    deferred[8](response({ sharingLevel: 'private', consentedAt: null }))
    await oldUpdate
    expect(sharing.settings.value.sharingLevel).toBe('detailed')
  })
})
