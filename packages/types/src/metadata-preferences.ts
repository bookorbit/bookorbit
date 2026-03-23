import { MetadataProviderKey } from "./metadata-fetch";

export type MetadataField =
  | "title"
  | "subtitle"
  | "description"
  | "cover"
  | "authors"
  | "publisher"
  | "publishedYear"
  | "language"
  | "pageCount"
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
  "authors",
  "publisher",
  "publishedYear",
  "language",
  "pageCount",
  "seriesName",
  "seriesIndex",
  "genres",
  "narrators",
  "duration",
  "abridged",
];

export type MergeStrategy = "fillMissing" | "overwrite" | "overwriteIfProvided";
export type GenreMergeMode = "firstProvider" | "merge";
export type GenreProviderScope = "selectedProviders" | "allConfiguredProviders";

export interface FieldPreference {
  enabled: boolean;
  providers: MetadataProviderKey[];
  mergeStrategy: MergeStrategy;
}

export type FieldPreferenceOverrides = Partial<Record<MetadataField, FieldPreference>>;

export interface MetadataFetchOptions {
  genres: {
    mode: GenreMergeMode;
    providerScope: GenreProviderScope;
  };
  saveProviderIds: boolean;
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

export interface ProviderConfigurations {
  google: GoogleProviderConfig;
  amazon: AmazonProviderConfig;
  goodreads: SimpleProviderConfig;
  hardcover: HardcoverProviderConfig;
  openLibrary: SimpleProviderConfig;
  itunes: SimpleProviderConfig;
  audible: AudibleProviderConfig;
  audnexus: AudnexusProviderConfig;
  comicvine: ComicVineProviderConfig;
}

export interface ProviderStatus {
  key: MetadataProviderKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
}
