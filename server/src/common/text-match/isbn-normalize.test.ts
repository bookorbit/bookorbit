import { canonicalIsbn13, splitMetadataIsbn } from './isbn-normalize';

describe('ISBN identifiers', () => {
  it.each([
    ['0-306-40615-2', { isbn10: '0306406152' }],
    ['0-9752298-0-x', { isbn10: '097522980X' }],
    ['978-0-306-40615-7', { isbn13: '9780306406157' }],
    ['9798896602590', { isbn13: '9798896602590' }],
    ['', {}],
    [null, {}],
    ['not an ISBN', {}],
  ] as const)('places %s in the correct field without creating a counterpart', (value, expected) => {
    expect(splitMetadataIsbn(value)).toEqual(expected);
  });

  it('compares equivalent identifiers while rejecting invalid checksums', () => {
    expect(canonicalIsbn13('0306406152')).toBe('9780306406157');
    expect(canonicalIsbn13('9780306406157')).toBe('9780306406157');
    expect(canonicalIsbn13('9798896602590')).toBe('9798896602590');
    expect(canonicalIsbn13('0306406153')).toBeUndefined();
    expect(canonicalIsbn13('9780306406158')).toBeUndefined();
  });
});
