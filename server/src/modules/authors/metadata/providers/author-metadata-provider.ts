import { AuthorMetadataCandidate, AuthorMetadataProviderKey } from '@projectx/types';

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
