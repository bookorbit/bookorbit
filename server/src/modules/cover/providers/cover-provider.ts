import { CoverSearchResult } from '@bookorbit/types';

export const DUCKDUCKGO_PROVIDER_KEY = 'duckduckgo' as const;
export const ITUNES_PROVIDER_KEY = 'itunes' as const;
export const AUDIOBOOKCOVERS_PROVIDER_KEY = 'audiobookcovers' as const;
export const COVER_PROVIDER_KEYS = [DUCKDUCKGO_PROVIDER_KEY, ITUNES_PROVIDER_KEY, AUDIOBOOKCOVERS_PROVIDER_KEY] as const;
export const COVER_PROVIDER_ALL_KEY = 'all' as const;
export const DEFAULT_COVER_PROVIDER_KEY = DUCKDUCKGO_PROVIDER_KEY;

export type CoverProviderKey = (typeof COVER_PROVIDER_KEYS)[number];
export type CoverSearchProvider = CoverProviderKey | typeof COVER_PROVIDER_ALL_KEY;

export interface CoverSearchParams {
  title: string;
  author?: string;
  isAudiobook?: boolean;
  ignoreProviderEnabled?: boolean;
}

export interface CoverProvider {
  key: CoverProviderKey;
  search(params: CoverSearchParams): Promise<CoverSearchResult[]>;
}
