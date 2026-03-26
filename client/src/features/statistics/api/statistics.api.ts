import { api } from '@/lib/api'
import type {
  BooksAddedDataPoint,
  ChordDiagramData,
  UserCompletionLatencyDistribution,
  FormatShareOverTimeItem,
  UserGenreReadingTimeItem,
  UserGoalTrajectory,
  StatisticsSummary,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserFavoriteDayStat,
  UserProgressFunnelComparison,
  UserPeakHourStat,
  UserReadingPacePoint,
  UserReadingSessionTimeline,
  UserReadingSessionTimelineItem,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
  FormatDistributionItem,
  GenreRankOverTimeItem,
  GenreDistributionItem,
  LibraryMetadataCompletenessItem,
  LanguageDistributionItem,
  MetadataScoreDistribution,
  MetadataCompletenessItem,
  PageCountDistributionItem,
  PublicationDecadeItem,
  StatisticsFilterConfig,
  StatisticsResult,
  StorageByFormatItem,
  TopAuthorItem,
} from '@projectx/types'

async function parseResult<T>(res: Response): Promise<StatisticsResult<T>> {
  if (!res.ok) throw new Error(`Statistics request failed: ${res.status}`)
  return res.json() as Promise<StatisticsResult<T>>
}

function buildParams(filters: StatisticsFilterConfig, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  filters.libraryIds.forEach((id) => params.append('libraryIds', String(id)))
  if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v))
  const str = params.toString()
  return str ? `?${str}` : ''
}

function getUtcDaysSinceYearStartInclusive(): number {
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const yearStartUtc = Date.UTC(now.getUTCFullYear(), 0, 1)
  return Math.floor((todayUtc - yearStartUtc) / 86_400_000) + 1
}

export async function fetchFormatDistribution(filters: StatisticsFilterConfig): Promise<StatisticsResult<FormatDistributionItem>> {
  return parseResult(await api(`/api/v1/statistics/format-distribution${buildParams(filters)}`))
}

export async function fetchLanguageDistribution(filters: StatisticsFilterConfig): Promise<StatisticsResult<LanguageDistributionItem>> {
  return parseResult(await api(`/api/v1/statistics/language-distribution${buildParams(filters)}`))
}

export async function fetchBooksAddedOverTime(filters: StatisticsFilterConfig): Promise<StatisticsResult<BooksAddedDataPoint>> {
  return parseResult(
    await api(
      `/api/v1/statistics/books-added-over-time${buildParams(filters, {
        granularity: filters.booksOverTimeGranularity,
        range: filters.booksOverTimeRange,
      })}`,
    ),
  )
}

export async function fetchStorageByFormat(filters: StatisticsFilterConfig): Promise<StatisticsResult<StorageByFormatItem>> {
  return parseResult(await api(`/api/v1/statistics/storage-by-format${buildParams(filters)}`))
}

export async function fetchPublicationDecade(filters: StatisticsFilterConfig): Promise<StatisticsResult<PublicationDecadeItem>> {
  return parseResult(await api(`/api/v1/statistics/publication-decade${buildParams(filters)}`))
}

export async function fetchTopAuthors(filters: StatisticsFilterConfig): Promise<StatisticsResult<TopAuthorItem>> {
  return parseResult(await api(`/api/v1/statistics/top-authors${buildParams(filters)}`))
}

export async function fetchMetadataCompleteness(filters: StatisticsFilterConfig): Promise<StatisticsResult<MetadataCompletenessItem>> {
  return parseResult(await api(`/api/v1/statistics/metadata-completeness${buildParams(filters)}`))
}

export async function fetchGenreDistribution(filters: StatisticsFilterConfig): Promise<StatisticsResult<GenreDistributionItem>> {
  return parseResult(await api(`/api/v1/statistics/genre-distribution${buildParams(filters)}`))
}

export async function fetchMetadataScoreDistribution(filters: StatisticsFilterConfig): Promise<MetadataScoreDistribution> {
  const res = await api(`/api/v1/statistics/metadata-score-distribution${buildParams(filters)}`)
  if (!res.ok) throw new Error(`Metadata score distribution request failed: ${res.status}`)
  return res.json() as Promise<MetadataScoreDistribution>
}

export async function fetchLibraryMetadataCompleteness(filters: StatisticsFilterConfig): Promise<StatisticsResult<LibraryMetadataCompletenessItem>> {
  return parseResult(await api(`/api/v1/statistics/library-metadata-completeness${buildParams(filters)}`))
}

export async function fetchFormatShareOverTime(filters: StatisticsFilterConfig): Promise<StatisticsResult<FormatShareOverTimeItem>> {
  return parseResult(await api(`/api/v1/statistics/format-share-over-time${buildParams(filters)}`))
}

export async function fetchGenreRankOverTime(filters: StatisticsFilterConfig): Promise<StatisticsResult<GenreRankOverTimeItem>> {
  return parseResult(await api(`/api/v1/statistics/genre-rank-over-time${buildParams(filters)}`))
}

export async function fetchPageCountDistribution(filters: StatisticsFilterConfig): Promise<StatisticsResult<PageCountDistributionItem>> {
  return parseResult(await api(`/api/v1/statistics/page-count-distribution${buildParams(filters)}`))
}

export async function fetchStatisticsSummary(filters: StatisticsFilterConfig): Promise<StatisticsSummary> {
  const res = await api(`/api/v1/statistics/summary${buildParams(filters)}`)
  if (!res.ok) throw new Error(`Statistics summary request failed: ${res.status}`)
  return res.json() as Promise<StatisticsSummary>
}

