import { isBuiltInMetadataProviderKey, MetadataProviderKey, type BuiltInMetadataProviderKey, type MetadataProviderSource } from "./metadata-fetch";

export type MetadataField =
  | "title"
  | "subtitle"
  | "description"
  | "cover"
  | "audioCover"
  | "authors"
  | "publisher"
  | "isbn"
  | "publishedYear"
  | "language"
  | "pageCount"
  | "communityRating"
  | "seriesName"
  | "seriesIndex"
  | "genres"
  | "narrators"
  | "duration"
  | "abridged";

export const ALL_METADATA_FIELDS: MetadataField[] = [
  "title",
  "subtitle",
  "description",
  "cover",
  "audioCover",
  "authors",
  "publisher",
  "isbn",
  "publishedYear",
  "language",
  "pageCount",
  "communityRating",
  "seriesName",
  "seriesIndex",
  "genres",
  "narrators",
  "duration",
  "abridged",
];

export type MergeStrategy = "fillMissing" | "overwrite" | "overwriteIfProvided";
export type MetadataMergeStrategy = MergeStrategy | "mergeExisting";
export type GenreMergeMode = "firstProvider" | "merge";
export type ProviderIdFetchMode = "preferExisting" | "existingOnly";
export const MERGE_STRATEGIES: MergeStrategy[] = ["fillMissing", "overwrite", "overwriteIfProvided"];
export const GENRE_MERGE_STRATEGIES: MetadataMergeStrategy[] = ["fillMissing", "mergeExisting", "overwriteIfProvided", "overwrite"];
export const GENRE_MERGE_MODES: GenreMergeMode[] = ["firstProvider", "merge"];
export const PROVIDER_ID_FETCH_MODES: ProviderIdFetchMode[] = ["preferExisting", "existingOnly"];
export const MAX_METADATA_GENRE_COUNT = 50;

export interface FieldPreference {
  enabled: boolean;
  providers: MetadataProviderKey[];
  mergeStrategy: MetadataMergeStrategy;
}

export type FieldPreferenceOverrides = Partial<Record<MetadataField, FieldPreference>>;

export interface MetadataFetchOptions {
  genres: {
    mode: GenreMergeMode;
    blocklist: string[];
    maxCount: number | null;
  };
  saveProviderIds: boolean;
  providerIdMode: ProviderIdFetchMode;
}

export interface MetadataFetchPreferences {
  fields: Record<MetadataField, FieldPreference>;
  options?: MetadataFetchOptions;
}

export interface LibraryMetadataPreferences {
  libraryId: number;
  overrides: FieldPreferenceOverrides | null;
  effective: MetadataFetchPreferences;
}

export interface GoogleProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface HardcoverProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface AmazonProviderConfig {
  enabled: boolean;
  domain: string;
  cookie: string;
}

export interface SimpleProviderConfig {
  enabled: boolean;
}

export type ITunesCoverResolution = "standard" | "high";
export const ITUNES_COVER_RESOLUTIONS: ITunesCoverResolution[] = ["standard", "high"];

export interface ITunesProviderConfig {
  enabled: boolean;
  coverResolution: ITunesCoverResolution;
}

export interface AudibleProviderConfig {
  enabled: boolean;
  domain: string;
}

export interface AudnexusProviderConfig {
  enabled: boolean;
}

export interface ComicVineProviderConfig {
  enabled: boolean;
  apiKey: string;
}

export interface KoboProviderConfig {
  enabled: boolean;
  country: string;
  language: string;
}

export interface ProviderConfigurations {
  google: GoogleProviderConfig;
  amazon: AmazonProviderConfig;
  goodreads: SimpleProviderConfig;
  hardcover: HardcoverProviderConfig;
  openLibrary: SimpleProviderConfig;
  itunes: ITunesProviderConfig;
  audible: AudibleProviderConfig;
  audnexus: AudnexusProviderConfig;
  librofm: SimpleProviderConfig;
  comicvine: ComicVineProviderConfig;
  ranobedb: SimpleProviderConfig;
  kobo: KoboProviderConfig;
}

export interface ProviderStatus {
  key: MetadataProviderKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
  /** Absent on servers older than external providers, which only had built-ins. */
  source?: MetadataProviderSource;
  /** An external provider's declared fields; built-ins use `METADATA_PROVIDER_SUPPORTED_FIELDS`. */
  supportedFields?: MetadataField[] | null;
  /** An external provider's icon and colour, as on `MetadataProviderInfo`. */
  iconUrl?: string;
  color?: string;
  /**
   * Set for a provider that used to be built in and is not registered: the image to run, or null when
   * the source closed and there is none, and whether field rules or stored ids still use it.
   */
  movedOut?: { image: string | null; inUse: boolean };
}

