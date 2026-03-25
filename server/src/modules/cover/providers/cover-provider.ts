import { CoverSearchResult } from '@projectx/types';

export const COVER_PROVIDER_KEYS = ['duckduckgo', 'itunes'] as const;
export type CoverProviderKey = (typeof COVER_PROVIDER_KEYS)[number];
export type CoverSearchProvider = CoverProviderKey | 'all';

export interface CoverSearchParams {
  title: string;
  author?: string;
  isAudiobook?: boolean;
}

export interface CoverProvider {
  key: CoverProviderKey;
  search(params: CoverSearchParams): Promise<CoverSearchResult[]>;
}