export async function fetchUserStatisticsSummary(filters: StatisticsFilterConfig): Promise<UserStatisticsSummary> {
  const res = await api(`/api/v1/user-statistics/summary${buildParams(filters)}`)
  if (!res.ok) throw new Error(`User statistics summary request failed: ${res.status}`)
  return res.json() as Promise<UserStatisticsSummary>
}

export async function fetchUserReadingHeatmap(filters: StatisticsFilterConfig): Promise<UserDailyReadingStat[]> {
  const days = String(getUtcDaysSinceYearStartInclusive())
  const res = await api(`/api/v1/user-statistics/reading-heatmap${buildParams(filters, { days })}`)
  if (!res.ok) throw new Error(`User reading heatmap request failed: ${res.status}`)
  return res.json() as Promise<UserDailyReadingStat[]>
}

export async function fetchUserPeakReadingHours(filters: StatisticsFilterConfig): Promise<UserPeakHourStat[]> {
  const res = await api(`/api/v1/user-statistics/peak-hours${buildParams(filters, { days: '365' })}`)
  if (!res.ok) throw new Error(`User peak hours request failed: ${res.status}`)
  return res.json() as Promise<UserPeakHourStat[]>
}

export async function fetchUserFavoriteReadingDays(filters: StatisticsFilterConfig): Promise<UserFavoriteDayStat[]> {
  const res = await api(`/api/v1/user-statistics/favorite-days${buildParams(filters, { days: '365' })}`)
  if (!res.ok) throw new Error(`User favorite days request failed: ${res.status}`)
  return res.json() as Promise<UserFavoriteDayStat[]>
}

export async function fetchUserCompletionTimeline(filters: StatisticsFilterConfig): Promise<UserCompletionTimelinePoint[]> {
  const res = await api(`/api/v1/user-statistics/completion-timeline${buildParams(filters, { days: '1825' })}`)
  if (!res.ok) throw new Error(`User completion timeline request failed: ${res.status}`)
  return res.json() as Promise<UserCompletionTimelinePoint[]>
}

export async function fetchUserGoalTrajectory(filters: StatisticsFilterConfig): Promise<UserGoalTrajectory> {
  const res = await api(`/api/v1/user-statistics/goal-trajectory${buildParams(filters, { days: '365', goalBooks: '12' })}`)
  if (!res.ok) throw new Error(`User goal trajectory request failed: ${res.status}`)
  return res.json() as Promise<UserGoalTrajectory>
}

export async function fetchUserProgressFunnel(filters: StatisticsFilterConfig): Promise<UserProgressFunnelComparison> {
  const res = await api(`/api/v1/user-statistics/progress-funnel${buildParams(filters, { days: '365', comparePrevious: 'true' })}`)
  if (!res.ok) throw new Error(`User progress funnel request failed: ${res.status}`)
  return res.json() as Promise<UserProgressFunnelComparison>
}

export async function fetchUserCompletionLatency(filters: StatisticsFilterConfig): Promise<UserCompletionLatencyDistribution> {
  const res = await api(`/api/v1/user-statistics/completion-latency${buildParams(filters, { days: '1825' })}`)
  if (!res.ok) throw new Error(`User completion latency request failed: ${res.status}`)
  return res.json() as Promise<UserCompletionLatencyDistribution>
}

export async function fetchUserGenreReadingTime(filters: StatisticsFilterConfig): Promise<UserGenreReadingTimeItem[]> {
  const res = await api(`/api/v1/user-statistics/genre-reading-time${buildParams(filters, { days: '365' })}`)
  if (!res.ok) throw new Error(`User genre reading time request failed: ${res.status}`)
  return res.json() as Promise<UserGenreReadingTimeItem[]>
}

export async function fetchUserReadingPace(filters: StatisticsFilterConfig): Promise<UserReadingPacePoint[]> {
  const res = await api(`/api/v1/user-statistics/reading-pace${buildParams(filters, { days: '1825' })}`)
  if (!res.ok) throw new Error(`User reading pace request failed: ${res.status}`)
  return res.json() as Promise<UserReadingPacePoint[]>
}

export async function fetchUserReadingSessionTimeline(
  filters: StatisticsFilterConfig,
  year: number,
  week: number,
): Promise<UserReadingSessionTimeline> {
  const res = await api(`/api/v1/user-statistics/session-timeline${buildParams(filters, { year: String(year), week: String(week) })}`)
  if (!res.ok) throw new Error(`User session timeline request failed: ${res.status}`)
  return res.json() as Promise<UserReadingSessionTimeline>
}

export async function updateUserReadingSessionTimelineSession(
  filters: StatisticsFilterConfig,
  sessionId: number,
  startedAt: string,
  endedAt: string,
): Promise<UserReadingSessionTimelineItem> {
  const res = await api(`/api/v1/user-statistics/session-timeline/${sessionId}${buildParams(filters)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startedAt, endedAt }),
  })
  if (!res.ok) throw new Error(`User session timeline update failed: ${res.status}`)
  return res.json() as Promise<UserReadingSessionTimelineItem>
}

export async function fetchGenreCooccurrence(filters: StatisticsFilterConfig): Promise<ChordDiagramData> {
  const res = await api(`/api/v1/statistics/genre-cooccurrence${buildParams(filters)}`)
  if (!res.ok) throw new Error(`Genre co-occurrence request failed: ${res.status}`)
  return res.json() as Promise<ChordDiagramData>
}

export async function fetchUserSessionArchetypes(filters: StatisticsFilterConfig): Promise<UserSessionArchetypePoint[]> {
  const res = await api(`/api/v1/user-statistics/session-archetypes${buildParams(filters, { days: '365' })}`)
  if (!res.ok) throw new Error(`User session archetypes request failed: ${res.status}`)
  return res.json() as Promise<UserSessionArchetypePoint[]>
}
