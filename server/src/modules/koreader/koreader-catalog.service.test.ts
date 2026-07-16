vi.mock('fs', () => ({
  createReadStream: vi.fn(() => 'stream'),
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { join } from 'path';
import { stat } from 'fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DEFAULT_KOREADER_DEVICE_PATTERN } from '@bookorbit/types';
import type { MockedFunction } from 'vitest';

import { makeUser } from '../../common/test-utils/make-user';
import { KoreaderCatalogBooksQueryDto } from './dto/koreader-catalog-query.dto';
import { KoreaderCatalogService } from './koreader-catalog.service';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeReply() {
  const reply = {
    header: vi.fn(),
    status: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  return reply;
}

function makeDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    libraryId: 1,
    libraryName: 'Main',
    status: 'present',
    folderPath: '/books/dune',
    addedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    title: 'Dune',
    subtitle: null,
    description: 'Desert planet',
    isbn10: null,
    isbn13: '9780441172719',
    publisher: 'Ace',
    publishedYear: 1965,
    language: 'en',
    pageCount: 412,
    seriesId: null,
    seriesName: 'Dune',
    seriesIndex: 1,
    seriesMemberships: [],
    rating: 5,
    coverSource: 'extracted',
    providerIds: {},
    authors: [{ id: 1, name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
    genres: ['Science Fiction'],
    tags: ['classic'],
    files: [
      {
        id: 100,
        format: 'epub',
        role: 'primary',
        sizeBytes: 1234,
        absolutePath: '/books/dune.epub',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        filename: 'dune.epub',
        durationSeconds: null,
      },
    ],
    lastWrittenAt: null,
    metadataScore: 90,
    readStatus: { status: 'reading' },
    audioMetadata: null,
    formatPriority: [],
    comicMetadata: null,
    lockedFields: [],
    collections: [{ id: 5, name: 'Favorites' }],
    fileWriteStatus: { enabled: false, reason: 'library_disabled', writableFormats: [], writableFields: [] },
    ...overrides,
  };
}

function makeService(
  deviceOrganization: {
    fileNamingPattern: string;
    seriesFileNamingPattern: string;
    standaloneFileNamingPattern: string;
  } | null = null,
) {
  const opdsBookService = {
    getAccessibleLibraries: vi.fn().mockResolvedValue([{ id: 1, name: 'Main', bookCount: 99 }]),
    getUserCollections: vi.fn().mockResolvedValue([{ id: 2, name: 'Favorites', bookCount: 99 }]),
    getUserSmartScopes: vi.fn().mockResolvedValue([{ id: 3, name: 'Unread', icon: 'book-open' }]),
    getDistinctAuthorsPage: vi.fn().mockResolvedValue({ items: [{ name: 'Frank Herbert', bookCount: 2 }], hasNext: false }),
    getDistinctSeriesPage: vi.fn().mockResolvedValue({ items: [{ id: 42, name: 'Dune', bookCount: 6 }], hasNext: false }),
    getBooksPage: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    getRandomBooks: vi.fn().mockResolvedValue([]),
  };
  const bookService = {
    getDetail: vi.fn().mockResolvedValue(makeDetail()),
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    bulkSetRating: vi.fn().mockResolvedValue(undefined),
    verifyFileAccess: vi.fn().mockResolvedValue({
      id: 100,
      role: 'content',
      bookId: 10,
      libraryId: 1,
      absolutePath: '/books/dune.epub',
      format: 'epub',
    }),
    resolveDownloadFilename: vi.fn().mockResolvedValue('Dune - Frank Herbert.epub'),
  };
  const bookReadService = {
    findProgressByBook: vi.fn().mockResolvedValue([
      {
        fileId: 100,
        percentage: 47.4,
        koreaderProgress: '/body/DocFragment[2]/body/p[1]',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]),
    findProgressByBooks: vi.fn().mockResolvedValue([
      {
        bookId: 10,
        fileId: 100,
        percentage: 47.4,
        koreaderProgress: '/body/DocFragment[2]/body/p[1]',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]),
  };
  const userBookStatusService = {
    findOne: vi.fn().mockResolvedValue({ status: 'reading' }),
    findByBookIds: vi.fn().mockResolvedValue(new Map([[10, { status: 'reading' }]])),
    setManual: vi.fn().mockResolvedValue(undefined),
  };
  const dashboardWidgetService = {
    getReadingGoal: vi.fn().mockResolvedValue({ goalBooks: 24, completedBooks: 6, year: 2026 }),
    getReadingStreak: vi.fn().mockResolvedValue({ currentStreak: 4, longestStreak: 9, lastSevenDays: [true, false, true, true, true, false, true] }),
    getHighlightOfTheDay: vi.fn().mockResolvedValue({
      text: 'Fear is the mind-killer.',
      note: null,
      bookTitle: 'Dune',
      bookId: 10,
      hasCover: true,
      chapterTitle: 'Chapter 1',
      createdAt: '2026-03-01T00:00:00.000Z',
    }),
  };
  const recommendationService = {
    getSeriesBooks: vi.fn().mockResolvedValue([
      {
        id: 10,
        title: 'Dune',
        updatedAt: '2026-02-01T00:00:00.000Z',
        seriesIndex: 1,
        hasCover: true,
        authors: ['Frank Herbert'],
      },
      {
        id: 11,
        title: 'Dune Messiah',
        updatedAt: '2026-02-02T00:00:00.000Z',
        seriesIndex: 2,
        hasCover: true,
        authors: ['Frank Herbert'],
      },
    ]),
    getAuthorBooks: vi.fn().mockResolvedValue([
      {
        id: 10,
        title: 'Dune',
        updatedAt: '2026-02-01T00:00:00.000Z',
        hasCover: true,
        authors: ['Frank Herbert'],
      },
      {
        id: 12,
        title: 'The Dosadi Experiment',
        updatedAt: '2026-02-03T00:00:00.000Z',
        hasCover: false,
        authors: ['Frank Herbert'],
      },
    ]),
    getRecommendations: vi.fn().mockResolvedValue([
      {
        id: 11,
        title: 'Dune Messiah',
        updatedAt: '2026-02-02T00:00:00.000Z',
        hasCover: true,
        authors: ['Frank Herbert'],
      },
      {
        id: 13,
        title: 'Hyperion',
        updatedAt: '2026-02-04T00:00:00.000Z',
        hasCover: true,
        authors: ['Dan Simmons'],
      },
    ]),
  };

  const service = new KoreaderCatalogService(
    opdsBookService as never,
    bookService as never,
    bookReadService as never,
    userBookStatusService as never,
    dashboardWidgetService as never,
    recommendationService as never,
    { isCrossPlatformPathSanitizationEnabled: vi.fn().mockResolvedValue(true) } as never,
    {
      getKoreaderUserDefaultPattern: vi.fn().mockResolvedValue(DEFAULT_KOREADER_DEVICE_PATTERN),
      getDeviceFileNamingPattern: vi.fn().mockResolvedValue(deviceOrganization),
    } as never,
    { appDataPath: '/data', bookDockPath: '/data/book-dock' },
  );

  return { service, opdsBookService, bookService, bookReadService, userBookStatusService, dashboardWidgetService, recommendationService };
}

describe('KoreaderCatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStat.mockResolvedValue({ size: 1234, mtimeMs: 5000 } as never);
  });

  it('returns root catalog sections', () => {
    const { service } = makeService();

    expect(service.getRoot().sections.map((section) => section.id)).toEqual([
      'continue-reading',
      'recent',
      'libraries',
      'collections',
      'smart-scopes',
      'authors',
      'series',
      'all-books',
    ]);
  });

  it('exposes the continue-reading shortcut as a recently_read reading scope', () => {
    const { service } = makeService();

    const entry = service.getRoot().sections.find((section) => section.id === 'continue-reading');

    expect(entry).toEqual(
      expect.objectContaining({
        section: 'continue-reading',
        booksHref: '/api/v1/koreader/plugin/catalog/books?sort=recently_read&readStatus=reading',
      }),
    );
  });

  it('builds a capped dashboard payload from catalog and widget data', async () => {
    const { service, opdsBookService, dashboardWidgetService } = makeService();
    const user = makeUser({ id: 7 });
    opdsBookService.getBooksPage.mockResolvedValueOnce({
      total: 1,
      entries: [
        {
          id: 10,
          title: 'Dune',
          folderPath: '/books/dune',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
          description: null,
          seriesId: 42,
          seriesName: 'Dune',
          seriesIndex: 1,
          language: 'en',
          publisher: 'Ace',
          isbn13: null,
          hasCover: true,
          authors: ['Frank Herbert'],
          files: [{ id: 100, format: 'epub' }],
        },
      ],
    });
    opdsBookService.getBooksPage.mockResolvedValueOnce({ total: 99, entries: [] });

    opdsBookService.getRandomBooks.mockResolvedValueOnce([
      {
        id: 22,
        title: 'Neuromancer',
        folderPath: '/books/neuromancer',
        addedAt: new Date('2026-01-05T00:00:00.000Z'),
        updatedAt: new Date('2026-02-05T00:00:00.000Z'),
        description: null,
        seriesId: null,
        seriesName: null,
        seriesIndex: null,
        language: 'en',
        publisher: 'Ace',
        isbn13: null,
        hasCover: true,
        authors: ['William Gibson'],
        files: [{ id: 200, format: 'epub' }],
      },
    ]);

    const dashboard = await service.getDashboard(user);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'recently_read', 1, 5, { readStatus: 'reading' }, false, user.contentFilters);
    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'title_asc', 1, 1, {}, false, user.contentFilters);
    expect(opdsBookService.getRandomBooks).toHaveBeenCalledWith(7, 10, false, user.contentFilters);
    expect(dashboard.sections.map((section) => section.id)).toContain('all-books');
    expect(dashboard.username).toBe('testuser');
    expect(dashboard.displayName).toBe('Test User');
    expect(dashboard.totalBooks).toBe(99);
    expect(dashboard.continueReading[0]).toEqual(expect.objectContaining({ id: 10, progressPercentage: 47.4, readStatus: 'reading' }));
    expect(dashboard.discover[0]).toEqual(expect.objectContaining({ id: 22, title: 'Neuromancer' }));
    expect(dashboard.readingGoal).toEqual({ goalBooks: 24, completedBooks: 6, year: 2026 });
    expect(dashboard.readingStreak.currentStreak).toBe(4);
    expect(dashboard.highlightOfTheDay?.bookId).toBe(10);
    expect(dashboard.generatedAt).toEqual(expect.any(String));
    expect(dashboardWidgetService.getReadingGoal).toHaveBeenCalledWith(user);
    expect(dashboardWidgetService.getReadingStreak).toHaveBeenCalledWith(user);
    expect(dashboardWidgetService.getHighlightOfTheDay).toHaveBeenCalledWith(user);
  });

  it('rerolls discover books via getDiscover', async () => {
    const { service, opdsBookService } = makeService();
    const user = makeUser({ id: 7 });
    opdsBookService.getRandomBooks.mockResolvedValueOnce([
      {
        id: 33,
        title: 'Frankenstein',
        folderPath: '/books/frankenstein',
        addedAt: new Date('2026-01-09T00:00:00.000Z'),
        updatedAt: new Date('2026-02-09T00:00:00.000Z'),
        description: null,
        seriesName: null,
        seriesIndex: null,
        language: 'en',
        publisher: 'Lackington',
        isbn13: null,
        hasCover: true,
        authors: ['Mary Shelley'],
        files: [{ id: 300, format: 'epub' }],
      },
    ]);

    const result = await service.getDiscover(user);

    expect(opdsBookService.getRandomBooks).toHaveBeenCalledWith(7, 10, false, user.contentFilters);
    expect(result.discover).toHaveLength(1);
    expect(result.discover[0]).toEqual(expect.objectContaining({ id: 33, title: 'Frankenstein' }));
  });

  it('forwards read-status, format, and id filters to the books query', async () => {
    const { service, opdsBookService } = makeService();
    const user = makeUser({ id: 4 });

    const query = Object.assign(new KoreaderCatalogBooksQueryDto(), {
      page: 1,
      size: 20,
      sort: 'recently_read',
      readStatus: 'reading',
      format: 'EPUB',
      ids: [3, 1, 2],
    });
    await service.getBooksPage(user, query);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(
      4,
      'recently_read',
      1,
      20,
      { readStatus: 'reading', format: 'epub', ids: [3, 1, 2] },
      false,
      user.contentFilters,
    );
  });

  it('maps explicit sort order to ascending/descending variants', async () => {
    const { service, opdsBookService } = makeService();
    const user = makeUser({ id: 11 });

    await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'title', order: 'desc' }));
    expect(opdsBookService.getBooksPage).toHaveBeenLastCalledWith(11, 'title_desc', 1, 20, {}, false, user.contentFilters);

    await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'recently_added', order: 'asc' }));
    expect(opdsBookService.getBooksPage).toHaveBeenLastCalledWith(11, 'recent_asc', 1, 20, {}, false, user.contentFilters);

    await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'recently_read', order: 'asc' }));
    expect(opdsBookService.getBooksPage).toHaveBeenLastCalledWith(11, 'recently_read_asc', 1, 20, {}, false, user.contentFilters);
  });

  it('falls back to the natural direction when no order is given', async () => {
    const { service, opdsBookService } = makeService();
    const user = makeUser({ id: 12 });

    await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'title' }));
    expect(opdsBookService.getBooksPage).toHaveBeenLastCalledWith(12, 'title_asc', 1, 20, {}, false, user.contentFilters);

    await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'recently_updated' }));
    expect(opdsBookService.getBooksPage).toHaveBeenLastCalledWith(12, 'updated', 1, 20, {}, false, user.contentFilters);
  });

  it('maps section entries to scoped book links and content-filtered counts', async () => {
    const { service, opdsBookService } = makeService();
    opdsBookService.getBooksPage.mockResolvedValue({ entries: [], total: 3 });
    const user = makeUser({ id: 7 });

    const libraries = await service.getSectionEntries(user, 'libraries');
    const authors = await service.getSectionEntries(user, 'authors');
    const series = await service.getSectionEntries(user, 'series');

    expect(libraries.items[0]).toEqual(
      expect.objectContaining({
        id: '1',
        title: 'Main',
        section: 'libraries',
        count: 3,
        booksHref: '/api/v1/koreader/plugin/catalog/books?sort=title&libraryId=1',
      }),
    );
    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(7, 'title_asc', 1, 1, { libraryId: 1 }, false, user.contentFilters);
    expect(authors.items[0]!.booksHref).toContain('author=Frank+Herbert');
    expect(series.items[0]).toEqual(
      expect.objectContaining({
        id: 'series:42',
        title: 'Dune',
        section: 'series',
        seriesId: 42,
        count: 6,
        booksHref: '/api/v1/koreader/plugin/catalog/books?sort=series&seriesId=42',
      }),
    );
  });

  it('rejects unknown section names', async () => {
    const { service } = makeService();
    await expect(service.getSectionEntries(makeUser(), 'bogus')).rejects.toThrow(BadRequestException);
  });

  it('returns paged book lists with sort mapping, scoped filters, progress, and status', async () => {
    const { service, opdsBookService } = makeService();
    const user = makeUser({ id: 9, isSuperuser: true });
    opdsBookService.getBooksPage.mockResolvedValueOnce({
      total: 50,
      entries: [
        {
          id: 10,
          title: 'Dune',
          folderPath: '/books/dune',
          addedAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-02-01T00:00:00.000Z'),
          description: null,
          seriesId: 42,
          seriesName: 'Dune',
          seriesIndex: 1,
          language: 'en',
          publisher: 'Ace',
          isbn13: null,
          hasCover: true,
          authors: ['Frank Herbert'],
          files: [
            { id: 100, format: 'epub' },
            { id: 101, format: 'pdf' },
          ],
        },
      ],
    });

    const query = Object.assign(new KoreaderCatalogBooksQueryDto(), {
      page: 2,
      size: 20,
      sort: 'recently_updated',
      q: ' dune ',
      libraryId: 1,
    });
    const result = await service.getBooksPage(user, query);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(9, 'updated', 2, 20, { libraryId: 1, q: 'dune' }, true, user.contentFilters);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 10,
        title: 'Dune',
        progressPercentage: 47.4,
        readStatus: 'reading',
        formats: ['epub', 'pdf'],
        thumbnailUrl: '/api/v1/koreader/plugin/catalog/books/10/thumbnail',
      }),
    );
    expect(result.previousUrl).toContain('page=1');
    expect(result.nextUrl).toContain('page=3');
  });

  it('maps book detail with related rows without exposing absolute paths', async () => {
    const { service, recommendationService } = makeService();

    const detail = await service.getBookDetail(makeUser({ id: 7 }), 10);

    expect(detail).toEqual(
      expect.objectContaining({
        id: 10,
        title: 'Dune',
        authors: ['Frank Herbert'],
        libraryName: 'Main',
        progress: expect.objectContaining({ fileId: 100, percentage: 47.4 }),
        files: [
          {
            id: 100,
            format: 'epub',
            role: 'primary',
            sizeBytes: 1234,
            durationSeconds: null,
            downloadUrl: '/api/v1/koreader/plugin/catalog/files/100/download',
            devicePath: 'Series/Dune/1.00 - Dune.epub',
          },
        ],
        relatedSections: [
          {
            id: 'series',
            title: 'More in series',
            books: [
              expect.objectContaining({
                id: 11,
                title: 'Dune Messiah',
                seriesIndex: 2,
                thumbnailUrl: '/api/v1/koreader/plugin/catalog/books/11/thumbnail',
              }),
            ],
          },
          {
            id: 'author',
            title: 'Also by this author',
            books: [
              expect.objectContaining({
                id: 12,
                title: 'The Dosadi Experiment',
                thumbnailUrl: null,
              }),
            ],
          },
          {
            id: 'similar',
            title: 'Similar books',
            books: [
              expect.objectContaining({
                id: 13,
                title: 'Hyperion',
                thumbnailUrl: '/api/v1/koreader/plugin/catalog/books/13/thumbnail',
              }),
            ],
          },
        ],
      }),
    );
    expect(recommendationService.getSeriesBooks).toHaveBeenCalledWith(10, expect.objectContaining({ id: 7 }));
    expect(recommendationService.getAuthorBooks).toHaveBeenCalledWith(10, expect.objectContaining({ id: 7 }));
    expect(recommendationService.getRecommendations).toHaveBeenCalledWith(10, expect.objectContaining({ id: 7 }));
    expect(JSON.stringify(detail)).not.toContain('/books/dune.epub');
  });

  it('normalizes catalog extensions once for format, placeholders, basename stripping, and fallback names', async () => {
    const { service, bookService } = makeService({
      fileNamingPattern: '{originalFilename}.{extension}',
      seriesFileNamingPattern: '',
      standaloneFileNamingPattern: '',
    });
    bookService.getDetail.mockResolvedValueOnce(
      makeDetail({
        seriesId: null,
        seriesName: null,
        seriesIndex: null,
        files: [
          {
            id: 100,
            format: 'EPUB',
            role: 'primary',
            sizeBytes: 1234,
            absolutePath: '/books/dune.epub',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            filename: 'dune.epub',
            durationSeconds: null,
          },
          {
            id: 101,
            format: null,
            role: 'content',
            sizeBytes: 2345,
            absolutePath: '/books/notes.bin',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            filename: null,
            durationSeconds: null,
          },
        ],
      }),
    );

    const detail = await service.getBookDetail(makeUser(), 10, 'device-1');

    expect(detail.files).toEqual([
      expect.objectContaining({ format: 'epub', devicePath: 'dune.epub' }),
      expect.objectContaining({ format: 'bin', devicePath: 'Dune.bin' }),
    ]);
  });

  it('uses the device series pattern for books in a series', async () => {
    const { service } = makeService({
      fileNamingPattern: 'Default/{title}.{extension}',
      seriesFileNamingPattern: 'SeriesOverride/{series}/{title}.{extension}',
      standaloneFileNamingPattern: 'StandaloneOverride/{title}.{extension}',
    });

    const detail = await service.getBookDetail(makeUser(), 10, 'device-1');

    expect(detail.files[0]?.devicePath).toBe('SeriesOverride/Dune/Dune.epub');
  });

  it('uses the standalone pattern and falls back to the device default when a specialized override is blank', async () => {
    const organization = {
      fileNamingPattern: 'Default/{title}.{extension}',
      seriesFileNamingPattern: '',
      standaloneFileNamingPattern: 'StandaloneOverride/{title}.{extension}',
    };
    const { service, bookService } = makeService(organization);
    bookService.getDetail.mockResolvedValue(makeDetail({ seriesId: null, seriesName: null, seriesIndex: null }));

    const standalone = await service.getBookDetail(makeUser(), 10, 'device-1');
    expect(standalone.files[0]?.devicePath).toBe('StandaloneOverride/Dune.epub');

    organization.standaloneFileNamingPattern = '   ';
    const fallback = await service.getBookDetail(makeUser(), 10, 'device-1');
    expect(fallback.files[0]?.devicePath).toBe('Default/Dune.epub');
  });

  it('streams thumbnails with access checks and etags', async () => {
    const { service, bookService } = makeService();
    const reply = makeReply();

    await service.streamThumbnail(makeUser(), 10, reply as never);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(10, expect.objectContaining({ id: 1 }));
    expect(reply.header).toHaveBeenCalledWith('ETag', '"5000"');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(mockCreateReadStream).toHaveBeenCalledWith(join('/data', 'covers', '10', 'thumbnail.jpg'));

    const cachedReply = makeReply();
    await service.streamThumbnail(makeUser(), 10, cachedReply as never, '"5000"');
    expect(cachedReply.status).toHaveBeenCalledWith(304);
  });

  it('streams content files without LibraryDownload permission', async () => {
    const { service, bookService } = makeService();
    const reply = makeReply();

    await service.streamFile(makeUser({ permissions: [] }), 100, reply as never);

    expect(bookService.verifyFileAccess).toHaveBeenCalledWith(100, expect.objectContaining({ permissions: [] }));
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="Dune - Frank Herbert.epub"; filename*=UTF-8''Dune%20-%20Frank%20Herbert.epub`,
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 1234);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/dune.epub');
  });

  it('encodes non-ASCII content file download filenames for Content-Disposition', async () => {
    const { service, bookService } = makeService();
    const reply = makeReply();
    bookService.resolveDownloadFilename.mockResolvedValueOnce('Dune’s Café - Frank Herbert.epub');

    await service.streamFile(makeUser({ permissions: [] }), 100, reply as never);

    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      `attachment; filename="Dune_s Caf_ - Frank Herbert.epub"; filename*=UTF-8''Dune%E2%80%99s%20Caf%C3%A9%20-%20Frank%20Herbert.epub`,
    );
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 1234);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/dune.epub');
  });

  it('rejects non-content file downloads and missing thumbnails', async () => {
    const { service, bookService } = makeService();
    bookService.verifyFileAccess.mockResolvedValueOnce({
      id: 200,
      role: 'cover',
      bookId: 10,
      libraryId: 1,
      absolutePath: '/cover.jpg',
      format: 'jpg',
    });

    await expect(service.streamFile(makeUser(), 200, makeReply() as never)).rejects.toThrow(NotFoundException);

    mockStat.mockRejectedValueOnce(new Error('missing'));
    await expect(service.streamThumbnail(makeUser(), 10, makeReply() as never)).rejects.toThrow(NotFoundException);
  });

  it('paginates author sections with a filter and navigation links', async () => {
    const { service, opdsBookService } = makeService();
    opdsBookService.getDistinctAuthorsPage.mockResolvedValueOnce({ items: [{ name: 'Frank Herbert', bookCount: 2 }], hasNext: true });
    const user = makeUser({ id: 7 });

    const res = await service.getSectionEntries(user, 'authors', { page: 2, q: 'her' });

    expect(opdsBookService.getDistinctAuthorsPage).toHaveBeenCalledWith(7, { q: 'her', limit: 60, offset: 60 }, false, user.contentFilters);
    expect(res.page).toBe(2);
    expect(res.hasNext).toBe(true);
    expect(res.nextUrl).toContain('sections/authors?page=3&q=her');
    expect(res.previousUrl).toContain('sections/authors?q=her');
    expect(res.query).toBe('her');
  });

  it('includes a series read-through summary on series-scoped pages', async () => {
    const { service, opdsBookService } = makeService();
    opdsBookService.getBooksPage
      .mockResolvedValueOnce({ entries: [], total: 6 })
      .mockResolvedValueOnce({ entries: [], total: 6 })
      .mockResolvedValueOnce({ entries: [], total: 2 });
    const user = makeUser({ id: 7 });

    const result = await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { seriesId: 42, sort: 'series' }));

    expect(result.seriesSummary).toEqual({ total: 6, finished: 2 });
    expect(opdsBookService.getBooksPage).toHaveBeenNthCalledWith(1, 7, 'series_asc', 1, 20, { seriesId: 42 }, false, user.contentFilters);
    expect(opdsBookService.getBooksPage).toHaveBeenNthCalledWith(2, 7, 'title_asc', 1, 1, { seriesId: 42 }, false, user.contentFilters);
    expect(opdsBookService.getBooksPage).toHaveBeenNthCalledWith(
      3,
      7,
      'title_asc',
      1,
      1,
      { seriesId: 42, readStatus: 'finished' },
      false,
      user.contentFilters,
    );
  });

  it('omits the series summary for non-series listings', async () => {
    const { service } = makeService();
    const result = await service.getBooksPage(makeUser({ id: 7 }), Object.assign(new KoreaderCatalogBooksQueryDto(), { sort: 'title' }));
    expect(result.seriesSummary).toBeNull();
  });

  it('sets read status through ownership-checked services', async () => {
    const { service, bookService, userBookStatusService } = makeService();
    const user = makeUser({ id: 7 });

    const res = await service.setReadStatus(user, 10, 'reading');

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(10, user);
    expect(userBookStatusService.setManual).toHaveBeenCalledWith(7, 10, 'reading');
    expect(res).toEqual({ readStatus: 'reading' });
  });

  it('sets and clears rating through the book service', async () => {
    const { service, bookService } = makeService();
    const user = makeUser({ id: 7 });

    const res = await service.setRating(user, 10, 4);
    expect(bookService.bulkSetRating).toHaveBeenCalledWith([10], 4, user);
    expect(res).toEqual({ rating: 4 });

    const cleared = await service.setRating(user, 10, null);
    expect(bookService.bulkSetRating).toHaveBeenLastCalledWith([10], null, user);
    expect(cleared).toEqual({ rating: null });
  });
});
