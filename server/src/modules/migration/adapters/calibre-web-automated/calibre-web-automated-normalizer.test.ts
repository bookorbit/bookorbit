import { describe, expect, it } from 'vitest';

import { CalibreWebAutomatedNormalizer } from './calibre-web-automated-normalizer';
import type { CalibreWebAutomatedCapabilities, CalibreWebAutomatedSourceRecords } from './calibre-web-automated-source.types';

const normalizer = new CalibreWebAutomatedNormalizer();

const capabilities: CalibreWebAutomatedCapabilities = {
  settings: true,
  authors: true,
  publishers: true,
  languages: true,
  series: true,
  ratings: true,
  comments: true,
  tags: true,
  identifiers: true,
  userBookStatuses: true,
  webProgress: true,
  koboProgress: true,
  koreaderProgress: true,
  shelves: true,
};

function source(overrides: Partial<CalibreWebAutomatedSourceRecords> = {}): CalibreWebAutomatedSourceRecords {
  return {
    sourceVersion: null,
    compatibilityWarnings: ['Schema compatibility was verified against Calibre-Web Automated v4.0.6'],
    warnings: [],
    capabilities: { ...capabilities },
    settings: [{ id: 1, calibreDirectory: '/library', splitLibrary: false, splitDirectory: null }],
    users: [{ id: 1, name: 'reader', email: null, role: 1 }],
    books: [{ id: 10, title: 'Book One', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Author/Book One (10)' }],
    files: [{ id: 100, bookId: 10, format: 'EPUB', name: 'Book One' }],
    authorLinks: [],
    publisherLinks: [],
    languageLinks: [],
    seriesLinks: [],
    ratingLinks: [],
    comments: [],
    tagLinks: [],
    identifiers: [],
    statuses: [],
    webProgress: [],
    koboReadingStates: [],
    koboBookmarks: [],
    koreaderProgress: [],
    checksums: [],
    shelves: [],
    shelfBooks: [],
    ...overrides,
  };
}

describe('CalibreWebAutomatedNormalizer users and metadata', () => {
  it('normalizes administrators, excludes anonymous users, and preserves missing email', () => {
    const result = normalizer.normalize(
      source({
        users: [
          { id: 1, name: ' admin ', email: '', role: 1 },
          { id: 2, name: 'anonymous', email: null, role: 32 },
          { id: 3, name: 'reader', email: ' reader@example.com ', role: 0 },
        ],
      }),
    );

    expect(result.data.users).toEqual([
      { sourceUserId: '1', username: 'admin', name: 'admin', email: null },
      { sourceUserId: '3', username: 'reader', name: 'reader', email: 'reader@example.com' },
    ]);
    expect(result.counters.anonymous_users_excluded).toBe(1);
  });

  it('normalizes metadata, CWA author order, provider identifiers, and deterministic files', () => {
    const result = normalizer.normalize(
      source({
        books: [
          {
            id: 10,
            title: 'Example Book',
            pubdate: '2024-04-02T00:00:00Z',
            seriesIndex: 2.5,
            authorSort: 'Author, Ada & Writer, Bea',
            path: 'Ada Author/Example Book (10)',
          },
        ],
        files: [
          { id: 102, bookId: 10, format: 'M4B', name: 'Audio' },
          { id: 100, bookId: 10, format: 'EPUB', name: 'Example Book' },
          { id: 101, bookId: 10, format: 'KEPUB', name: 'Example Book' },
        ],
        authorLinks: [
          { id: 2, bookId: 10, authorId: 20, name: 'Ada Author', sort: 'Author, Ada' },
          { id: 1, bookId: 10, authorId: 21, name: 'Bea Writer', sort: 'Writer, Bea' },
        ],
        publisherLinks: [{ id: 1, bookId: 10, valueId: 30, value: 'Example Press' }],
        languageLinks: [
          { id: 2, bookId: 10, valueId: 31, value: 'fra', itemOrder: 1 },
          { id: 1, bookId: 10, valueId: 32, value: 'eng', itemOrder: 0 },
        ],
        seriesLinks: [{ id: 1, bookId: 10, valueId: 33, value: 'Examples', sort: 'Examples' }],
        ratingLinks: [
          { id: 2, bookId: 10, ratingId: 34, rating: 8 },
          { id: 1, bookId: 10, ratingId: 35, rating: 6 },
        ],
        comments: [{ id: 1, bookId: 10, text: ' Description ' }],
        tagLinks: [
          { id: 1, bookId: 10, valueId: 40, value: 'Fiction' },
          { id: 2, bookId: 10, valueId: 41, value: 'fiction' },
        ],
        identifiers: [
          { id: 1, bookId: 10, type: 'isbn', value: '978-0-306-40615-7' },
          { id: 2, bookId: 10, type: 'asin', value: 'b012345678' },
          { id: 3, bookId: 10, type: 'amazon_us', value: 'B012345678' },
          { id: 4, bookId: 10, type: 'goodreads', value: 'goodreads-1' },
          { id: 5, bookId: 10, type: 'google', value: 'google-1' },
          { id: 6, bookId: 10, type: 'kobo', value: 'kobo-1' },
          { id: 7, bookId: 10, type: 'hardcover', value: 'hardcover-1' },
        ],
      }),
    );

    expect(result.data.books[0]).toMatchObject({
      sourceBookId: '10',
      title: 'Example Book',
      author: 'Ada Author & Bea Writer',
      publisher: 'Example Press',
      publishedYear: 2024,
      language: 'eng',
      seriesName: 'Examples',
      seriesIndex: '2.5',
      rating: 6,
      description: 'Description',
      tags: ['Fiction'],
      isbn13: '9780306406157',
      asin: 'B012345678',
      amazonId: 'B012345678',
      goodreadsId: 'goodreads-1',
      googleBooksId: 'google-1',
      koboId: 'kobo-1',
      hardcoverId: 'hardcover-1',
    });
    expect(result.data.books[0]?.authors).toEqual([
      { sourceContributorId: '20', name: 'Ada Author', sortName: 'Author, Ada', description: null, displayOrder: 0 },
      { sourceContributorId: '21', name: 'Bea Writer', sortName: 'Writer, Bea', description: null, displayOrder: 1 },
    ]);
    expect(result.data.books[0]?.files).toEqual([
      {
        sourceFileId: '10:100',
        sourceBookId: '10',
        filePath: '/library/Ada Author/Example Book (10)/Example Book.epub',
        fileHash: null,
        fileName: 'Example Book.epub',
        fileSubPath: 'Ada Author/Example Book (10)/Example Book.epub',
        durationSeconds: null,
        format: 'epub',
        sortOrder: 0,
      },
      expect.objectContaining({ sourceFileId: '10:101', format: 'kepub', sortOrder: 1 }),
      expect.objectContaining({ sourceFileId: '10:102', format: 'm4b', sortOrder: 2 }),
    ]);
    expect(result.data.books[0]?.presentFields).toEqual(
      expect.arrayContaining(['title', 'isbn13', 'publisher', 'publishedYear', 'language', 'seriesName', 'seriesIndex', 'rating', 'amazonId']),
    );
    expect(result.counters.multiple_ratings).toBe(1);
  });

  it('falls back to link order when author_sort is ambiguous and treats the year-101 sentinel as absent', () => {
    const result = normalizer.normalize(
      source({
        books: [{ id: 10, title: 'Book One', pubdate: '0101-01-01T00:00:00Z', seriesIndex: 1, authorSort: 'Missing', path: 'Books/One' }],
        authorLinks: [
          { id: 20, bookId: 10, authorId: 1, name: 'Second Link', sort: 'Second' },
          { id: 10, bookId: 10, authorId: 2, name: 'First Link', sort: 'First' },
        ],
      }),
    );

    expect(result.data.books[0]?.authors?.map((author) => author.name)).toEqual(['First Link', 'Second Link']);
    expect(result.data.books[0]?.publishedYear).toBeNull();
    expect(result.data.books[0]?.presentFields).not.toContain('publishedYear');
    expect(result.counters.ambiguous_author_order).toBe(1);
  });

  it('omits conflicting alias identifiers without depending on row order', () => {
    const records = [
      { id: 1, bookId: 10, type: 'asin', value: 'B012345678' },
      { id: 2, bookId: 10, type: 'amazon', value: 'B087654321' },
      { id: 3, bookId: 10, type: 'hardcover', value: 'one' },
      { id: 4, bookId: 10, type: 'hardcover_id', value: 'two' },
    ];
    const first = normalizer.normalize(source({ identifiers: records }));
    const second = normalizer.normalize(source({ identifiers: [...records].reverse() }));

    expect(first.data.books[0]).toMatchObject({ asin: null, amazonId: null, hardcoverId: null });
    expect(second.data.books[0]).toMatchObject({ asin: null, amazonId: null, hardcoverId: null });
    expect(first.counters.conflicting_asin_identifiers).toBe(1);
    expect(first.counters.conflicting_hardcover_identifiers).toBe(1);
  });

  it('validates ISBN-10 checksums instead of accepting length alone', () => {
    const result = normalizer.normalize(
      source({
        identifiers: [
          { id: 1, bookId: 10, type: 'isbn', value: '0-306-40615-2' },
          { id: 2, bookId: 10, type: 'amazon_de', value: 'not-an-asin' },
        ],
      }),
    );

    expect(result.data.books[0]).toMatchObject({ isbn10: '0306406152', isbn13: null, asin: null, amazonId: null });
    expect(result.counters.invalid_identifiers).toBe(1);
  });

  it('does not mark unavailable optional metadata fields as present', () => {
    const result = normalizer.normalize(source({ capabilities: { ...capabilities, publishers: false, identifiers: false, series: false } }));

    expect(result.data.books[0]?.presentFields).toEqual(['title']);
    expect(result.data.availableDomains?.authors).toBe(true);
    expect(result.data.availableDomains?.narrators).toBe(false);
    expect(result.data.availableDomains?.genres).toBe(false);
  });
});

describe('CalibreWebAutomatedNormalizer logical paths', () => {
  it('uses the split-library root and rejects unsafe paths, names, and formats without dropping books', () => {
    const result = normalizer.normalize(
      source({
        settings: [{ id: 1, calibreDirectory: '/ignored', splitLibrary: true, splitDirectory: '/split-library/' }],
        books: [
          { id: 10, title: 'Safe', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Safe' },
          { id: 11, title: 'Traversal', pubdate: null, seriesIndex: 1, authorSort: null, path: '../escape' },
          { id: 12, title: 'Absolute', pubdate: null, seriesIndex: 1, authorSort: null, path: '/escape' },
        ],
        files: [
          { id: 1, bookId: 10, format: 'EPUB', name: 'Safe' },
          { id: 2, bookId: 10, format: 'EPUB', name: '../unsafe' },
          { id: 3, bookId: 10, format: 'EPUB!', name: 'Unsafe Format' },
          { id: 4, bookId: 11, format: 'EPUB', name: 'Traversal' },
          { id: 5, bookId: 12, format: 'EPUB', name: 'Absolute' },
          { id: 6, bookId: 10, format: 'EPUB', name: 'back\\slash' },
          { id: 7, bookId: 10, format: 'EPUB', name: 'nul\0name' },
        ],
      }),
    );

    expect(result.pathPrefixes).toEqual(['/split-library']);
    expect(result.data.books).toHaveLength(3);
    expect(result.data.books[0]?.files?.[0]?.filePath).toBe('/split-library/Books/Safe/Safe.epub');
    expect(result.data.books[0]?.files?.[1]?.filePath).toBeNull();
    expect(result.data.books[0]?.files?.[2]?.filePath).toBeNull();
    expect(result.data.books[1]?.files?.[0]?.filePath).toBeNull();
    expect(result.data.books[2]?.files?.[0]?.filePath).toBeNull();
    expect(result.counters.unsafe_book_paths).toBe(2);
    expect(result.counters.unsafe_file_names).toBe(3);
    expect(result.counters.unsafe_file_formats).toBe(1);
  });

  it('rejects ambiguous and non-POSIX logical roots', () => {
    const multiple = normalizer.normalize(
      source({
        settings: [
          { id: 1, calibreDirectory: '/one', splitLibrary: false, splitDirectory: null },
          { id: 2, calibreDirectory: '/two', splitLibrary: false, splitDirectory: null },
        ],
      }),
    );
    const unsafe = normalizer.normalize(
      source({ settings: [{ id: 1, calibreDirectory: 'C:\\library', splitLibrary: false, splitDirectory: null }] }),
    );

    expect(multiple.pathPrefixes).toEqual([]);
    expect(multiple.data.books[0]?.files?.[0]?.filePath).toBeNull();
    expect(multiple.counters.multiple_logical_roots).toBe(1);
    expect(unsafe.pathPrefixes).toEqual([]);
    expect(unsafe.counters.unsafe_logical_roots).toBe(1);
  });
});

describe('CalibreWebAutomatedNormalizer status and progress', () => {
  it('normalizes web, Kobo, and KOReader progress independently and merges compatible exact locators', () => {
    const result = normalizer.normalize(
      source({
        files: [
          { id: 100, bookId: 10, format: 'EPUB', name: 'Book' },
          { id: 101, bookId: 10, format: 'KEPUB', name: 'Book' },
          { id: 102, bookId: 10, format: 'MP3', name: 'Audio' },
          { id: 103, bookId: 10, format: 'CBZ', name: 'Comic' },
          { id: 104, bookId: 10, format: 'WAV', name: 'Wave' },
          { id: 105, bookId: 10, format: 'CBT', name: 'Tar Comic' },
        ],
        webProgress: [
          { id: 1, userId: 1, bookId: 10, format: 'EPUB', bookmarkKey: 'epubcfi(/6/2)' },
          { id: 2, userId: 1, bookId: 10, format: 'MP3', bookmarkKey: '2500' },
          { id: 3, userId: 1, bookId: 10, format: 'CBZ', bookmarkKey: '0' },
          { id: 4, userId: 1, bookId: 10, format: 'WAV', bookmarkKey: '1000' },
          { id: 5, userId: 1, bookId: 10, format: 'CBT', bookmarkKey: '2' },
        ],
        koboReadingStates: [{ id: 20, userId: 1, bookId: 10, lastModified: '2024-01-02T00:00:00Z', priorityTimestamp: '2024-01-02T00:00:00Z' }],
        koboBookmarks: [
          {
            id: 21,
            readingStateId: 20,
            lastModified: '2024-01-04T00:00:00Z',
            locationSource: 'epub',
            locationType: 'cfi',
            locationValue: 'epubcfi(/6/4)',
            progressPercent: 120,
            contentSourceProgressPercent: 42,
          },
        ],
        checksums: [{ id: 30, bookId: 10, format: 'EPUB', checksum: 'partial', version: 'koreader', created: null }],
        koreaderProgress: [{ id: 31, userId: 1, document: 'partial', progress: 'not-a-cfi', percentage: 55, timestamp: '2024-01-04T00:00:00Z' }],
        statuses: [
          { id: 40, userId: 1, bookId: 10, readStatus: 2, lastModified: '2024-01-05T00:00:00Z', lastTimeStartedReading: '2024-01-01T00:00:00Z' },
        ],
      }),
    );

    expect(result.data.userFileProgress).toEqual([
      {
        sourceUserId: '1',
        sourceBookId: '10',
        sourceFileId: '10:100',
        percentage: 55,
        cfi: 'epubcfi(/6/2)',
        pageNumber: null,
        positionSeconds: null,
        updatedAt: '2024-01-04T00:00:00.000Z',
      },
      expect.objectContaining({ sourceFileId: '10:101', percentage: 42, cfi: 'epubcfi(/6/4)' }),
      expect.objectContaining({ sourceFileId: '10:102', percentage: null, positionSeconds: 2.5 }),
      expect.objectContaining({ sourceFileId: '10:103', percentage: null, pageNumber: 1 }),
    ]);
    expect(result.data.userBookStatuses).toEqual([
      {
        sourceUserId: '1',
        sourceBookId: '10',
        status: 'reading',
        percentage: 55,
        startedAt: '2024-01-01T00:00:00.000Z',
        finishedAt: null,
        updatedAt: '2024-01-05T00:00:00.000Z',
      },
    ]);
    expect(result.counters.invalid_kobo_percentages).toBe(1);
    expect(result.counters.unsupported_cwa_audio_formats).toBe(1);
    expect(result.counters.unsupported_cwa_comic_formats).toBe(1);
    expect(result.data.books[0]?.files?.every((file) => file.fileHash === null)).toBe(true);
  });

  it('rejects malformed web and proprietary Kobo locators without discarding a valid percentage', () => {
    const result = normalizer.normalize(
      source({
        webProgress: [{ id: 1, userId: 1, bookId: 10, format: 'EPUB', bookmarkKey: 'epubcfi()' }],
        koboReadingStates: [{ id: 2, userId: 1, bookId: 10, lastModified: '2024-01-01T00:00:00Z', priorityTimestamp: null }],
        koboBookmarks: [
          {
            id: 3,
            readingStateId: 2,
            lastModified: '2024-01-02T00:00:00Z',
            locationSource: 'kobo',
            locationType: 'KoboSpan',
            locationValue: 'OEBPS/chapter.xhtml#point(/1/2:3)',
            progressPercent: 33,
            contentSourceProgressPercent: null,
          },
        ],
      }),
    );

    expect(result.data.userFileProgress).toEqual([
      expect.objectContaining({ sourceFileId: '10:100', percentage: 33, cfi: null, updatedAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    expect(result.counters.invalid_web_cfi).toBe(1);
  });

  it('does not attach progress arbitrarily when a source format is unexpectedly duplicated', () => {
    const result = normalizer.normalize(
      source({
        files: [
          { id: 100, bookId: 10, format: 'EPUB', name: 'One' },
          { id: 101, bookId: 10, format: 'EPUB', name: 'Two' },
        ],
        webProgress: [{ id: 1, userId: 1, bookId: 10, format: 'EPUB', bookmarkKey: 'epubcfi(/6/2)' }],
      }),
    );

    expect(result.data.userFileProgress).toEqual([]);
    expect(result.counters.ambiguous_web_progress_files).toBe(1);
    expect(result.counters.unresolved_web_progress).toBe(1);
  });

  it('uses KOReader over Kobo on equal timestamps and rejects ambiguous historical checksums', () => {
    const result = normalizer.normalize(
      source({
        koboReadingStates: [{ id: 1, userId: 1, bookId: 10, lastModified: null, priorityTimestamp: '2024-01-01T00:00:00Z' }],
        koboBookmarks: [
          {
            id: 2,
            readingStateId: 1,
            lastModified: '2024-01-02T00:00:00Z',
            locationSource: null,
            locationType: null,
            locationValue: null,
            progressPercent: 40,
            contentSourceProgressPercent: null,
          },
        ],
        checksums: [
          { id: 3, bookId: 10, format: 'EPUB', checksum: 'unique', version: 'koreader', created: null },
          { id: 4, bookId: 10, format: 'EPUB', checksum: 'ambiguous', version: 'koreader', created: null },
          { id: 5, bookId: 11, format: 'EPUB', checksum: 'ambiguous', version: 'koreader', created: null },
        ],
        koreaderProgress: [
          { id: 6, userId: 1, document: 'unique', progress: 'epubcfi(/6/8)', percentage: 60, timestamp: '2024-01-02T00:00:00Z' },
          { id: 7, userId: 1, document: 'ambiguous', progress: 'epubcfi(/6/10)', percentage: 70, timestamp: '2024-01-03T00:00:00Z' },
        ],
      }),
    );

    expect(result.data.userFileProgress).toEqual([
      expect.objectContaining({ sourceFileId: '10:100', percentage: 60, cfi: 'epubcfi(/6/8)', updatedAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    expect(result.counters.ambiguous_koreader_checksums).toBe(1);
  });

  it('maps read states exactly, deduplicates by timestamp and ID, and warns on unknown codes', () => {
    const result = normalizer.normalize(
      source({
        books: [
          { id: 10, title: 'One', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/One' },
          { id: 11, title: 'Two', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Two' },
          { id: 12, title: 'Three', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Three' },
        ],
        files: [],
        statuses: [
          { id: 1, userId: 1, bookId: 10, readStatus: 0, lastModified: '2024-01-01T00:00:00Z', lastTimeStartedReading: null },
          { id: 2, userId: 1, bookId: 11, readStatus: 1, lastModified: '2024-01-02T00:00:00Z', lastTimeStartedReading: '2024-01-01T00:00:00Z' },
          { id: 3, userId: 1, bookId: 12, readStatus: 2, lastModified: '2024-01-01T00:00:00Z', lastTimeStartedReading: null },
          { id: 4, userId: 1, bookId: 12, readStatus: 2, lastModified: '2024-01-02T00:00:00Z', lastTimeStartedReading: null },
          { id: 5, userId: 1, bookId: 12, readStatus: 99, lastModified: null, lastTimeStartedReading: null },
        ],
      }),
    );

    expect(result.data.userBookStatuses).toEqual([
      expect.objectContaining({ sourceBookId: '10', status: 'unread', percentage: 0, finishedAt: null }),
      expect.objectContaining({ sourceBookId: '11', status: 'read', percentage: 100, finishedAt: '2024-01-02T00:00:00.000Z' }),
      expect.objectContaining({ sourceBookId: '12', status: 'reading', percentage: null, updatedAt: '2024-01-02T00:00:00.000Z' }),
    ]);
    expect(result.counters.duplicate_statuses).toBe(1);
    expect(result.counters.unknown_read_statuses).toBe(1);
  });
});

describe('CalibreWebAutomatedNormalizer shelves and capabilities', () => {
  it('privatizes public shelves and produces a deterministic membership order', () => {
    const result = normalizer.normalize(
      source({
        books: [
          { id: 10, title: 'One', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/One' },
          { id: 11, title: 'Two', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Two' },
          { id: 12, title: 'Three', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Three' },
          { id: 13, title: 'Four', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Four' },
          { id: 14, title: 'Five', pubdate: null, seriesIndex: 1, authorSort: null, path: 'Books/Five' },
        ],
        files: [],
        shelves: [{ id: 20, userId: 1, name: 'Public Favorites', isPublic: true }],
        shelfBooks: [
          { id: 4, shelfId: 20, bookId: 13, position: null },
          { id: 3, shelfId: 20, bookId: 12, position: 1 },
          { id: 2, shelfId: 20, bookId: 11, position: 1 },
          { id: 1, shelfId: 20, bookId: 10, position: 0 },
          { id: 5, shelfId: 20, bookId: 14, position: -1 },
          { id: 6, shelfId: 20, bookId: 13, position: null },
        ],
      }),
    );

    expect(result.data.shelves).toEqual([{ sourceShelfId: '20', sourceUserId: '1', name: 'Public Favorites' }]);
    expect(result.data.shelfBooks).toEqual([
      { sourceShelfId: '20', sourceUserId: '1', sourceBookId: '10', position: 0 },
      { sourceShelfId: '20', sourceUserId: '1', sourceBookId: '11', position: null },
      { sourceShelfId: '20', sourceUserId: '1', sourceBookId: '12', position: null },
      { sourceShelfId: '20', sourceUserId: '1', sourceBookId: '13', position: null },
      { sourceShelfId: '20', sourceUserId: '1', sourceBookId: '14', position: null },
    ]);
    expect(result.counters.public_shelves_privatized).toBe(1);
    expect(result.counters.invalid_shelf_positions).toBe(3);
    expect(result.counters.duplicate_shelf_memberships).toBe(1);
  });

  it('declares conditional domains accurately and bounds warning categories', () => {
    const warnings = Array.from({ length: 120 }, (_, index) => ({ category: `category_${index}`, count: 1 }));
    const result = normalizer.normalize(
      source({
        warnings,
        capabilities: {
          ...capabilities,
          authors: false,
          tags: false,
          userBookStatuses: false,
          webProgress: false,
          koboProgress: false,
          koreaderProgress: false,
          shelves: false,
        },
      }),
    );

    expect(result.data.availableDomains).toEqual({
      metadata: true,
      authors: false,
      narrators: false,
      genres: false,
      tags: false,
      userBookStatuses: false,
      readingProgress: false,
      readingSessions: false,
      bookmarks: false,
      annotations: false,
      shelves: false,
      covers: false,
    });
    expect(Object.keys(result.counters)).toHaveLength(100);
    expect(result.warnings).toHaveLength(101);
  });
});
