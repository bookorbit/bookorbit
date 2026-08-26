import { ConcreteBookMediaKind, MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { MetadataSearchParams } from './metadata-search-params';

export interface MetadataProvider {
  readonly key: MetadataProviderKey;
  readonly label: string;
  readonly identifiable: boolean;
  readonly timeoutMs?: number;
  /**
   * The media kinds this provider is worth asking about. Only specialists declare one; a provider
   * that leaves it undefined serves every kind, so a new provider is never silently scoped out.
   */
  readonly mediaKinds?: readonly ConcreteBookMediaKind[];
  search(params: MetadataSearchParams): Promise<MetadataCandidate[]>;
}

export interface IdentifiableProvider extends MetadataProvider {
  readonly identifiable: true;
  lookupById(providerId: string, signal?: AbortSignal, params?: MetadataSearchParams): Promise<MetadataCandidate | null>;
}

export function isIdentifiable(p: MetadataProvider): p is IdentifiableProvider {
  return p.identifiable === true;
}
