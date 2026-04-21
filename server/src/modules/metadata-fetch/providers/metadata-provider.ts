import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { MetadataSearchParams } from './metadata-search-params';

export interface MetadataProvider {
  readonly key: MetadataProviderKey;
  readonly label: string;
  readonly identifiable: boolean;
  search(params: MetadataSearchParams): Promise<MetadataCandidate[]>;
}

export interface IdentifiableProvider extends MetadataProvider {
  readonly identifiable: true;
  lookupById(providerId: string, signal?: AbortSignal): Promise<MetadataCandidate | null>;
}

export function isIdentifiable(p: MetadataProvider): p is IdentifiableProvider {
  return p.identifiable === true;
}
