import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KoreaderHashLinkService } from './koreader-hash-link.service';
import { KoreaderRepository } from './koreader.repository';

const HASH_A = 'a'.repeat(32);
const HASH_B = 'b'.repeat(32);

describe('KoreaderHashLinkService', () => {
  let service: KoreaderHashLinkService;
  let mockRepo: {
    getAccessibleLibraryIds: ReturnType<typeof vi.fn>;
    resolveBookFileByHash: ReturnType<typeof vi.fn>;
    resolveBookFilesByHashes: ReturnType<typeof vi.fn>;
    listUnmatchedBooks: ReturnType<typeof vi.fn>;
    getUnmatchedBook: ReturnType<typeof vi.fn>;
    clearUnmatchedBooks: ReturnType<typeof vi.fn>;
    listBookHashLinks: ReturnType<typeof vi.fn>;
    upsertBookHashLink: ReturnType<typeof vi.fn>;
    getBookHashLink: ReturnType<typeof vi.fn>;
    deleteBookHashLink: ReturnType<typeof vi.fn>;
    upsertUnmatchedBooks: ReturnType<typeof vi.fn>;
    findBookFileIdByBookId: ReturnType<typeof vi.fn>;
    dismissUnmatchedBook: ReturnType<typeof vi.fn>;
    dismissAllUnmatchedBooks: ReturnType<typeof vi.fn>;
  };
  let mockBookService: {
    verifyBookAccess: ReturnType<typeof vi.fn>;
  };

  const user = { id: 7, settings: {}, contentFilters: null } as never;
  const firstSeenAt = new Date('2026-06-01T10:00:00.000Z');
  const lastSeenAt = new Date('2026-06-02T11:00:00.000Z');

  function makeUnmatchedRow(overrides: Record<string, unknown> = {}) {
    return {
      userId: 7,
      hash: HASH_A,
      title: 'Stats title',
      authors: 'Stats author',
      lastOpen: 100,
      source: 'file',
      metadataAmbiguous: false,
      firstSeenAt,
      lastSeenAt,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    mockRepo = {
      getAccessibleLibraryIds: vi.fn().mockResolvedValue([1, 2]),
      resolveBookFileByHash: vi.fn(),
      resolveBookFilesByHashes: vi.fn().mockResolvedValue(new Map()),
      listUnmatchedBooks: vi.fn().mockResolvedValue([]),
      getUnmatchedBook: vi.fn().mockResolvedValue(null),
      clearUnmatchedBooks: vi.fn().mockResolvedValue(undefined),
      listBookHashLinks: vi.fn().mockResolvedValue([]),
      upsertBookHashLink: vi.fn().mockResolvedValue(undefined),
      getBookHashLink: vi.fn().mockResolvedValue(null),
      deleteBookHashLink: vi.fn().mockResolvedValue(null),
      upsertUnmatchedBooks: vi.fn().mockResolvedValue(undefined),
      findBookFileIdByBookId: vi.fn(),
      dismissUnmatchedBook: vi.fn().mockResolvedValue(null),
      dismissAllUnmatchedBooks: vi.fn().mockResolvedValue(0),
    };

    mockBookService = {
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new KoreaderHashLinkService(mockRepo as unknown as KoreaderRepository, mockBookService as never);
  });

  describe('listUnmatchedBooks', () => {
    it('returns an empty array without further lookups when there are no unmatched rows', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([]);

      await expect(service.listUnmatchedBooks(user)).resolves.toEqual([]);

      expect(mockRepo.getAccessibleLibraryIds).not.toHaveBeenCalled();
      expect(mockRepo.resolveBookFilesByHashes).not.toHaveBeenCalled();
    });

    it('lists unmatched books and clears rows that now resolve', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([
        {
          userId: 7,
          hash: HASH_A,
          title: 'Already matched',
          authors: 'Author A',
          lastOpen: 100,
          source: 'file',
          metadataAmbiguous: false,
          firstSeenAt,
          lastSeenAt,
        },
        {
          userId: 7,
          hash: HASH_B,
          title: 'Needs link',
          authors: null,
          lastOpen: null,
          source: 'file',
          metadataAmbiguous: false,
          firstSeenAt,
          lastSeenAt,
        },
      ]);
      mockRepo.resolveBookFilesByHashes.mockResolvedValue(new Map([[HASH_A, { bookFileId: 10, bookId: 20, libraryId: 1 }]]));

      await expect(service.listUnmatchedBooks(user)).resolves.toEqual([
        {
          hash: HASH_B,
          title: 'Needs link',
          authors: null,
          lastOpen: null,
          firstSeenAt: '2026-06-01T10:00:00.000Z',
          lastSeenAt: '2026-06-02T11:00:00.000Z',
        },
      ]);
      expect(mockRepo.resolveBookFilesByHashes).toHaveBeenCalledWith([HASH_A, HASH_B], [1, 2], 7);
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A]);
    });

    it('does not call clearUnmatchedBooks when nothing resolves', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow()]);
      mockRepo.resolveBookFilesByHashes.mockResolvedValue(new Map());

      await expect(service.listUnmatchedBooks(user)).resolves.toEqual([
        {
          hash: HASH_A,
          title: 'Stats title',
          authors: 'Stats author',
          lastOpen: 100,
          firstSeenAt: '2026-06-01T10:00:00.000Z',
          lastSeenAt: '2026-06-02T11:00:00.000Z',
        },
      ]);
      expect(mockRepo.clearUnmatchedBooks).not.toHaveBeenCalled();
    });
  });

  describe('linkUnmatchedBook', () => {
    it('links an unmatched hash to an accessible book file', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.linkUnmatchedBook(user, HASH_A.toUpperCase(), 55)).resolves.toEqual({ hash: HASH_A, bookId: 55, bookFileId: 44 });

      expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(55, user);
      expect(mockRepo.resolveBookFileByHash).toHaveBeenCalledWith(HASH_A, [1, 2]);
      expect(mockRepo.getBookHashLink).toHaveBeenCalledWith(7, HASH_A);
      expect(mockRepo.upsertBookHashLink).toHaveBeenCalledWith(7, HASH_A, 44, {
        title: 'Stats title',
        authors: 'Stats author',
        lastOpen: 100,
      });
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A]);
    });

    it('does not create a manual link when the hash already resolves to the same file intrinsically', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 44, bookId: 55, libraryId: 1 });

      await service.linkUnmatchedBook(user, HASH_A, 55);

      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A]);
    });

    it('rejects linking historical or ambiguous unmatched rows', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow({ source: 'statistics' }));

      await expect(service.linkUnmatchedBook(user, HASH_A, 55)).rejects.toThrow(NotFoundException);

      expect(mockBookService.verifyBookAccess).not.toHaveBeenCalled();
      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
    });

    it('rejects invalid hashes before checking book access', async () => {
      await expect(service.linkUnmatchedBook(user, 'not-a-md5', 55)).rejects.toThrow(BadRequestException);

      expect(mockBookService.verifyBookAccess).not.toHaveBeenCalled();
      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
    });

    it('rejects linking when the target book has no primary file', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(null);

      await expect(service.linkUnmatchedBook(user, HASH_A, 55)).rejects.toThrow(BadRequestException);

      expect(mockRepo.resolveBookFileByHash).not.toHaveBeenCalled();
      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
    });

    it('rejects links when the hash already belongs to a different accessible book file', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 99, bookId: 88, libraryId: 1 });

      await expect(service.linkUnmatchedBook(user, HASH_A, 55)).rejects.toThrow(ConflictException);

      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).not.toHaveBeenCalled();
    });

    it('rejects linking when the hash is already manually linked to a different file', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);
      mockRepo.getBookHashLink.mockResolvedValue({ bookFileId: 99 });

      await expect(service.linkUnmatchedBook(user, HASH_A, 55)).rejects.toThrow(ConflictException);

      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).not.toHaveBeenCalled();
    });
  });

  describe('listManualHashLinks', () => {
    it('lists manual hash links with BookOrbit and KOReader metadata', async () => {
      const createdAt = new Date('2026-06-01T10:00:00.000Z');
      const updatedAt = new Date('2026-06-02T11:00:00.000Z');
      mockRepo.listBookHashLinks.mockResolvedValue([
        {
          hash: HASH_A,
          bookId: 55,
          bookFileId: 44,
          bookTitle: 'BookOrbit Title',
          bookAuthors: ['BookOrbit Author'],
          koreaderTitle: 'KOReader Title',
          koreaderAuthors: 'KOReader Author',
          koreaderLastOpen: 100,
          createdAt,
          updatedAt,
        },
      ]);

      await expect(service.listManualHashLinks(user)).resolves.toEqual([
        {
          hash: HASH_A,
          bookId: 55,
          bookFileId: 44,
          bookTitle: 'BookOrbit Title',
          bookAuthors: ['BookOrbit Author'],
          koreaderTitle: 'KOReader Title',
          koreaderAuthors: 'KOReader Author',
          koreaderLastOpen: 100,
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-02T11:00:00.000Z',
        },
      ]);
      expect(mockRepo.listBookHashLinks).toHaveBeenCalledWith(7, 100, [1, 2]);
    });
  });

  describe('relinkManualHashLink', () => {
    it('relinks an existing manual hash link to a different accessible book file', async () => {
      mockRepo.getBookHashLink.mockResolvedValue({ bookFileId: 44 });
      mockRepo.findBookFileIdByBookId.mockResolvedValue(66);
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.relinkManualHashLink(user, HASH_A, 77)).resolves.toEqual({ hash: HASH_A, bookId: 77, bookFileId: 66 });

      expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(77, user);
      expect(mockRepo.upsertBookHashLink).toHaveBeenCalledWith(7, HASH_A, 66);
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A]);
    });

    it('rejects relinking when no manual link exists', async () => {
      mockRepo.getBookHashLink.mockResolvedValue(null);

      await expect(service.relinkManualHashLink(user, HASH_A, 77)).rejects.toThrow(NotFoundException);

      expect(mockBookService.verifyBookAccess).not.toHaveBeenCalled();
      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
    });

    it('rejects relinking when the target book has no primary file', async () => {
      mockRepo.getBookHashLink.mockResolvedValue({ bookFileId: 44 });
      mockRepo.findBookFileIdByBookId.mockResolvedValue(null);

      await expect(service.relinkManualHashLink(user, HASH_A, 77)).rejects.toThrow(BadRequestException);

      expect(mockRepo.resolveBookFileByHash).not.toHaveBeenCalled();
      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
    });

    it('rejects relinking when the hash already matches a different book intrinsically', async () => {
      mockRepo.getBookHashLink.mockResolvedValue({ bookFileId: 44 });
      mockRepo.findBookFileIdByBookId.mockResolvedValue(66);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 99, bookId: 88, libraryId: 1 });

      await expect(service.relinkManualHashLink(user, HASH_A, 77)).rejects.toThrow(ConflictException);

      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).not.toHaveBeenCalled();
    });
  });

  describe('unlinkManualHashLink', () => {
    it('unlinks a manual hash link and restores it as unmatched when no intrinsic match exists', async () => {
      mockRepo.deleteBookHashLink.mockResolvedValue({
        hash: HASH_A,
        bookFileId: 44,
        koreaderTitle: 'KOReader Title',
        koreaderAuthors: 'KOReader Author',
        koreaderLastOpen: 100,
      });
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.unlinkManualHashLink(user, HASH_A)).resolves.toEqual({ hash: HASH_A });

      expect(mockRepo.deleteBookHashLink).toHaveBeenCalledWith(7, HASH_A);
      expect(mockRepo.upsertUnmatchedBooks).toHaveBeenCalledWith(7, [
        { hash: HASH_A, title: 'KOReader Title', authors: 'KOReader Author', lastOpen: 100, source: 'file', metadataAmbiguous: false },
      ]);
    });

    it('does not restore the hash as unmatched when it still resolves intrinsically', async () => {
      mockRepo.deleteBookHashLink.mockResolvedValue({
        hash: HASH_A,
        bookFileId: 44,
        koreaderTitle: 'KOReader Title',
        koreaderAuthors: 'KOReader Author',
        koreaderLastOpen: 100,
      });
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 44, bookId: 55, libraryId: 1 });

      await expect(service.unlinkManualHashLink(user, HASH_A)).resolves.toEqual({ hash: HASH_A });

      expect(mockRepo.upsertUnmatchedBooks).not.toHaveBeenCalled();
    });

    it('rejects unlinking when no manual link exists', async () => {
      mockRepo.deleteBookHashLink.mockResolvedValue(null);

      await expect(service.unlinkManualHashLink(user, HASH_A)).rejects.toThrow(NotFoundException);

      expect(mockRepo.upsertUnmatchedBooks).not.toHaveBeenCalled();
    });
  });

  describe('dismissUnmatchedBook', () => {
    it('dismisses an unmatched book and returns its hash', async () => {
      mockRepo.dismissUnmatchedBook.mockResolvedValue({ hash: HASH_A });

      await expect(service.dismissUnmatchedBook(user, HASH_A)).resolves.toEqual({ hash: HASH_A });

      expect(mockRepo.dismissUnmatchedBook).toHaveBeenCalledWith(7, HASH_A);
    });

    it('normalizes the hash before dismissing', async () => {
      mockRepo.dismissUnmatchedBook.mockResolvedValue({ hash: HASH_A });

      await service.dismissUnmatchedBook(user, HASH_A.toUpperCase());

      expect(mockRepo.dismissUnmatchedBook).toHaveBeenCalledWith(7, HASH_A);
    });

    it('rejects an invalid hash before calling the repository', async () => {
      await expect(service.dismissUnmatchedBook(user, 'not-a-hash')).rejects.toThrow(BadRequestException);

      expect(mockRepo.dismissUnmatchedBook).not.toHaveBeenCalled();
    });

    it('rejects dismissing when no unmatched book exists for the user', async () => {
      mockRepo.dismissUnmatchedBook.mockResolvedValue(null);

      await expect(service.dismissUnmatchedBook(user, HASH_A)).rejects.toThrow(NotFoundException);
    });
  });

  describe('dismissAllUnmatchedBooks', () => {
    it('dismisses all unmatched books for the user and returns the count', async () => {
      mockRepo.dismissAllUnmatchedBooks.mockResolvedValue(5);

      await expect(service.dismissAllUnmatchedBooks(user)).resolves.toEqual({ count: 5 });

      expect(mockRepo.dismissAllUnmatchedBooks).toHaveBeenCalledWith(7);
    });

    it('returns a zero count when there is nothing to dismiss', async () => {
      mockRepo.dismissAllUnmatchedBooks.mockResolvedValue(0);

      await expect(service.dismissAllUnmatchedBooks(user)).resolves.toEqual({ count: 0 });
    });
  });
});
