import { ConcreteBookMediaKind, MetadataCandidate, MetadataCoverShape, MetadataProviderKey } from '@bookorbit/types';

import type { ProviderCacheSpec } from '../../../common/provider-cache/provider-cache-spec';
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
  /**
   * The shape of every cover this provider returns, when that never varies. A provider whose art
   * depends on the edition it matched leaves this unset and states `coverShape` per candidate.
   */
  readonly coverShape?: Exclude<MetadataCoverShape, 'unknown'>;
  /**
   * True when the provider carries both an ebook and an audiobook edition of a title and answers
   * with the one `isAudiobook` asks for, art included. Only these are asked again for a book's
   * other medium.
   */
  readonly editionFollowsMedium?: boolean;
  /**
   * How the metadata cache identifies this provider's calls. A provider without one is never
   * cached. Its key inputs must cover every parameter the provider reads, directly or in helpers.
   */
  readonly cache?: ProviderCacheSpec<MetadataSearchParams>;
  /** `external` for a provider registered at runtime over HTTP; built-ins leave it unset. */
  readonly source?: 'external';
  /** An external provider's icon as BookOrbit serves it, and its brand colour. Built-ins' live in the clients. */
  readonly iconUrl?: string;
  readonly color?: string;
  /** A record link for a stored id, for providers that publish a URL template. */
  bookUrl?(id: string): string | undefined;
  search(params: MetadataSearchParams): Promise<MetadataCandidate[]>;
}

export interface IdentifiableProvider extends MetadataProvider {
  readonly identifiable: true;
  lookupById(providerId: string, signal?: AbortSignal, params?: MetadataSearchParams): Promise<MetadataCandidate | null>;
}

export function isIdentifiable(p: MetadataProvider): p is IdentifiableProvider {
  return p.identifiable === true;
}
