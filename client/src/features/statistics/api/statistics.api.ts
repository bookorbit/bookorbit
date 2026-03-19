import { api } from '@/lib/api'
import type {
  BooksAddedDataPoint,
  FormatShareOverTimeItem,
  StatisticsSummary,
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
