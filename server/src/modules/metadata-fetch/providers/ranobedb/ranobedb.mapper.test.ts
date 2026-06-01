import { MetadataProviderKey } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { mapRanobeDbBook, parseDateInt } from './ranobedb.mapper';
import { RanobeDbBook } from './ranobedb.types';

const baseBook: RanobeDbBook = {
  id: 1287,
  title: 'ソードアート・オンライン',
  romaji: 'Sword Art Online',
  lang: 'ja',
  description: 'A virtual reality adventure.',
  description_ja: '仮想現実の冒険。',
  c_release_date: 20120710,
  image: { id: 10, filename: 'covers/sao.jpg', width: 300, height: 450, nsfw: false, spoiler: false },
  rating: { score: 8.5, count: 1200 },
  titles: [
    { book_id: 1287, lang: 'en', official: true, title: 'Sword Art Online Vol. 1', romaji: null },
    { book_id: 1287, lang: 'ja', official: true, title: 'ソードアート・オンライン', romaji: 'Sword Art Online' },
  ],
  editions: [
    {
      book_id: 1287,
      lang: 'en',
      title: 'English Edition',
      eid: 1,
      staff: [
        { role_type: 'author', romaji: 'Reki Kawahara', name: '川原礫', staff_id: 1 },
        { role_type: 'artist', romaji: 'abec', name: 'abec', staff_id: 2 },
      ],
    },
    {
      book_id: 1287,
      lang: 'ja',
      title: 'Japanese Edition',
      eid: 2,
      staff: [
        { role_type: 'author', romaji: null, name: '川原礫', staff_id: 1 },
        { role_type: 'translator', romaji: 'Some Translator', name: 'Some Translator', staff_id: 3 },
      ],
    },
  ],
  releases: [
    {
      lang: 'en',
      id: 100,
      title: 'Sword Art Online Vol. 1',
      release_date: 20121210,
      isbn13: '9780316371247',
      pages: 240,
      format: 'print',
    },
    {
      lang: 'en',
      id: 101,
      title: 'Sword Art Online Vol. 1 Digital',
      release_date: 20121215,
      isbn13: null,
      pages: null,
      format: 'digital',
    },
    {
      lang: 'ja',
      id: 200,
      title: 'ソードアート・オンライン',
      release_date: 20120710,
      isbn13: '9784048913102',
      pages: 248,
      format: 'print',
    },
  ],
  publishers: [
    { lang: 'en', id: 10, romaji: null, name: 'Yen Press', publisher_type: 'publisher' },
    { lang: 'en', id: 11, romaji: null, name: 'Yen On', publisher_type: 'imprint' },
    { lang: 'ja', id: 20, romaji: null, name: 'KADOKAWA', publisher_type: 'publisher' },
  ],
  series: {
    id: 50,
    title: 'Sword Art Online',
    romaji: 'Sword Art Online',
    books: [
      { id: 1287, lang: 'en', title: 'Vol. 1', romaji: null, image: null },
      { id: 1288, lang: 'en', title: 'Vol. 2', romaji: null, image: null },
    ],
    tags: [
      { id: 1, name: 'Sci-Fi', ttype: 'genre' },
      { id: 2, name: 'Action', ttype: 'genre' },
      { id: 3, name: 'LGBTQ', ttype: 'genre' },
      { id: 4, name: 'Isekai', ttype: 'tag' },
      { id: 5, name: 'Shonen', ttype: 'demographic' },
    ],
  },
};

