import { AuthorMetadataCandidate, AuthorMetadataField, AuthorMetadataProviderKey } from '@bookorbit/types';

import type { ProviderCacheSpec } from '../../../../common/provider-cache/provider-cache-spec';

export type AuthorMetadataSearchParams = {
  name: string;
  region?: string;
  limit?: number;
  /** The caller's deadline; every request the provider makes is abandoned once it aborts. */
  signal?: AbortSignal;
};

export interface AuthorMetadataProvider {
  readonly key: AuthorMetadataProviderKey;
  readonly label: string;
  readonly identifiable: boolean;
  /** Fields this provider can actually return. Assigning it to any other field
   *  would be inert, so preferences and the settings UI both filter on this. */
  readonly supportedFields: readonly AuthorMetadataField[];
  /** Absent for providers that have not opted into the metadata cache. */
  readonly cache?: ProviderCacheSpec<AuthorMetadataSearchParams>;
  search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]>;
}

export interface IdentifiableAuthorMetadataProvider extends AuthorMetadataProvider {
  readonly identifiable: true;
  lookupById(providerId: string, region?: string, signal?: AbortSignal): Promise<AuthorMetadataCandidate | null>;
}

export function isIdentifiableAuthorProvider(p: AuthorMetadataProvider): p is IdentifiableAuthorMetadataProvider {
  return p.identifiable === true;
}

export class AuthorMetadataProviderError extends Error {
  readonly httpStatus: number | null;
  readonly retryAfterMs: number | null;
  readonly transient: boolean;

  constructor(
    message: string,
    options?: {
      httpStatus?: number | null;
      retryAfterMs?: number | null;
      transient?: boolean;
    },
  ) {
    super(message);
    this.name = 'AuthorMetadataProviderError';
    this.httpStatus = options?.httpStatus ?? null;
    this.retryAfterMs = options?.retryAfterMs ?? null;
    this.transient = options?.transient ?? false;
  }
}
