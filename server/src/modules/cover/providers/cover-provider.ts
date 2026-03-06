import { CoverSearchResult } from '@projectx/types';

export interface CoverSearchParams {
  title: string;
  author?: string;
  isAudiobook?: boolean;
}

export interface CoverProvider {
  key: string;
  search(params: CoverSearchParams): Promise<CoverSearchResult[]>;
}
