import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '@/lib/api'
import {
  fetchFormatDistribution,
  fetchLanguageDistribution,
  fetchBooksAddedOverTime,
  fetchStorageByFormat,
  fetchPublicationDecade,
  fetchPublicationYearTimeline,
  fetchTopAuthors,
  fetchMetadataCompleteness,
  fetchGenreDistribution,
  fetchMetadataScoreDistribution,
  fetchLibraryMetadataCompleteness,
  fetchFormatShareOverTime,
  fetchPageCountDistribution,
  fetchStatisticsSummary,
  fetchUserStatisticsSummary,
  fetchUserReadingHeatmap,
  fetchUserPeakReadingHours,
  fetchUserFavoriteReadingDays,
  fetchUserCompletionTimeline,
  fetchUserGoalTrajectory,
  fetchUserProgressFunnel,
  fetchUserCompletionLatency,
  fetchUserGenreReadingTime,
  fetchUserReadingPace,
  fetchUserReadingSessionTimeline,
  updateUserReadingSessionTimelineSession,
  fetchGenreCooccurrence,
  fetchMetadataFreshnessGauge,
  fetchLibraryIntegrityGauge,
  fetchAcquisitionLagScatter,
  fetchUserSessionArchetypes,
  fetchLargestBooks,
  fetchTopSeries,
} from './statistics.api'
import type { StatisticsFilterConfig } from '@bookorbit/types'

vi.mock('@/lib/api', () => ({ api: vi.fn<(...args: unknown[]) => unknown>() }))

const mockedApi = vi.mocked(api)

function mockOkResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) } as Response
}

function mockErrorResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}) } as Response
}

const filters: StatisticsFilterConfig = {
  libraryIds: [1, 2],
  booksOverTimeGranularity: 'monthly',
  booksOverTimeRange: 'last-year',
}

beforeEach(() => {
  vi.clearAllMocks()
})

function expectLibraryIdsEncoded(url: string) {
  expect(url).toContain('libraryIds=1')
  expect(url).toContain('libraryIds=2')
}

