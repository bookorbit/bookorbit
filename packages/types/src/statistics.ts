export type StatisticsChartId =
  | "format-distribution"
  | "language-distribution"
  | "books-added-over-time"
  | "storage-by-format"
  | "publication-decade"
  | "top-authors"
  | "metadata-completeness"
  | "genre-distribution"
  | "metadata-score-distribution"
  | "library-metadata-completeness"
  | "format-share-over-time"
  | "genre-rank-over-time"
  | "page-count-distribution"
  | "reading-heatmap"
  | "peak-reading-hours"
  | "favorite-reading-days"
  | "completion-timeline"
  | "goal-trajectory"
  | "progress-funnel"
  | "completion-latency"
  | "genre-reading-time"
  | "reading-pace"
  | "books-completed"
  | "reading-clock"
  | "reading-session-timeline"
  | "session-archetypes"
  | "genre-cooccurrence";

export type StatisticsGranularity = "monthly" | "yearly";
export type StatisticsDateRange = "last-year" | "last-5-years" | "all-time";

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

export const DEFAULT_LIBRARY_CHART_ORDER: StatisticsChartId[] = [
  "format-distribution",
  "language-distribution",
  "storage-by-format",
  "publication-decade",
  "books-added-over-time",
  "format-share-over-time",
  "metadata-completeness",
  "metadata-score-distribution",
  "page-count-distribution",
  "top-authors",
  "genre-distribution",
  "genre-rank-over-time",
  "library-metadata-completeness",
  "genre-cooccurrence",
];

export const DEFAULT_USER_CHART_ORDER: StatisticsChartId[] = [
  "reading-heatmap",
  "peak-reading-hours",
  "favorite-reading-days",
  "completion-timeline",
  "goal-trajectory",
  "progress-funnel",
  "completion-latency",
  "genre-reading-time",
  "reading-pace",
  "books-completed",
  "reading-clock",
  "reading-session-timeline",
  "session-archetypes",
];

export const DEFAULT_STATISTICS_CHART_ORDER: StatisticsChartId[] = [...DEFAULT_LIBRARY_CHART_ORDER, ...DEFAULT_USER_CHART_ORDER];

export const DEFAULT_STATISTICS_FILTERS: StatisticsFilterConfig = {
  libraryIds: [],
  booksOverTimeRange: "all-time",
  booksOverTimeGranularity: "monthly",
};

export function createDefaultStatisticsSettings(): StatisticsSettings {
  return {
    charts: DEFAULT_STATISTICS_CHART_ORDER.map((id, order) => ({ id, order, visible: true })),
    filters: {
      libraryIds: [],
      booksOverTimeRange: DEFAULT_STATISTICS_FILTERS.booksOverTimeRange,
      booksOverTimeGranularity: DEFAULT_STATISTICS_FILTERS.booksOverTimeGranularity,
    },
  };
}

// Generic wrapper returned by all statistics endpoints.
// unknownCount = books excluded due to NULL in the relevant metadata field.
// Is 0 for charts where the source column is never NULL (format, addedAt).
export interface ChordNode {
  name: string;
}

export interface ChordLink {
  source: string;
  target: string;
  value: number;
}

export interface ChordDiagramData {
  nodes: ChordNode[];
  links: ChordLink[];
}

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

export interface MetadataScoreDistributionBin {
  minScore: number;
  maxScore: number;
  count: number;
}

export interface MetadataScoreDistribution {
  bins: MetadataScoreDistributionBin[];
  unknownCount: number;
  totalCount: number;
  percentile25: number | null;
  percentile50: number | null;
  percentile75: number | null;
  percentile90: number | null;
}

export interface LibraryMetadataCompletenessItem {
  libraryId: number;
  libraryName: string;
  field: string;
  presentCount: number;
  totalCount: number;
  percent: number;
}

export interface FormatShareOverTimeItem {
  year: number;
  month: number;
  format: string;
  count: number;
}

export interface GenreRankOverTimeItem {
  year: number;
  genre: string;
  rank: number;
  count: number;
}

export interface PageCountDistributionItem {
  format: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
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
