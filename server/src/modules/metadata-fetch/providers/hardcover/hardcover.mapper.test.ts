import { MetadataProviderKey } from '@bookorbit/types';

import { mapBookWithEditions, mapSearchDocument } from './hardcover.mapper';
import { HardcoverBookWithEditions, HardcoverSearchDocument } from './hardcover.types';

const baseDocument: HardcoverSearchDocument = {
  id: '379217',
  slug: 'the-name-of-the-wind',
  title: 'The Name of the Wind',
  subtitle: '10th Anniversary Edition',
  description: 'A story about a wizard.',
  author_names: ['Patrick Rothfuss'],
  contributions: [{ author: { id: 1, name: 'Patrick Rothfuss' }, contribution: 'Author' }],
  isbns: ['9780756404079', '0756404079'],
  pages: 662,
  release_year: 2007,
  release_date: '2007-03-27',
  genres: ['Fantasy', 'Fiction'],
  rating: 4.42,
  ratings_count: 12345,
  featured_series: { series: { name: 'The Kingkiller Chronicle' }, position: 1 },
  image: { url: 'https://assets.hardcover.app/cover.jpg' },
};

const baseBook: HardcoverBookWithEditions = {
  id: 379217,
  slug: 'the-name-of-the-wind',
  title: 'The Name of the Wind',
  subtitle: 'Book Subtitle',
  description: 'A story about a wizard.',
  cached_contributors: [{ author: { id: 1, name: 'Patrick Rothfuss' }, contribution: null }],
  featured_book_series: { series: { name: 'The Kingkiller Chronicle', books_count: 3 }, position: 1 },
  rating: 4.42,
  ratings_count: 12345,
  pages: 662,
  release_year: 2007,
  release_date: '2007-03-27',
  image: { url: 'https://assets.hardcover.app/book-cover.jpg' },
  editions: [
    {
      id: 1001,
      title: 'The Name of the Wind',
      subtitle: 'Edition Subtitle',
      cached_contributors: [{ author: { id: 1, name: 'Patrick Rothfuss' }, contribution: null }],
      pages: 662,
      release_year: 2007,
      release_date: '2007-03-27',
      image: { url: 'https://assets.hardcover.app/edition-cover.jpg' },
      publisher: { name: 'DAW Books' },
      isbn_10: '0756404079',
      isbn_13: '9780756404079',
      language: { code2: 'en' },
    },
  ],
};

