import type { AudiobookChapter, NarratorRef } from "./audiobook";
import type { SeriesIndex } from "./series-index";

export const MetadataProviderKey = {
  GOOGLE: "google",
  GOODREADS: "goodreads",
  AMAZON: "amazon",
  HARDCOVER: "hardcover",
  OPEN_LIBRARY: "openLibrary",
  ITUNES: "itunes",
  AUDIBLE: "audible",
  AUDNEXUS: "audnexus",
  LIBROFM: "librofm",
  COMICVINE: "comicvine",
  RANOBEDB: "ranobedb",
  KOBO: "kobo",
  LUBIMYCZYTAC: "lubimyczytac",
  ALADIN: "aladin",
} as const;

export const COMMUNITY_RATING_PROVIDER_KEYS = [
  MetadataProviderKey.HARDCOVER,
  MetadataProviderKey.GOODREADS,
  MetadataProviderKey.GOOGLE,
  MetadataProviderKey.OPEN_LIBRARY,
  MetadataProviderKey.ITUNES,
  MetadataProviderKey.RANOBEDB,
  MetadataProviderKey.AMAZON,
  MetadataProviderKey.AUDIBLE,
] as const;

export type CommunityRatingProviderKey = (typeof COMMUNITY_RATING_PROVIDER_KEYS)[number];

export interface ComicMetadataFields {
  issueNumber?: string;
  volumeName?: string;
  pencillers?: string[];
  inkers?: string[];
  colorists?: string[];
  letterers?: string[];
  coverArtists?: string[];
  characters?: string[];
  teams?: string[];
  locations?: string[];
  storyArcs?: string[];
}

export type MetadataProviderKey = (typeof MetadataProviderKey)[keyof typeof MetadataProviderKey];

export interface MetadataSeriesMembership {
  seriesName: string;
  seriesIndex?: SeriesIndex | null;
}

export interface BookCommunityRating {
  provider: MetadataProviderKey;
  rating: number;
  ratingCount: number | null;
  updatedAt: string | null;
}

export interface MetadataCandidate {
  provider: MetadataProviderKey;
  providerId: string;
  hardcoverEditionId?: string;
  /** Absent when the provider has no title of its own for this record, e.g. an unnamed comic issue. */
  title?: string;
  displayTitle?: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedDate?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesIndex?: SeriesIndex;
  /** Books the provider believes the series contains in total, not a field of this book. */
  seriesTotalBooks?: number;
  seriesMemberships?: MetadataSeriesMembership[];
  genres?: string[];
  coverUrl?: string;
  sourceUrl?: string;
  narrators?: string[];
  durationSeconds?: number;
  abridged?: boolean;
  audibleId?: string;
  chapters?: AudiobookChapter[];
  comicMetadata?: ComicMetadataFields;
  communityRating?: number;
  communityRatingCount?: number;
}

export interface MetadataProviderInfo {
  key: MetadataProviderKey;
  label: string;
  identifiable: boolean;
  selectedByFieldRules?: boolean;
  /** Zero-based priority for the effective Cover field rule. Absent when the provider is not used for covers. */
  coverPriority?: number;
}

/**
 * SSE event name carrying a MetadataProviderSearchStatus. Candidates keep the default event, so a
 * client that only reads candidates is unaffected by a provider reporting how it stopped.
 */
export const METADATA_PROVIDER_STATUS_EVENT = "provider-status";

/** Why a provider stopped before finishing, so an interrupted search is not read as an empty one. */
export type MetadataProviderSearchOutcome = "timeout" | "throttled" | "failed";

export interface MetadataProviderSearchStatus {
  provider: MetadataProviderKey;
  outcome: MetadataProviderSearchOutcome;
}

export type MetadataFetchEmptyReason = "no_active_providers" | "providers_throttled" | "no_candidates" | "no_resolved_fields";

export interface MetadataFetchDiagnostics {
  reason: MetadataFetchEmptyReason | null;
  activeProviders: MetadataProviderKey[];
  fieldRuleProviders: MetadataProviderKey[];
  disabledFieldRuleProviders: MetadataProviderKey[];
  enabledUnreferencedProviders: MetadataProviderKey[];
  throttledProviders: MetadataProviderKey[];
  candidateProviders: MetadataProviderKey[];
  candidateCount: number;
  resolvedFieldCount: number;
}

export interface ProviderThrottleRuntimeState {
  key: MetadataProviderKey;
  throttled: boolean;
  throttledUntil: string | null;
  remainingSeconds: number;
  backoffLevel: number;
}

export interface ProviderThrottleRuntimeSnapshot {
  observedAt: string;
  providers: ProviderThrottleRuntimeState[];
}

export interface MetadataSource {
  title: string | null;
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: SeriesIndex | null;
  isbn10: string | null;
  isbn13: string | null;
  authors: string[];
  genres: string[];
  narrators: string[];
  durationSeconds: number | null;
  abridged: boolean | null;
  hardcoverEditionId: string | null;
  communityRatings: BookCommunityRating[];
}
