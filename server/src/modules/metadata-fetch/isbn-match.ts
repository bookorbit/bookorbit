import { MetadataCandidate } from '@bookorbit/types';

import { normalizeMetadataIsbn } from '../../common/text-match/isbn-normalize';

export { normalizeMetadataIsbn };

export function candidateHasNormalizedIsbn(candidate: MetadataCandidate, normalizedIsbn: string): boolean {
  return (
    normalizedIsbn.length > 0 &&
    (normalizeMetadataIsbn(candidate.isbn10) === normalizedIsbn || normalizeMetadataIsbn(candidate.isbn13) === normalizedIsbn)
  );
}

export function candidatesShareIsbn(left: MetadataCandidate, right: MetadataCandidate): boolean {
  const isbn13 = normalizeMetadataIsbn(left.isbn13);
  if (isbn13 && normalizeMetadataIsbn(right.isbn13) === isbn13) return true;

  const isbn10 = normalizeMetadataIsbn(left.isbn10);
  return isbn10.length > 0 && normalizeMetadataIsbn(right.isbn10) === isbn10;
}