describe('mapSearchDocument', () => {
  it('maps a complete document correctly', () => {
    const result = mapSearchDocument(baseDocument);

    expect(result).toEqual({
      provider: MetadataProviderKey.HARDCOVER,
      providerId: 'the-name-of-the-wind',
      title: 'The Name of the Wind',
      subtitle: '10th Anniversary Edition',
      description: 'A story about a wizard.',
      authors: ['Patrick Rothfuss'],
      pageCount: 662,
      publishedDate: '2007-03-27',
      publishedYear: 2007,
      isbn13: '9780756404079',
      isbn10: '0756404079',
      genres: ['Fantasy', 'Fiction'],
      seriesName: 'The Kingkiller Chronicle',
      seriesIndex: 1,
      coverUrl: 'https://assets.hardcover.app/cover.jpg',
      sourceUrl: 'https://hardcover.app/books/the-name-of-the-wind',
      communityRating: 4.42,
      communityRatingCount: 12345,
    });
    expect(result.hardcoverEditionId).toBeUndefined();
  });

  it('prefers release_year over release_date for publishedYear', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, release_year: 2007, release_date: '2009-01-01' };
    expect(mapSearchDocument(doc).publishedYear).toBe(2007);
  });

  it('falls back to release_date when release_year is absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, release_year: undefined, release_date: '2007-03-27' };
    expect(mapSearchDocument(doc).publishedYear).toBe(2007);
  });

  it('returns undefined publishedYear when both date fields are absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, release_year: undefined, release_date: undefined };
    expect(mapSearchDocument(doc).publishedYear).toBeUndefined();
  });

  it('returns undefined publishedYear when release_year is out of range', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, release_year: 19, release_date: undefined };
    expect(mapSearchDocument(doc).publishedYear).toBeUndefined();
  });

  it('returns undefined publishedYear when release_date is sub-4-digit', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, release_year: undefined, release_date: '19' };
    expect(mapSearchDocument(doc).publishedYear).toBeUndefined();
  });

  it('picks isbn13 and isbn10 from the isbns array', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, isbns: ['9780756404079', '0756404079', '9990000000000'] };
    const result = mapSearchDocument(doc);
    expect(result.isbn13).toBe('9780756404079');
    expect(result.isbn10).toBe('0756404079');
  });

  it('returns undefined isbns when the array is absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, isbns: undefined };
    const result = mapSearchDocument(doc);
    expect(result.isbn10).toBeUndefined();
    expect(result.isbn13).toBeUndefined();
  });

  it('normalises null series position to undefined', () => {
    const doc: HardcoverSearchDocument = {
      ...baseDocument,
      featured_series: { series: { name: 'Some Series' }, position: null },
    };
    expect(mapSearchDocument(doc).seriesIndex).toBeUndefined();
  });

  it('returns undefined seriesName and seriesIndex when series is absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, featured_series: undefined };
    const result = mapSearchDocument(doc);
    expect(result.seriesName).toBeUndefined();
    expect(result.seriesIndex).toBeUndefined();
  });

  it('omits authors when contribution data is absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, contributions: undefined };
    expect(mapSearchDocument(doc).authors).toBeUndefined();
  });

  it('maps only author contributions from search documents', () => {
    const doc: HardcoverSearchDocument = {
      ...baseDocument,
      author_names: ['Primary Author', 'Second Author', 'Audio Narrator', 'Book Translator'],
      contributions: [
        { author: { id: 1, name: 'Primary Author' }, contribution: null },
        { author: { id: 2, name: 'Second Author' }, contribution: ' AUTHOR ' },
        { author: { id: 3, name: 'Audio Narrator' }, contribution: 'Narrator' },
        { author: { id: 4, name: 'Book Translator' }, contribution: 'Translator' },
      ],
    };

    expect(mapSearchDocument(doc).authors).toEqual(['Primary Author', 'Second Author']);
  });

  it('returns undefined coverUrl when image is absent', () => {
    const doc: HardcoverSearchDocument = { ...baseDocument, image: undefined };
    expect(mapSearchDocument(doc).coverUrl).toBeUndefined();
  });

  describe('embedded subtitle split', () => {
    const longColonTitle = "Babel, or The Necessity of Violence: An Arcane History of the Oxford Translators' Revolution";

    it('splits a long colon title into title and subtitle when no subtitle is provided', () => {
      const doc: HardcoverSearchDocument = { ...baseDocument, title: longColonTitle, subtitle: undefined };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('Babel, or The Necessity of Violence');
      expect(result.subtitle).toBe("An Arcane History of the Oxford Translators' Revolution");
    });

    it('keeps the title untouched when the API provides a subtitle', () => {
      const doc: HardcoverSearchDocument = { ...baseDocument, title: longColonTitle, subtitle: 'Provided Subtitle' };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe(longColonTitle);
      expect(result.subtitle).toBe('Provided Subtitle');
    });

    it('does not split short colon titles', () => {
      const doc: HardcoverSearchDocument = { ...baseDocument, title: '2001: A Space Odyssey', subtitle: undefined };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('2001: A Space Odyssey');
      expect(result.subtitle).toBeUndefined();
    });

    it('treats a blank API subtitle as absent and still splits', () => {
      const doc: HardcoverSearchDocument = { ...baseDocument, title: longColonTitle, subtitle: '   ' };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('Babel, or The Necessity of Violence');
      expect(result.subtitle).toBe("An Arcane History of the Oxford Translators' Revolution");
    });

    it('does not split long titles without a colon', () => {
      const title = 'A'.repeat(70);
      const doc: HardcoverSearchDocument = { ...baseDocument, title, subtitle: undefined };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe(title);
      expect(result.subtitle).toBeUndefined();
    });

    it('splits only titles longer than 60 characters', () => {
      const at60 = `${'A'.repeat(30)}: ${'B'.repeat(28)}`;
      const at61 = `${'A'.repeat(30)}: ${'B'.repeat(29)}`;
      expect(mapSearchDocument({ ...baseDocument, title: at60, subtitle: undefined }).title).toBe(at60);
      const result = mapSearchDocument({ ...baseDocument, title: at61, subtitle: undefined });
      expect(result.title).toBe('A'.repeat(30));
      expect(result.subtitle).toBe('B'.repeat(29));
    });

    it('splits at the first colon only', () => {
      const doc: HardcoverSearchDocument = {
        ...baseDocument,
        title: 'How to Do Nothing: Resisting the Attention Economy: A Field Guide',
        subtitle: undefined,
      };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('How to Do Nothing');
      expect(result.subtitle).toBe('Resisting the Attention Economy: A Field Guide');
    });

    it('does not split when nothing follows the colon', () => {
      const title = `${'A'.repeat(70)}:`;
      const doc: HardcoverSearchDocument = { ...baseDocument, title, subtitle: undefined };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe(title);
      expect(result.subtitle).toBeUndefined();
    });

    it('does not split when the title starts with a colon', () => {
      const title = `: ${'A'.repeat(70)}`;
      const doc: HardcoverSearchDocument = { ...baseDocument, title, subtitle: undefined };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe(title);
      expect(result.subtitle).toBeUndefined();
    });

    it('trims the title when the API subtitle duplicates the part after the colon', () => {
      const doc: HardcoverSearchDocument = {
        ...baseDocument,
        title: "Quantitative Momentum: A Practitioner's Guide to Building a Momentum-Based Stock Selection System",
        subtitle: "A Practitioner's Guide to Building a Momentum-Based Stock Selection System",
      };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('Quantitative Momentum');
      expect(result.subtitle).toBe("A Practitioner's Guide to Building a Momentum-Based Stock Selection System");
    });

    it('matches the duplicated subtitle case-insensitively and keeps the API value verbatim', () => {
      const doc: HardcoverSearchDocument = {
        ...baseDocument,
        title: "Quantitative Momentum: A Practitioner's Guide to Building a Momentum-Based Stock Selection System",
        subtitle: "A PRACTITIONER'S GUIDE TO BUILDING A MOMENTUM-BASED STOCK SELECTION SYSTEM",
      };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('Quantitative Momentum');
      expect(result.subtitle).toBe("A PRACTITIONER'S GUIDE TO BUILDING A MOMENTUM-BASED STOCK SELECTION SYSTEM");
    });

    it('does not trim short colon titles even when the subtitle matches', () => {
      const doc: HardcoverSearchDocument = {
        ...baseDocument,
        title: '2001: A Space Odyssey',
        subtitle: 'A Space Odyssey',
      };
      const result = mapSearchDocument(doc);
      expect(result.title).toBe('2001: A Space Odyssey');
      expect(result.subtitle).toBe('A Space Odyssey');
    });
  });
});

