import type { AudiobookChapter, NarratorRef } from "./audiobook";
import type { CoverMedium } from "./book";
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

/**
 * The shape of a candidate's cover as the provider knows it, without downloading the image. A
 * provider that cannot tell (a book-level image that may belong to any edition) says `unknown`.
 */
export type MetadataCoverShape = "square" | "portrait" | "unknown";

/**
 * Width over height from this ratio through `SQUARE_COVER_MAX_RATIO` reads as square art. Measured
 * on provider covers in September 2026: real audiobook art sat at 0.998-1.000, while portrait
 * jackets padded to 0.93 and box-set photos came between 0.90 and 0.95, so the floor sits above them.
 */
export const SQUARE_COVER_MIN_RATIO = 0.95;
export const SQUARE_COVER_MAX_RATIO = 1.1;
/** Width over height at or below this reads as a portrait jacket; real ebook art reached 0.85. */
export const PORTRAIT_COVER_MAX_RATIO = 0.85;
/** Provider placeholders and search thumbnails are smaller than this on their short side; no real cover is. */
export const MIN_COVER_SHORT_SIDE_PX = 150;

/** The shape of a cover of this size, or `unknown` for a size that is neither square nor portrait. */
export function coverShapeFromSize(width: number | null | undefined, height: number | null | undefined): MetadataCoverShape {
  if (!width || !height || width <= 0 || height <= 0) return "unknown";
  const ratio = width / height;
  if (ratio >= SQUARE_COVER_MIN_RATIO && ratio <= SQUARE_COVER_MAX_RATIO) return "square";
  if (ratio <= PORTRAIT_COVER_MAX_RATIO) return "portrait";
  return "unknown";
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
  coverShape?: MetadataCoverShape;
  /** Pixel size of the cover when the provider states it, so a shape can be checked without a download. */
  coverWidth?: number;
  coverHeight?: number;
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
  /** Zero-based priority for the effective Audiobook cover field rule. Absent when the provider is not used for it. */
  audioCoverPriority?: number;
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

export type MetadataFetchEmptyReason =
  "no_active_providers" | "no_existing_provider_ids" | "providers_throttled" | "no_candidates" | "no_resolved_fields";

/** How a fetch settled one cover slot. `pass` 2 is the re-query for a book's other medium. */
export interface MetadataFetchCoverSlotDiagnostics {
  provider: MetadataProviderKey | null;
  pass: 1 | 2 | null;
}

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
  /** One entry per cover slot the fetch applied to; a slot outside the book's media is absent. */
  coverSlots?: Partial<Record<CoverMedium, MetadataFetchCoverSlotDiagnostics>>;
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
