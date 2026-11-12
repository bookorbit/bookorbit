import {
  findIsbnInText,
  isValidIsbn10,
  isValidIsbn13,
  mergeIsbnHits,
  normalizeIsbn,
  pickSingleIsbn,
  toIsbnCandidates,
  type IsbnHit,
} from './isbn-detect';

const ISBN_13 = '9780306406157';
const ISBN_10 = '0306406152';
const OTHER_13 = '9781635766264';
const OTHER_10 = '1635766265';
const ISBN_979 = '9791032305690';

function hit(value: string, overrides: Partial<IsbnHit> = {}): IsbnHit {
  return { value, kind: value.length === 13 ? 13 : 10, labeled: true, edition: null, context: '', ...overrides };
}

function editionOf(text: string, value: string) {
  return findIsbnInText(text).find((h) => h.value === value)?.edition;
}

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
  it('finds a labeled ISBN-13 with the words around it', () => {
    const hits = findIsbnInText('Copyright page. ISBN: 978-0-306-40615-7. All rights reserved.');
    expect(hits).toEqual([
      { value: ISBN_13, kind: 13, labeled: true, edition: null, context: 'Copyright page. ISBN: 978-0-306-40615-7. All rights reserved.' },
    ]);
  });

  it('marks an unlabeled ISBN as not labeled', () => {
    const hits = findIsbnInText('Some long preamble text here 9780306406157 trailing');
    expect(hits).toMatchObject([{ value: ISBN_13, kind: 13, labeled: false, edition: null }]);
  });

  it('finds a labeled ISBN-10', () => {
    expect(findIsbnInText('ISBN-10: 0-306-40615-2')).toMatchObject([{ value: ISBN_10, kind: 10, labeled: true }]);
  });

  it('rejects phone numbers, dates and bad checksums', () => {
    expect(findIsbnInText('Call 1-800-555-0199 today')).toEqual([]);
    expect(findIsbnInText('Published 2020-01-01')).toEqual([]);
    expect(findIsbnInText('ISBN 978-0-306-40615-8')).toEqual([]);
  });

  it('de-duplicates by value and upgrades to labeled', () => {
    const hits = findIsbnInText('9780306406157\nfoo bar baz\nISBN: 9780306406157');
    expect(hits).toMatchObject([{ value: ISBN_13, kind: 13, labeled: true }]);
  });

  it('respects the label lookback window', () => {
    const far = findIsbnInText('ISBN is the worldwide standard, but this number 9780306406157');
    expect(far[0].labeled).toBe(false);
  });

  it('does not count an ISBN inside a URL as labeled', () => {
    expect(findIsbnInText('See https://example.com/errata.csp?isbn=9780306406157 for details')[0].labeled).toBe(false);
    expect(findIsbnInText('Visit example.com/isbn/9780306406157 today')[0].labeled).toBe(false);
  });

  it('accepts a label straight after a sentence', () => {
    expect(findIsbnInText('New York, New York 10014.ISBN: 978-0-306-40615-7')).toMatchObject([{ value: ISBN_13, labeled: true }]);
  });

  it('accepts eISBN and e-ISBN labels as the ebook edition', () => {
    expect(findIsbnInText('eISBN: 978-0-306-40615-7')).toMatchObject([{ labeled: true, edition: 'ebook' }]);
    expect(findIsbnInText('e-ISBN 978-0-306-40615-7')).toMatchObject([{ labeled: true, edition: 'ebook' }]);
    expect(findIsbnInText('e ISBN 978-0-306-40615-7')).toMatchObject([{ labeled: true, edition: 'ebook' }]);
  });

  it('reads the edition from brackets after the number', () => {
    const text = 'ISBN 978-0-306-40615-7 (hardcover) ISBN 978-1-63576-626-4 (ebook)';
    expect(editionOf(text, ISBN_13)).toBe('hardcover');
    expect(editionOf(text, OTHER_13)).toBe('ebook');
  });

  it('reads the edition between the label and the number', () => {
    expect(editionOf('ISBN-13 (pbk.): 978-0-306-40615-7', ISBN_13)).toBe('paperback');
  });

  it('reads the edition named before the label', () => {
    const text = 'Paperback ISBN 978-0-306-40615-7 Large Print ISBN 978-1-63576-626-4 Audio CD ISBN 978-1-55192-370-3';
    expect(editionOf(text, ISBN_13)).toBe('paperback');
    expect(editionOf(text, OTHER_13)).toBe('print');
    expect(editionOf(text, '9781551923703')).toBe('audio');
  });

  it('gives an unbracketed word after one number to the next ISBN, not the previous one', () => {
    const text = 'Data is available upon request. ISBN 978-0-306-40615-7 eBook ISBN 978-1-63576-626-4 Map by';
    expect(editionOf(text, ISBN_13)).toBeNull();
    expect(editionOf(text, OTHER_13)).toBe('ebook');
  });

  it('carries one label over the list that follows it', () => {
    const text = 'ISBNs: 9780306406157 (hardcover), 9781635766264 (ebook)';
    expect(findIsbnInText(text)).toMatchObject([
      { value: ISBN_13, labeled: true, edition: 'hardcover' },
      { value: OTHER_13, labeled: true, edition: 'ebook' },
    ]);
    expect(pickSingleIsbn(findIsbnInText(text))).toEqual({ isbn10: null, isbn13: null });
  });

  it('reads abbreviated editions in a list', () => {
    const text = 'ISBN: HB : 978-0-306-40615-7; EBOOK : 978-1-63576-626-4; Barnes';
    expect(editionOf(text, ISBN_13)).toBe('hardcover');
    expect(editionOf(text, OTHER_13)).toBe('ebook');
    expect(editionOf('ISBN (FTP): 9780306406157 ISBN (E): 9781635766264 Head of Zeus', OTHER_13)).toBe('ebook');
  });

  it('does not give one number the bracketed edition of the number before it', () => {
    expect(editionOf('ISBN 978-0-306-40615-7 (hardcover) ISBN 978-1-63576-626-4', OTHER_13)).toBeNull();
  });

  it('does not carry a label across an unlabeled number or a long gap', () => {
    expect(findIsbnInText(`ISBN 978-0-306-40615-7 ${'and more words here '.repeat(3)}9781635766264`)[1].labeled).toBe(false);
  });

  it('trims partial words and collapses whitespace in the context', () => {
    const text = `${'x'.repeat(80)} lorem ipsum\n\nISBN 978-0-306-40615-7\nall rights reserved by the publisher and the author ${'y'.repeat(40)}`;
    const [found] = findIsbnInText(text);
    expect(found.context).toBe('lorem ipsum ISBN 978-0-306-40615-7 all rights reserved by the publisher');
  });
});

