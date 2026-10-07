import { MetadataCandidate, MetadataProviderKey } from '@bookorbit/types';

import { candidateHasNormalizedIsbn, candidatesShareIsbn, normalizeMetadataIsbn } from './isbn-match';

function candidate(data: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    provider: MetadataProviderKey.HARDCOVER,
    providerId: 'hardcover-slug',
    title: 'Kometen kommer',
    ...data,
  };
}

describe('isbn-match', () => {
  it('matches equivalent ISBN-10 and ISBN-13 across providers', () => {
    expect(candidateHasNormalizedIsbn(candidate({ isbn10: '0306406152' }), '9780306406157')).toBe(true);
    expect(candidateHasNormalizedIsbn(candidate({ isbn13: '9780306406157' }), '0306406152')).toBe(true);
    expect(candidatesShareIsbn(candidate({ isbn10: '0306406152' }), candidate({ isbn13: '9780306406157' }))).toBe(true);
    expect(candidatesShareIsbn(candidate({ isbn10: '0306406152' }), candidate({ isbn13: '9781635766264' }))).toBe(false);
  });

  it('normalizes formatted ISBN values for comparison', () => {
    const normalized = normalizeMetadataIsbn('978-952-333-158-7');

    expect(normalized).toBe('9789523331587');
    expect(candidateHasNormalizedIsbn(candidate({ isbn13: '9789523331587' }), normalized)).toBe(true);
  });

  it('does not match missing or different ISBN values', () => {
    const normalized = normalizeMetadataIsbn('9789523331587');

    expect(candidateHasNormalizedIsbn(candidate(), normalized)).toBe(false);
    expect(candidateHasNormalizedIsbn(candidate({ isbn13: '9788203250132' }), normalized)).toBe(false);
    expect(candidateHasNormalizedIsbn(candidate({ isbn13: '9789523331587' }), '')).toBe(false);
  });
});
