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
export const MERGE_STRATEGIES: MergeStrategy[] = ["fillMissing", "overwrite", "overwriteIfProvided"];
export const GENRE_MERGE_MODES: GenreMergeMode[] = ["firstProvider", "merge"];

export interface FieldPreference {
  enabled: boolean;
  providers: MetadataProviderKey[];
  mergeStrategy: MergeStrategy;
}

export type FieldPreferenceOverrides = Partial<Record<MetadataField, FieldPreference>>;

export interface MetadataFetchOptions {
  genres: {
    mode: GenreMergeMode;
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

export interface ProviderConfigurations {
  google: GoogleProviderConfig;
  amazon: AmazonProviderConfig;
  goodreads: SimpleProviderConfig;
  hardcover: HardcoverProviderConfig;
  openLibrary: SimpleProviderConfig;
  itunes: ITunesProviderConfig;
  audible: AudibleProviderConfig;
  audnexus: AudnexusProviderConfig;
  comicvine: ComicVineProviderConfig;
  ranobedb: SimpleProviderConfig;
}

export interface ProviderStatus {
  key: MetadataProviderKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
}

export type ProviderConnectionTestStatus = "success" | "warning" | "fail";

export interface ProviderConnectionTestResult {
  key: MetadataProviderKey;
  ok: boolean;
  status: ProviderConnectionTestStatus;
  message: string;
}
