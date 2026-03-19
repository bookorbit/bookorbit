export const MetadataProviderKey = {
  GOOGLE: 'google',
  GOODREADS: 'goodreads',
  AMAZON: 'amazon',
  HARDCOVER: 'hardcover',
  OPEN_LIBRARY: 'openLibrary',
  ITUNES: 'itunes',
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
  genres?: string[];
  coverUrl?: string;
  sourceUrl?: string;
}

export interface MetadataProviderInfo {
  key: MetadataProviderKey;
  label: string;
  identifiable: boolean;
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
}
