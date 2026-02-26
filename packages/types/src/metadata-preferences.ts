import { MetadataProviderKey } from './metadata-fetch';

export type MetadataField =
  | 'title'
  | 'subtitle'
  | 'description'
  | 'cover'
  | 'authors'
  | 'publisher'
  | 'publishedYear'
  | 'language'
  | 'pageCount'
  | 'seriesName'
  | 'seriesIndex'
  | 'genres';

export const ALL_METADATA_FIELDS: MetadataField[] = [
  'title',
  'subtitle',
  'description',
  'cover',
  'authors',
  'publisher',
  'publishedYear',
  'language',
  'pageCount',
  'seriesName',
  'seriesIndex',
  'genres',
];

export type MergeStrategy = 'fillMissing' | 'overwrite' | 'overwriteIfProvided';

export interface FieldPreference {
  enabled: boolean;
  providers: MetadataProviderKey[];
  mergeStrategy: MergeStrategy;
}

export type FieldPreferenceOverrides = Partial<Record<MetadataField, FieldPreference>>;

export interface MetadataFetchPreferences {
  fields: Record<MetadataField, FieldPreference>;
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

export interface ProviderConfigurations {
  google: GoogleProviderConfig;
  amazon: AmazonProviderConfig;
  goodreads: SimpleProviderConfig;
  hardcover: HardcoverProviderConfig;
  openLibrary: SimpleProviderConfig;
}

export interface ProviderStatus {
  key: MetadataProviderKey;
  label: string;
  configured: boolean;
  enabled: boolean;
  hint?: string;
}
