import { findIsbnInText, isValidIsbn10, isValidIsbn13, normalizeIsbn, pickBestIsbn } from './isbn-detect';

describe('normalizeIsbn', () => {
  it('strips separators and uppercases X', () => {
    expect(normalizeIsbn('978-0-306-40615-7')).toBe('9780306406157');
    expect(normalizeIsbn('0 306 40615 2')).toBe('0306406152');
    expect(normalizeIsbn('097522980x')).toBe('097522980X');
  });
});

describe('isValidIsbn10', () => {
  it('accepts valid ISBN-10 incl. X check digit', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('097522980X')).toBe(true);
  });
  it('rejects bad checksum, wrong length, lowercase x', () => {
    expect(isValidIsbn10('0306406153')).toBe(false);
    expect(isValidIsbn10('1234567890')).toBe(false);
    expect(isValidIsbn10('030640615')).toBe(false);
    expect(isValidIsbn10('097522980x')).toBe(false);
  });
});

describe('isValidIsbn13', () => {
  it('accepts valid 978/979 ISBN-13', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9781635766264')).toBe(true);
  });
  it('rejects bad checksum and non-978/979 prefix', () => {
    expect(isValidIsbn13('9780306406158')).toBe(false);
    expect(isValidIsbn13('1230306406157')).toBe(false);
    expect(isValidIsbn13('978030640615')).toBe(false);
  });
});

describe('findIsbnInText', () => {
  it('finds a labeled ISBN-13', () => {
    const hits = findIsbnInText('Copyright page. ISBN: 978-0-306-40615-7. All rights reserved.');
    expect(hits).toEqual([{ value: '9780306406157', kind: 13, labeled: true }]);
  });

  it('marks an unlabeled ISBN as not labeled', () => {
    const hits = findIsbnInText('Some long preamble text here 9780306406157 trailing');
    expect(hits).toEqual([{ value: '9780306406157', kind: 13, labeled: false }]);
  });

  it('finds a labeled ISBN-10', () => {
    const hits = findIsbnInText('ISBN-10: 0-306-40615-2');
    expect(hits).toEqual([{ value: '0306406152', kind: 10, labeled: true }]);
  });

  it('rejects phone numbers, dates and bad checksums', () => {
    expect(findIsbnInText('Call 1-800-555-0199 today')).toEqual([]);
    expect(findIsbnInText('Published 2020-01-01')).toEqual([]);
    expect(findIsbnInText('ISBN 978-0-306-40615-8')).toEqual([]);
  });

  it('de-duplicates by value and upgrades to labeled', () => {
    const hits = findIsbnInText('9780306406157\nfoo bar baz\nISBN: 9780306406157');
    expect(hits).toEqual([{ value: '9780306406157', kind: 13, labeled: true }]);
  });

  it('respects the label lookback window', () => {
    const far = findIsbnInText('ISBN is the worldwide standard, but this number 9780306406157');
    expect(far[0].labeled).toBe(false);
  });
});

describe('pickBestIsbn', () => {
  it('prefers a labeled ISBN-13 over a labeled ISBN-10', () => {
    const result = pickBestIsbn([
      { value: '0306406152', kind: 10, labeled: true },
      { value: '9780306406157', kind: 13, labeled: true },
    ]);
    expect(result).toEqual({ isbn10: null, isbn13: '9780306406157' });
  });

  it('falls back to a labeled ISBN-10', () => {
    expect(pickBestIsbn([{ value: '0306406152', kind: 10, labeled: true }])).toEqual({ isbn10: '0306406152', isbn13: null });
  });

  it('ignores unlabeled hits', () => {
    expect(pickBestIsbn([{ value: '9780306406157', kind: 13, labeled: false }])).toEqual({ isbn10: null, isbn13: null });
  });

  it('returns nulls for an empty set', () => {
    expect(pickBestIsbn([])).toEqual({ isbn10: null, isbn13: null });
  });
});