describe('mapBookWithEditions', () => {
  it('maps a complete book+edition correctly', () => {
    const [result] = mapBookWithEditions(baseBook);

    expect(result).toEqual({
      provider: MetadataProviderKey.HARDCOVER,
      providerId: 'the-name-of-the-wind',
      hardcoverEditionId: '1001',
      title: 'The Name of the Wind',
      subtitle: 'Edition Subtitle',
      description: 'A story about a wizard.',
      authors: ['Patrick Rothfuss'],
      publisher: 'DAW Books',
      language: 'en',
      pageCount: 662,
      publishedDate: '2007-03-27',
      publishedYear: 2007,
      isbn10: '0756404079',
      isbn13: '9780756404079',
      seriesName: 'The Kingkiller Chronicle',
      seriesIndex: 1,
      seriesTotalBooks: 3,
      communityRating: 4.42,
      communityRatingCount: 12345,
      coverUrl: 'https://assets.hardcover.app/edition-cover.jpg',
      sourceUrl: 'https://hardcover.app/books/the-name-of-the-wind',
    });
  });

  it('returns empty array when editions is absent', () => {
    const book: HardcoverBookWithEditions = { ...baseBook, editions: undefined };
    expect(mapBookWithEditions(book)).toEqual([]);
  });

  describe('series total books', () => {
    function withBooksCount(booksCount: unknown): HardcoverBookWithEditions {
      return {
        ...baseBook,
        featured_book_series: {
          series: { name: 'The Kingkiller Chronicle', books_count: booksCount as number | undefined },
          position: 1,
        },
      };
    }

    it('maps the series book count Hardcover already returns', () => {
      expect(mapBookWithEditions(withBooksCount(7))[0].seriesTotalBooks).toBe(7);
    });

    it('is undefined when Hardcover omits the count', () => {
      expect(mapBookWithEditions(withBooksCount(undefined))[0].seriesTotalBooks).toBeUndefined();
    });

    it('is undefined when the series itself is absent', () => {
      const book: HardcoverBookWithEditions = { ...baseBook, featured_book_series: undefined };
      expect(mapBookWithEditions(book)[0].seriesTotalBooks).toBeUndefined();
    });

    it('rejects an out-of-range count rather than trusting the payload', () => {
      expect(mapBookWithEditions(withBooksCount(0))[0].seriesTotalBooks).toBeUndefined();
      expect(mapBookWithEditions(withBooksCount(-4))[0].seriesTotalBooks).toBeUndefined();
      expect(mapBookWithEditions(withBooksCount(10_001))[0].seriesTotalBooks).toBeUndefined();
    });
  });

  it('returns empty array when editions is empty', () => {
    const book: HardcoverBookWithEditions = { ...baseBook, editions: [] };
    expect(mapBookWithEditions(book)).toEqual([]);
  });

  it('returns one candidate per edition', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [
        { ...baseBook.editions![0], id: 1001, isbn_13: '9780000000001' },
        { ...baseBook.editions![0], id: 1002, isbn_13: '9780000000002' },
      ],
    };
    const results = mapBookWithEditions(book);
    expect(results).toHaveLength(2);
    expect(results[0].isbn13).toBe('9780000000001');
    expect(results[0].hardcoverEditionId).toBe('1001');
    expect(results[1].isbn13).toBe('9780000000002');
    expect(results[1].hardcoverEditionId).toBe('1002');
  });

  it('uses edition authors when present', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      cached_contributors: [{ author: { id: 2, name: 'Book-Level Author' }, contribution: null }],
      editions: [
        {
          ...baseBook.editions![0],
          cached_contributors: [{ author: { id: 1, name: 'Edition Author' }, contribution: null }],
        },
      ],
    };
    expect(mapBookWithEditions(book)[0].authors).toEqual(['Edition Author']);
  });

  it('falls back to book authors when edition has no contributors', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      cached_contributors: [{ author: { id: 2, name: 'Book Author' }, contribution: null }],
      editions: [{ ...baseBook.editions![0], cached_contributors: [] }],
    };
    expect(mapBookWithEditions(book)[0].authors).toEqual(['Book Author']);
  });

  it('falls back to book authors when the edition has only non-author contributors', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      cached_contributors: [{ author: { id: 2, name: 'Book Author' }, contribution: 'Author' }],
      editions: [
        {
          ...baseBook.editions![0],
          cached_contributors: [
            { author: { id: 3, name: 'Audio Narrator' }, contribution: 'Narrator' },
            { author: { id: 4, name: 'Book Translator' }, contribution: 'Translator' },
          ],
        },
      ],
    };

    expect(mapBookWithEditions(book)[0].authors).toEqual(['Book Author']);
  });

  it('maps only author contributions from an edition', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [
        {
          ...baseBook.editions![0],
          cached_contributors: [
            { author: { id: 1, name: 'Primary Author' }, contribution: null },
            { author: { id: 2, name: 'Second Author' }, contribution: 'author' },
            { author: { id: 3, name: 'Audio Narrator' }, contribution: 'Narrator' },
            { author: { id: 4, name: 'Book Translator' }, contribution: 'Translator' },
            { author: { id: 5, name: 'Cover Artist' }, contribution: 'Cover Artist' },
          ],
        },
      ],
    };

    expect(mapBookWithEditions(book)[0].authors).toEqual(['Primary Author', 'Second Author']);
  });

  it('omits authors when neither the edition nor the book has an author contribution', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      cached_contributors: [{ author: { id: 2, name: 'Book Translator' }, contribution: 'Translator' }],
      editions: [
        {
          ...baseBook.editions![0],
          cached_contributors: [{ author: { id: 3, name: 'Audio Narrator' }, contribution: 'Narrator' }],
        },
      ],
    };

    expect(mapBookWithEditions(book)[0].authors).toBeUndefined();
  });

  it('falls back to book title when edition title is absent', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [{ ...baseBook.editions![0], title: undefined }],
    };
    expect(mapBookWithEditions(book)[0].title).toBe('The Name of the Wind');
  });

  it('falls back to book subtitle when edition subtitle is absent', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [{ ...baseBook.editions![0], subtitle: undefined }],
    };
    expect(mapBookWithEditions(book)[0].subtitle).toBe('Book Subtitle');
  });

  it('falls back to book image when edition image is absent', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [{ ...baseBook.editions![0], image: undefined }],
    };
    expect(mapBookWithEditions(book)[0].coverUrl).toBe('https://assets.hardcover.app/book-cover.jpg');
  });

  it('uses edition release_date before book release_year when edition release_year is absent', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      release_year: 1962,
      release_date: '1962-01-01',
      editions: [
        {
          ...baseBook.editions![0],
          title: 'Det osynliga barnet och andra berättelser',
          release_year: undefined,
          release_date: '2019-08-08',
          publisher: { name: 'Förlaget M' },
          language: { code2: 'sv' },
          pages: 150,
          isbn_10: '9523331647',
          isbn_13: '9789523331648',
        },
      ],
    };

    const [result] = mapBookWithEditions(book);

    expect(result).toMatchObject({
      publisher: 'Förlaget M',
      language: 'sv',
      pageCount: 150,
      publishedYear: 2019,
      isbn10: '9523331647',
      isbn13: '9789523331648',
    });
  });

  it('prefers edition release_year over edition release_date and book release_year', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      release_year: 1962,
      release_date: '1962-01-01',
      editions: [{ ...baseBook.editions![0], release_year: 2020, release_date: '2019-08-08' }],
    };

    expect(mapBookWithEditions(book)[0].publishedYear).toBe(2020);
  });

  it('falls back to book publishedYear when edition has no date fields', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      release_year: 2007,
      release_date: undefined,
      editions: [{ ...baseBook.editions![0], release_year: undefined, release_date: undefined }],
    };
    expect(mapBookWithEditions(book)[0].publishedYear).toBe(2007);
  });

  it('normalises null series position to undefined', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      featured_book_series: { series: { name: 'Some Series' }, position: null },
    };
    expect(mapBookWithEditions(book)[0].seriesIndex).toBeUndefined();
  });

  it('emits no page count for audiobook editions (reading_format_id = 2)', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      pages: 662,
      editions: [{ ...baseBook.editions![0], reading_format_id: 2, pages: undefined }],
    };
    expect(mapBookWithEditions(book)[0].pageCount).toBeUndefined();
  });

  it('emits no page count for audiobook editions (audio_seconds > 0)', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      pages: 662,
      editions: [{ ...baseBook.editions![0], audio_seconds: 36000, pages: undefined }],
    };
    expect(mapBookWithEditions(book)[0].pageCount).toBeUndefined();
  });

  it('does not let audiobooks inherit the book page count even if Hardcover provides one', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      pages: 662,
      editions: [{ ...baseBook.editions![0], reading_format_id: 2, pages: 999 }],
    };
    expect(mapBookWithEditions(book)[0].pageCount).toBeUndefined();
  });

  it('keeps the book page-count fallback for non-audiobook editions without pages', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      pages: 662,
      editions: [{ ...baseBook.editions![0], reading_format_id: 4, pages: undefined }],
    };
    expect(mapBookWithEditions(book)[0].pageCount).toBe(662);
  });

  it('ranks physical/ebook editions ahead of audiobooks', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [
        { ...baseBook.editions![0], id: 1, isbn_13: 'AUDIO', reading_format_id: 2, pages: undefined },
        { ...baseBook.editions![0], id: 2, isbn_13: 'PRINT', reading_format_id: 1, pages: 700 },
      ],
    };
    const results = mapBookWithEditions(book);
    expect(results[0].isbn13).toBe('PRINT');
    expect(results[0].pageCount).toBe(700);
    expect(results[1].isbn13).toBe('AUDIO');
    expect(results[1].pageCount).toBeUndefined();
  });

  it('ranks editions with a page count ahead of those without when format is equal', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [
        { ...baseBook.editions![0], id: 1, isbn_13: 'NOPAGES', reading_format_id: 1, pages: undefined },
        { ...baseBook.editions![0], id: 2, isbn_13: 'HASPAGES', reading_format_id: 1, pages: 500 },
      ],
    };
    const results = mapBookWithEditions(book);
    expect(results[0].isbn13).toBe('HASPAGES');
    expect(results[1].isbn13).toBe('NOPAGES');
  });

  describe('embedded subtitle split', () => {
    const longColonTitle = "Babel, or The Necessity of Violence: An Arcane History of the Oxford Translators' Revolution";

    it('splits a long colon title when neither edition nor book has a subtitle', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        subtitle: undefined,
        editions: [{ ...baseBook.editions![0], title: longColonTitle, subtitle: undefined }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe('Babel, or The Necessity of Violence');
      expect(result.subtitle).toBe("An Arcane History of the Oxford Translators' Revolution");
    });

    it('keeps the title untouched when the edition provides its own subtitle', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        subtitle: undefined,
        editions: [{ ...baseBook.editions![0], title: longColonTitle, subtitle: 'Edition Subtitle' }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe(longColonTitle);
      expect(result.subtitle).toBe('Edition Subtitle');
    });

    it('keeps the title untouched when the book subtitle fallback applies', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        subtitle: 'Book Subtitle',
        editions: [{ ...baseBook.editions![0], title: longColonTitle, subtitle: undefined }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe(longColonTitle);
      expect(result.subtitle).toBe('Book Subtitle');
    });

    it('splits the book-title fallback when the edition has no title', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        title: longColonTitle,
        subtitle: undefined,
        editions: [{ ...baseBook.editions![0], title: undefined, subtitle: undefined }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe('Babel, or The Necessity of Violence');
      expect(result.subtitle).toBe("An Arcane History of the Oxford Translators' Revolution");
    });

    it('does not split short colon titles', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        subtitle: undefined,
        editions: [{ ...baseBook.editions![0], title: '2001: A Space Odyssey', subtitle: undefined }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe('2001: A Space Odyssey');
      expect(result.subtitle).toBeUndefined();
    });

    it('trims the title when the edition subtitle duplicates the part after the colon', () => {
      const fullTitle = "Quantitative Momentum: A Practitioner's Guide to Building a Momentum-Based Stock Selection System";
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        title: fullTitle,
        subtitle: undefined,
        editions: [
          {
            ...baseBook.editions![0],
            title: fullTitle,
            subtitle: "A Practitioner's Guide to Building a Momentum-Based Stock Selection System",
          },
        ],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe('Quantitative Momentum');
      expect(result.subtitle).toBe("A Practitioner's Guide to Building a Momentum-Based Stock Selection System");
    });

    it('keeps the title untouched when the edition subtitle differs from the embedded one', () => {
      const book: HardcoverBookWithEditions = {
        ...baseBook,
        subtitle: undefined,
        editions: [{ ...baseBook.editions![0], title: longColonTitle, subtitle: 'A Completely Different Subtitle' }],
      };
      const [result] = mapBookWithEditions(book);
      expect(result.title).toBe(longColonTitle);
      expect(result.subtitle).toBe('A Completely Different Subtitle');
    });
  });

  it('filters out contributors with no author name', () => {
    const book: HardcoverBookWithEditions = {
      ...baseBook,
      editions: [
        {
          ...baseBook.editions![0],
          cached_contributors: [
            { author: { id: 1, name: 'Valid Author' }, contribution: null },
            { author: { id: 2, name: undefined }, contribution: null },
            { contribution: null },
          ],
        },
      ],
    };
    expect(mapBookWithEditions(book)[0].authors).toEqual(['Valid Author']);
  });
});
