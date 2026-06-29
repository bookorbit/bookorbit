import type { AudiobookChapter, NarratorRef } from "./audiobook";

export const MetadataProviderKey = {
  GOOGLE: "google",
  GOODREADS: "goodreads",
  AMAZON: "amazon",
  HARDCOVER: "hardcover",
  OPEN_LIBRARY: "openLibrary",
  ITUNES: "itunes",
  AUDIBLE: "audible",
  AUDNEXUS: "audnexus",
  COMICVINE: "comicvine",
  RANOBEDB: "ranobedb",
  KOBO: "kobo",
  LUBIMYCZYTAC: "lubimyczytac",
  ALADIN: "aladin",
} as const;

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
  seriesIndex?: number | null;
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
  title: string;
  subtitle?: string;
  authors?: string[];
  description?: string;
  publisher?: string;
  publishedYear?: number;
  language?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  seriesIndex?: number;
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
  publishedYear: number | null;
  language: string | null;
  pageCount: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
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
