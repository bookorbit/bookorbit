import { MetadataCandidate } from '@bookorbit/types';

import { canonicalIsbn13, normalizeMetadataIsbn } from '../../common/text-match/isbn-normalize';

export { normalizeMetadataIsbn };

export function candidateHasNormalizedIsbn(candidate: MetadataCandidate, normalizedIsbn: string): boolean {
  const canonical = canonicalIsbn13(normalizedIsbn);
  return (
    normalizedIsbn.length > 0 &&
    [candidate.isbn10, candidate.isbn13].some(
      (value) => normalizeMetadataIsbn(value) === normalizedIsbn || (canonical !== undefined && canonicalIsbn13(value) === canonical),
    )
  );
}

export function candidatesShareIsbn(left: MetadataCandidate, right: MetadataCandidate): boolean {
  return [left.isbn10, left.isbn13].some((value) => candidateHasNormalizedIsbn(right, normalizeMetadataIsbn(value)));
}
