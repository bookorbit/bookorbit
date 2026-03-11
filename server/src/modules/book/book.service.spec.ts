import { BadRequestException, NotFoundException } from '@nestjs/common';
import { access, readdir, rm, stat } from 'fs/promises';

import type { RequestUser } from '../../common/types/request-user';
import { MetadataProviderKey } from '@projectx/types';
import { BookService } from './book.service';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    access: jest.fn(),
    readdir: jest.fn(),
    rm: jest.fn(),
    stat: jest.fn(),
  };
});

const mockAccess = access as jest.MockedFunction<typeof access>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockRm = rm as jest.MockedFunction<typeof rm>;
const mockStat = stat as jest.MockedFunction<typeof stat>;

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
    findPatternMetadataByBookIds: jest.fn(),
    findLibraryIdsByBookIds: jest.fn(),
    findPrimaryFilesByBookIds: jest.fn(),
    findAllFilesByBookIds: jest.fn(),
    findById: jest.fn(),
    findKoboReadingState: jest.fn(),
    findKoboSnapshotState: jest.fn(),
    findKoboSyncCollectionNamesForBook: jest.fn(),
    findFileById: jest.fn(),
    findLibraryIdByBookId: jest.fn(),
    findProgress: jest.fn(),
    upsertProgress: jest.fn(),
    updateMetadataFields: jest.fn(),
    deleteByIds: jest.fn(),
    findAllIds: jest.fn(),
  };
  const libraryService = {
    verifyUserAccess: jest.fn().mockResolvedValue(undefined),
    findAll: jest.fn().mockResolvedValue([]),
  };
  const queryBuilder = {
    buildWhere: jest.fn(),
    buildOrderBy: jest.fn(),
  };
  const metadataService = {
    replaceAuthors: jest.fn().mockResolvedValue(undefined),
    replaceGenres: jest.fn().mockResolvedValue(undefined),
    replaceTags: jest.fn().mockResolvedValue(undefined),
    downloadAndSaveCover: jest.fn().mockResolvedValue(undefined),
    refreshCoverForBook: jest.fn(),
  };
  const pipeline = {
    run: jest.fn(),
    runWithSources: jest.fn(),
  };
  const config = {
    get: jest.fn().mockImplementation((key: string) => (key === 'storage.booksPath' ? '/tmp/books' : undefined)),
  };
  const appSettings = {
    getDownloadPattern: jest.fn().mockResolvedValue('{originalFilename}'),
  };
  const embedder = {
    embedBook: jest.fn().mockResolvedValue(undefined),
  };
  const fileWriteService = {
    scheduleWrite: jest.fn(),
  };

  const service = new BookService(
    bookRepo as never,
    libraryService as never,
    queryBuilder as never,
    metadataService as never,
    pipeline as never,
    config as never,
    appSettings as never,
    embedder as never,
    fileWriteService as never,
  );

  return { service, bookRepo, libraryService, queryBuilder, metadataService, pipeline, config, appSettings, embedder, fileWriteService };
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
    jest.clearAllMocks();
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
      mockReaddir.mockRejectedValue(new Error('missing'));

      await expect(service.getCoverPath(9, makeUser())).resolves.toBeNull();
    });

    it('returns thumbnail path only when file is accessible', async () => {
      const { service, bookRepo } = makeService();
      bookRepo.findLibraryIdByBookId.mockResolvedValue(5);
      mockAccess.mockResolvedValue(undefined);

      await expect(service.getThumbnailPath(9, makeUser())).resolves.toBe('/tmp/books/covers/9/thumbnail.jpg');

      mockAccess.mockRejectedValue(new Error('nope'));
      await expect(service.getThumbnailPath(9, makeUser())).resolves.toBeNull();
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
      const updateSpy = jest.spyOn(service, 'updateMetadata');

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

      const updateSpy = jest.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);
      const getDetailSpy = jest.spyOn(service, 'getDetail').mockResolvedValue({ id: 1, title: 'Final' } as never);

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

      const updateSpy = jest.spyOn(service, 'updateMetadata').mockResolvedValue({ id: 1 } as never);

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

    it('updateMetadata writes scalar fields, collections, schedules file write, and triggers embedding', async () => {
      const { service, bookRepo, metadataService, embedder, fileWriteService } = makeService();
      const user = makeUser();
      const verifySpy = jest.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
      const detailSpy = jest.spyOn(service, 'getDetail').mockResolvedValue({ id: 5 } as never);

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
      expect(bookRepo.updateMetadataFields).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          title: null,
          rating: 4,
          updatedAt: expect.any(Date),
        }),
      );
      expect(metadataService.replaceAuthors).toHaveBeenCalledWith(5, [
        { name: 'A1', sortName: null },
        { name: 'A2', sortName: null },
      ]);
      expect(metadataService.replaceGenres).toHaveBeenCalledWith(5, ['Sci-Fi']);
      expect(metadataService.replaceTags).toHaveBeenCalledWith(5, ['favorite']);
      expect(fileWriteService.scheduleWrite).toHaveBeenCalledWith(5, 'auto', user.id);
      expect(embedder.embedBook).toHaveBeenCalledWith(5);
      expect(detailSpy).toHaveBeenCalledWith(5, user);
    });
  });

  describe('kobo and batch behavior', () => {
    it('returns not-eligible kobo state when user lacks kobo_sync permission', async () => {
      const { service } = makeService();
      const user = makeUser();
      jest.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);

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
      jest.spyOn(service, 'verifyBookAccess').mockResolvedValue(undefined);
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
      const onProgress = jest.fn();

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

    it('deleteBooks verifies access, removes book files, and removes cover directories without failing on rm errors', async () => {
      const { service, bookRepo, libraryService } = makeService();
      const user = makeUser();
      const warnSpy = jest.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation();

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
      await Promise.resolve();

      expect(libraryService.verifyUserAccess).toHaveBeenCalledTimes(2);
      expect(bookRepo.deleteByIds).toHaveBeenCalledWith([3, 4]);
      expect(mockRm).toHaveBeenCalledWith('/tmp/books/covers/3', { recursive: true, force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/books/covers/4', { recursive: true, force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/library/book3.epub', { force: true });
      expect(mockRm).toHaveBeenCalledWith('/tmp/library/book4.pdf', { force: true });
      expect(warnSpy).toHaveBeenCalled();
    });
  });
});