export type ProviderConnectionTestStatus = "success" | "warning" | "fail";

export interface ProviderConnectionTestResult {
  key: MetadataProviderKey;
  ok: boolean;
  status: ProviderConnectionTestStatus;
  message: string;
}

/**
 * The field-rule fields each provider can ever fill, read from its mapper on 2026-10-08. The rule
 * editor uses it to say a provider will never answer a field; nothing fetches by it, so an entry
 * that drifts costs a wrong hint, never a value. A field filled only on some paths (Goodreads'
 * publisher, which its fallback search lacks) counts as filled.
 *
 * The two cover rules list a provider only where its art can be that slot's shape. Audible's art is
 * always square, so it is not under `cover`; it still fills an empty ebook slot as a last resort.
 */
export const METADATA_PROVIDER_SUPPORTED_FIELDS: Record<BuiltInMetadataProviderKey, readonly MetadataField[]> = {
  [MetadataProviderKey.GOOGLE]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "genres",
  ],
  [MetadataProviderKey.GOODREADS]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "seriesName",
    "seriesIndex",
    "genres",
  ],
  [MetadataProviderKey.AMAZON]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "audioCover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "seriesName",
    "seriesIndex",
    "genres",
  ],
  [MetadataProviderKey.HARDCOVER]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "audioCover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "seriesName",
    "seriesIndex",
    "genres",
  ],
  [MetadataProviderKey.OPEN_LIBRARY]: [
    "title",
    "description",
    "cover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "genres",
  ],
  [MetadataProviderKey.ITUNES]: [
    "title",
    "description",
    "cover",
    "audioCover",
    "authors",
    "publisher",
    "publishedYear",
    "language",
    "communityRating",
    "genres",
  ],
  [MetadataProviderKey.AUDIBLE]: [
    "title",
    "subtitle",
    "description",
    "audioCover",
    "authors",
    "publisher",
    "publishedYear",
    "language",
    "communityRating",
    "seriesName",
    "seriesIndex",
    "genres",
    "narrators",
    "duration",
    "abridged",
  ],
  [MetadataProviderKey.AUDNEXUS]: [
    "title",
    "subtitle",
    "description",
    "audioCover",
    "authors",
    "publisher",
    "publishedYear",
    "language",
    "seriesName",
    "seriesIndex",
    "narrators",
    "duration",
    "abridged",
  ],
  [MetadataProviderKey.LIBROFM]: [
    "title",
    "subtitle",
    "description",
    "audioCover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "seriesName",
    "seriesIndex",
    "genres",
    "narrators",
    "duration",
    "abridged",
  ],
  [MetadataProviderKey.COMICVINE]: ["title", "description", "cover", "authors", "publisher", "publishedYear", "seriesName", "seriesIndex"],
  [MetadataProviderKey.RANOBEDB]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "communityRating",
    "seriesName",
    "seriesIndex",
    "genres",
  ],
  [MetadataProviderKey.KOBO]: [
    "title",
    "subtitle",
    "description",
    "cover",
    "authors",
    "publisher",
    "isbn",
    "publishedYear",
    "language",
    "pageCount",
    "seriesName",
    "seriesIndex",
    "genres",
  ],
};

/** How a provider stands against one field: it can fill it, its cover art is the other shape, or never. */
export type ProviderFieldSupport = "supplies" | "otherShape" | "never";

/**
 * `declaredFields` is what an external provider says it fills; built-ins are answered from
 * `METADATA_PROVIDER_SUPPORTED_FIELDS`.
 */
export function providerFieldSupport(
  provider: MetadataProviderKey,
  field: MetadataField,
  declaredFields?: readonly MetadataField[] | null,
): ProviderFieldSupport {
  const fields = declaredFields ?? (isBuiltInMetadataProviderKey(provider) ? METADATA_PROVIDER_SUPPORTED_FIELDS[provider] : undefined);
  // An unknown key, or a provider that did not say, would only get a guess.
  if (!fields || fields.includes(field)) return "supplies";
  if (field === "cover" || field === "audioCover") return "otherShape";
  return "never";
}
