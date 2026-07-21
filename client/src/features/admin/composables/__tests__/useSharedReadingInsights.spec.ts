import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useSharedReadingInsights } from '../useSharedReadingInsights'

const apiMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()

vi.mock('@/lib/api', () => ({ api: (input: string, init?: RequestInit) => apiMock(input, init) }))

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

const summary = {
  sharingLevel: 'summary',
  periodDays: 90,
  activeDays: 1,
  readingSeconds: 1200,
  sessionsCount: 2,
  booksStarted: 1,
  booksCompleted: 0,
  formatDistribution: [],
  genreDistribution: [],
  sourceCoverage: [],
  trend: [],
}

describe('useSharedReadingInsights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates one audited view session and uses it for summary requests', async () => {
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-1', sharingLevel: 'summary', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) return response(summary)
      return response({}, false)
    })
    const insights = useSharedReadingInsights(9)

    await insights.initialize()

    const summaryCall = apiMock.mock.calls.find(([input]) => input.includes('/summary?'))
    expect(summaryCall?.[1]?.headers).toEqual({ 'x-reading-insights-view-session': 'session-1' })
    expect(apiMock.mock.calls.filter(([input]) => input.endsWith('/view-sessions'))).toHaveLength(1)
    expect(apiMock.mock.calls.some(([input]) => input.includes('/detailed?'))).toBe(false)
  })

  it('requests detailed fields only when the session permits them', async () => {
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-2', sharingLevel: 'detailed', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) return response({ ...summary, sharingLevel: 'detailed' })
      if (input.includes('/detailed?')) {
        return response({
          sharingLevel: 'detailed',
          periodDays: 90,
          recentBooks: [],
          topBooks: [],
          topAuthors: [],
          topGenres: [],
          topSeries: [],
          topNarrators: [],
        })
      }
      return response({}, false)
    })
    const insights = useSharedReadingInsights(9)

    await insights.initialize()

    expect(apiMock.mock.calls.some(([input]) => input.includes('/detailed?'))).toBe(true)
    expect(insights.detail.value?.sharingLevel).toBe('detailed')
  })

  it('clears all reading data immediately when consent is revoked', async () => {
    let revoked = false
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-1', sharingLevel: 'summary', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) {
        return revoked ? response({ errorCode: 'READING_INSIGHTS_PRIVATE' }, false) : response(summary)
      }
      return response({}, false)
    })
    const insights = useSharedReadingInsights(9)
    await insights.initialize()
    revoked = true

    await insights.loadInsights()

    expect(insights.summary.value).toBeNull()
    expect(insights.detail.value).toBeNull()
    expect(insights.errorCode.value).toBe('READING_INSIGHTS_PRIVATE')
  })

  it('keeps the available summary when detailed consent is downgraded', async () => {
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-2', sharingLevel: 'detailed', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) return response(summary)
      return response({}, false)
    })
    const insights = useSharedReadingInsights(9)

    await insights.initialize()

    expect(insights.summary.value).toEqual(summary)
    expect(insights.detail.value).toBeNull()
    expect(insights.errorCode.value).toBeNull()
    expect(apiMock.mock.calls.some(([input]) => input.includes('/detailed?'))).toBe(false)
  })

  it('reuses the existing view session when the reporting period changes', async () => {
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-1', sharingLevel: 'summary', expiresAt: '2026-07-01' })
      return response(summary)
    })
    const insights = useSharedReadingInsights(9)
    await insights.initialize()
    insights.days.value = 365

    await insights.loadInsights()

    expect(apiMock.mock.calls.filter(([input]) => input.endsWith('/view-sessions'))).toHaveLength(1)
    expect(apiMock.mock.calls.some(([input]) => input.endsWith('/summary?days=365'))).toBe(true)
  })

  it('discards responses for the previous user after a route change', async () => {
    let resolveOldAccount!: (value: Response) => void
    let resolveOldSession!: (value: Response) => void
    apiMock.mockImplementation((input) => {
      if (input === '/api/v1/account-activity/9') return new Promise((resolve) => (resolveOldAccount = resolve))
      if (input.includes('/9/view-sessions')) return new Promise((resolve) => (resolveOldSession = resolve))
      if (input === '/api/v1/account-activity/10') return Promise.resolve(response({ id: 10, name: 'New Reader' }))
      if (input.includes('/10/view-sessions')) {
        return Promise.resolve(response({ viewSessionId: 'session-10', sharingLevel: 'summary', expiresAt: '2026-07-01' }))
      }
      if (input.includes('/10/summary?')) return Promise.resolve(response(summary))
      return Promise.resolve(response({}, false))
    })
    const userId = ref(9)
    const insights = useSharedReadingInsights(userId)
    const oldInitialize = insights.initialize()
    userId.value = 10

    await insights.initialize()
    resolveOldAccount(response({ id: 9, name: 'Old Reader' }))
    resolveOldSession(response({ viewSessionId: 'session-9', sharingLevel: 'detailed', expiresAt: '2026-07-01' }))
    await oldInitialize

    expect(insights.account.value?.id).toBe(10)
    expect(insights.session.value?.viewSessionId).toBe('session-10')
    expect(insights.summary.value).toEqual(summary)
  })

  it('maps account and session failures to stable error codes', async () => {
    apiMock.mockResolvedValueOnce(response({}, false)).mockResolvedValueOnce(response({}, true))
    const accountFailure = useSharedReadingInsights(9)
    await accountFailure.initialize()
    expect(accountFailure.errorCode.value).toBe('LOAD_FAILED')

    apiMock
      .mockResolvedValueOnce(response({ id: 9, name: 'Reader' }))
      .mockResolvedValueOnce(response({ errorCode: 'READING_INSIGHTS_PRIVATE' }, false))
    const sessionFailure = useSharedReadingInsights(9)
    await sessionFailure.initialize()
    expect(sessionFailure.errorCode.value).toBe('READING_INSIGHTS_PRIVATE')
  })

  it('clears summary data when a detailed request is rejected', async () => {
    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session-2', sharingLevel: 'detailed', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) return response({ ...summary, sharingLevel: 'detailed' })
      if (input.includes('/detailed?')) return response({ errorCode: 'READING_INSIGHTS_SUMMARY_ONLY' }, false)
      return response({}, false)
    })
    const insights = useSharedReadingInsights(9)

    await insights.initialize()

    expect(insights.summary.value).toBeNull()
    expect(insights.detail.value).toBeNull()
    expect(insights.errorCode.value).toBe('READING_INSIGHTS_SUMMARY_ONLY')
  })

  it('falls back safely when failed responses do not contain JSON', async () => {
    const invalidErrorResponse = {
      ok: false,
      json: vi.fn<() => Promise<never>>().mockRejectedValue(new SyntaxError('invalid json')),
    } as unknown as Response
    apiMock.mockResolvedValueOnce(response({ id: 9, name: 'Reader' })).mockResolvedValueOnce(invalidErrorResponse)
    const sessionFailure = useSharedReadingInsights(9)
    await sessionFailure.initialize()
    expect(sessionFailure.errorCode.value).toBe('LOAD_FAILED')

    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session', sharingLevel: 'summary', expiresAt: '2026-07-01' })
      return invalidErrorResponse
    })
    const summaryFailure = useSharedReadingInsights(9)
    await summaryFailure.initialize()
    expect(summaryFailure.errorCode.value).toBe('LOAD_FAILED')

    apiMock.mockImplementation(async (input) => {
      if (input === '/api/v1/account-activity/9') return response({ id: 9, name: 'Reader' })
      if (input.endsWith('/view-sessions')) return response({ viewSessionId: 'session', sharingLevel: 'detailed', expiresAt: '2026-07-01' })
      if (input.includes('/summary?')) return response({ ...summary, sharingLevel: 'detailed' })
      return invalidErrorResponse
    })
    const detailFailure = useSharedReadingInsights(9)
    await detailFailure.initialize()
    expect(detailFailure.errorCode.value).toBe('LOAD_FAILED')
  })
})
