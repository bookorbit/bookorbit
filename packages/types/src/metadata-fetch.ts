export const MetadataProviderKey = {
  GOOGLE: 'google',
  GOODREADS: 'goodreads',
  AMAZON: 'amazon',
  HARDCOVER: 'hardcover',
  OPEN_LIBRARY: 'openLibrary',
} as const;

export type MetadataProviderKey = (typeof MetadataProviderKey)[keyof typeof MetadataProviderKey];

export interface MetadataCandidate {
  provider: MetadataProviderKey;
  providerId: string;
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
  tags?: string[];
  coverUrl?: string;
  sourceUrl?: string;
}

export interface MetadataProviderInfo {
  key: MetadataProviderKey;
  label: string;
  identifiable: boolean;
}