describe('parseDateInt', () => {
  it('extracts year from valid date integer', () => {
    expect(parseDateInt(20220624)).toBe(2022);
    expect(parseDateInt(19991231)).toBe(1999);
    expect(parseDateInt(20000101)).toBe(2000);
  });

  it('returns undefined for null', () => {
    expect(parseDateInt(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseDateInt(undefined)).toBeUndefined();
  });

  it('returns undefined for zero', () => {
    expect(parseDateInt(0)).toBeUndefined();
  });

  it('returns undefined for years out of plausible range', () => {
    expect(parseDateInt(9990101)).toBeUndefined();
    expect(parseDateInt(9990101)).toBeUndefined();
  });

  it('extracts year at boundary', () => {
    expect(parseDateInt(10000101)).toBe(1000);
    expect(parseDateInt(22000101)).toBe(2200);
  });
});

describe('mapRanobeDbBook', () => {
  it('maps a complete book correctly', () => {
    const result = mapRanobeDbBook(baseBook);

    expect(result).toMatchObject({
      provider: MetadataProviderKey.RANOBEDB,
      providerId: '1287',
      title: 'Sword Art Online Vol. 1',
      authors: ['Reki Kawahara'],
      publisher: 'Yen Press',
      publishedYear: 2012,
      language: 'en',
      pageCount: 240,
      isbn13: '9780316371247',
      seriesName: 'Sword Art Online',
      seriesIndex: 1,
      coverUrl: 'https://images.ranobedb.org/covers/sao.jpg',
      sourceUrl: 'https://ranobedb.org/book/1287',
    });
  });

  it('includes only genre-type tags (not tag/demographic)', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.genres).toEqual(['Sci-Fi', 'Action', 'LGBTQ']);
    expect(result?.genres).not.toContain('Isekai');
    expect(result?.genres).not.toContain('Shonen');
  });

  it('preserves original casing of genre names', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.genres).toContain('Sci-Fi');
    expect(result?.genres).toContain('LGBTQ');
  });

  it('deduplicates authors across editions', () => {
    const result = mapRanobeDbBook(baseBook);
    const authorCount = result?.authors?.filter((a) => a === 'Reki Kawahara' || a === '川原礫').length ?? 0;
    expect(authorCount).toBe(1);
  });

  it('prefers romaji over native name for authors', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.authors).toContain('Reki Kawahara');
    expect(result?.authors).not.toContain('川原礫');
  });

  it('only includes authors (not artists/translators)', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.authors).not.toContain('abec');
    expect(result?.authors).not.toContain('Some Translator');
  });

  it('prefers English print release over English digital for isbn/pages', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.isbn13).toBe('9780316371247');
    expect(result?.pageCount).toBe(240);
  });

  it('prefers English release publishedYear over c_release_date', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.publishedYear).toBe(2012);
  });

  it('falls back to c_release_date year when no English release has a date', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      releases: [{ lang: 'en', id: 100, title: null, release_date: null, isbn13: null, pages: null, format: 'print' }],
      c_release_date: 20180501,
    };
    const result = mapRanobeDbBook(book);
    expect(result?.publishedYear).toBe(2018);
  });

  it('returns null when book has no id', () => {
    const book = { ...baseBook, id: 0 };
    expect(mapRanobeDbBook(book)).toBeNull();
  });

  it('sets language to "en" when any release has lang en', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.language).toBe('en');
  });

  it('falls back to book.lang when no English releases exist', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      lang: 'ja',
      releases: [{ lang: 'ja', id: 200, title: null, release_date: 20120710, isbn13: null, pages: null, format: 'print' }],
    };
    const result = mapRanobeDbBook(book);
    expect(result?.language).toBe('ja');
  });

  it('falls back to romaji title when no official English title', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      titles: [{ book_id: 1287, lang: 'ja', official: true, title: 'ソードアート・オンライン', romaji: null }],
      romaji: 'Sword Art Online',
    };
    const result = mapRanobeDbBook(book);
    expect(result?.title).toBe('Sword Art Online');
  });

  it('falls back to native title when no romaji and no English title', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      titles: [],
      romaji: null,
      title: 'ソードアート・オンライン',
    };
    const result = mapRanobeDbBook(book);
    expect(result?.title).toBe('ソードアート・オンライン');
  });

  it('resolves publisher from English publisher (not imprint)', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.publisher).toBe('Yen Press');
    expect(result?.publisher).not.toBe('Yen On');
  });

  it('returns undefined publisher when no English publisher exists', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      publishers: [{ lang: 'ja', id: 20, romaji: null, name: 'KADOKAWA', publisher_type: 'publisher' }],
    };
    const result = mapRanobeDbBook(book);
    expect(result?.publisher).toBeUndefined();
  });

  it('computes seriesIndex as 1-based position', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.seriesIndex).toBe(1);
  });

  it('returns undefined seriesIndex when book is not in series.books', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      series: { ...baseBook.series!, books: [{ id: 9999, lang: null, title: null, romaji: null, image: null }] },
    };
    const result = mapRanobeDbBook(book);
    expect(result?.seriesIndex).toBeUndefined();
  });

  it('returns undefined seriesIndex when series is null', () => {
    const book: RanobeDbBook = { ...baseBook, series: null };
    const result = mapRanobeDbBook(book);
    expect(result?.seriesIndex).toBeUndefined();
  });

  it('returns empty genres array when series is null', () => {
    const book: RanobeDbBook = { ...baseBook, series: null };
    const result = mapRanobeDbBook(book);
    expect(result?.genres).toEqual([]);
  });

  it('returns no coverUrl when image is null', () => {
    const book: RanobeDbBook = { ...baseBook, image: null };
    const result = mapRanobeDbBook(book);
    expect(result?.coverUrl).toBeUndefined();
  });

  it('returns empty authors array when no editions have authors', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      editions: [{ book_id: 1287, lang: 'en', title: null, eid: 1, staff: [{ role_type: 'artist', romaji: 'abec', name: 'abec', staff_id: 2 }] }],
    };
    const result = mapRanobeDbBook(book);
    expect(result?.authors).toEqual([]);
  });

  it('uses digital release when no print release is available', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      releases: [{ lang: 'en', id: 101, title: null, release_date: 20221201, isbn13: '9780000000001', pages: 300, format: 'digital' }],
    };
    const result = mapRanobeDbBook(book);
    expect(result?.isbn13).toBe('9780000000001');
    expect(result?.pageCount).toBe(300);
  });

  it('does not use audio release for isbn/pages selection', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      releases: [{ lang: 'en', id: 102, title: null, release_date: 20221201, isbn13: '9780000000002', pages: 999, format: 'audio' }],
    };
    const result = mapRanobeDbBook(book);
    expect(result?.isbn13).toBeUndefined();
    expect(result?.pageCount).toBeUndefined();
  });

  it('deduplicates genres', () => {
    const book: RanobeDbBook = {
      ...baseBook,
      series: {
        ...baseBook.series!,
        tags: [
          { id: 1, name: 'Action', ttype: 'genre' },
          { id: 2, name: 'Action', ttype: 'genre' },
        ],
      },
    };
    const result = mapRanobeDbBook(book);
    expect(result?.genres).toEqual(['Action']);
  });

  it('includes sourceUrl', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.sourceUrl).toBe('https://ranobedb.org/book/1287');
  });

  it('maps English description when present', () => {
    const result = mapRanobeDbBook(baseBook);
    expect(result?.description).toBe('A virtual reality adventure.');
  });

  it('falls back to description_ja when English description is empty', () => {
    const book: RanobeDbBook = { ...baseBook, description: '', description_ja: '仮想現実の冒険。' };
    const result = mapRanobeDbBook(book);
    expect(result?.description).toBe('仮想現実の冒険。');
  });

  it('falls back to description_ja when English description is null', () => {
    const book: RanobeDbBook = { ...baseBook, description: null, description_ja: '仮想現実の冒険。' };
    const result = mapRanobeDbBook(book);
    expect(result?.description).toBe('仮想現実の冒険。');
  });

  it('returns undefined description when both descriptions are empty', () => {
    const book: RanobeDbBook = { ...baseBook, description: '', description_ja: '' };
    const result = mapRanobeDbBook(book);
    expect(result?.description).toBeUndefined();
  });

  it('returns undefined description when both descriptions are null', () => {
    const book: RanobeDbBook = { ...baseBook, description: null, description_ja: null };
    const result = mapRanobeDbBook(book);
    expect(result?.description).toBeUndefined();
  });
});
