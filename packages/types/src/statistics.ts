export type StatisticsChartId =
  | 'format-distribution'
  | 'language-distribution'
  | 'books-added-over-time'
  | 'storage-by-format'
  | 'publication-decade'
  | 'top-authors'
  | 'metadata-completeness'
  | 'genre-distribution';

export type StatisticsGranularity = 'monthly' | 'yearly';
export type StatisticsDateRange = 'last-year' | 'last-5-years' | 'all-time';

// Stored in users.settings JSONB under key 'statisticsConfig'.
// Does NOT include 'wide' — that is fixed per chart type in CHART_REGISTRY.
export interface ChartConfigEntry {
  id: StatisticsChartId;
  visible: boolean;
  order: number;
}

export interface StatisticsFilterConfig {
  libraryIds: number[];
  booksOverTimeGranularity: StatisticsGranularity;
  booksOverTimeRange: StatisticsDateRange;
}

export interface StatisticsSettings {
  charts: ChartConfigEntry[];
  filters: StatisticsFilterConfig;
}

// Generic wrapper returned by all statistics endpoints.
// unknownCount = books excluded due to NULL in the relevant metadata field.
// Is 0 for charts where the source column is never NULL (format, addedAt).
export interface StatisticsResult<T> {
  items: T[];
  unknownCount: number;
}

export interface FormatDistributionItem {
  format: string;
  count: number;
}

export interface LanguageDistributionItem {
  language: string;
  count: number;
}

export interface BooksAddedDataPoint {
  year: number;
  month: number;
  count: number;
}

export interface StorageByFormatItem {
  format: string;
  sizeBytes: number;
}

export interface PublicationDecadeItem {
  decade: number;
  count: number;
}

export interface TopAuthorItem {
  name: string;
  count: number;
}

export interface MetadataCompletenessItem {
  field: string;
  presentCount: number;
  totalCount: number;
}

export interface GenreDistributionItem {
  genre: string;
  count: number;
}

export interface StatisticsSummary {
  totalBooks: number;
  totalAuthors: number;
  totalSeries: number;
  totalPublishers: number;
  totalStorageBytes: number;
  totalGenres: number;
  totalLanguages: number;
  publicationYearMin: number | null;
  publicationYearMax: number | null;
  booksAddedThisYear: number;
}
