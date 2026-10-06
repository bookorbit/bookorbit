export type MetadataScoreField =
  | "title"
  | "subtitle"
  | "description"
  | "coverSource"
  | "genres"
  | "isbn13"
  | "publisher"
  | "publishedYear"
  | "language"
  | "isbn10"
  | "pageCount"
  | "rating"
  | "seriesName"
  | "seriesIndex"
  | "tags"
  | "authors"
  | "googleBooksId"
  | "goodreadsId"
  | "amazonId"
  | "hardcoverId"
  | "openLibraryId"
  | "itunesId"
  | "koboId"
  | "aladinId"
  | "mangabakaId"
  | "mangabakaSeriesId";

export type MetadataScoreGroup = "core" | "publishing" | "classification" | "enrichment" | "providers";

export type MetadataScoreRule = "text" | "positive" | "count" | "seriesIndex" | "cover" | "providerId";

export interface MetadataScoreFieldMeta {
  group: MetadataScoreGroup;
  rule: MetadataScoreRule;
  defaultWeight: number;
}

export const METADATA_SCORE_FIELDS: Record<MetadataScoreField, MetadataScoreFieldMeta> = {
  title: { group: "core", rule: "text", defaultWeight: 10 },
  authors: { group: "core", rule: "count", defaultWeight: 10 },
  coverSource: { group: "core", rule: "cover", defaultWeight: 10 },
  description: { group: "core", rule: "text", defaultWeight: 8 },
  genres: { group: "core", rule: "count", defaultWeight: 6 },
  subtitle: { group: "core", rule: "text", defaultWeight: 0 },
  publisher: { group: "publishing", rule: "text", defaultWeight: 4 },
  publishedYear: { group: "publishing", rule: "positive", defaultWeight: 4 },
  language: { group: "publishing", rule: "text", defaultWeight: 4 },
  pageCount: { group: "publishing", rule: "positive", defaultWeight: 2 },
  isbn13: { group: "classification", rule: "text", defaultWeight: 7 },
  isbn10: { group: "classification", rule: "text", defaultWeight: 2 },
  seriesName: { group: "classification", rule: "text", defaultWeight: 0 },
  seriesIndex: { group: "classification", rule: "seriesIndex", defaultWeight: 0 },
  tags: { group: "enrichment", rule: "count", defaultWeight: 2 },
  rating: { group: "enrichment", rule: "positive", defaultWeight: 1 },
  googleBooksId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  goodreadsId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  amazonId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  hardcoverId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  openLibraryId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  itunesId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  koboId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  aladinId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  mangabakaId: { group: "providers", rule: "providerId", defaultWeight: 1 },
  mangabakaSeriesId: { group: "providers", rule: "providerId", defaultWeight: 1 },
};

/** Display order for the groups. Not alphabetical: it runs from most to least weight by default. */
export const METADATA_SCORE_GROUPS: readonly MetadataScoreGroup[] = [
  "core",
  "publishing",
  "classification",
  "enrichment",
  "providers",
];

export type MetadataScoreWeights = Record<MetadataScoreField, number>;

export const DEFAULT_METADATA_SCORE_WEIGHTS: MetadataScoreWeights = Object.fromEntries(
  Object.entries(METADATA_SCORE_FIELDS).map(([field, meta]) => [field, meta.defaultWeight]),
) as MetadataScoreWeights;

/**
 * A weight at or below zero removes the field from the score entirely, denominator included, so a
 * book missing it is not marked down. Mirrors the guard in MetadataScoreScorer.compute.
 */
export function isMetadataScoreFieldScoring(weight: number | null | undefined): boolean {
  return typeof weight === "number" && Number.isFinite(weight) && weight > 0;
}

/** Sum of every scoring weight. This is the denominator the server divides by. */
export function totalMetadataScoreWeight(weights: MetadataScoreWeights): number {
  return Object.values(weights).reduce((sum, weight) => (isMetadataScoreFieldScoring(weight) ? sum + weight : sum), 0);
}

export type MetadataScoreRecalculationState = "idle" | "running" | "completed" | "failed";

export type MetadataScoreRecalculationTrigger = "manual" | "weights_update";

/**
 * Wire shape of GET /metadata-score/recalculate/status. Timestamps are ISO strings here; the
 * service holds them as Date instances before serialization.
 */
export interface MetadataScoreRecalculationStatus {
  state: MetadataScoreRecalculationState;
  trigger: MetadataScoreRecalculationTrigger | null;
  startedAt: string | null;
  endedAt: string | null;
  processed: number;
  succeeded: number;
  failed: number;
  error: string | null;
}
