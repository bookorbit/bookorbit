import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { access, readdir, rm, stat } from 'fs/promises';

import type { RequestUser } from '../../common/types/request-user';
import { AUDIO_BOOK_FILE_WRITE_FIELDS, MetadataProviderKey, type BookQuery } from '@bookorbit/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractAudioMetadata } from '../metadata/extractors/audio.extractor';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED } from '../achievement/achievement-events.service';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import { BulkEditFieldsDto } from './dto/bulk-edit-metadata.dto';
import { BookQueryBuilder } from './book-query-builder.service';
import { BookService } from './book.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
    stat: vi.fn(),
  };
});

vi.mock('../metadata/lib/epub', () => ({
  extractEpubMetadata: vi.fn(),
}));

vi.mock('../metadata/extractors/audio.extractor', () => ({
  extractAudioMetadata: vi.fn(),
}));

vi.mock('../metadata/lib/cbz-metadata', () => ({
  extractCbzMetadata: vi.fn(),
  extractCbrMetadata: vi.fn(),
  extractCb7Metadata: vi.fn(),
}));

vi.mock('../metadata/lib/fb2-parser', () => ({
  parseFb2File: vi.fn(),
}));

vi.mock('../metadata/lib/mobi-parser', () => ({
  parseMobiFile: vi.fn(),
}));

vi.mock('../metadata/lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

const mockAccess = access as MockedFunction<typeof access>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;
const mockExtractEpubMetadata = extractEpubMetadata as MockedFunction<typeof extractEpubMetadata>;
const mockExtractAudioMetadata = extractAudioMetadata as MockedFunction<typeof extractAudioMetadata>;
const mockExtractCbzMetadata = extractCbzMetadata as MockedFunction<typeof extractCbzMetadata>;
const mockExtractCbrMetadata = extractCbrMetadata as MockedFunction<typeof extractCbrMetadata>;
const mockExtractCb7Metadata = extractCb7Metadata as MockedFunction<typeof extractCb7Metadata>;
const mockParseFb2File = parseFb2File as MockedFunction<typeof parseFb2File>;
const mockParseMobiFile = parseMobiFile as MockedFunction<typeof parseMobiFile>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const bookRepo = {
    findCards: vi.fn(),
    countWhere: vi.fn(),
    findPatternMetadataByBookIds: vi.fn(),
    findLibraryIdsByBookIds: vi.fn(),
    findPrimaryFilesByBookIds: vi.fn(),
    findAllFilesByBookIds: vi.fn(),
    findTagsByBookIds: vi.fn(),
    findAuthorsByBookIds: vi.fn(),
    findGenresByBookIds: vi.fn(),
    findNarratorsByBookIds: vi.fn(),
    findPrimaryFile: vi.fn(),
    findById: vi.fn(),
    findRatingByBookAndUser: vi.fn().mockResolvedValue(null),
    findCollectionsByBookId: vi.fn(),
    findKoboReadingState: vi.fn(),
    findKoboSnapshotState: vi.fn(),
    findKoboSyncCollectionNamesForBook: vi.fn(),
    findFileById: vi.fn(),
    findLibraryIdByBookId: vi.fn(),
    findProgress: vi.fn(),
    findProgressByBook: vi.fn(),
    upsertProgress: vi.fn(),
    clearFileProgress: vi.fn(),
    findAudioProgress: vi.fn(),
    upsertAudioProgress: vi.fn(),
    bulkSetRating: vi.fn(),
    bulkUpdateMetadataFields: vi.fn(),
    updateMetadataFields: vi.fn(),
    withTransaction: vi.fn(),
    deleteByIds: vi.fn(),
    findAllIds: vi.fn(),
    findIdsByWhere: vi.fn(),
    findCardsCollapsed: vi.fn(),
    checkBookPassesContentFilters: vi.fn().mockResolvedValue(true),
  };
  const libraryService = {
    verifyUserAccess: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
  };
  const queryBuilder = {
    buildWhere: vi.fn(),
    buildOrderBy: vi.fn(),
  };
  const metadataService = {
    replaceAuthors: vi.fn().mockResolvedValue([]),
    replaceGenres: vi.fn().mockResolvedValue(undefined),
    replaceTags: vi.fn().mockResolvedValue(undefined),
    emitAuthorsReplaced: vi.fn(),
    downloadAndSaveCover: vi.fn().mockResolvedValue(undefined),
    refreshCoverForBook: vi.fn(),
  };
  const pipeline = {
    run: vi.fn(),
    runWithSources: vi.fn(),
  };
  const config = {
    get: vi.fn().mockImplementation((key: string) => (key === 'storage.appDataPath' ? '/tmp/books' : undefined)),
  };
  const appSettings = {
    getDownloadPattern: vi.fn().mockResolvedValue('{originalFilename}'),
  };
  const scoreService = {
    calculateAndSave: vi.fn().mockResolvedValue(undefined),
  };
  const embedder = {
    embedBook: vi.fn().mockResolvedValue(undefined),
  };
  const fileWriteService = {
    scheduleWrite: vi.fn(),
    cancelPendingWrite: vi.fn(),
    writeToFile: vi.fn(),
    findLibraryWriteSettingsForBook: vi.fn().mockResolvedValue({ fileWriteEnabled: false, fileRenameEnabled: false }),
    resolveBookFileWriteStatus: vi.fn().mockReturnValue({ enabled: false, reason: 'library_disabled', writableFormats: [], writableFields: [] }),
  };
  const fileRenameService = {
    scheduleRename: vi.fn(),
    cancelPendingRename: vi.fn(),
    performRename: vi.fn(),
  };
  const achievementEvents = {
    emit: vi.fn(),
  };
  const narratorService = {
    replaceForBook: vi.fn().mockResolvedValue(undefined),
  };
  const comicMetadataService = {
    upsert: vi.fn().mockResolvedValue(undefined),
    findByBookId: vi.fn().mockResolvedValue(null),
  };
  const bookMetadataLockService = {
    normalizeLockedFields: vi.fn().mockImplementation((fields: string[] | null | undefined) => fields ?? []),
    isFieldLocked: vi.fn().mockResolvedValue(false),
    assertManualUpdateAllowed: vi.fn().mockResolvedValue(undefined),
    assertManualUpdateAllowedForLockTransition: vi.fn().mockResolvedValue(undefined),
    filterResolvedMetadata: vi.fn().mockImplementation((_bookId: number, resolved: unknown, providerIds: unknown) =>
      Promise.resolve({
        resolved,
        providerIds,
        skippedFields: [],
      }),
    ),
    assertFieldsUnlocked: vi.fn().mockResolvedValue(undefined),
    getCoverLockedBookIds: vi.fn().mockResolvedValue(new Set()),
    getBookIdsWithLockedField: vi.fn().mockResolvedValue(new Set()),
    getLockedFieldsMap: vi.fn().mockResolvedValue(new Map()),
    replaceLockedFields: vi.fn().mockResolvedValue([]),
  };
  const userBookStatusService = {
    autoUpdate: vi.fn().mockResolvedValue(undefined),
    setManual: vi.fn().mockResolvedValue(undefined),
    updateManual: vi.fn().mockResolvedValue({
      status: 'unread',
      source: 'manual',
      startedAt: null,
      finishedAt: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
    findOne: vi.fn().mockResolvedValue(null),
    findByBookIds: vi.fn().mockResolvedValue(new Map()),
  };

  bookRepo.withTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));

  const service = new BookService(
    bookRepo as never,
    libraryService as never,
    queryBuilder as never,
    metadataService as never,
    scoreService as never,
    pipeline as never,
    config as never,
    appSettings as never,
    userBookStatusService as never,
    narratorService as never,
    comicMetadataService as never,
    bookMetadataLockService as never,
    embedder as never,
    fileWriteService as never,
    fileRenameService as never,
    achievementEvents as never,
  );

  return {
    service,
    bookRepo,
    libraryService,
    queryBuilder,
    metadataService,
    scoreService,
    pipeline,
    config,
    appSettings,
    userBookStatusService,
    embedder,
    fileWriteService,
    fileRenameService,
    achievementEvents,
    narratorService,
    comicMetadataService,
    bookMetadataLockService,
  };
}

function metaRow(bookId: number, fields?: Partial<{ title: string | null; authors: string[] }>) {
  return {
    bookId,
    title: fields?.title ?? null,
    subtitle: null,
    publisher: null,
    publishedYear: null,
    language: null,
    seriesName: null,
    seriesIndex: null,
    isbn13: null,
    authors: fields?.authors ?? [],
  };
}

function makeBookCard(id: number, overrides?: Record<string, unknown>) {
  return {
    id,
    status: 'present',
    title: `Book ${id}`,
    subtitle: null,
    authors: ['Author'],
    seriesName: null,
    seriesIndex: null,
    files: [{ id: id * 10, format: 'epub', role: 'primary', sizeBytes: 123 }],
    publishedYear: 2020,
    language: 'en',
    genres: ['Sci-Fi'],
    tags: ['tag1'],
    rating: 4,
    readingProgress: 75,
    readStatus: {
      status: 'reading',
      source: 'manual',
      startedAt: '2026-05-01T00:00:00.000Z',
      finishedAt: null,
      updatedAt: '2026-05-07T00:00:00.000Z',
    },
    addedAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    metadataScore: 88,
    hasCover: true,
    hasMetadataLocks: false,
    lockedFields: [],
    publisher: 'Pub',
    pageCount: 320,
    isbn13: '9780000000000',
    narrators: [],
    ...(overrides ?? {}),
  };
}

