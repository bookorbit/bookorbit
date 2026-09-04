import type { BooksPage } from "./book";
import type { MergeStrategy } from "./metadata-preferences";

export type AuthorSummary = {
  id: number;
  name: string;
  sortName: string | null;
  description?: string | null;
  imageUrl?: string | null;
  bookCount: number;
  lastAddedAt: string | null;
  /**
   * A book of theirs that has cover art, most recently added first. Only 19% of a
   * typical library's authors have a portrait, so the grid falls back to this
   * before it falls back to a monogram. Null when none of their books has a cover.
   */
  coverBookId?: number | null;
};

/** One bucket of the authors A-Z rail. `letter` is "#" for anything non-alphabetic. */
export type AuthorLetterCount = {
  letter: string;
  count: number;
};

export type AuthorDetail = AuthorSummary & {
  description: string | null;
  birthDate: string | null;
  birthYear: number | null;
  deathDate: string | null;
  deathYear: number | null;
  website: string | null;
  genres: string[];
  influences: string[];
  metadataProvider: AuthorMetadataProviderKey | null;
  metadataProviderId: string | null;
};

export type AuthorsPage = {
  items: AuthorSummary[];
  total: number;
  page: number;
  size: number;
};

/**
 * `total` counts rows in the page's own unit, so it is the number of cards once
 * `collapseSeries` folds a series into one card — that is what paginating and "is there more"
 * have to be driven by. `bookTotal` stays the number of books behind those rows, for the
 * places that count books rather than cards. The two are equal while the list is flat.
 */
export type AuthorBooksPage = BooksPage & {
  bookTotal: number;
};

export type MergeAuthorsResult = {
  target: AuthorDetail;
  mergedAuthorIds: number[];
  affectedBookCount: number;
};

export const AuthorMetadataProviderKey = {
  AUDNEXUS: "audnexus",
  GOODREADS: "goodreads",
} as const;

export type AuthorMetadataProviderKey = (typeof AuthorMetadataProviderKey)[keyof typeof AuthorMetadataProviderKey];

export type AuthorMetadataCandidate = {
  provider: AuthorMetadataProviderKey;
  providerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  birthDate?: string;
  birthYear?: number;
  deathDate?: string;
  deathYear?: number;
  website?: string;
  genres?: string[];
  influences?: string[];
};

export type AuthorMetadataProviderInfo = {
  key: AuthorMetadataProviderKey;
  label: string;
  identifiable: boolean;
  supportedFields: AuthorMetadataField[];
};

export type AuthorEnrichmentStatus = {
  queued: number;
  processing: number;
  rateLimited: number;
  failed: number;
  latestFailureAt: string | null;
  done: number;
  total: number;
};

export type AuthorEnrichmentStatusEvent = AuthorEnrichmentStatus & {
  paused: boolean;
  sessionTotal: number;
  sessionDone: number;
  sessionFailed: number;
  currentItemName: string | null;
};

export type AuthorEnrichmentFailedItem = {
  authorId: number;
  name: string | null;
  error: string | null;
  httpStatus: number | null;
  failedAt: string;
};

export type AuthorEnrichmentFailedPage = {
  items: AuthorEnrichmentFailedItem[];
  total: number;
  page: number;
  limit: number;
};

// Retained only so the app_settings migration can read pre-per-field values.
// Overwrite behaviour now lives on each field's mergeStrategy.
export const AuthorAutoEnrichmentWriteMode = {
  MISSING_ONLY: "missing_only",
  ALWAYS_REFETCH: "always_refetch",
} as const;

export type AuthorAutoEnrichmentWriteMode = (typeof AuthorAutoEnrichmentWriteMode)[keyof typeof AuthorAutoEnrichmentWriteMode];

export type AuthorEnrichmentConditions = {
  neverEnriched: boolean;
  missingBio: boolean;
  missingPhoto: boolean;
};

export type AuthorAutoEnrichmentConfig = {
  enabled: boolean;
  triggerOnImport: boolean;
  conditions: AuthorEnrichmentConditions;
};

export type AuthorMetadataField = "description" | "photo" | "birthDate" | "deathDate" | "website" | "genres" | "influences";

export const ALL_AUTHOR_METADATA_FIELDS: AuthorMetadataField[] = [
  "description",
  "photo",
  "birthDate",
  "deathDate",
  "website",
  "genres",
  "influences",
];

// What each provider can actually return. Audnexus exposes only asin, name,
// description and image, so listing it against any other field would be inert.
export const AUTHOR_PROVIDER_SUPPORTED_FIELDS: Record<AuthorMetadataProviderKey, AuthorMetadataField[]> = {
  [AuthorMetadataProviderKey.AUDNEXUS]: ["description", "photo"],
  [AuthorMetadataProviderKey.GOODREADS]: [...ALL_AUTHOR_METADATA_FIELDS],
};

export function providerSupportsAuthorField(provider: AuthorMetadataProviderKey, field: AuthorMetadataField): boolean {
  return AUTHOR_PROVIDER_SUPPORTED_FIELDS[provider]?.includes(field) ?? false;
}

export type AuthorFieldPreference = {
  enabled: boolean;
  providers: AuthorMetadataProviderKey[];
  mergeStrategy: MergeStrategy;
};

// Authors are global rows shared across every library, so unlike book metadata
// these preferences have no per-library override layer.
export type AuthorMetadataPreferences = {
  fields: Record<AuthorMetadataField, AuthorFieldPreference>;
};
