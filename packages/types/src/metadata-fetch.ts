import type { AudiobookChapter, NarratorRef } from "./audiobook";
import type { ConcreteBookMediaKind, CoverMedium } from "./book";
import type { MetadataCacheServedProvider, MetadataCandidateCacheInfo } from "./metadata-cache";
import type { SeriesIndex } from "./series-index";

/**
 * Every provider key BookOrbit has a dedicated id field for. Most are built in; the ones in
 * `MOVED_METADATA_PROVIDERS` are not, and keep their id columns and the API fields released clients
 * send.
 */
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

/**
 * Any provider whose ratings can be filtered on. External providers are named at runtime, so the
 * list above only seeds defaults; it is not the set of valid values.
 */
export type CommunityRatingProviderKey = MetadataProviderKey;

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

/**
 * Providers that used to be compiled into BookOrbit. One with an `image` now runs as its own service
 * under the same key, so stored ids, ratings and field rules carry over once an admin adds it. One
 * without has closed: its ids and links stay on books, and there is nothing to run.
 */
export const MOVED_METADATA_PROVIDERS: Readonly<Record<"lubimyczytac" | "aladin", { label: string; image: string | null }>> = {
  lubimyczytac: { label: "LubimyCzytac", image: "ghcr.io/bookorbit/lubimyczytac-provider" },
  // Aladin stopped issuing Open API keys on 2026-09-04 and ends the API on 2026-10-30, with no replacement.
  aladin: { label: "Aladin", image: null },
};

export type MovedMetadataProviderKey = keyof typeof MOVED_METADATA_PROVIDERS;

/** A key with its own id column and API field, built in or moved out. */
export type KnownMetadataProviderKey = (typeof MetadataProviderKey)[keyof typeof MetadataProviderKey];

/** A provider compiled into BookOrbit. Maps that only make sense for these are keyed by this type. */
export type BuiltInMetadataProviderKey = Exclude<KnownMetadataProviderKey, MovedMetadataProviderKey>;

/**
 * A provider an admin registered at runtime: an HTTP service speaking the book-metadata-provider
 * spec. Its key is only known once registered, so any string that passes
 * `EXTERNAL_METADATA_PROVIDER_KEY_PATTERN` and is not reserved can be one.
 */
export type ExternalMetadataProviderKey = string & { readonly __externalMetadataProviderKey?: never };

/**
 * Any provider, built-in or external. A `Record` over this type is not exhaustive (it collapses to a
 * string index), so a map that must list every provider is keyed by `BuiltInMetadataProviderKey`
 * instead, and everything else is a `Partial` with a fallback. A guard test enforces it.
 */
export type MetadataProviderKey = KnownMetadataProviderKey | ExternalMetadataProviderKey;

/** Display names of the built-in providers, the one list every surface reads. */
export const BUILT_IN_METADATA_PROVIDER_LABELS: Record<BuiltInMetadataProviderKey, string> = {
  google: "Google Books",
  goodreads: "Goodreads",
  amazon: "Amazon",
  hardcover: "Hardcover",
  openLibrary: "Open Library",
  itunes: "iTunes",
  audible: "Audible",
  audnexus: "AudNexus",
  librofm: "Libro.fm",
  comicvine: "ComicVine",
  ranobedb: "RanobeDB",
  kobo: "Kobo",
};

/** At most 32 characters, which fits every column and DTO that carries a provider key. */
export const EXTERNAL_METADATA_PROVIDER_KEY_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

const KNOWN_METADATA_PROVIDER_KEYS: ReadonlySet<string> = new Set(Object.values(MetadataProviderKey));
const BUILT_IN_METADATA_PROVIDER_KEYS: ReadonlySet<string> = new Set(
  Object.values(MetadataProviderKey).filter((key) => !(key in MOVED_METADATA_PROVIDERS)),
);

/**
 * Keys an external provider may not take: every built-in, the author and cover-search sources, and
 * pseudo-providers the clients use for themselves (the iOS editor files auto-fill results under
 * `autofill`, Book Dock uses `auto`, the match view `fetched`).
 */
export const RESERVED_METADATA_PROVIDER_KEYS: readonly string[] = [
  ...BUILT_IN_METADATA_PROVIDER_KEYS,
  "openlibrary",
  "googlebooks",
  "duckduckgo",
  "any",
  "all",
  "none",
  "auto",
  "autofill",
  "fetched",
  "file",
  "manual",
  "custom",
  "unknown",
  "builtin",
  "external",
];

const RESERVED_KEY_SET: ReadonlySet<string> = new Set(RESERVED_METADATA_PROVIDER_KEYS.map((key) => key.toLowerCase()));

export function isBuiltInMetadataProviderKey(key: string): key is BuiltInMetadataProviderKey {
  return BUILT_IN_METADATA_PROVIDER_KEYS.has(key);
}

/** Whether the key's ids live in their own column and API field, rather than with other external ids. */
export function isKnownMetadataProviderKey(key: string): key is KnownMetadataProviderKey {
  return KNOWN_METADATA_PROVIDER_KEYS.has(key);
}

export function isMovedMetadataProviderKey(key: string): key is MovedMetadataProviderKey {
  return Object.prototype.hasOwnProperty.call(MOVED_METADATA_PROVIDERS, key);
}

/** Syntax only: whether `key` could name an external provider. Registration also checks collisions. */
export function isExternalMetadataProviderKeySyntax(key: string): boolean {
  return EXTERNAL_METADATA_PROVIDER_KEY_PATTERN.test(key) && !RESERVED_KEY_SET.has(key);
}

/** Whether `key` is a built-in or could name an external provider. Says nothing about registration. */
export function isMetadataProviderKeySyntax(key: unknown): key is MetadataProviderKey {
  return typeof key === "string" && (isBuiltInMetadataProviderKey(key) || isExternalMetadataProviderKeySyntax(key));
}

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
  /**
   * The medium the provider says this record is, where it says: a light novel and its manga share a
   * title, and this tells them apart. Absent from older servers and from providers that do not say.
   */
  mediaKind?: ConcreteBookMediaKind;
}

/**
 * A candidate as a search stream sends it. `cache` is present only when the metadata cache answered
 * for the candidate's provider; it is never part of the candidate itself.
 */
export type MetadataSearchCandidateEvent = MetadataCandidate & { cache?: MetadataCandidateCacheInfo };

/** Whether a provider is compiled into BookOrbit or registered at runtime over HTTP. */
export type MetadataProviderSource = "builtin" | "external";

export interface MetadataProviderInfo {
  key: MetadataProviderKey;
  label: string;
  identifiable: boolean;
  /** Absent on servers older than external providers. */
  source?: MetadataProviderSource;
  /**
   * An external provider's icon, served by BookOrbit, and its brand colour (`#rrggbb`). Absent for
   * built-ins, whose clients bundle their own, and for a provider that declares none.
   */
  iconUrl?: string;
  color?: string;
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

/**
 * The most ranked candidates one provider may contribute to a metadata search stream. A search for
 * one book's match keeps the server's small default; a search that browses, such as finding a book
 * to request, asks for up to this many with `resultsPerProvider`.
 */
export const METADATA_SEARCH_MAX_RESULTS_PER_PROVIDER = 20;

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
  /** Providers the metadata cache answered for. Absent on servers without the cache. */
  cacheServedProviders?: MetadataCacheServedProvider[];
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