describe('mergeIsbnHits', () => {
  it('de-duplicates across passages and keeps the labeled occurrence', () => {
    const merged = mergeIsbnHits([[hit(ISBN_13, { labeled: false })], [hit(ISBN_13, { context: 'ISBN here' }), hit(OTHER_13)]]);
    expect(merged.map((h) => [h.value, h.labeled, h.context])).toEqual([
      [ISBN_13, true, 'ISBN here'],
      [OTHER_13, true, ''],
    ]);
  });
});

describe('pickSingleIsbn', () => {
  it('returns the one labeled ISBN', () => {
    expect(pickSingleIsbn([hit(ISBN_13)])).toEqual({ isbn10: null, isbn13: ISBN_13 });
    expect(pickSingleIsbn([hit(ISBN_10)])).toEqual({ isbn10: ISBN_10, isbn13: null });
  });

  it('counts the ISBN-10 and ISBN-13 forms of one ISBN as one and returns both', () => {
    expect(pickSingleIsbn([hit(ISBN_13), hit(ISBN_10)])).toEqual({ isbn10: ISBN_10, isbn13: ISBN_13 });
  });

  it('returns nothing when the text prints two different ISBNs', () => {
    expect(pickSingleIsbn([hit(ISBN_13), hit(OTHER_13)])).toEqual({ isbn10: null, isbn13: null });
    expect(pickSingleIsbn([hit(ISBN_13), hit(OTHER_10)])).toEqual({ isbn10: null, isbn13: null });
  });

  it('ignores unlabeled hits', () => {
    expect(pickSingleIsbn([hit(ISBN_13, { labeled: false })])).toEqual({ isbn10: null, isbn13: null });
    expect(pickSingleIsbn([hit(ISBN_13), hit(OTHER_13, { labeled: false })])).toEqual({ isbn10: null, isbn13: ISBN_13 });
  });

  it('returns nulls for an empty set', () => {
    expect(pickSingleIsbn([])).toEqual({ isbn10: null, isbn13: null });
  });
});

describe('toIsbnCandidates', () => {
  it('groups both forms of one ISBN and keeps print order', () => {
    const candidates = toIsbnCandidates([
      hit(OTHER_13, { edition: 'hardcover', context: 'ISBN 978-1-63576-626-4 (hardcover)' }),
      hit(ISBN_10, { context: 'ISBN 0-306-40615-2' }),
      hit(ISBN_13, { edition: 'ebook' }),
    ]);
    expect(candidates).toEqual([
      { isbn13: OTHER_13, isbn10: OTHER_10, edition: 'hardcover', context: 'ISBN 978-1-63576-626-4 (hardcover)' },
      { isbn13: ISBN_13, isbn10: ISBN_10, edition: 'ebook', context: 'ISBN 0-306-40615-2' },
    ]);
  });

  it('gives a 979 ISBN no ISBN-10 form', () => {
    expect(toIsbnCandidates([hit(ISBN_979)])).toEqual([{ isbn13: ISBN_979, isbn10: null, edition: null, context: '' }]);
  });

  it('skips unlabeled hits', () => {
    expect(toIsbnCandidates([hit(ISBN_13, { labeled: false })])).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => {
      const body = `978000000${String(i).padStart(3, '0')}`;
      const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
      return hit(`${body}${(10 - (sum % 10)) % 10}`);
    });
    expect(toIsbnCandidates(many)).toHaveLength(20);
  });
});
