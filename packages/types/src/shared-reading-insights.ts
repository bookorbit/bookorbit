export const READING_INSIGHTS_SHARING_LEVELS = ["private", "summary", "detailed"] as const;
export type ReadingInsightsSharingLevel = (typeof READING_INSIGHTS_SHARING_LEVELS)[number];

export interface ReadingInsightsSharingSettings {
  sharingLevel: ReadingInsightsSharingLevel;
  consentedAt: string | null;
}

export interface ReadingInsightsAccessHistoryItem {
  id: number;
  viewerUsername: string;
  sharingLevel: Exclude<ReadingInsightsSharingLevel, "private">;
  viewedAt: string;
}

export interface ReadingInsightsAccessHistoryPage {
  items: ReadingInsightsAccessHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SharedReadingTrendPoint {
  day: string;
  readingSeconds: number;
  sessionsCount: number;
}

export interface SharedReadingDistributionItem {
  name: string;
  readingSeconds: number;
}

export const BROAD_READING_GENRES = [
  "science_fiction",
  "fantasy",
  "mystery_thriller",
  "romance",
  "horror",
  "history_biography",
  "science_technology",
  "business_economics",
  "self_development",
  "society_culture",
  "children_young_adult",
  "comics_graphic_novels",
  "poetry",
  "other",
] as const;
export type BroadReadingGenre = (typeof BROAD_READING_GENRES)[number];

export interface SharedReadingGenreDistributionItem {
  name: BroadReadingGenre;
  readingSeconds: number;
}

export interface SharedReadingSourceItem {
  source: string;
  readingSeconds: number;
  sessionsCount: number;
}

export interface SharedReadingInsightsSummary {
  sharingLevel: Exclude<ReadingInsightsSharingLevel, "private">;
  periodDays: number;
  activeDays: number;
  readingSeconds: number;
  sessionsCount: number;
  booksStarted: number;
  booksCompleted: number;
  formatDistribution: SharedReadingDistributionItem[];
  genreDistribution: SharedReadingGenreDistributionItem[];
  sourceCoverage: SharedReadingSourceItem[];
  trend: SharedReadingTrendPoint[];
}

export interface SharedReadingBookItem {
  bookId: number;
  title: string | null;
  readingSeconds: number;
  lastReadAt: string;
  status: string | null;
}

export interface SharedReadingRankedItem {
  name: string;
  readingSeconds: number;
}

export interface SharedReadingInsightsDetail {
  sharingLevel: "detailed";
  periodDays: number;
  recentBooks: SharedReadingBookItem[];
  topBooks: SharedReadingBookItem[];
  topAuthors: SharedReadingRankedItem[];
  topGenres: SharedReadingRankedItem[];
  topSeries: SharedReadingRankedItem[];
  topNarrators: SharedReadingRankedItem[];
}

export interface SharedReadingInsightsViewSession {
  viewSessionId: string;
  sharingLevel: Exclude<ReadingInsightsSharingLevel, "private">;
  expiresAt: string;
}

export type ReadingInsightsPreview =
  | ReadingInsightsSharingSettings
  | SharedReadingInsightsSummary
  | { summary: SharedReadingInsightsSummary; detail: SharedReadingInsightsDetail };
