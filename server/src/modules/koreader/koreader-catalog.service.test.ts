vi.mock('fs', () => ({
  createReadStream: vi.fn(() => 'stream'),
}));

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
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

function makeService() {
  const opdsBookService = {
    getAccessibleLibraries: vi.fn().mockResolvedValue([{ id: 1, name: 'Main', bookCount: 99 }]),
    getUserCollections: vi.fn().mockResolvedValue([{ id: 2, name: 'Favorites', bookCount: 99 }]),
    getUserSmartScopes: vi.fn().mockResolvedValue([{ id: 3, name: 'Unread', icon: 'book-open' }]),
    getDistinctAuthorsPage: vi.fn().mockResolvedValue({ items: [{ name: 'Frank Herbert', bookCount: 2 }], hasNext: false }),
    getDistinctSeriesPage: vi.fn().mockResolvedValue({ items: [{ name: 'Dune', bookCount: 6 }], hasNext: false }),
    getBooksPage: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
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

  const service = new KoreaderCatalogService(
    opdsBookService as never,
    bookService as never,
    bookReadService as never,
    userBookStatusService as never,
    { appDataPath: '/data', bookDockPath: '/data/book-dock' },
  );

  return { service, opdsBookService, bookService, bookReadService, userBookStatusService };
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
    expect(series.items.map((item) => item.title)).toEqual(['Dune']);
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

  it('maps book detail without exposing absolute paths', async () => {
    const { service } = makeService();

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
          },
        ],
      }),
    );
    expect(JSON.stringify(detail)).not.toContain('/books/dune.epub');
  });

  it('streams thumbnails with access checks and etags', async () => {
    const { service, bookService } = makeService();
    const reply = makeReply();

    await service.streamThumbnail(makeUser(), 10, reply as never);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(10, expect.objectContaining({ id: 1 }));
    expect(reply.header).toHaveBeenCalledWith('ETag', '"5000"');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/data/covers/10/thumbnail.jpg');

    const cachedReply = makeReply();
    await service.streamThumbnail(makeUser(), 10, cachedReply as never, '"5000"');
    expect(cachedReply.status).toHaveBeenCalledWith(304);
  });

  it('streams content files without LibraryDownload permission', async () => {
    const { service, bookService } = makeService();
    const reply = makeReply();

    await service.streamFile(makeUser({ permissions: [] }), 100, reply as never);

    expect(bookService.verifyFileAccess).toHaveBeenCalledWith(100, expect.objectContaining({ permissions: [] }));
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="Dune - Frank Herbert.epub"');
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

    const result = await service.getBooksPage(user, Object.assign(new KoreaderCatalogBooksQueryDto(), { series: 'Dune', sort: 'series' }));

    expect(result.seriesSummary).toEqual({ total: 6, finished: 2 });
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
