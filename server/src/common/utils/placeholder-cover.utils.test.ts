import { createHash } from 'crypto';

import { GOOGLE_BOOKS_PLACEHOLDER_HASHES, GOOGLE_BOOKS_PLACEHOLDER_LENGTHS, isKnownPlaceholderCover } from './placeholder-cover.utils';

describe('isKnownPlaceholderCover', () => {
  it('matches only bytes of the placeholder length and hash', () => {
    const [length] = [...GOOGLE_BOOKS_PLACEHOLDER_LENGTHS];
    const sameLength = Buffer.alloc(length!, 1);

    expect(GOOGLE_BOOKS_PLACEHOLDER_HASHES.has(createHash('sha256').update(sameLength).digest('hex'))).toBe(false);
    expect(isKnownPlaceholderCover(sameLength)).toBe(false);
    expect(isKnownPlaceholderCover(Buffer.alloc(10))).toBe(false);
  });
});