describe('fetchFormatDistribution', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchFormatDistribution(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/statistics/format-distribution')
    expectLibraryIdsEncoded(url)
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchFormatDistribution(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchLanguageDistribution', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchLanguageDistribution(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/language-distribution'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchLanguageDistribution(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchBooksAddedOverTime', () => {
  it('returns parsed result and includes granularity and range params', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchBooksAddedOverTime(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/statistics/books-added-over-time')
    expect(url).toContain('granularity=monthly')
    expect(url).toContain('range=last-year')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchBooksAddedOverTime(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchStorageByFormat', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchStorageByFormat(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/storage-by-format'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchStorageByFormat(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchPublicationDecade', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchPublicationDecade(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/publication-decade'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchPublicationDecade(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchPublicationYearTimeline', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchPublicationYearTimeline(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/publication-year-timeline'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchPublicationYearTimeline(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchTopAuthors', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchTopAuthors(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/top-authors'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchTopAuthors(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchMetadataCompleteness', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchMetadataCompleteness(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/metadata-completeness'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchMetadataCompleteness(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchGenreDistribution', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchGenreDistribution(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/genre-distribution'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchGenreDistribution(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchMetadataScoreDistribution', () => {
  it('returns parsed result on ok response', async () => {
    const data = { buckets: [] }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchMetadataScoreDistribution(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/statistics/metadata-score-distribution')
    expectLibraryIdsEncoded(url)
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchMetadataScoreDistribution(filters)).rejects.toThrow('Metadata score distribution request failed: 503')
  })
})

describe('fetchLibraryMetadataCompleteness', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchLibraryMetadataCompleteness(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/library-metadata-completeness'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchLibraryMetadataCompleteness(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchFormatShareOverTime', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchFormatShareOverTime(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/format-share-over-time'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchFormatShareOverTime(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchPageCountDistribution', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchPageCountDistribution(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/page-count-distribution'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchPageCountDistribution(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchStatisticsSummary', () => {
  it('returns parsed result on ok response', async () => {
    const data = { totalBooks: 100 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchStatisticsSummary(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/statistics/summary')
    expectLibraryIdsEncoded(url)
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchStatisticsSummary(filters)).rejects.toThrow('Statistics summary request failed: 503')
  })
})

describe('fetchUserStatisticsSummary', () => {
  it('returns parsed result on ok response', async () => {
    const data = { booksRead: 10 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserStatisticsSummary(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/user-statistics/summary'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserStatisticsSummary(filters)).rejects.toThrow('User statistics summary request failed: 503')
  })
})

describe('fetchUserReadingHeatmap', () => {
  it('returns parsed result and includes days param', async () => {
    const data = [{ date: '2026-01-01', minutes: 30 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserReadingHeatmap(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/reading-heatmap')
    expect(url).toContain('days=')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserReadingHeatmap(filters)).rejects.toThrow('User reading heatmap request failed: 503')
  })
})

describe('fetchUserPeakReadingHours', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ hour: 9, minutes: 60 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserPeakReadingHours(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/peak-hours')
    expect(url).toContain('days=365')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserPeakReadingHours(filters)).rejects.toThrow('User peak hours request failed: 503')
  })
})

describe('fetchUserFavoriteReadingDays', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ dayOfWeek: 6, minutes: 120 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserFavoriteReadingDays(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/favorite-days')
    expect(url).toContain('days=365')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserFavoriteReadingDays(filters)).rejects.toThrow('User favorite days request failed: 503')
  })
})

describe('fetchUserCompletionTimeline', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ date: '2026-01-01', completedBooks: 1 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserCompletionTimeline(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/completion-timeline')
    expect(url).toContain('days=1825')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserCompletionTimeline(filters)).rejects.toThrow('User completion timeline request failed: 503')
  })
})

describe('fetchUserGoalTrajectory', () => {
  it('returns parsed result on ok response', async () => {
    const data = { onTrack: true, projectedBooks: 15 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserGoalTrajectory(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/goal-trajectory')
    expect(url).toContain('days=365')
    expect(url).toContain('goalBooks=12')
    expect(result).toEqual(data)
  })

  it('passes a custom goalBooks value when specified', async () => {
    mockedApi.mockResolvedValue(mockOkResponse({ goalBooks: 24, points: [] }))

    await fetchUserGoalTrajectory(filters, 24)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('goalBooks=24')
    expect(url).not.toContain('goalBooks=12')
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserGoalTrajectory(filters)).rejects.toThrow('User goal trajectory request failed: 503')
  })
})

describe('fetchUserProgressFunnel', () => {
  it('returns parsed result on ok response', async () => {
    const data = { current: {}, previous: {} }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserProgressFunnel(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/progress-funnel')
    expect(url).toContain('comparePrevious=true')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserProgressFunnel(filters)).rejects.toThrow('User progress funnel request failed: 503')
  })
})

describe('fetchUserCompletionLatency', () => {
  it('returns parsed result on ok response', async () => {
    const data = { buckets: [], median: 14 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserCompletionLatency(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/completion-latency')
    expect(url).toContain('days=1825')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserCompletionLatency(filters)).rejects.toThrow('User completion latency request failed: 503')
  })
})

describe('fetchUserGenreReadingTime', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ genre: 'Fantasy', minutes: 500 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserGenreReadingTime(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/genre-reading-time')
    expect(url).toContain('days=365')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserGenreReadingTime(filters)).rejects.toThrow('User genre reading time request failed: 503')
  })
})

describe('fetchUserReadingPace', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ date: '2026-01-01', pagesPerHour: 40 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserReadingPace(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/reading-pace')
    expect(url).toContain('days=1825')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserReadingPace(filters)).rejects.toThrow('User reading pace request failed: 503')
  })
})

describe('fetchUserReadingSessionTimeline', () => {
  it('returns parsed result and encodes year and week params', async () => {
    const data = { sessions: [], week: 24, year: 2026 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserReadingSessionTimeline(filters, 2026, 24)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/session-timeline')
    expect(url).toContain('year=2026')
    expect(url).toContain('week=24')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserReadingSessionTimeline(filters, 2026, 24)).rejects.toThrow('User session timeline request failed: 503')
  })
})

describe('updateUserReadingSessionTimelineSession', () => {
  it('sends PATCH request and returns updated session', async () => {
    const data = { id: 5, startedAt: '2026-01-01T09:00:00Z', endedAt: '2026-01-01T10:00:00Z' }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await updateUserReadingSessionTimelineSession(filters, 5, '2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z')

    const [url, opts] = mockedApi.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/api/v1/user-statistics/session-timeline/5')
    expectLibraryIdsEncoded(url)
    expect(opts.method).toBe('PATCH')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(updateUserReadingSessionTimelineSession(filters, 5, '2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z')).rejects.toThrow(
      'User session timeline update failed: 503',
    )
  })
})

describe('fetchGenreCooccurrence', () => {
  it('returns parsed result on ok response', async () => {
    const data = { nodes: [], links: [] }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchGenreCooccurrence(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/genre-cooccurrence'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchGenreCooccurrence(filters)).rejects.toThrow('Genre co-occurrence request failed: 503')
  })
})

describe('fetchMetadataFreshnessGauge', () => {
  it('returns parsed result on ok response', async () => {
    const data = { freshPercent: 80 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchMetadataFreshnessGauge(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/metadata-freshness-gauge'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchMetadataFreshnessGauge(filters)).rejects.toThrow('Metadata freshness gauge request failed: 503')
  })
})

describe('fetchLibraryIntegrityGauge', () => {
  it('returns parsed result on ok response', async () => {
    const data = { integrityScore: 95 }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchLibraryIntegrityGauge(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/library-integrity-gauge'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchLibraryIntegrityGauge(filters)).rejects.toThrow('Library integrity gauge request failed: 503')
  })
})

describe('fetchAcquisitionLagScatter', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchAcquisitionLagScatter(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/acquisition-lag-scatter'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchAcquisitionLagScatter(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchUserSessionArchetypes', () => {
  it('returns parsed result on ok response', async () => {
    const data = [{ archetype: 'marathon', count: 5 }]
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchUserSessionArchetypes(filters)

    const url = mockedApi.mock.calls[0][0] as string
    expect(url).toContain('/api/v1/user-statistics/session-archetypes')
    expect(url).toContain('days=365')
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse(503))

    await expect(fetchUserSessionArchetypes(filters)).rejects.toThrow('User session archetypes request failed: 503')
  })
})

describe('fetchLargestBooks', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchLargestBooks(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/largest-books'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchLargestBooks(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})

describe('fetchTopSeries', () => {
  it('returns parsed result on ok response', async () => {
    const data = { data: [], cached: false }
    mockedApi.mockResolvedValue(mockOkResponse(data))

    const result = await fetchTopSeries(filters)

    expect(mockedApi).toHaveBeenCalledWith(expect.stringContaining('/api/v1/statistics/top-series'))
    expect(result).toEqual(data)
  })

  it('throws on non-ok response', async () => {
    mockedApi.mockResolvedValue(mockErrorResponse())

    await expect(fetchTopSeries(filters)).rejects.toThrow('Statistics request failed: 500')
  })
})