describe('BookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockReset();
    mockReaddir.mockReset();
    mockRm.mockReset();
    mockStat.mockReset();
    mockExtractEpubMetadata.mockReset();
    mockExtractAudioMetadata.mockReset();
    mockExtractCbzMetadata.mockReset();
    mockExtractCbrMetadata.mockReset();
    mockExtractCb7Metadata.mockReset();
    mockParseFb2File.mockReset();
    mockParseMobiFile.mockReset();
    mockParsePdfFile.mockReset();
  });

  describe('download naming', () => {
    it('resolves download filename from pattern and metadata', async () => {
      const { service, appSettings, bookRepo } = makeService();
      appSettings.getDownloadPattern.mockResolvedValue('<{authors:first} - >{title}');
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(10, { title: 'Neuromancer', authors: ['William Gibson'] })]);

      const filename = await service.resolveDownloadFilename({
        bookId: 10,
        absolutePath: '/books/original-name.epub',
        format: 'epub',
      });

      expect(filename).toBe('William Gibson - Neuromancer.epub');
    });

    it('falls back to sanitized original filename when pattern resolution fails', async () => {
      const { service, appSettings } = makeService();
      appSettings.getDownloadPattern.mockRejectedValue(new Error('settings unavailable'));

      const filename = await service.resolveDownloadFilename({
        bookId: 10,
        absolutePath: '/books/bad:name?.epub',
        format: 'epub',
      });

      expect(filename).toBe('bad_name_.epub');
    });

    it('prefers file extension from path over unknown format', async () => {
      const { service, appSettings, bookRepo } = makeService();
      appSettings.getDownloadPattern.mockResolvedValue('{title}.{extension}');
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(10, { title: 'Dune' })]);

      const filename = await service.resolveDownloadFilename({
        bookId: 10,
        absolutePath: '/books/dune.PDF',
        format: 'unknown',
      });

      expect(filename).toBe('Dune.pdf');
    });

    it('preserves numeric stem suffix and still appends real extension', async () => {
      const { service, appSettings, bookRepo } = makeService();
      appSettings.getDownloadPattern.mockResolvedValue('{originalFilename}');
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(10, { title: 'Lost in the Cañon' })]);

      const filename = await service.resolveDownloadFilename({
        bookId: 10,
        absolutePath: '/books/Lost in the Cañon.37466.epub',
        format: 'epub',
      });

      expect(filename).toBe('Lost in the Cañon.37466.epub');
    });

    it('enforces actual file extension when pattern specifies a different extension', async () => {
      const { service, appSettings, bookRepo } = makeService();
      appSettings.getDownloadPattern.mockResolvedValue('{title}.pdf');
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(10, { title: 'Dune' })]);

      const filename = await service.resolveDownloadFilename({
        bookId: 10,
        absolutePath: '/books/dune.epub',
        format: 'epub',
      });

      expect(filename).toBe('Dune.pdf.epub');
    });
  });

  describe('export files', () => {
    it('throws when export is requested with no books', async () => {
      const { service } = makeService();

      await expect(service.getExportFiles([], makeUser(), 'primary')).rejects.toThrow(BadRequestException);
    });

    it('applies pattern to export zip paths and de-duplicates collisions', async () => {
      const { service, appSettings, bookRepo, libraryService } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([
        { id: 1, libraryId: 77 },
        { id: 2, libraryId: 77 },
      ]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([
        { bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 100 },
        { bookId: 2, absolutePath: '/books/b.epub', format: 'epub', sizeBytes: 200 },
      ]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Duplicate' }), metaRow(2, { title: 'Duplicate' })]);

      const plan = await service.getExportFiles([1, 2], user, 'primary');

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 77, false);
      expect(plan.projectedBytes).toBe(300);
      expect(plan.files).toEqual([
        { absolutePath: '/books/a.epub', zipPath: 'Duplicate.epub', sizeBytes: 100 },
        { absolutePath: '/books/b.epub', zipPath: 'Duplicate (2).epub', sizeBytes: 200 },
      ]);
    });

    it('sanitizes unsafe path segments in generated zip paths', async () => {
      const { service, appSettings, bookRepo } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('../{title}/..//bad:name');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/source.epub', format: 'epub', sizeBytes: 100 }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: '..' })]);

      const plan = await service.getExportFiles([1], user, 'primary');

      const [file] = plan.files;
      expect(file.zipPath).toBe('download/download/download/bad_name.epub');
    });

    it('uses all-files query when allFormats is true', async () => {
      const { service, appSettings, bookRepo } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 1, sortOrder: 0 }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'One' })]);

      await service.getExportFiles([1], user, 'all');

      expect(bookRepo.findAllFilesByBookIds).toHaveBeenCalledWith([1]);
      expect(bookRepo.findPrimaryFilesByBookIds).not.toHaveBeenCalled();
    });

    it('uses audio-only export scope when requested', async () => {
      const { service, appSettings, bookRepo } = makeService();
      const user = makeUser();
      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue([
        { bookId: 1, absolutePath: '/books/a.mp3', format: 'mp3', sizeBytes: 5, sortOrder: 0 },
        { bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 10, sortOrder: 1 },
      ]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'One' })]);

      const plan = await service.getExportFiles([1], user, 'audio');

      expect(plan.files).toHaveLength(1);
      expect(plan.files[0]?.absolutePath).toBe('/books/a.mp3');
    });

    it('throws when selected book ids include missing records', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);

      await expect(service.getExportFiles([1, 2], makeUser(), 'primary')).rejects.toThrow(BadRequestException);
    });

    it('throws when selected books have no exportable files', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([]);

      await expect(service.getExportFiles([1], makeUser(), 'primary')).rejects.toThrow(BadRequestException);
    });

    it('throws when selected books exceed configured limit', async () => {
      const { service } = makeService();
      const tooManyBookIds = Array.from({ length: 251 }, (_, i) => i + 1);

      await expect(service.getExportFiles(tooManyBookIds, makeUser(), 'primary')).rejects.toThrow(BadRequestException);
    });

    it('throws when selected export files exceed configured limit', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      const fileRows = Array.from({ length: 2001 }, (_, i) => ({
        bookId: 1,
        absolutePath: `/books/${i}.epub`,
        format: 'epub',
        sizeBytes: 1,
        sortOrder: i,
      }));

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue(fileRows);

      await expect(service.getExportFiles([1], user, 'all')).rejects.toThrow(BadRequestException);
    });

    it('throws when projected export size exceeds limit', async () => {
      const { service, bookRepo, appSettings } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub', sizeBytes: 9_000_000_000 }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Huge' })]);

      await expect(service.getExportFiles([1], user, 'primary')).rejects.toThrow(BadRequestException);
    });
  });

  describe('metadata export', () => {
    it('builds metadata export preflight for query selection', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 12 });
      libraryService.findAll.mockResolvedValue([{ id: 5, name: 'Main' }]);
      queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE' as never);
      bookRepo.countWhere.mockResolvedValue(42);

      const preflight = await service.getMetadataExportPreflight(
        {
          query: { libraryId: 5, q: 'dune', sort: [{ field: 'title', dir: 'asc' }] },
          format: 'csv',
          viewType: 'library',
        } as never,
        user,
      );

      expect(preflight.rowCount).toBe(42);
      expect(preflight.format).toBe('csv');
      expect(preflight.scope).toBe('all-matching');
      expect(preflight.fileName).toContain('bookorbit-library-all-matching-');
      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, {
        accessibleLibraryIds: [5],
        implicitLibraryId: 5,
        userId: 12,
        q: 'dune',
        timeZone: 'UTC',
      });
      expect(bookRepo.countWhere).toHaveBeenCalledWith('WHERE_CLAUSE');
    });

    it('rejects metadata export preflight for inaccessible library query selections', async () => {
      const { service, libraryService } = makeService();
      const user = makeUser({ id: 99 });
      libraryService.findAll.mockResolvedValue([{ id: 7, name: 'Allowed' }]);

      await expect(
        service.getMetadataExportPreflight(
          {
            query: { libraryId: 9, q: 'dune' },
            format: 'json',
            viewType: 'library',
          } as never,
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('builds csv metadata export with context lines and stable machine keys', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAll.mockResolvedValue([{ id: 5, name: 'Main Library' }]);
      queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE' as never);
      bookRepo.countWhere.mockResolvedValue(1);
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 5 }]);
      vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({
        items: [makeBookCard(1)],
        total: 1,
        page: 0,
        size: 1,
      });

      const exported = await service.buildMetadataExport(
        {
          query: { libraryId: 5, sort: [{ field: 'title', dir: 'asc' }] },
          format: 'csv',
          viewType: 'library',
          options: { includePersonalData: false, includeContextMeta: true, columnsMode: 'canonical' },
        } as never,
        user,
      );

      expect(exported.contentType).toBe('text/csv; charset=utf-8');
      expect(exported.fileName).toContain('.csv');
      expect(exported.preflight.rowCount).toBe(1);
      expect(exported.content).toContain('\uFEFF');
      expect(exported.content).toContain('# schemaVersion=1');
      expect(exported.content).toContain('bookId,libraryId,libraryName,status,title');
      expect(exported.content).toContain('1,5,Main Library,present,Book 1');
    });

    it('builds json metadata export with visible-column projection', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser({ id: 11 });
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 2, libraryId: 8 }]);
      libraryService.findAll.mockResolvedValue([{ id: 8, name: 'Focus' }]);
      vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({
        items: [makeBookCard(2)],
        total: 1,
        page: 0,
        size: 1,
      });

      const exported = await service.buildMetadataExport(
        {
          bookIds: [2],
          sort: [{ field: 'title', dir: 'asc' }],
          format: 'json',
          viewType: 'collection',
          options: { columnsMode: 'visible', visibleColumns: ['title', 'authors', 'format'], includePersonalData: true },
        } as never,
        user,
      );

      expect(exported.contentType).toBe('application/json; charset=utf-8');
      const parsed = JSON.parse(exported.content) as {
        schemaVersion: number;
        meta: { viewType: string; scope: string };
        items: Array<Record<string, unknown>>;
      };
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.meta.viewType).toBe('collection');
      expect(parsed.meta.scope).toBe('selected');
      expect(parsed.items[0]).toMatchObject({
        bookId: 2,
        libraryId: 8,
        libraryName: 'Focus',
        title: 'Book 2',
      });
      expect(parsed.items[0]).toHaveProperty('authors');
      expect(parsed.items[0]).toHaveProperty('primaryFormat', 'epub');
      expect(parsed.items[0]).toHaveProperty('formats');
      expect(parsed.items[0]).not.toHaveProperty('status');
    });

    it('omits json context metadata when includeContextMeta is disabled', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser({ id: 15 });
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 4, libraryId: 6 }]);
      libraryService.findAll.mockResolvedValue([{ id: 6, name: 'Focus' }]);
      vi.spyOn(service, 'executeBooksQuery').mockResolvedValue({
        items: [makeBookCard(4)],
        total: 1,
        page: 0,
        size: 1,
      });

      const exported = await service.buildMetadataExport(
        {
          bookIds: [4],
          format: 'json',
          viewType: 'smartScope',
          options: { includeContextMeta: false, columnsMode: 'canonical' },
        } as never,
        user,
      );

      const parsed = JSON.parse(exported.content) as Record<string, unknown>;
      expect(parsed).toHaveProperty('schemaVersion', 1);
      expect(parsed).toHaveProperty('items');
      expect(parsed).not.toHaveProperty('meta');
    });

    it('rejects metadata export preflight when projected payload estimate exceeds guardrail', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser();
      libraryService.findAll.mockResolvedValue([{ id: 1, name: 'Main' }]);
      queryBuilder.buildWhere.mockReturnValue('WHERE_CLAUSE' as never);
      bookRepo.countWhere.mockResolvedValue(100000);

      await expect(
        service.getMetadataExportPreflight(
          {
            query: { libraryId: 1 },
            format: 'json',
            viewType: 'library',
            options: { includeFilePaths: true, includePersonalData: true },
          } as never,
          user,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('export concurrency slots', () => {
    it('enforces max concurrent exports per user', () => {
      const { service } = makeService();
      const releaseOne = service.acquireExportSlot(7);
      const releaseTwo = service.acquireExportSlot(7);

      expect(() => service.acquireExportSlot(7)).toThrow();

      releaseOne();
      const releaseThree = service.acquireExportSlot(7);
      releaseTwo();
      releaseThree();
    });
  });

  describe('access + file/cover helpers', () => {
    it('throws NotFoundException when verifying file access for missing file', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findFileById.mockResolvedValue(null);

      await expect(service.verifyFileAccess(99, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('returns cover path with custom cover preferred over extracted cover', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_custom.png'] as never);

      const result = await service.getCoverPath(9, makeUser());

      expect(result).toBe('/tmp/books/covers/9/cover_custom.png');
    });

    it('returns null cover path when cover directory cannot be read', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      const missingError = Object.assign(new Error('missing'), { code: 'ENOENT' });
      mockReaddir.mockRejectedValue(missingError);

      await expect(service.getCoverPath(9, makeUser())).resolves.toBeNull();
    });

    it('throws when cover directory lookup fails for non-missing errors', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      mockReaddir.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

      await expect(service.getCoverPath(9, makeUser())).rejects.toThrow('permission denied');
    });

    it('returns thumbnail path only when file is accessible', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      mockAccess.mockResolvedValue(undefined);

      await expect(service.getThumbnailPath(9, makeUser())).resolves.toBe('/tmp/books/covers/9/thumbnail.jpg');

      mockAccess.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
      await expect(service.getThumbnailPath(9, makeUser())).resolves.toBeNull();
    });

    it('throws when thumbnail access fails for non-missing errors', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      mockAccess.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

      await expect(service.getThumbnailPath(9, makeUser())).rejects.toThrow('permission denied');
    });

    it('returns file info with unknown format fallback', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findFileById.mockResolvedValue({ id: 10, absolutePath: '/books/test.book', format: null, bookId: 1, libraryId: 7 });
      mockStat.mockResolvedValue({ size: 1234 } as never);

      const result = await service.getFileInfo(10, makeUser());

      expect(result).toEqual({
        path: '/books/test.book',
        size: 1234,
        format: 'unknown',
        bookId: 1,
        originalFilename: 'test.book',
      });
    });

    it('throws NotFoundException when file exists in DB but is missing on disk', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findFileById.mockResolvedValue({ id: 10, absolutePath: '/books/missing.book', format: null, bookId: 1, libraryId: 7 });
      mockStat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await expect(service.getFileInfo(10, makeUser())).rejects.toThrow(NotFoundException);
    });
  });

  describe('metadata refresh + update', () => {
    it('refreshMetadata preview returns resolved fields without mutating metadata', async () => {
      const { service, bookRepo, libraryService, pipeline, metadataService } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: {
            title: 'Old Title',
            subtitle: null,
            description: null,
            publisher: null,
            publishedYear: null,
            language: null,
            pageCount: null,
            seriesName: null,
            seriesIndex: null,
            coverSource: 'extracted',
            isbn13: '978123',
            isbn10: null,
            googleBooksId: 'g-id',
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: 'ol-id',
          },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({ resolved: { title: 'New Title' }, sources: {}, providerIds: {} });
      const updateSpy = vi.spyOn(service, 'updateMetadata');

      const result = await service.refreshMetadata(1, true, user);

      expect(result).toEqual({ title: 'New Title' });
      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 7, false);
      expect(pipeline.runWithSources).toHaveBeenCalledWith(
        {
          title: 'Old Title',
          author: 'Author One',
          isbn: '978123',
          existingProviderIds: {
            [MetadataProviderKey.GOOGLE]: 'g-id',
            [MetadataProviderKey.OPEN_LIBRARY]: 'ol-id',
          },
          isAudiobook: false,
          maxCandidatesPerProvider: 1,
        },
        {
          title: 'Old Title',
          subtitle: null,
          description: null,
          authors: ['Author One'],
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          seriesName: null,
          seriesIndex: null,
          genres: [],
          cover: 'extracted',
          duration: undefined,
          abridged: undefined,
        },
        7,
      );
      expect(updateSpy).not.toHaveBeenCalled();
      expect(metadataService.downloadAndSaveCover).not.toHaveBeenCalled();
    });

    it('refreshMetadata updates mapped fields and downloads cover when provided', async () => {
      const { service, bookRepo, pipeline, metadataService } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: { title: 'Resolved', authors: ['A'], genres: ['G'], coverUrl: 'https://img/c.jpg' },
        sources: {},
        providerIds: {},
      });

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({
        book: { id: 1 },
        write: null,
        libraryAutoWriteEnabled: false,
      } as never);
      const getDetailSpy = vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 1, title: 'Final' } as never);

      const result = await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(1, { title: 'Resolved', authors: ['A'], genres: ['G'] }, user, { postSaveMode: 'schedule' });
      expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith('https://img/c.jpg', 1);
      expect(getDetailSpy).toHaveBeenCalledWith(1, user);
      expect(result).toEqual({ id: 1, title: 'Final' });
    });

    it('refreshMetadata preview includes provider ids returned by pipeline', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: { title: 'Resolved' },
        sources: {},
        providerIds: {
          [MetadataProviderKey.GOOGLE]: 'g-id',
          [MetadataProviderKey.OPEN_LIBRARY]: 'ol-id',
        },
      });

      const result = await service.refreshMetadata(1, true, user);

      expect(result).toEqual({
        title: 'Resolved',
        googleBooksId: 'g-id',
        openLibraryId: 'ol-id',
      });
    });

    it('refreshMetadata preview nests audiobook fields under audioMetadata', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: {
          title: 'Resolved',
          narrators: ['Narrator One'],
          duration: 3600,
          abridged: true,
          chapters: [{ title: 'Chapter 1', startMs: 0 }],
        },
        sources: {},
        providerIds: {},
      });

      const result = await service.refreshMetadata(1, true, user);

      expect(result).toEqual({
        title: 'Resolved',
        audioMetadata: {
          narrators: ['Narrator One'],
          durationSeconds: 3600,
          abridged: true,
          chapters: [{ title: 'Chapter 1', startMs: 0 }],
        },
      });
      expect((result as Record<string, unknown>).narrators).toBeUndefined();
      expect((result as Record<string, unknown>).duration).toBeUndefined();
      expect((result as Record<string, unknown>).abridged).toBeUndefined();
      expect((result as Record<string, unknown>).chapters).toBeUndefined();
    });

    it('refreshMetadata persists provider ids returned by pipeline', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: { title: 'Resolved' },
        sources: {},
        providerIds: {
          [MetadataProviderKey.GOOGLE]: 'g-id',
          [MetadataProviderKey.OPEN_LIBRARY]: 'ol-id',
        },
      });

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({
        book: { id: 1 },
        write: null,
        libraryAutoWriteEnabled: false,
      } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(
        1,
        {
          title: 'Resolved',
          googleBooksId: 'g-id',
          openLibraryId: 'ol-id',
        },
        user,
        { postSaveMode: 'schedule' },
      );
    });

    it('refreshMetadata persists audiobook fields under audioMetadata', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: {
          title: 'Resolved',
          narrators: ['Narrator One'],
          duration: 3600,
          abridged: false,
          chapters: [{ title: 'Chapter 1', startMs: 0 }],
        },
        sources: {},
        providerIds: {},
      });

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({
        book: { id: 1 },
        write: null,
        libraryAutoWriteEnabled: false,
      } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(
        1,
        {
          title: 'Resolved',
          audioMetadata: {
            narrators: ['Narrator One'],
            durationSeconds: 3600,
            abridged: false,
            chapters: [{ title: 'Chapter 1', startMs: 0 }],
          },
        },
        user,
        { postSaveMode: 'schedule' },
      );
    });

    it('refreshMetadata persists comic metadata returned by pipeline', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: {
          title: 'Resolved',
          comicMetadata: {
            issueNumber: '12',
            volumeName: 'Arkham Asylum',
            pencillers: ['Jock'],
          },
        },
        sources: {},
        providerIds: {},
      });

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({
        book: { id: 1 },
        write: null,
        libraryAutoWriteEnabled: false,
      } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(
        1,
        {
          title: 'Resolved',
          comicMetadata: {
            issueNumber: '12',
            volumeName: 'Arkham Asylum',
            pencillers: ['Jock'],
          },
        },
        user,
        { postSaveMode: 'schedule' },
      );
    });

    it('refreshMetadata skips locked automated fields and cover mutations', async () => {
      const { service, bookRepo, pipeline, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: {
          books: { id: 1, libraryId: 7 },
          book_metadata: { title: 'Old', isbn13: null, isbn10: null },
        },
        authorRows: [{ id: 1, name: 'Author One', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockResolvedValue({
        resolved: { title: 'Resolved', authors: ['A'], coverUrl: 'https://img/c.jpg' },
        sources: {},
        providerIds: {
          [MetadataProviderKey.GOOGLE]: 'g-id',
        },
      });
      bookMetadataLockService.filterResolvedMetadata.mockResolvedValue({
        resolved: { authors: ['A'] },
        providerIds: {},
        skippedFields: ['title', 'cover', 'googleBooksId'],
      });

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({
        book: { id: 1 },
        write: null,
        libraryAutoWriteEnabled: false,
      } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(1, { authors: ['A'] }, user, { postSaveMode: 'schedule' });
      expect(metadataService.downloadAndSaveCover).not.toHaveBeenCalled();
    });

    it('updateMetadata writes scalar fields, syncs enabled file write and rename, and triggers embedding', async () => {
      const { service, bookRepo, metadataService, embedder, fileWriteService, fileRenameService } = makeService();
      const user = makeUser();
      const verifySpy = vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      const detailSpy = vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);
      fileWriteService.findLibraryWriteSettingsForBook.mockResolvedValue({ fileWriteEnabled: true, fileRenameEnabled: true });
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 12 });
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 8, oldPath: '/old', newPath: '/new' });

      const result = await service.updateMetadata(
        5,
        {
          title: null,
          rating: 4,
          authors: ['A1', 'A2'],
          genres: ['Sci-Fi'],
          tags: ['favorite'],
        },
        user,
        { postSaveMode: 'sync' },
      );

      expect(verifySpy).toHaveBeenCalledWith(5, user);
      expect(bookRepo.withTransaction).toHaveBeenCalledTimes(1);
      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          title: null,
          updatedAt: expect.any(Date),
        }),
        expect.anything(),
      );
      expect(bookRepo.bulkSetRating).toHaveBeenCalledWith([5], 4, user.id);
      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(
        5,
        [
          { name: 'A1', sortName: null },
          { name: 'A2', sortName: null },
        ],
        { executor: expect.anything(), emitEvent: false },
      );
      expect(metadataService.replaceGenres).toHaveBeenCalledWith(5, ['Sci-Fi'], { executor: expect.anything() });
      expect(metadataService.replaceTags).toHaveBeenCalledWith(5, ['favorite'], { executor: expect.anything() });
      expect(metadataService.emitAuthorsReplaced).toHaveBeenCalledWith(5, []);
      expect(fileWriteService.cancelPendingWrite).toHaveBeenCalledWith(5);
      expect(fileRenameService.cancelPendingRename).toHaveBeenCalledWith(5);
      expect(fileWriteService.writeToFile).toHaveBeenCalledWith(5, 'sync', user.id, false, false, true);
      expect(fileRenameService.performRename).toHaveBeenCalledWith(5, user.id, false, true);
      expect(fileWriteService.scheduleWrite).not.toHaveBeenCalled();
      expect(fileRenameService.scheduleRename).not.toHaveBeenCalled();
      expect(embedder.embedBook).toHaveBeenCalledWith(5);
      expect(detailSpy).toHaveBeenCalledWith(5, user);
      expect(result).toEqual({
        book: { id: 5 },
        write: { status: 'success', fieldsWritten: ['title'], durationMs: 12 },
        libraryAutoWriteEnabled: true,
      });
    });

    it('updateMetadata keeps the saved metadata response when sync file write settings lookup fails', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5, title: 'Saved Title' } as never);
      const warnSpy = vi.spyOn((service as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
      fileWriteService.findLibraryWriteSettingsForBook.mockRejectedValue(new Error('settings db unavailable'));

      const result = await service.updateMetadata(5, { title: 'Saved Title' }, user, { postSaveMode: 'sync' });

      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          title: 'Saved Title',
          updatedAt: expect.any(Date),
        }),
        expect.anything(),
      );
      expect(fileWriteService.cancelPendingWrite).toHaveBeenCalledWith(5);
      expect(fileRenameService.cancelPendingRename).toHaveBeenCalledWith(5);
      expect(fileWriteService.writeToFile).not.toHaveBeenCalled();
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[book.update_metadata_file_write_settings] [fail] bookId=5'));
      expect(result).toEqual({
        book: { id: 5, title: 'Saved Title' },
        write: expect.objectContaining({
          status: 'failed',
          fieldsWritten: [],
          reason: 'file write settings unavailable',
        }),
        libraryAutoWriteEnabled: false,
      });
      warnSpy.mockRestore();
    });

    it('updateMetadata rejects manual writes to locked fields', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      const error = new ConflictException('Metadata fields are locked: title');
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookMetadataLockService.assertManualUpdateAllowed.mockRejectedValue(error);

      await expect(service.updateMetadata(5, { title: 'Locked Title' }, user)).rejects.toThrow(error);

      expect(bookRepo.withTransaction).not.toHaveBeenCalled();
    });

    it('updateMetadataAndLocks persists edited metadata and final locks in one transaction', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      const tx = { id: 'tx-locks' };
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5, lockedFields: ['goodreadsId'] } as never);
      bookRepo.withTransaction.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
      bookMetadataLockService.replaceLockedFields.mockResolvedValue(['goodreadsId']);

      const result = await service.updateMetadataAndLocks(
        5,
        {
          metadata: { goodreadsId: 'manual-goodreads-id' },
          lockedFields: ['goodreadsId'],
        },
        user,
      );

      expect(bookMetadataLockService.assertManualUpdateAllowedForLockTransition).toHaveBeenCalledWith(5, { goodreadsId: 'manual-goodreads-id' }, [
        'goodreadsId',
      ]);
      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          goodreadsId: 'manual-goodreads-id',
          updatedAt: expect.any(Date),
        }),
        tx,
      );
      expect(bookMetadataLockService.replaceLockedFields).toHaveBeenCalledWith(5, ['goodreadsId'], tx);
      expect(result).toEqual({ book: { id: 5, lockedFields: ['goodreadsId'] }, write: null, libraryAutoWriteEnabled: false });
    });

    it('updateMetadataAndLocks rejects fields locked before and after without opening a transaction', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      const error = new ConflictException('Metadata fields are locked: title');
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookMetadataLockService.assertManualUpdateAllowedForLockTransition.mockRejectedValue(error);

      await expect(
        service.updateMetadataAndLocks(
          5,
          {
            metadata: { title: 'Blocked Title' },
            lockedFields: ['title'],
          },
          user,
        ),
      ).rejects.toThrow(error);

      expect(bookRepo.withTransaction).not.toHaveBeenCalled();
      expect(bookMetadataLockService.replaceLockedFields).not.toHaveBeenCalled();
    });

    it('updateMetadataAndLocks can persist locks without scheduling metadata side effects', async () => {
      const { service, bookRepo, bookMetadataLockService, embedder, fileWriteService, fileRenameService, scoreService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5, lockedFields: ['title'] } as never);
      bookMetadataLockService.replaceLockedFields.mockResolvedValue(['title']);

      await service.updateMetadataAndLocks(5, { metadata: {}, lockedFields: ['title'] }, user);

      expect(bookRepo.updateMetadataFields).not.toHaveBeenCalled();
      expect(bookMetadataLockService.replaceLockedFields).toHaveBeenCalledWith(5, ['title'], expect.anything());
      expect(embedder.embedBook).not.toHaveBeenCalled();
      expect(fileWriteService.scheduleWrite).not.toHaveBeenCalled();
      expect(fileWriteService.writeToFile).not.toHaveBeenCalled();
      expect(fileRenameService.scheduleRename).not.toHaveBeenCalled();
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
      expect(scoreService.calculateAndSave).not.toHaveBeenCalled();
    });

    it('updateMetadata does not clear omitted scalar fields on transformed dto instances', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      const dto = new UpdateBookMetadataDto();
      dto.publisher = 'Allowed Publisher';

      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(5, dto, user);

      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          publisher: 'Allowed Publisher',
          updatedAt: expect.any(Date),
        }),
        expect.anything(),
      );
      expect(bookRepo.updateMetadataFields).not.toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          title: null,
        }),
        expect.anything(),
      );
    });

    it('updateMetadata applies single-field title patch without touching other fields', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      const dto = new UpdateBookMetadataDto();
      dto.title = 'Inline Edit Title';
      await service.updateMetadata(5, dto, user);

      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(5, expect.objectContaining({ title: 'Inline Edit Title' }), expect.anything());
      expect(bookRepo.updateMetadataFields).not.toHaveBeenCalledWith(
        5,
        expect.objectContaining({ seriesName: expect.anything() }),
        expect.anything(),
      );
    });

    it('updateMetadata applies single-field seriesName and seriesIndex patch', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      const dto = new UpdateBookMetadataDto();
      dto.seriesName = 'Dune Saga';
      dto.seriesIndex = 2;
      await service.updateMetadata(5, dto, user);

      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ seriesName: 'Dune Saga', seriesIndex: 2 }),
        expect.anything(),
      );
    });

    it('updateMetadata applies single-field language patch', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      const dto = new UpdateBookMetadataDto();
      dto.language = 'fr';
      await service.updateMetadata(5, dto, user);

      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(5, expect.objectContaining({ language: 'fr' }), expect.anything());
    });

    it('updateMetadata clears rating to null', async () => {
      const { service, bookRepo, achievementEvents } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(5, { rating: null }, user);

      expect(bookRepo.bulkSetRating).toHaveBeenCalledWith([5], null, user.id);
      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, {
        userId: user.id,
        bookIds: [5],
        rating: null,
      });
    });

    it('updateMetadata emits rating changed event when rating is updated', async () => {
      const { service, achievementEvents } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(5, { rating: 4 }, user);

      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, {
        userId: user.id,
        bookIds: [5],
        rating: 4,
      });
    });

    it('updateMetadata replaces genres array only', async () => {
      const { service, metadataService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(5, { genres: ['Fantasy', 'Adventure'] }, user);

      expect(metadataService.replaceGenres).toHaveBeenCalledWith(5, ['Fantasy', 'Adventure'], expect.anything());
      expect(metadataService.replaceAuthors).not.toHaveBeenCalled();
      expect(metadataService.replaceTags).not.toHaveBeenCalled();
    });

    it('updateMetadata replaces tags array only', async () => {
      const { service, metadataService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(5, { tags: ['favorite', 'to-read'] }, user);

      expect(metadataService.replaceTags).toHaveBeenCalledWith(5, ['favorite', 'to-read'], expect.anything());
      expect(metadataService.replaceAuthors).not.toHaveBeenCalled();
      expect(metadataService.replaceGenres).not.toHaveBeenCalled();
    });

    it('updateMetadataLocks replaces lock state and returns updated detail', async () => {
      const { service, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      const detailSpy = vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5, lockedFields: ['title'] } as never);
      bookMetadataLockService.replaceLockedFields.mockResolvedValue(['title']);

      const result = await service.updateMetadataLocks(5, ['title', 'title'], user);

      expect(bookMetadataLockService.replaceLockedFields).toHaveBeenCalledWith(5, ['title', 'title']);
      expect(detailSpy).toHaveBeenCalledWith(5, user);
      expect(result).toEqual({ id: 5, lockedFields: ['title'] });
    });
  });

  describe('kobo and batch behavior', () => {
    it('returns not-eligible kobo state when user lacks kobo_sync permission', async () => {
      const { service } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);

      const result = await service.getKoboState(10, user);

      expect(result).toEqual({
        eligibleForKoboSync: false,
        syncCollections: [],
        readingState: null,
        snapshot: null,
      });
    });

    it('normalizes kobo provider payload and clamps progress', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser({ permissions: ['kobo_sync'] } as never);
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findKoboReadingState.mockResolvedValue({
        currentBookmark: { ProgressPercent: 130 },
        statusInfo: { Status: 'Reading' },
        createdAtKobo: 'created',
        lastModifiedKobo: 'updated',
        priorityTimestamp: 'priority',
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      bookRepo.findKoboSnapshotState.mockResolvedValue({
        snapshotId: 99,
        snapshotUpdatedAt: new Date('2026-01-03T00:00:00.000Z'),
        synced: true,
        pendingDelete: false,
        isNew: false,
        removedByDevice: false,
        fileHash: 'fhash',
        metadataHash: 'mhash',
      });
      bookRepo.findKoboSyncCollectionNamesForBook.mockResolvedValue(['Favorites']);

      const result = await service.getKoboState(10, user);

      expect(result.eligibleForKoboSync).toBe(true);
      expect(result.readingState?.progressPercent).toBe(100);
      expect(result.readingState?.status).toBe('Reading');
      expect(result.snapshot?.snapshotId).toBe(99);
    });

    it('bulkReExtractCover reports progress for every processed book file, including unchanged covers', async () => {
      const { service, bookRepo, libraryService, metadataService } = makeService();
      const user = makeUser();
      const onProgress = vi.fn();

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([
        { bookId: 1, absolutePath: '/books/1.epub', format: 'epub' },
        { bookId: 2, absolutePath: '/books/2.epub', format: 'epub' },
      ]);
      metadataService.refreshCoverForBook.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await service.bulkReExtractCover([1, 2], user, onProgress);

      expect(result).toEqual({ processed: 2, updated: 1 });
      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 7, false);
      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2);
    });

    it('stops bulk cover extraction when progress callback throws', async () => {
      const { service, bookRepo, metadataService } = makeService();
      const user = makeUser();

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([
        { bookId: 1, absolutePath: '/books/1.epub', format: 'epub' },
        { bookId: 2, absolutePath: '/books/2.epub', format: 'epub' },
      ]);
      metadataService.refreshCoverForBook.mockResolvedValue(true);

      const onProgress = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('stream closed');
        })
        .mockImplementation(() => undefined);

      const result = await service.bulkReExtractCover([1, 2], user, onProgress);

      expect(result).toEqual({ processed: 1, updated: 1 });
      expect(metadataService.refreshCoverForBook).toHaveBeenCalledTimes(1);
    });

    it('bulkReExtractCover skips locked cover mutations', async () => {
      const { service, bookRepo, bookMetadataLockService, metadataService } = makeService();
      const user = makeUser();
      const onProgress = vi.fn();

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/1.epub', format: 'epub' }]);
      bookMetadataLockService.getCoverLockedBookIds.mockResolvedValue(new Set([1]));

      await expect(service.bulkReExtractCover([1], user, onProgress)).resolves.toEqual({ processed: 0, updated: 0 });

      expect(bookMetadataLockService.getCoverLockedBookIds).toHaveBeenCalledWith([1]);
      expect(metadataService.refreshCoverForBook).not.toHaveBeenCalled();
      expect(onProgress).not.toHaveBeenCalled();
    });

    it('stops bulk metadata refresh when cancelled', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      const refreshSpy = vi.spyOn(service, 'refreshMetadata').mockResolvedValue({ id: 1 } as never);
      const onProgress = vi.fn();

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);

      const result = await service.bulkRefreshMetadata([1, 2, 3], user, onProgress, {
        isCancelled: () => refreshSpy.mock.calls.length > 0,
      });

      expect(result).toEqual({ processed: 1, failed: 0 });
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it('stops bulk metadata refresh when progress callback throws', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      const refreshSpy = vi.spyOn(service, 'refreshMetadata').mockResolvedValue({ id: 1 } as never);

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);

      const onProgress = vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error('stream closed');
        })
        .mockImplementation(() => undefined);

      const result = await service.bulkRefreshMetadata([1, 2], user, onProgress);

      expect(result).toEqual({ processed: 1, failed: 0 });
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledTimes(1);
    });

    it('deleteBooks verifies access, removes book files, and removes cover directories without failing on rm errors', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser();
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();

      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([
        { id: 3, libraryId: 7 },
        { id: 4, libraryId: 9 },
      ]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue([
        { bookId: 3, absolutePath: '/tmp/library/book3.epub', format: 'epub' },
        { bookId: 4, absolutePath: '/tmp/library/book4.pdf', format: 'pdf' },
      ]);
      bookRepo.deleteByIds.mockResolvedValue(undefined);
      mockRm.mockRejectedValue(new Error('cannot delete'));

      await service.deleteBooks([3, 4], user);

      expect(libraryService.verifyUserAccess).toHaveBeenCalledTimes(2);
      expect(bookRepo.deleteByIds).toHaveBeenCalledWith([3, 4]);
      expect(mockRm).toHaveBeenCalledWith('/tmp/books/covers/3', { recursive: true, force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/books/covers/4', { recursive: true, force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/library/book3.epub', { force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/library/book4.pdf', { force: true });
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns queued=0 when embed-all is already running', async () => {
      const { service, bookRepo, embedder } = makeService();
      let resolveEmbed: (() => void) | null = null;

      bookRepo.findAllIds.mockResolvedValue([11]);
      embedder.embedBook.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveEmbed = resolve;
          }),
      );

      await expect(service.embedAll()).resolves.toEqual({ queued: 1 });
      await expect(service.embedAll()).resolves.toEqual({ queued: 0 });

      resolveEmbed?.();
      await Promise.resolve();
    });
  });

  // ── AUDIO PROGRESS ─────────────────────────────────────────────────────────

  describe('getAudioProgress', () => {
    it('returns latest audio progress from repo', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      const progressRow = { fileId: 5, positionSeconds: 1234, updatedAt: new Date().toISOString() };

      bookRepo.findLibraryIdByBookId = vi.fn().mockResolvedValue(1);
      bookRepo.findAudioProgress = vi.fn().mockResolvedValue(progressRow);

      const result = await service.getAudioProgress(user.id, 10, user);
      expect(result).toBe(progressRow);
      expect(bookRepo.findAudioProgress).toHaveBeenCalledWith(user.id, 10);
    });

    it('throws NotFoundException when book does not exist', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      bookRepo.findLibraryIdByBookId = vi.fn().mockResolvedValue(null);

      await expect(service.getAudioProgress(user.id, 99, user)).rejects.toThrow();
    });
  });

  describe('getBookProgress', () => {
    it('returns one row per file with defaults for missing progress', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findProgressByBook.mockResolvedValue([
        {
          fileId: 10,
          cfi: null,
          pageNumber: null,
          percentage: null,
          updatedAt: null,
        },
        {
          fileId: 11,
          cfi: 'epubcfi(/6/4)',
          pageNumber: 12,
          percentage: 45,
          updatedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
      ]);

      const result = await service.getBookProgress(user.id, 99, user);

      expect(bookRepo.findProgressByBook).toHaveBeenCalledWith(user.id, 99);
      expect(result).toEqual([
        {
          fileId: 10,
          cfi: null,
          pageNumber: null,
          percentage: 0,
          updatedAt: null,
        },
        {
          fileId: 11,
          cfi: 'epubcfi(/6/4)',
          pageNumber: 12,
          percentage: 45,
          updatedAt: new Date('2026-01-04T00:00:00.000Z'),
        },
      ]);
    });
  });

  describe('saveProgress — positionSeconds', () => {
    it('passes positionSeconds from DTO to repo', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser();

      bookRepo.findFileById.mockResolvedValue({ id: 7, bookId: 10, libraryId: 1, absolutePath: '/books/a.m4b', format: 'm4b' });
      bookRepo.upsertProgress.mockResolvedValue(undefined);
      libraryService.verifyUserAccess.mockResolvedValue(undefined);
      libraryService.findOne = vi.fn().mockResolvedValue(null);

      await service.saveProgress(user.id, 7, { percentage: 25, positionSeconds: 900 } as never, user);

      expect(bookRepo.upsertProgress).toHaveBeenCalledWith(user.id, 7, null, null, 25, 900);
    });

    it('passes null positionSeconds when not provided in DTO', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser();

      bookRepo.findFileById.mockResolvedValue({ id: 8, bookId: 11, libraryId: 2, absolutePath: '/books/b.epub', format: 'epub' });
      bookRepo.upsertProgress.mockResolvedValue(undefined);
      libraryService.verifyUserAccess.mockResolvedValue(undefined);
      libraryService.findOne = vi.fn().mockResolvedValue(null);

      await service.saveProgress(user.id, 8, { percentage: 50 } as never, user);

      expect(bookRepo.upsertProgress).toHaveBeenCalledWith(user.id, 8, null, null, 50, null);
    });
  });

  describe('clearFileProgress', () => {
    it('verifies file access and clears file-scoped progress rows', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser({ id: 12 });
      vi.spyOn(service, 'verifyFileAccess').mockResolvedValue({
        id: 88,
        absolutePath: '/books/sample.epub',
        format: 'epub',
        bookId: 77,
        libraryId: 5,
      });

      await service.clearFileProgress(user.id, 88, user);

      expect(service.verifyFileAccess).toHaveBeenCalledWith(88, user);
      expect(bookRepo.clearFileProgress).toHaveBeenCalledWith(user.id, 88);
    });
  });

  describe('saveAudioProgress', () => {
    it('writes audio progress when current file belongs to the target book', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser({ id: 21 });

      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      bookRepo.findFileById.mockResolvedValue({
        id: 7,
        absolutePath: '/books/audiobook-1.mp3',
        format: 'mp3',
        bookId: 10,
        libraryId: 1,
      });
      libraryService.verifyUserAccess.mockResolvedValue(undefined);
      libraryService.findOne = vi.fn().mockResolvedValue(null);

      await service.saveAudioProgress(
        user.id,
        10,
        {
          percentage: 33,
          currentFileId: 7,
          positionSeconds: 120,
        },
        user,
      );

      expect(bookRepo.upsertAudioProgress).toHaveBeenCalledWith(user.id, 10, 7, 120, 33);
    });

    it('throws BadRequestException when current file belongs to a different book', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser({ id: 21 });

      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      bookRepo.findFileById.mockResolvedValue({
        id: 8,
        absolutePath: '/books/audiobook-2.mp3',
        format: 'mp3',
        bookId: 99,
        libraryId: 1,
      });
      libraryService.verifyUserAccess.mockResolvedValue(undefined);

      await expect(
        service.saveAudioProgress(
          user.id,
          10,
          {
            percentage: 40,
            currentFileId: 8,
            positionSeconds: 90,
          },
          user,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(bookRepo.upsertAudioProgress).not.toHaveBeenCalled();
    });

    it('propagates ForbiddenException when current file is in an inaccessible library', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser({ id: 21 });

      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      bookRepo.findFileById.mockResolvedValue({
        id: 9,
        absolutePath: '/books/secret.mp3',
        format: 'mp3',
        bookId: 10,
        libraryId: 2,
      });
      libraryService.verifyUserAccess.mockImplementation((_userId: number, libraryId: number) => {
        if (libraryId === 2) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      });

      await expect(
        service.saveAudioProgress(
          user.id,
          10,
          {
            percentage: 20,
            currentFileId: 9,
            positionSeconds: 44,
          },
          user,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(bookRepo.upsertAudioProgress).not.toHaveBeenCalled();
    });
  });

  describe('query, pagination, and read-state delegates', () => {
    it('queryForLibrary verifies access and returns paged cards', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 42 });
      queryBuilder.buildWhere.mockReturnValue('WHERE' as never);
      queryBuilder.buildOrderBy.mockReturnValue(['ORDER'] as never);
      bookRepo.findCards.mockResolvedValue({
        rows: [
          {
            id: 10,
            status: 'present',
            primaryFileId: 1,
            folderPath: '/books/dune',
            addedAt: new Date('2026-01-01T00:00:00.000Z'),
            title: 'Dune',
            seriesName: null,
            seriesIndex: null,
            publishedYear: null,
            language: null,
            rating: null,
          },
        ],
        authorRows: [{ bookId: 10, name: 'Frank Herbert' }],
        fileRows: [{ bookId: 10, id: 1, format: 'epub', role: 'primary' }],
        genreRows: [{ bookId: 10, name: 'Sci-Fi' }],
        progressRows: [{ bookFileId: 1, percentage: 10 }],
        statusRows: [],
        total: 1,
      });

      const result = await service.queryForLibrary(user, 7, {
        filter: null,
        sort: [],
        pagination: { page: 1, size: 5 },
      } as never);

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(42, 7, false);
      expect(bookRepo.findCards).toHaveBeenCalledWith({
        where: 'WHERE',
        orderBy: ['ORDER'],
        limit: 5,
        offset: 5,
        userId: 42,
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.size).toBe(5);
      expect(result.items).toHaveLength(1);
    });

    it('queryForLibrary routes to findCardsCollapsed when collapseSeries is true', async () => {
      const { service, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 5 });
      queryBuilder.buildWhere.mockReturnValue('WHERE' as never);
      bookRepo.findCardsCollapsed.mockResolvedValue({
        rows: [
          {
            id: 20,
            status: 'present',
            primaryFileId: null,
            folderPath: '/books/series-rep',
            addedAt: new Date('2024-01-01T00:00:00.000Z'),
            title: 'First Book',
            seriesName: 'The Arc',
            seriesIndex: 1,
            publishedYear: null,
            language: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
            bookCount: 3,
            readCount: 1,
            coverBookIds: [20],
            seriesLatestAddedAt: new Date('2024-06-01T00:00:00.000Z'),
          },
        ],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 1,
      });

      const result = await service.queryForLibrary(user, 2, {
        filter: null,
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 20 },
        collapseSeries: true,
      } as never);

      expect(bookRepo.findCardsCollapsed).toHaveBeenCalledWith({
        where: 'WHERE',
        sort: [{ field: 'title', dir: 'asc' }],
        limit: 20,
        offset: 0,
        userId: 5,
      });
      expect(bookRepo.findCards).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.items[0]!.collapsedSeries).toBeDefined();
      expect(result.items[0]!.collapsedSeries!.bookCount).toBe(3);
    });

    it('queryForLibrary uses normal findCards when collapseSeries is false', async () => {
      const { service, queryBuilder, bookRepo } = makeService();
      queryBuilder.buildWhere.mockReturnValue('WHERE' as never);
      queryBuilder.buildOrderBy.mockReturnValue(['ORDER'] as never);
      bookRepo.findCards.mockResolvedValue({
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      });

      await service.queryForLibrary(makeUser(), 1, {
        filter: null,
        sort: [],
        pagination: { page: 0, size: 10 },
        collapseSeries: false,
      } as never);

      expect(bookRepo.findCardsCollapsed).not.toHaveBeenCalled();
      expect(bookRepo.findCards).toHaveBeenCalled();
    });

    it('queryForLibrary auto-disables collapse when a series filter is active', async () => {
      const { service, queryBuilder, bookRepo } = makeService();
      queryBuilder.buildWhere.mockReturnValue('WHERE' as never);
      queryBuilder.buildOrderBy.mockReturnValue(['ORDER'] as never);
      bookRepo.findCards.mockResolvedValue({
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      });

      const filterWithSeries = {
        type: 'group',
        join: 'AND',
        rules: [{ type: 'rule', field: 'series', operator: 'contains', value: 'Dune' }],
      };

      await service.queryForLibrary(makeUser(), 1, {
        filter: filterWithSeries,
        sort: [],
        pagination: { page: 0, size: 10 },
        collapseSeries: true,
      } as never);

      expect(bookRepo.findCardsCollapsed).not.toHaveBeenCalled();
      expect(bookRepo.findCards).toHaveBeenCalled();
    });

    it('globalQuery routes to findCardsCollapsed when collapseSeries is true', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 3 });
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      queryBuilder.buildWhere.mockReturnValue('GLOBAL_WHERE' as never);
      bookRepo.findCardsCollapsed.mockResolvedValue({
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      });

      await service.globalQuery(user, {
        filter: null,
        sort: [],
        pagination: { page: 0, size: 10 },
        collapseSeries: true,
      } as never);

      expect(bookRepo.findCardsCollapsed).toHaveBeenCalledWith(expect.objectContaining({ userId: 3 }));
      expect(bookRepo.findCards).not.toHaveBeenCalled();
    });

    it('globalQuery auto-disables collapse when a series filter is active', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 1 }]);
      queryBuilder.buildWhere.mockReturnValue('WHERE' as never);
      queryBuilder.buildOrderBy.mockReturnValue(['ORDER'] as never);
      bookRepo.findCards.mockResolvedValue({
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      });

      const filterWithSeries = {
        type: 'group',
        join: 'AND',
        rules: [{ type: 'rule', field: 'series', operator: 'equals', value: 'Mistborn' }],
      };

      await service.globalQuery(makeUser(), {
        filter: filterWithSeries,
        sort: [],
        pagination: { page: 0, size: 10 },
        collapseSeries: true,
      } as never);

      expect(bookRepo.findCardsCollapsed).not.toHaveBeenCalled();
      expect(bookRepo.findCards).toHaveBeenCalled();
    });

    it('globalQuery throws when pagination window exceeds configured limit', async () => {
      const { service } = makeService();

      await expect(
        service.globalQuery(makeUser(), {
          filter: null,
          sort: [],
          pagination: { page: 9_999_999, size: 9_999_999 },
        } as never),
      ).rejects.toThrow(BadRequestException);
    });

    it('globalQuery uses accessible libraries and assembled cards', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAll.mockResolvedValue([{ id: 3 }, { id: 4 }]);
      queryBuilder.buildWhere.mockReturnValue('GLOBAL_WHERE' as never);
      queryBuilder.buildOrderBy.mockReturnValue(['GLOBAL_ORDER'] as never);
      bookRepo.findCards.mockResolvedValue({
        rows: [],
        authorRows: [],
        fileRows: [],
        genreRows: [],
        progressRows: [],
        statusRows: [],
        total: 0,
      });

      await service.globalQuery(user, { filter: null, sort: [], pagination: { page: 0, size: 10 } } as never);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(null, {
        accessibleLibraryIds: [3, 4],
        userId: 7,
        timeZone: 'UTC',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
        q: undefined,
      });
      expect(bookRepo.findCards).toHaveBeenCalledWith({
        where: 'GLOBAL_WHERE',
        orderBy: ['GLOBAL_ORDER'],
        limit: 10,
        offset: 0,
        userId: 7,
      });
    });

    it('delegates getProgress to repository', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser({ id: 77 });
      vi.spyOn(service, 'verifyFileAccess').mockResolvedValue({ id: 1 } as never);
      bookRepo.findProgress.mockResolvedValue({ percentage: 12 });

      await expect(service.getProgress(user.id, 1, user)).resolves.toEqual({ percentage: 12 });

      expect(bookRepo.findProgress).toHaveBeenCalledWith(77, 1);
    });

    describe('setReadStatus', () => {
      it('requires at least one updatable field', async () => {
        const { service } = makeService();
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);

        await expect(service.setReadStatus(10, {} as never, makeUser())).rejects.toThrow(
          'At least one of status, startedAt, or finishedAt is required',
        );
      });

      it('updates status only and returns canonical date-only payload', async () => {
        const { service, userBookStatusService } = makeService();
        const user = makeUser({ id: 77 });
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        userBookStatusService.updateManual.mockResolvedValue({
          status: 'reading',
          source: 'manual',
          startedAt: '2026-04-10T00:00:00.000Z',
          finishedAt: null,
          updatedAt: '2026-04-11T00:00:00.000Z',
        });

        const result = await service.setReadStatus(10, { status: 'reading' }, user);

        expect(userBookStatusService.updateManual).toHaveBeenCalledWith(77, 10, { status: 'reading' });
        expect(result).toEqual({
          status: 'reading',
          source: 'manual',
          startedAt: '2026-04-10',
          finishedAt: null,
          updatedAt: '2026-04-11T00:00:00.000Z',
        });
      });

      it('accepts ISO date input, applies timezone normalization, and persists as manual patch dates', async () => {
        const { service, userBookStatusService } = makeService();
        const user = makeUser({ id: 12, settings: { timezone: 'America/New_York' } });
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        userBookStatusService.updateManual.mockImplementation(
          (_userId: number, _bookId: number, patch: { status?: string; startedAt?: Date | null; finishedAt?: Date | null }) => ({
            status: (patch.status as 'reading' | undefined) ?? 'reading',
            source: 'manual',
            startedAt: patch.startedAt instanceof Date ? patch.startedAt.toISOString() : null,
            finishedAt: patch.finishedAt instanceof Date ? patch.finishedAt.toISOString() : null,
            updatedAt: '2026-04-11T00:00:00.000Z',
          }),
        );

        const result = await service.setReadStatus(
          10,
          {
            startedAt: '2026-01-01T02:30:00.000Z',
            finishedAt: '2026-01-15',
          },
          user,
        );

        expect(userBookStatusService.updateManual).toHaveBeenCalledOnce();
        const patch = userBookStatusService.updateManual.mock.calls[0]?.[2];
        expect(patch.startedAt).toBeInstanceOf(Date);
        expect(patch.finishedAt).toBeInstanceOf(Date);
        expect(result.startedAt).toBe('2025-12-31');
        expect(result.finishedAt).toBe('2026-01-15');
      });

      it('rejects future dates', async () => {
        const { service, userBookStatusService } = makeService();
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-20T12:00:00.000Z'));

        await expect(service.setReadStatus(10, { startedAt: '2026-05-21' }, makeUser())).rejects.toThrow('startedAt cannot be in the future');
        expect(userBookStatusService.updateManual).not.toHaveBeenCalled();
        vi.useRealTimers();
      });

      it('rejects finishedAt that is earlier than startedAt across omitted field merges', async () => {
        const { service, userBookStatusService } = makeService();
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        userBookStatusService.findOne.mockResolvedValue({
          status: 'reading',
          source: 'manual',
          startedAt: '2026-01-01T00:00:00.000Z',
          finishedAt: '2026-01-10T00:00:00.000Z',
          updatedAt: '2026-01-10T00:00:00.000Z',
        });

        await expect(service.setReadStatus(10, { startedAt: '2026-01-15' }, makeUser())).rejects.toThrow('finishedAt must be on or after startedAt');
        expect(userBookStatusService.updateManual).not.toHaveBeenCalled();
      });

      it('falls back to UTC when user timezone is invalid', async () => {
        const { service, userBookStatusService } = makeService();
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        userBookStatusService.updateManual.mockImplementation((_userId: number, _bookId: number, patch: { startedAt?: Date | null }) => ({
          status: 'reading',
          source: 'manual',
          startedAt: patch.startedAt instanceof Date ? patch.startedAt.toISOString() : null,
          finishedAt: null,
          updatedAt: '2026-04-11T00:00:00.000Z',
        }));

        const result = await service.setReadStatus(
          10,
          {
            startedAt: '2026-01-01T00:30:00.000+05:00',
          },
          makeUser({ settings: { timezone: 'Invalid/Zone' } }),
        );

        expect(result.startedAt).toBe('2025-12-31');
      });

      it('supports explicit null clearing for reading dates', async () => {
        const { service, userBookStatusService } = makeService();
        vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
        userBookStatusService.updateManual.mockResolvedValue({
          status: 'reading',
          source: 'manual',
          startedAt: null,
          finishedAt: null,
          updatedAt: '2026-04-11T00:00:00.000Z',
        });

        const result = await service.setReadStatus(10, { startedAt: null, finishedAt: null }, makeUser());

        expect(userBookStatusService.updateManual).toHaveBeenCalledWith(1, 10, { startedAt: null, finishedAt: null });
        expect(result.startedAt).toBeNull();
        expect(result.finishedAt).toBeNull();
      });
    });
  });

  describe('embedding and failpoint behavior', () => {
    it('embedAll returns queued=0 when embedder is unavailable', async () => {
      const { service } = makeService();
      (service as unknown as { embedder?: unknown }).embedder = undefined;

      await expect(service.embedAll()).resolves.toEqual({ queued: 0 });
    });

    it('runEmbeddings logs per-item failures and continues', async () => {
      const { service, embedder } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();
      embedder.embedBook.mockRejectedValueOnce(new Error('embedding failed')).mockResolvedValueOnce(undefined);

      await (service as any).runEmbeddings([1, 2]);

      expect(embedder.embedBook).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('validates and clears metadata failpoints for tests', () => {
      const { service } = makeService();

      expect(() => service.setMetadataUpdateFailpointForTests('not-a-stage' as never)).toThrow('Unknown metadata update failpoint');

      service.setMetadataUpdateFailpointForTests('afterTagsReplace');
      expect(() => (service as any).throwIfMetadataUpdateFailpoint('afterTagsReplace')).toThrow(
        'Metadata update failpoint triggered: afterTagsReplace',
      );

      service.setMetadataUpdateFailpointForTests('afterGenresReplace');
      service.clearMetadataUpdateFailpointForTests();
      expect(() => (service as any).throwIfMetadataUpdateFailpoint('afterGenresReplace')).not.toThrow();
    });
  });

  describe('metadata workflow error branches', () => {
    it('refreshMetadata logs and rethrows provider failures', async () => {
      const { service, bookRepo, pipeline } = makeService();
      const user = makeUser();
      bookRepo.findById.mockResolvedValue({
        book: { books: { id: 1, libraryId: 7 }, book_metadata: { title: 'Old', isbn13: null, isbn10: null } },
        authorRows: [{ id: 1, name: 'Author', sortName: null }],
        genreRows: [],
      });
      pipeline.runWithSources.mockRejectedValue(new Error('provider timeout'));

      await expect(service.refreshMetadata(1, false, user)).rejects.toThrow('provider timeout');
    });

    it('bulkRefreshMetadata increments failed count when individual books fail', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      const refreshSpy = vi
        .spyOn(service, 'refreshMetadata')
        .mockRejectedValueOnce(new Error('failed one'))
        .mockResolvedValueOnce({ id: 2 } as never);
      const onProgress = vi.fn();

      const result = await service.bulkRefreshMetadata([1, 2], user, onProgress);

      expect(result).toEqual({ processed: 1, failed: 1 });
      expect(refreshSpy).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledTimes(2);
    });

    it('bulkRefreshMetadata returns zero counts without checking access when no books are requested', async () => {
      const { service, bookRepo } = makeService();

      await expect(service.bulkRefreshMetadata([], makeUser())).resolves.toEqual({ processed: 0, failed: 0 });

      expect(bookRepo.findLibraryIdsByBookIds).not.toHaveBeenCalled();
    });

    it('bulkRefreshMetadata logs and rethrows access failures before iteration starts', async () => {
      const { service } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();
      const user = makeUser();
      const accessError = new ForbiddenException('denied');
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockRejectedValue(accessError);

      await expect(service.bulkRefreshMetadata([1], user)).rejects.toThrow(accessError);

      expect(warnSpy).toHaveBeenCalled();
    });

    it('bulkReExtractCover aborts early when cancellation is requested', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/1.epub', format: 'epub' }]);

      const result = await service.bulkReExtractCover([1], user, undefined, { isCancelled: () => true });

      expect(result).toEqual({ processed: 0, updated: 0 });
    });

    it('bulkReExtractCover returns zero counts without checking access when no books are requested', async () => {
      const { service, bookRepo } = makeService();

      await expect(service.bulkReExtractCover([], makeUser())).resolves.toEqual({ processed: 0, updated: 0 });

      expect(bookRepo.findLibraryIdsByBookIds).not.toHaveBeenCalled();
    });

    it('bulkReExtractCover logs and rethrows access failures before loading files', async () => {
      const { service } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();
      const user = makeUser();
      const accessError = new ForbiddenException('denied');
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockRejectedValue(accessError);

      await expect(service.bulkReExtractCover([1], user)).rejects.toThrow(accessError);

      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe('bulk metadata actions', () => {
    it('bulkSetRating updates ratings and queues file writes and score recalculation', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService, scoreService } = makeService();
      const user = makeUser({ id: 42 });
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await service.bulkSetRating([3, 5], 4, user);

      expect(bookRepo.bulkSetRating).toHaveBeenCalledWith([3, 5], 4, 42);
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(1, 3, 'auto', 42);
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(2, 5, 'auto', 42);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(1, 3, 42);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(2, 5, 42);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(1, 3);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(2, 5);
    });

    it('bulkSetRating skips books where rating is metadata-locked', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService, scoreService, bookMetadataLockService } = makeService();
      const user = makeUser({ id: 42 });
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getBookIdsWithLockedField.mockResolvedValue(new Set([5]));

      await service.bulkSetRating([3, 5], 4, user);

      expect(bookMetadataLockService.getBookIdsWithLockedField).toHaveBeenCalledWith([3, 5], 'rating');
      expect(bookRepo.bulkSetRating).toHaveBeenCalledWith([3], 4, 42);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledTimes(1);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(3, 'auto', 42);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledTimes(1);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(3, 42);
      expect(scoreService.calculateAndSave).toHaveBeenCalledTimes(1);
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(3);
    });

    it('bulkSetRating logs score recalculation failures without interrupting the update', async () => {
      const { service, bookRepo, scoreService } = makeService();
      const user = makeUser({ id: 42 });
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      scoreService.calculateAndSave.mockRejectedValue(new Error('score exploded'));

      await service.bulkSetRating([3], 4, user);
      await Promise.resolve();

      expect(bookRepo.bulkSetRating).toHaveBeenCalledWith([3], 4, 42);
      expect(warnSpy).toHaveBeenCalledWith('Score calculation failed for book 3: score exploded');
    });

    it('bulkSetMetadata updates a single metadata field and queues follow-up work', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService, scoreService } = makeService();
      const user = makeUser({ id: 11 });
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await service.bulkSetMetadata([7, 9], 'language', 'fr', user);

      expect(bookRepo.bulkUpdateMetadataFields).toHaveBeenCalledWith(
        [7, 9],
        expect.objectContaining({ language: 'fr', updatedAt: expect.any(Date) }),
      );
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(1, 7, 'auto', 11);
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(2, 9, 'auto', 11);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(1, 7, 11);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(2, 9, 11);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(1, 7);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(2, 9);
    });

    it('bulkSetMetadata skips books where the field is metadata-locked', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService, scoreService, bookMetadataLockService } = makeService();
      const user = makeUser({ id: 11 });
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getBookIdsWithLockedField.mockResolvedValue(new Set([9]));

      await service.bulkSetMetadata([7, 9], 'language', 'fr', user);

      expect(bookMetadataLockService.getBookIdsWithLockedField).toHaveBeenCalledWith([7, 9], 'language');
      expect(bookRepo.bulkUpdateMetadataFields).toHaveBeenCalledWith([7], expect.objectContaining({ language: 'fr', updatedAt: expect.any(Date) }));
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledTimes(1);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(7, 'auto', 11);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledTimes(1);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(7, 11);
      expect(scoreService.calculateAndSave).toHaveBeenCalledTimes(1);
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(7);
    });

    it('bulkSetMetadata replaces relation fields in a transaction', async () => {
      const { service, bookRepo, metadataService, fileWriteService, fileRenameService, scoreService } = makeService();
      const user = makeUser({ id: 11 });
      const tx = { select: vi.fn(), delete: vi.fn(), insert: vi.fn(), update: vi.fn() };
      bookRepo.withTransaction.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await service.bulkSetMetadata([7, 9], 'tags', ['favorite', 'reading'], user);

      expect(metadataService.replaceTags).toHaveBeenNthCalledWith(1, 7, ['favorite', 'reading'], { executor: tx });
      expect(metadataService.replaceTags).toHaveBeenNthCalledWith(2, 9, ['favorite', 'reading'], { executor: tx });
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(1, 7, 'auto', 11);
      expect(fileWriteService.scheduleWrite).toHaveBeenNthCalledWith(2, 9, 'auto', 11);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(1, 7, 11);
      expect(fileRenameService.scheduleRename).toHaveBeenNthCalledWith(2, 9, 11);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(1, 7);
      expect(scoreService.calculateAndSave).toHaveBeenNthCalledWith(2, 9);
    });

    it('bulkSetMetadata replaces narrators for editable books only', async () => {
      const { service, bookRepo, narratorService, fileWriteService, fileRenameService, scoreService, bookMetadataLockService } = makeService();
      const user = makeUser({ id: 11 });
      const tx = { select: vi.fn(), delete: vi.fn(), insert: vi.fn(), update: vi.fn() };
      bookRepo.withTransaction.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getBookIdsWithLockedField.mockResolvedValue(new Set([9]));

      await service.bulkSetMetadata([7, 9], 'narrators', ['Narrator A'], user);

      expect(narratorService.replaceForBook).toHaveBeenCalledTimes(1);
      expect(narratorService.replaceForBook).toHaveBeenCalledWith(7, ['Narrator A'], { executor: tx });
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledTimes(1);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(7, 'auto', 11);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledTimes(1);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(7, 11);
      expect(scoreService.calculateAndSave).toHaveBeenCalledTimes(1);
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(7);
    });

    it('bulkUpdateTags performs all tag changes in one transaction and queues follow-up work', async () => {
      const { service, bookRepo, metadataService, fileWriteService, fileRenameService, scoreService } = makeService();
      const user = makeUser({ id: 11 });
      const tx = { select: vi.fn(), delete: vi.fn(), insert: vi.fn() };
      bookRepo.withTransaction.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
      bookRepo.findTagsByBookIds.mockResolvedValue(new Map([[7, ['existing']]]));
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await service.bulkUpdateTags([7], 'add', ['new'], user);

      expect(bookRepo.findTagsByBookIds).toHaveBeenCalledWith([7], tx);
      expect(metadataService.replaceTags).toHaveBeenCalledWith(7, ['existing', 'new'], { executor: tx });
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(7, 'auto', 11);
      expect(fileRenameService.scheduleRename).toHaveBeenCalledWith(7, 11);
      expect(scoreService.calculateAndSave).toHaveBeenCalledWith(7);
    });

    it('bulkUpdateTags replaces tags inside the transaction executor', async () => {
      const { service, bookRepo, metadataService } = makeService();
      const user = makeUser();
      const tx = { select: vi.fn(), delete: vi.fn(), insert: vi.fn() };
      bookRepo.withTransaction.mockImplementation(async (callback: (value: unknown) => Promise<unknown>) => callback(tx));
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await service.bulkUpdateTags([9], 'replace', ['fresh'], user);

      expect(bookRepo.findTagsByBookIds).not.toHaveBeenCalled();
      expect(metadataService.replaceTags).toHaveBeenCalledWith(9, ['fresh'], { executor: tx });
    });
  });

  describe('bulkEditMetadata', () => {
    function makeFields(overrides: Record<string, unknown> = {}): BulkEditFieldsDto {
      const dto = new BulkEditFieldsDto();
      Object.assign(dto, overrides);
      return dto;
    }

    it('updates scalar fields and triggers post-metadata effects', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));
      const triggerSpy = vi.spyOn(service, 'triggerPostMetadataUpdateEffects' as never).mockReturnValue(undefined as never);

      const fields = makeFields({
        publisher: { value: 'Bloomsbury' },
        language: { value: 'en' },
      });

      const result = await service.bulkEditMetadata([7, 9], fields, user);

      expect(bookRepo.bulkUpdateMetadataFields).toHaveBeenCalled();
      expect(result.updatedBooks).toBe(2);
      expect(result.fields.publisher).toEqual({ updated: 2, skippedLocked: 0 });
      expect(result.fields.language).toEqual({ updated: 2, skippedLocked: 0 });
      expect(triggerSpy).toHaveBeenCalledWith([7, 9], user.id);
    });

    it('updates publishedYear as integer', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        publishedYear: { value: 2001 },
      });

      const result = await service.bulkEditMetadata([7], fields, user);

      expect(result.fields.publishedYear).toEqual({ updated: 1, skippedLocked: 0 });
    });

    it('replaces authors in replace mode', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        authors: { mode: 'replace', values: ['Author A', 'Author B'] },
      });

      await service.bulkEditMetadata([7, 9], fields, user);

      expect(metadataService.replaceAuthors).toHaveBeenCalledTimes(2);
      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(
        7,
        [
          { name: 'Author A', sortName: null },
          { name: 'Author B', sortName: null },
        ],
        { executor: tx },
      );
    });

    it('adds authors in add mode by merging with existing', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));
      bookRepo.findAuthorsByBookIds.mockResolvedValue(new Map([[7, ['Existing Author']]]));

      const fields = makeFields({
        authors: { mode: 'add', values: ['New Author'] },
      });

      await service.bulkEditMetadata([7], fields, user);

      expect(bookRepo.findAuthorsByBookIds).toHaveBeenCalledWith([7], tx);
      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(
        7,
        [
          { name: 'Existing Author', sortName: null },
          { name: 'New Author', sortName: null },
        ],
        { executor: tx },
      );
    });

    it('removes authors in remove mode', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));
      bookRepo.findAuthorsByBookIds.mockResolvedValue(new Map([[7, ['Author A', 'Author B']]]));

      const fields = makeFields({
        authors: { mode: 'remove', values: ['Author A'] },
      });

      await service.bulkEditMetadata([7], fields, user);

      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(7, [{ name: 'Author B', sortName: null }], { executor: tx });
    });

    it('replaces tags in replace mode', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        tags: { mode: 'replace', values: ['favorite', 'reading'] },
      });

      await service.bulkEditMetadata([7, 9], fields, user);

      expect(metadataService.replaceTags).toHaveBeenCalledTimes(2);
      expect(metadataService.replaceTags).toHaveBeenCalledWith(7, ['favorite', 'reading'], { executor: tx });
      expect(metadataService.replaceTags).toHaveBeenCalledWith(9, ['favorite', 'reading'], { executor: tx });
    });

    it('adds tags in add mode by merging with existing', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));
      bookRepo.findTagsByBookIds.mockResolvedValue(new Map([[7, ['existing']]]));

      const fields = makeFields({
        tags: { mode: 'add', values: ['new'] },
      });

      await service.bulkEditMetadata([7], fields, user);

      expect(metadataService.replaceTags).toHaveBeenCalledWith(7, ['existing', 'new'], { executor: tx });
    });

    it('replaces genres in replace mode', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        genres: { mode: 'replace', values: ['Fantasy'] },
      });

      await service.bulkEditMetadata([7], fields, user);

      expect(metadataService.replaceGenres).toHaveBeenCalledWith(7, ['Fantasy'], { executor: tx });
    });

    it('replaces narrators in replace mode', async () => {
      const { service, bookRepo, narratorService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        narrators: { mode: 'replace', values: ['Stephen Fry'] },
      });

      await service.bulkEditMetadata([7], fields, user);

      expect(narratorService.replaceForBook).toHaveBeenCalledWith(7, ['Stephen Fry'], { executor: tx });
    });

    it('skips locked fields per-field and reports correctly', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(
        new Map([
          [7, ['authors']],
          [9, []],
        ]),
      );
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        authors: { mode: 'replace', values: ['New Author'] },
        genres: { mode: 'replace', values: ['Fantasy'] },
      });

      const result = await service.bulkEditMetadata([7, 9], fields, user);

      expect(result.fields.authors).toEqual({ updated: 1, skippedLocked: 1 });
      expect(result.fields.genres).toEqual({ updated: 2, skippedLocked: 0 });
      expect(metadataService.replaceAuthors).toHaveBeenCalledTimes(1);
      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(9, [{ name: 'New Author', sortName: null }], { executor: tx });
      expect(metadataService.replaceGenres).toHaveBeenCalledTimes(2);
    });

    it('handles mixed scalar and array fields in one call', async () => {
      const { service, bookRepo, metadataService, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        publisher: { value: 'Penguin' },
        tags: { mode: 'replace', values: ['classic'] },
      });

      const result = await service.bulkEditMetadata([7], fields, user);

      expect(result.updatedBooks).toBe(1);
      expect(result.fields.publisher).toEqual({ updated: 1, skippedLocked: 0 });
      expect(result.fields.tags).toEqual({ updated: 1, skippedLocked: 0 });
      expect(bookRepo.bulkUpdateMetadataFields).toHaveBeenCalled();
      expect(metadataService.replaceTags).toHaveBeenCalledWith(7, ['classic'], { executor: tx });
    });

    it('throws BadRequestException when no fields are provided', async () => {
      const { service } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      const fields = makeFields({});

      await expect(service.bulkEditMetadata([7], fields, user)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when add mode has empty values', async () => {
      const { service } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      const fields = makeFields({
        authors: { mode: 'add', values: [] },
      });

      await expect(service.bulkEditMetadata([7], fields, user)).rejects.toThrow(BadRequestException);
    });

    it('returns zero updatedBooks when all books have all fields locked', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map([[7, ['publisher']]]));
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        publisher: { value: 'Test' },
      });

      const result = await service.bulkEditMetadata([7], fields, user);

      expect(result.updatedBooks).toBe(0);
      expect(result.fields.publisher).toEqual({ updated: 0, skippedLocked: 1 });
      expect(bookRepo.bulkUpdateMetadataFields).not.toHaveBeenCalled();
    });

    it('clears a scalar field when value is null', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        seriesName: { value: null },
      });

      const result = await service.bulkEditMetadata([7], fields, user);

      expect(result.fields.seriesName).toEqual({ updated: 1, skippedLocked: 0 });
      expect(bookRepo.bulkUpdateMetadataFields).toHaveBeenCalledWith([7], expect.objectContaining({ seriesName: null }), tx);
    });

    it('verifies library access for all book IDs', async () => {
      const { service, bookRepo, bookMetadataLockService } = makeService();
      const user = makeUser();
      const verifySpy = vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);
      bookMetadataLockService.getLockedFieldsMap.mockResolvedValue(new Map());
      const tx = {};
      bookRepo.withTransaction.mockImplementation(async (cb: (value: unknown) => Promise<unknown>) => cb(tx));

      const fields = makeFields({
        publisher: { value: 'Test' },
      });

      await service.bulkEditMetadata([7, 8, 9], fields, user);

      expect(verifySpy).toHaveBeenCalledWith([7, 8, 9], user);
    });
  });

  describe('getDetail and metadata extraction', () => {
    it('throws NotFoundException when detail lookup has no result', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findById.mockResolvedValue(null);
      bookRepo.findCollectionsByBookId.mockResolvedValue([]);

      await expect(service.getDetail(9, user)).rejects.toThrow(NotFoundException);
    });

    it('maps detail payload and synthesizes audiobook chapters from file durations', async () => {
      const { service, bookRepo, userBookStatusService, comicMetadataService, fileWriteService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findById.mockResolvedValue({
        book: {
          books: {
            id: 9,
            libraryId: 7,
            primaryFileId: 100,
            status: 'present',
            folderPath: '/books/dune',
            addedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          libraries: {
            name: 'Main',
            formatPriority: ['epub'],
            fileWriteEnabled: true,
            fileWriteWriteCover: true,
            fileWriteEpubEnabled: true,
            fileWriteEpubMaxFileSizeMb: 100,
            fileWritePdfEnabled: true,
            fileWritePdfMaxFileSizeMb: 100,
            fileWriteCbxEnabled: false,
            fileWriteCbxMaxFileSizeMb: 500,
            fileWriteAudioEnabled: true,
            fileWriteAudioMaxFileSizeMb: 500,
          },
          book_metadata: {
            title: 'Dune',
            subtitle: null,
            description: 'Epic',
            isbn10: null,
            isbn13: '9780441172719',
            publisher: 'Ace',
            publishedYear: 1965,
            language: 'en',
            pageCount: 412,
            seriesName: 'Dune',
            seriesIndex: 1,
            rating: 5,
            coverSource: 'custom',
            lockedFields: ['title'],
            googleBooksId: 'g1',
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: null,
            itunesId: null,
            audibleId: null,
            comicvineId: null,
            ranobedbId: 'ranobe-detail',
            chapters: null,
            durationSeconds: 90,
            abridged: null,
            lastWrittenAt: null,
            metadataScore: 80,
          },
        },
        authorRows: [{ id: 1, name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
        genreRows: [{ name: 'Sci-Fi' }],
        tagRows: [{ name: 'classic' }],
        fileRows: [
          {
            id: 100,
            format: 'mp3',
            role: 'content',
            sizeBytes: 10,
            absolutePath: '/audio/01-intro.mp3',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            durationSeconds: 30,
          },
          {
            id: 101,
            format: 'm4b',
            role: 'content',
            sizeBytes: 20,
            absolutePath: '/audio/02-main.m4b',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            durationSeconds: 60,
          },
        ],
        narratorRows: [{ id: 4, name: 'Narrator Name', sortName: null, displayOrder: 0 }],
      });
      userBookStatusService.findOne.mockResolvedValue({
        status: 'reading',
        source: 'manual',
        startedAt: '2026-01-03T00:00:00.000Z',
        finishedAt: null,
        updatedAt: '2026-01-04T00:00:00.000Z',
      });
      comicMetadataService.findByBookId.mockResolvedValue({ issueNumber: '1', teams: ['House Atreides'] });
      bookRepo.findCollectionsByBookId.mockResolvedValue([{ id: 3, name: 'Favorites' }]);
      bookRepo.findRatingByBookAndUser.mockResolvedValue(5);
      fileWriteService.resolveBookFileWriteStatus.mockReturnValue({
        enabled: true,
        reason: null,
        writableFormats: ['mp3', 'm4b'],
        writableFields: [...AUDIO_BOOK_FILE_WRITE_FIELDS],
      });

      const result = await service.getDetail(9, user);

      expect(result.id).toBe(9);
      expect(result.audioMetadata?.chapters).toEqual([
        { title: '01-intro', startMs: 0 },
        { title: '02-main', startMs: 30_000 },
      ]);
      expect(result.readStatus).toEqual({
        status: 'reading',
        source: 'manual',
        startedAt: '2026-01-03T00:00:00.000Z',
        finishedAt: null,
        updatedAt: '2026-01-04T00:00:00.000Z',
      });
      expect(result.files[0]?.role).toBe('primary');
      expect(result.collections).toEqual([{ id: 3, name: 'Favorites' }]);
      expect(result.lockedFields).toEqual(['title']);
      expect(result.comicMetadata).toEqual(expect.objectContaining({ issueNumber: '1', teams: ['House Atreides'] }));
      expect(result.rating).toBe(5);
      expect(result.providerIds.google).toBe('g1');
      expect(result.providerIds.ranobedb).toBe('ranobe-detail');
      expect(result.fileWriteStatus).toEqual({
        enabled: true,
        reason: null,
        writableFormats: ['mp3', 'm4b'],
        writableFields: [...AUDIO_BOOK_FILE_WRITE_FIELDS],
      });
      expect(fileWriteService.resolveBookFileWriteStatus).toHaveBeenCalledWith(
        expect.objectContaining({ fileWriteEnabled: true }),
        expect.any(Array),
        100,
      );
    });

    it('preserves null personal detail fields when no user-specific state exists', async () => {
      const { service, bookRepo, userBookStatusService, comicMetadataService } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findById.mockResolvedValue({
        book: {
          books: {
            id: 12,
            libraryId: 3,
            primaryFileId: 400,
            status: 'present',
            folderPath: '/books/foundation',
            addedAt: new Date('2026-02-01T00:00:00.000Z'),
          },
          libraries: { name: 'Main', formatPriority: null },
          book_metadata: {
            title: 'Foundation',
            subtitle: null,
            description: null,
            isbn10: null,
            isbn13: null,
            publisher: null,
            publishedYear: null,
            language: null,
            pageCount: null,
            seriesName: null,
            seriesIndex: null,
            rating: null,
            coverSource: null,
            lockedFields: null,
            googleBooksId: null,
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: null,
            itunesId: null,
            audibleId: null,
            comicvineId: null,
            ranobedbId: null,
            chapters: null,
            durationSeconds: null,
            abridged: null,
            lastWrittenAt: null,
            metadataScore: null,
          },
        },
        authorRows: [{ id: 2, name: 'Isaac Asimov', sortName: 'Asimov, Isaac' }],
        genreRows: [{ name: 'Sci-Fi' }],
        tagRows: [],
        fileRows: [
          {
            id: 400,
            format: 'epub',
            role: 'content',
            sizeBytes: 42,
            absolutePath: '/books/foundation.epub',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            durationSeconds: null,
          },
        ],
        narratorRows: [],
      });
      userBookStatusService.findOne.mockResolvedValue(null);
      comicMetadataService.findByBookId.mockResolvedValue(null);
      bookRepo.findCollectionsByBookId.mockResolvedValue([]);
      bookRepo.findRatingByBookAndUser.mockResolvedValue(null);

      const result = await service.getDetail(12, user);

      expect(result.readStatus).toBeNull();
      expect(result.rating).toBeNull();
      expect(result.audioMetadata).toBeNull();
      expect(result.collections).toEqual([]);
      expect(result.comicMetadata).toBeNull();
      expect(result.lockedFields).toEqual([]);
      expect(result.formatPriority).toEqual([]);
      expect(result.fileWriteStatus).toEqual({ enabled: false, reason: 'library_disabled', writableFormats: [], writableFields: [] });
      expect(result.files).toEqual([
        expect.objectContaining({
          id: 400,
          role: 'primary',
          filename: 'foundation.epub',
        }),
      ]);
    });

    it('getMetadataFromFile handles missing or unsupported primary files', async () => {
      const { service, bookRepo } = makeService();
      const user = makeUser();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValueOnce(null).mockResolvedValueOnce({ absolutePath: '/books/a.bin', format: null });

      await expect(service.getMetadataFromFile(1, user)).rejects.toThrow(NotFoundException);
      await expect(service.getMetadataFromFile(1, user)).resolves.toEqual({});
    });

    it('getMetadataFromFile returns an empty object for unsupported but known file formats', async () => {
      const { service, bookRepo } = makeService();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValue({ absolutePath: '/books/archive.azw3', format: 'azw3' });

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual({});
    });

    it('maps epub metadata to update payload shape', async () => {
      const { service, bookRepo } = makeService();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValue({ absolutePath: '/books/dune.epub', format: 'epub' });
      mockExtractEpubMetadata.mockResolvedValue({
        title: 'Dune',
        subtitle: 'Book One',
        description: 'Desc',
        publisher: 'Ace',
        publishedYear: 1965,
        language: 'en',
        pageCount: 412,
        isbn10: '0441172717',
        isbn13: '9780441172719',
        seriesName: 'Dune',
        seriesIndex: 1,
        googleBooksId: 'google-file',
        ranobedbId: 'ranobe-file',
        authors: [{ name: 'Frank Herbert', sortName: null }],
        genres: ['Sci-Fi'],
        tags: [],
      } as never);

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual(
        expect.objectContaining({
          title: 'Dune',
          subtitle: 'Book One',
          pageCount: 412,
          googleBooksId: 'google-file',
          ranobedbId: 'ranobe-file',
          authors: ['Frank Herbert'],
          genres: ['Sci-Fi'],
        }),
      );
    });

    it('maps audio file metadata to update payload shape', async () => {
      const { service, bookRepo } = makeService();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValue({ absolutePath: '/books/project-hail-mary.m4b', format: 'm4b' });
      mockExtractAudioMetadata.mockResolvedValue({
        title: 'Project Hail Mary',
        subtitle: null,
        description: 'A lone astronaut saves the day.',
        publisher: 'Audible Studios',
        publishedYear: 2021,
        language: 'eng',
        seriesName: null,
        seriesIndex: null,
        authors: [{ name: 'Andy Weir', sortName: null }],
        genres: ['Science Fiction'],
        audibleId: 'B08G9PRS1K',
        narrators: ['Ray Porter'],
        durationSeconds: 57600,
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
        coverBytes: Buffer.from('cover'),
      });

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual({
        title: 'Project Hail Mary',
        description: 'A lone astronaut saves the day.',
        publisher: 'Audible Studios',
        publishedYear: 2021,
        language: 'eng',
        authors: ['Andy Weir'],
        genres: ['Science Fiction'],
        audibleId: 'B08G9PRS1K',
        narrators: ['Ray Porter'],
        durationSeconds: 57600,
      });
    });

    it('returns an empty object when audio extraction finds no usable tags', async () => {
      const { service, bookRepo } = makeService();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValue({ absolutePath: '/books/empty.m4b', format: 'm4b' });
      mockExtractAudioMetadata.mockResolvedValue({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        seriesName: null,
        seriesIndex: null,
        authors: [],
        genres: [],
        audibleId: null,
        narrators: [],
        durationSeconds: null,
        chapters: [],
        coverBytes: null,
      });

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual({});
    });

    it('maps pdf metadata and emits parser warnings', async () => {
      const { service, bookRepo } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile.mockResolvedValue({ absolutePath: '/books/doc.pdf', format: 'pdf' });
      mockParsePdfFile.mockImplementation(
        (
          _path: string,
          options: {
            onWarning: (warning: {
              code: string;
              absolutePath: string;
              sizeBytes?: number;
              thresholdBytes?: number;
              errorClass?: string;
              errorMessage?: string;
            }) => void;
          },
        ) => {
          options.onWarning({
            code: 'buffered-large-pdf',
            absolutePath: '/books/doc.pdf',
            sizeBytes: 100,
            thresholdBytes: 10,
          });
          options.onWarning({
            code: 'parse-warning',
            absolutePath: '/books/doc.pdf',
            errorClass: 'ParseWarning',
            errorMessage: 'metadata truncated',
          });
          return {
            title: 'PDF Title',
            publisher: 'Pub',
            pageCount: 10,
            ranobedbId: 'pdf-ranobe',
            authors: [{ name: 'Author One', sortName: null }],
            genres: ['Tech'],
          } as never;
        },
      );

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual(
        expect.objectContaining({
          title: 'PDF Title',
          publisher: 'Pub',
          pageCount: 10,
          ranobedbId: 'pdf-ranobe',
          authors: ['Author One'],
          genres: ['Tech'],
        }),
      );
      expect(warnSpy).toHaveBeenCalled();
    });

    it('maps mobi, comic archive, and fb2 metadata formats', async () => {
      const { service, bookRepo } = makeService();
      vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      bookRepo.findPrimaryFile
        .mockResolvedValueOnce({ absolutePath: '/books/dune.mobi', format: 'mobi' })
        .mockResolvedValueOnce({ absolutePath: '/books/comic.cbr', format: 'cbr' })
        .mockResolvedValueOnce({ absolutePath: '/books/novel.fb2', format: 'fb2' });
      mockParseMobiFile.mockResolvedValue({
        title: 'Mobi Title',
        description: 'Mobi Desc',
        publisher: 'Mobi Pub',
        publishedDate: '2001-02-03',
        language: 'en',
        isbn: '9781111111111',
        authors: ['Mobius'],
        tags: ['Adventure'],
      } as never);
      mockExtractCbrMetadata.mockResolvedValue({
        title: 'Comic Title',
        subtitle: 'Issue',
        description: 'Comic Desc',
        publisher: 'Comic Pub',
        publishedYear: 2012,
        language: 'en',
        pageCount: 40,
        isbn10: null,
        isbn13: null,
        seriesName: 'Series',
        seriesIndex: 4,
        authors: [{ name: 'Writer', sortName: null }],
        genres: [],
        tags: ['Comics'],
        ranobedbId: 'comic-ranobe',
        comicMetadata: { issueNumber: '4' },
      } as never);
      mockParseFb2File.mockResolvedValue({
        title: 'FB2 Title',
        description: 'FB2 Desc',
        publishedYear: 1999,
        language: 'ru',
        seriesName: 'FB2 Series',
        seriesIndex: 2,
        authors: ['Author'],
        genres: ['Drama'],
      } as never);

      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual(
        expect.objectContaining({
          title: 'Mobi Title',
          publishedYear: 2001,
          authors: ['Mobius'],
        }),
      );
      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual(
        expect.objectContaining({
          title: 'Comic Title',
          ranobedbId: 'comic-ranobe',
          comicMetadata: { issueNumber: '4' },
        }),
      );
      await expect(service.getMetadataFromFile(5, makeUser())).resolves.toEqual(
        expect.objectContaining({
          title: 'FB2 Title',
          genres: ['Drama'],
        }),
      );
    });
  });

  describe('export edge cases', () => {
    it('resolves missing sizeBytes from disk stat for projected exports', async () => {
      const { service, bookRepo, appSettings } = makeService();
      const user = makeUser();
      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/dune.epub', format: 'epub', sizeBytes: null }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Dune' })]);
      mockStat.mockResolvedValue({ size: 321 } as never);

      const plan = await service.getExportFiles([1], user, 'primary');

      expect(plan.projectedBytes).toBe(321);
      expect(plan.files).toEqual([{ absolutePath: '/books/dune.epub', zipPath: 'Dune.epub', sizeBytes: 321 }]);
    });

    it('resolves missing sizeBytes from disk stat and throws when file is missing', async () => {
      const { service, bookRepo, appSettings } = makeService();
      const user = makeUser();
      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/missing.epub', format: 'epub', sizeBytes: null }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Missing' })]);
      mockStat.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

      await expect(service.getExportFiles([1], user, 'primary')).rejects.toThrow(NotFoundException);
    });

    it('rethrows unexpected stat failures while resolving export file sizes', async () => {
      const { service, bookRepo, appSettings } = makeService();
      const user = makeUser();
      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/secret.epub', format: 'epub', sizeBytes: null }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Secret' })]);
      mockStat.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

      await expect(service.getExportFiles([1], user, 'primary')).rejects.toThrow('permission denied');
    });

    it('sorts equal-order export files by absolute path as final tie-breaker', async () => {
      const { service, bookRepo, appSettings } = makeService();
      const user = makeUser();
      appSettings.getDownloadPattern.mockResolvedValue('{originalFilename}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 7 }]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue([
        { bookId: 1, absolutePath: '/books/zeta.epub', format: 'epub', sizeBytes: 1, sortOrder: 0 },
        { bookId: 1, absolutePath: '/books/alpha.epub', format: 'epub', sizeBytes: 1, sortOrder: 0 },
      ]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Any' })]);

      const plan = await service.getExportFiles([1], user, 'all');

      expect(plan.files.map((file) => file.absolutePath)).toEqual(['/books/alpha.epub', '/books/zeta.epub']);
    });
  });

  describe('executeBooksQuery', () => {
    const emptyCardQueryResult = {
      rows: [],
      authorRows: [],
      fileRows: [],
      genreRows: [],
      tagRows: [],
      progressRows: [],
      statusRows: [],
      narratorRows: [],
      total: 0,
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns results from findCards when collapseSeries is false', async () => {
      const { service, bookRepo, queryBuilder } = makeService();
      const query: BookQuery = {
        pagination: { page: 0, size: 50 },
        sort: [{ field: 'title', dir: 'asc' }],
        filter: undefined,
        collapseSeries: false,
      };
      queryBuilder.buildOrderBy.mockReturnValue('order-by');
      bookRepo.findCards.mockResolvedValue(emptyCardQueryResult);

      const result = await service.executeBooksQuery(12, undefined, query);

      expect(queryBuilder.buildOrderBy).toHaveBeenCalledWith(query.sort, 12);
      expect(bookRepo.findCards).toHaveBeenCalledWith({
        where: undefined,
        orderBy: 'order-by',
        limit: 50,
        offset: 0,
        userId: 12,
      });
      expect(bookRepo.findCardsCollapsed).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
    });

    it('returns results from findCardsCollapsed when collapseSeries is true', async () => {
      const { service, bookRepo, queryBuilder } = makeService();
      const hasSeriesFilterSpy = vi.spyOn(BookQueryBuilder, 'hasSeriesFilter').mockReturnValue(false);
      const query: BookQuery = {
        pagination: { page: 1, size: 25 },
        sort: [{ field: 'title', dir: 'asc' }],
        filter: undefined,
        collapseSeries: true,
      };
      bookRepo.findCardsCollapsed.mockResolvedValue(emptyCardQueryResult);

      const result = await service.executeBooksQuery(12, 'where' as never, query);

      expect(hasSeriesFilterSpy).toHaveBeenCalledWith(undefined);
      expect(bookRepo.findCardsCollapsed).toHaveBeenCalledWith({
        where: 'where',
        sort: query.sort,
        limit: 25,
        offset: 25,
        userId: 12,
      });
      expect(bookRepo.findCards).not.toHaveBeenCalled();
      expect(queryBuilder.buildOrderBy).not.toHaveBeenCalled();
      expect(result).toEqual({ items: [], total: 0, page: 1, size: 25 });
    });

    it('does not call logger.warn when query completes fast', async () => {
      const { service, bookRepo, queryBuilder } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(400);
      queryBuilder.buildOrderBy.mockReturnValue('order-by');
      bookRepo.findCards.mockResolvedValue(emptyCardQueryResult);

      await service.executeBooksQuery(12, undefined, {
        pagination: { page: 0, size: 50 },
        sort: [],
        filter: undefined,
        collapseSeries: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('calls logger.warn when a non-collapsed query is slow', async () => {
      const { service, bookRepo, queryBuilder } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(600);
      queryBuilder.buildOrderBy.mockReturnValue('order-by');
      bookRepo.findCards.mockResolvedValue(emptyCardQueryResult);

      await service.executeBooksQuery(12, undefined, {
        pagination: { page: 0, size: 50 },
        sort: [],
        filter: undefined,
        collapseSeries: false,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[book.list_query] [end] userId=12 page=0 size=50 filterCount=0 sortFields=0 collapseSeries=false resultCount=0 durationMs=600 - slow query',
      );
    });

    it('calls logger.warn when a collapsed query is slow', async () => {
      const { service, bookRepo } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(600);
      vi.spyOn(BookQueryBuilder, 'hasSeriesFilter').mockReturnValue(false);
      bookRepo.findCardsCollapsed.mockResolvedValue(emptyCardQueryResult);

      await service.executeBooksQuery(12, undefined, {
        pagination: { page: 0, size: 50 },
        sort: [],
        filter: undefined,
        collapseSeries: true,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[book.list_query] [end] userId=12 page=0 size=50 filterCount=0 sortFields=0 collapseSeries=true resultCount=0 durationMs=600 - slow query',
      );
    });

    it('includes the expected fields in the slow-query warning message', async () => {
      const { service, bookRepo, queryBuilder } = makeService();
      const warnSpy = vi.spyOn((service as unknown as { logger: Logger }).logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(900);
      queryBuilder.buildOrderBy.mockReturnValue('order-by');
      bookRepo.findCards.mockResolvedValue(emptyCardQueryResult);

      await service.executeBooksQuery(77, undefined, {
        pagination: { page: 2, size: 25 },
        sort: [
          { field: 'title', dir: 'asc' },
          { field: 'author', dir: 'desc' },
        ],
        filter: {
          type: 'group',
          join: 'AND',
          rules: [
            { type: 'rule', field: 'title', operator: 'contains', value: 'space' },
            { type: 'rule', field: 'language', operator: 'eq', value: 'en' },
          ],
        },
        collapseSeries: false,
      });

      expect(warnSpy).toHaveBeenCalledWith(
        '[book.list_query] [end] userId=77 page=2 size=25 filterCount=2 sortFields=2 collapseSeries=false resultCount=0 durationMs=900 - slow query',
      );
    });
  });

  describe('resolveSelectionToIds', () => {
    it('verifies access and returns explicit book ids', async () => {
      const { service } = makeService();
      const user = makeUser();
      const verifySpy = vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockResolvedValue(undefined);

      await expect(service.resolveSelectionToIds({ bookIds: [1, 2] }, user)).resolves.toEqual([1, 2]);
      expect(verifySpy).toHaveBeenCalledWith([1, 2], user);
    });

    it('throws when bookIds and query are both provided', async () => {
      const { service } = makeService();

      await expect(service.resolveSelectionToIds({ bookIds: [1], query: {} }, makeUser())).rejects.toThrow(BadRequestException);
    });

    it('propagates library access errors for explicit book ids', async () => {
      const { service } = makeService();
      const error = new ForbiddenException('no access');
      vi.spyOn(service, 'verifyLibraryAccessForBookIds').mockRejectedValue(error);

      await expect(service.resolveSelectionToIds({ bookIds: [1, 2] }, makeUser())).rejects.toBe(error);
    });

    it('resolves query selections across all accessible libraries', async () => {
      const { service, bookRepo, libraryService, queryBuilder } = makeService();
      const user = makeUser({ id: 42 });
      const filter = { type: 'group', join: 'AND', rules: [] } as const;
      libraryService.findAll.mockResolvedValue([{ id: 5 }, { id: 9 }]);
      queryBuilder.buildWhere.mockReturnValue('where-clause');
      bookRepo.findIdsByWhere.mockResolvedValue([10, 11]);

      await expect(service.resolveSelectionToIds({ query: { filter, q: 'dune' } }, user)).resolves.toEqual([10, 11]);
      expect(libraryService.findAll).toHaveBeenCalledWith(user);
      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(filter, {
        accessibleLibraryIds: [5, 9],
        implicitLibraryId: undefined,
        userId: 42,
        q: 'dune',
        timeZone: 'UTC',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
      expect(bookRepo.findIdsByWhere).toHaveBeenCalledWith('where-clause');
    });

    it('restricts query selections to the requested accessible library', async () => {
      const { service, bookRepo, libraryService, queryBuilder } = makeService();
      const user = makeUser({ id: 7 });
      libraryService.findAll.mockResolvedValue([{ id: 5 }, { id: 9 }]);
      queryBuilder.buildWhere.mockReturnValue('library-where');
      bookRepo.findIdsByWhere.mockResolvedValue([22]);

      await expect(service.resolveSelectionToIds({ query: { libraryId: 9 } }, user)).resolves.toEqual([22]);
      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, {
        accessibleLibraryIds: [9],
        implicitLibraryId: 9,
        userId: 7,
        q: undefined,
        timeZone: 'UTC',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
      expect(bookRepo.findIdsByWhere).toHaveBeenCalledWith('library-where');
    });

    it('rejects query selections for inaccessible libraries', async () => {
      const { service, libraryService, queryBuilder, bookRepo } = makeService();
      libraryService.findAll.mockResolvedValue([{ id: 5 }]);

      await expect(service.resolveSelectionToIds({ query: { libraryId: 9 } }, makeUser())).rejects.toThrow(ForbiddenException);
      expect(queryBuilder.buildWhere).not.toHaveBeenCalled();
      expect(bookRepo.findIdsByWhere).not.toHaveBeenCalled();
    });

    it('throws when neither bookIds nor query is provided', async () => {
      const { service } = makeService();

      await expect(service.resolveSelectionToIds({}, makeUser())).rejects.toThrow(BadRequestException);
    });
  });

  describe('writeAndRename', () => {
    it('throws NotFoundException when book does not exist', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(null);

      await expect(service.writeAndRename(999, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('cancels pending write and rename before executing', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 0 });
      fileRenameService.performRename.mockResolvedValue({ status: 'skipped', durationMs: 0, reason: 'path unchanged' });

      await service.writeAndRename(10, makeUser());

      expect(fileWriteService.cancelPendingWrite).toHaveBeenCalledWith(10);
      expect(fileRenameService.cancelPendingRename).toHaveBeenCalledWith(10);
    });

    it('calls writeToFile with force=true and suppressNotification=true', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
      fileRenameService.performRename.mockResolvedValue({ status: 'skipped', durationMs: 0, reason: 'path unchanged' });

      await service.writeAndRename(10, makeUser({ id: 7 }));

      expect(fileWriteService.writeToFile).toHaveBeenCalledWith(10, 'sync', 7, false, true, true);
    });

    it('calls performRename with force=true and suppressNotification=true', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 0 });
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10, oldPath: '/a', newPath: '/b' });

      await service.writeAndRename(10, makeUser({ id: 7 }));

      expect(fileRenameService.performRename).toHaveBeenCalledWith(10, 7, true, true);
    });

    it('returns write and rename results combined', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: ['title', 'authors'], durationMs: 20 });
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10, oldPath: '/old', newPath: '/new' });
      fileWriteService.findLibraryWriteSettingsForBook.mockResolvedValue({ fileWriteEnabled: true, fileRenameEnabled: false });

      const result = await service.writeAndRename(10, makeUser());

      expect(result.write).toEqual({ status: 'success', fieldsWritten: ['title', 'authors'], durationMs: 20 });
      expect(result.rename).toEqual({ status: 'success', durationMs: 10, oldPath: '/old', newPath: '/new' });
    });

    it('includes libraryAutoWriteEnabled and libraryAutoRenameEnabled from settings', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 0 });
      fileRenameService.performRename.mockResolvedValue({ status: 'skipped', durationMs: 0, reason: 'path unchanged' });
      fileWriteService.findLibraryWriteSettingsForBook.mockResolvedValue({ fileWriteEnabled: true, fileRenameEnabled: true });

      const result = await service.writeAndRename(10, makeUser());

      expect(result.libraryAutoWriteEnabled).toBe(true);
      expect(result.libraryAutoRenameEnabled).toBe(true);
    });

    it('returns write=failed but still runs rename when writeToFile throws', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockRejectedValue(new Error('disk error'));
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 5, oldPath: '/old', newPath: '/new' });

      const result = await service.writeAndRename(10, makeUser());

      expect(result.write.status).toBe('failed');
      expect(result.write.reason).toBe('disk error');
      expect(result.rename.status).toBe('success');
    });

    it('returns rename=failed but reports write result when performRename throws', async () => {
      const { service, bookRepo, fileWriteService, fileRenameService } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: ['title'], durationMs: 5 });
      fileRenameService.performRename.mockRejectedValue(new Error('rename crashed'));

      const result = await service.writeAndRename(10, makeUser());

      expect(result.write.status).toBe('success');
      expect(result.rename.status).toBe('failed');
      expect(result.rename.reason).toBe('rename crashed');
    });

    it('returns skipped write when fileWriteService is null', async () => {
      const {
        bookRepo,
        libraryService,
        queryBuilder,
        metadataService,
        scoreService,
        pipeline,
        config,
        appSettings,
        userBookStatusService,
        narratorService,
        comicMetadataService,
        bookMetadataLockService,
        embedder,
        fileRenameService,
        achievementEvents,
      } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileRenameService.performRename.mockResolvedValue({ status: 'skipped', durationMs: 0, reason: 'disabled' });

      const serviceWithoutFileWrite = new BookService(
        bookRepo as never,
        libraryService as never,
        queryBuilder as never,
        metadataService as never,
        scoreService as never,
        pipeline as never,
        config as never,
        appSettings as never,
        userBookStatusService as never,
        narratorService as never,
        comicMetadataService as never,
        bookMetadataLockService as never,
        embedder as never,
        null as never,
        fileRenameService as never,
        achievementEvents as never,
      );

      const result = await serviceWithoutFileWrite.writeAndRename(10, makeUser());

      expect(result.write.status).toBe('skipped');
      expect(result.write.reason).toContain('unavailable');
    });

    it('returns skipped rename when fileRenameService is null', async () => {
      const {
        bookRepo,
        libraryService,
        queryBuilder,
        metadataService,
        scoreService,
        pipeline,
        config,
        appSettings,
        userBookStatusService,
        narratorService,
        comicMetadataService,
        bookMetadataLockService,
        embedder,
        fileWriteService,
        achievementEvents,
      } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(1);
      fileWriteService.writeToFile.mockResolvedValue({ status: 'success', fieldsWritten: [], durationMs: 0 });

      const serviceWithoutRename = new BookService(
        bookRepo as never,
        libraryService as never,
        queryBuilder as never,
        metadataService as never,
        scoreService as never,
        pipeline as never,
        config as never,
        appSettings as never,
        userBookStatusService as never,
        narratorService as never,
        comicMetadataService as never,
        bookMetadataLockService as never,
        embedder as never,
        fileWriteService as never,
        null as never,
        achievementEvents as never,
      );

      const result = await serviceWithoutRename.writeAndRename(10, makeUser());

      expect(result.rename.status).toBe('skipped');
      expect(result.rename.reason).toContain('unavailable');
    });
  });
});
