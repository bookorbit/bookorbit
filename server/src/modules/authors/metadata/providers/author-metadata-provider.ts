import { AuthorMetadataCandidate, AuthorMetadataProviderKey } from '@bookorbit/types';

export type AuthorMetadataSearchParams = {
  name: string;
  region?: string;
  limit?: number;
};

export interface AuthorMetadataProvider {
  readonly key: AuthorMetadataProviderKey;
  readonly label: string;
  readonly identifiable: boolean;
  search(params: AuthorMetadataSearchParams): Promise<AuthorMetadataCandidate[]>;
}

export interface IdentifiableAuthorMetadataProvider extends AuthorMetadataProvider {
  readonly identifiable: true;
  lookupById(providerId: string, region?: string): Promise<AuthorMetadataCandidate | null>;
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
