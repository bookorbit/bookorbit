import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';
import { access, readdir, rm, stat } from 'fs/promises';

import type { RequestUser } from '../../common/types/request-user';
import { MetadataProviderKey } from '@projectx/types';
import { UpdateBookMetadataDto } from './dto/update-book-metadata.dto';
import { BookService } from './book.service';

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

const mockAccess = access as MockedFunction<typeof access>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockStat = stat as MockedFunction<typeof stat>;

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
  };
}

function makeService() {
  const bookRepo = {
    findPatternMetadataByBookIds: vi.fn(),
    findLibraryIdsByBookIds: vi.fn(),
    findPrimaryFilesByBookIds: vi.fn(),
    findAllFilesByBookIds: vi.fn(),
    findById: vi.fn(),
    findKoboReadingState: vi.fn(),
    findKoboSnapshotState: vi.fn(),
    findKoboSyncCollectionNamesForBook: vi.fn(),
    findFileById: vi.fn(),
    findLibraryIdByBookId: vi.fn(),
    findProgress: vi.fn(),
    findProgressByBook: vi.fn(),
    upsertProgress: vi.fn(),
    findAudioProgress: vi.fn(),
    upsertAudioProgress: vi.fn(),
    updateMetadataFields: vi.fn(),
    withTransaction: vi.fn(),
    deleteByIds: vi.fn(),
    findAllIds: vi.fn(),
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
    filterResolvedMetadata: vi.fn().mockImplementation((_bookId: number, resolved: unknown, providerIds: unknown) =>
      Promise.resolve({
        resolved,
        providerIds,
        skippedFields: [],
      }),
    ),
    assertFieldsUnlocked: vi.fn().mockResolvedValue(undefined),
    getCoverLockedBookIds: vi.fn().mockResolvedValue(new Set()),
    replaceLockedFields: vi.fn().mockResolvedValue([]),
  };
  const userBookStatusService = {
    autoUpdate: vi.fn().mockResolvedValue(undefined),
    setManual: vi.fn().mockResolvedValue(undefined),
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
  );

  return {
    service,
    bookRepo,
    libraryService,
    queryBuilder,
    metadataService,
    pipeline,
    config,
    appSettings,
    userBookStatusService,
    embedder,
    fileWriteService,
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

describe('BookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockReset();
    mockReaddir.mockReset();
    mockRm.mockReset();
    mockStat.mockReset();
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
  });

  describe('export files', () => {
    it('throws when export is requested with no books', async () => {
      const { service } = makeService();

      await expect(service.getExportFiles([], makeUser(), false)).rejects.toThrow(BadRequestException);
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
        { bookId: 1, absolutePath: '/books/a.epub', format: 'epub' },
        { bookId: 2, absolutePath: '/books/b.epub', format: 'epub' },
      ]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'Duplicate' }), metaRow(2, { title: 'Duplicate' })]);

      const files = await service.getExportFiles([1, 2], user, false);

      expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(user.id, 77, false);
      expect(files).toEqual([
        { absolutePath: '/books/a.epub', zipPath: 'Duplicate.epub' },
        { absolutePath: '/books/b.epub', zipPath: 'Duplicate (2).epub' },
      ]);
    });

    it('sanitizes unsafe path segments in generated zip paths', async () => {
      const { service, appSettings, bookRepo } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('../{title}/..//bad:name');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findPrimaryFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/source.epub', format: 'epub' }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: '..' })]);

      const [file] = await service.getExportFiles([1], user, false);

      expect(file.zipPath).toBe('download/download/download/bad_name.epub');
    });

    it('uses all-files query when allFormats is true', async () => {
      const { service, appSettings, bookRepo } = makeService();
      const user = makeUser();

      appSettings.getDownloadPattern.mockResolvedValue('{title}');
      bookRepo.findLibraryIdsByBookIds.mockResolvedValue([{ id: 1, libraryId: 77 }]);
      bookRepo.findAllFilesByBookIds.mockResolvedValue([{ bookId: 1, absolutePath: '/books/a.epub', format: 'epub' }]);
      bookRepo.findPatternMetadataByBookIds.mockResolvedValue([metaRow(1, { title: 'One' })]);

      await service.getExportFiles([1], user, true);

      expect(bookRepo.findAllFilesByBookIds).toHaveBeenCalledWith([1]);
      expect(bookRepo.findPrimaryFilesByBookIds).not.toHaveBeenCalled();
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

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);
      const getDetailSpy = vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 1, title: 'Final' } as never);

      const result = await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(1, { title: 'Resolved', authors: ['A'], genres: ['G'] }, user);
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

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(
        1,
        {
          title: 'Resolved',
          googleBooksId: 'g-id',
          openLibraryId: 'ol-id',
        },
        user,
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

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);

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

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);

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

      const updateSpy = vi.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);

      await service.refreshMetadata(1, false, user);

      expect(updateSpy).toHaveBeenCalledWith(1, { authors: ['A'] }, user);
      expect(metadataService.downloadAndSaveCover).not.toHaveBeenCalled();
    });

    it('updateMetadata writes scalar fields, collections, schedules file write, and triggers embedding', async () => {
      const { service, bookRepo, metadataService, embedder, fileWriteService } = makeService();
      const user = makeUser();
      const verifySpy = vi.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      const detailSpy = vi.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

      await service.updateMetadata(
        5,
        {
          title: null,
          rating: 4,
          authors: ['A1', 'A2'],
          genres: ['Sci-Fi'],
          tags: ['favorite'],
        },
        user,
      );

      expect(verifySpy).toHaveBeenCalledWith(5, user);
      expect(bookRepo.withTransaction).toHaveBeenCalledTimes(1);
      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          title: null,
          rating: 4,
          updatedAt: expect.any(Date),
        }),
        expect.anything(),
      );
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
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(5, 'auto', user.id);
      expect(embedder.embedBook).toHaveBeenCalledWith(5);
      expect(detailSpy).toHaveBeenCalledWith(5, user);
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
        progressSyncedAt: new Date('2026-01-01T00:00:00.000Z'),
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
});
