import { Test } from '@nestjs/testing';
import { BookService } from '../book/book.service';
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
    unlinkBookHashLink: ReturnType<typeof vi.fn>;
    upsertUnmatchedBooks: ReturnType<typeof vi.fn>;
    findBookFileIdByBookId: ReturnType<typeof vi.fn>;
    dismissUnmatchedBook: ReturnType<typeof vi.fn>;
    dismissAllUnmatchedBooks: ReturnType<typeof vi.fn>;
    findBooksByTitleKeys: ReturnType<typeof vi.fn>;
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

  beforeEach(async () => {
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
      unlinkBookHashLink: vi.fn().mockResolvedValue(null),
      upsertUnmatchedBooks: vi.fn().mockResolvedValue(undefined),
      findBookFileIdByBookId: vi.fn(),
      dismissUnmatchedBook: vi.fn().mockResolvedValue(null),
      dismissAllUnmatchedBooks: vi.fn().mockResolvedValue(0),
      findBooksByTitleKeys: vi.fn().mockResolvedValue([]),
    };

    mockBookService = {
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [KoreaderHashLinkService, { provide: KoreaderRepository, useValue: mockRepo }, { provide: BookService, useValue: mockBookService }],
    }).compile();
    service = module.get(KoreaderHashLinkService);
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

    it('keeps a pending manual override visible even after intrinsic resolution succeeds', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ manualLinkRequested: true })]);
      mockRepo.resolveBookFilesByHashes.mockResolvedValue(new Map([[HASH_A, { bookFileId: 44, bookId: 55, libraryId: 1 }]]));
      const rows = await service.listUnmatchedBooks(user);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.hash).toBe(HASH_A);
      expect(rows[0]).not.toHaveProperty('manualLinkRequested');
      expect(mockRepo.resolveBookFilesByHashes).toHaveBeenCalledWith([], [1, 2], 7);
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

  describe('listUnmatchedBookSuggestions', () => {
    function makeLibraryBook(overrides: Record<string, unknown> = {}) {
      return {
        bookId: 501,
        titleKey: 'lab alpha',
        title: 'Lab Alpha',
        subtitle: null,
        language: 'en',
        publishedYear: 2026,
        format: 'epub',
        role: 'content',
        libraryName: 'Novels',
        authors: ['Ada Tester'],
        ...overrides,
      };
    }

    it('suggests the one library book with the same title and the same set of authors', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: '  Lab   ALPHA ', authors: 'Bo Sample\nAda Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([makeLibraryBook({ authors: ['Ada Tester', 'Bo Sample'] })]);

      await expect(service.listUnmatchedBookSuggestions(user)).resolves.toEqual([
        {
          hash: HASH_A,
          candidates: [
            {
              bookId: 501,
              title: 'Lab Alpha',
              subtitle: null,
              authors: ['Ada Tester', 'Bo Sample'],
              format: 'epub',
              language: 'en',
              publishedYear: 2026,
              libraryName: 'Novels',
            },
          ],
          moreCandidates: false,
        },
      ]);
      expect(mockRepo.findBooksByTitleKeys).toHaveBeenCalledWith(['lab alpha'], [1, 2], null, 26);
    });

    it('lists every edition that shares the title and authors, so none is presented as the only match', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([
        makeLibraryBook({ bookId: 501 }),
        makeLibraryBook({ bookId: 502, subtitle: 'Second edition' }),
      ]);

      const [suggestion] = await service.listUnmatchedBookSuggestions(user);

      expect(suggestion!.candidates.map((candidate) => candidate.bookId)).toEqual([501, 502]);
      expect(suggestion!.moreCandidates).toBe(false);
    });

    it('suggests nothing when the author sets differ in any way', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([
        makeUnmatchedRow({ hash: HASH_A, title: 'Lab Alpha', authors: 'Ada Tester' }),
        makeUnmatchedRow({ hash: HASH_B, title: 'Lab Alpha', authors: 'Ada Tester\nBo Sample\nCy Third' }),
      ]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([makeLibraryBook({ authors: ['Ada Tester', 'Bo Sample'] })]);

      await expect(service.listUnmatchedBookSuggestions(user)).resolves.toEqual([]);
    });

    it('suggests nothing for a different title, even with the same author', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha!', authors: 'Ada Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([makeLibraryBook({ titleKey: 'lab alpha!', title: 'Lab Alpha' })]);

      await expect(service.listUnmatchedBookSuggestions(user)).resolves.toEqual([]);
    });

    it('only considers rows a link would accept, with a title and authors', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([
        makeUnmatchedRow({ hash: 'c'.repeat(32), source: 'statistics' }),
        makeUnmatchedRow({ hash: 'd'.repeat(32), metadataAmbiguous: true }),
        makeUnmatchedRow({ hash: 'e'.repeat(32), manualLinkRequested: true }),
        makeUnmatchedRow({ hash: 'f'.repeat(32), title: null }),
        makeUnmatchedRow({ hash: '1'.repeat(32), authors: '  ' }),
      ]);

      await expect(service.listUnmatchedBookSuggestions(user)).resolves.toEqual([]);
      expect(mockRepo.findBooksByTitleKeys).not.toHaveBeenCalled();
      expect(mockRepo.getAccessibleLibraryIds).not.toHaveBeenCalled();
    });

    it('never offers a book whose primary file is audio or not content, because the link targets that file', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([
        makeLibraryBook({ bookId: 601, format: 'm4b' }),
        makeLibraryBook({ bookId: 602, role: 'supplement' }),
        makeLibraryBook({ bookId: 603, format: 'pdf' }),
      ]);

      const [suggestion] = await service.listUnmatchedBookSuggestions(user);

      expect(suggestion!.candidates.map((candidate) => candidate.bookId)).toEqual([603]);
    });

    it('flags more candidates when the title was shared by more books than were checked', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);
      const others = Array.from({ length: 25 }, (_, index) => makeLibraryBook({ bookId: 700 + index, authors: ['Someone Else'] }));
      mockRepo.findBooksByTitleKeys.mockResolvedValue([makeLibraryBook({ bookId: 699 }), ...others]);

      const [suggestion] = await service.listUnmatchedBookSuggestions(user);

      expect(suggestion!.candidates.map((candidate) => candidate.bookId)).toEqual([699]);
      expect(suggestion!.moreCandidates).toBe(true);
    });

    it('caps the candidates and reports that more exist', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue(Array.from({ length: 7 }, (_, index) => makeLibraryBook({ bookId: 800 + index })));

      const [suggestion] = await service.listUnmatchedBookSuggestions(user);

      expect(suggestion!.candidates).toHaveLength(5);
      expect(suggestion!.moreCandidates).toBe(true);
    });

    it('applies content filters for regular users and skips them for superusers', async () => {
      const filters = { includeTagIds: [3], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] };
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);

      await service.listUnmatchedBookSuggestions({ id: 7, settings: {}, contentFilters: filters } as never);
      await service.listUnmatchedBookSuggestions({ id: 7, settings: {}, contentFilters: filters, isSuperuser: true } as never);

      expect(mockRepo.findBooksByTitleKeys).toHaveBeenNthCalledWith(1, ['lab alpha'], [1, 2], filters, 26);
      expect(mockRepo.findBooksByTitleKeys).toHaveBeenNthCalledWith(2, ['lab alpha'], [1, 2], null, 26);
    });

    it('never writes', async () => {
      mockRepo.listUnmatchedBooks.mockResolvedValue([makeUnmatchedRow({ title: 'Lab Alpha', authors: 'Ada Tester' })]);
      mockRepo.findBooksByTitleKeys.mockResolvedValue([makeLibraryBook()]);

      await service.listUnmatchedBookSuggestions(user);

      expect(mockRepo.upsertBookHashLink).not.toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).not.toHaveBeenCalled();
      expect(mockRepo.resolveBookFilesByHashes).not.toHaveBeenCalled();
    });
  });

  describe('linkUnmatchedBook', () => {
    it('links an unmatched hash to an accessible book file', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.linkUnmatchedBook(user, HASH_A.toUpperCase(), 55)).resolves.toEqual({ hash: HASH_A, bookId: 55, bookFileId: 44 });

      expect(mockBookService.verifyBookAccess).toHaveBeenCalledWith(55, user);
      expect(mockRepo.resolveBookFileByHash).not.toHaveBeenCalled();
      expect(mockRepo.getBookHashLink).toHaveBeenCalledWith(7, HASH_A);
      expect(mockRepo.upsertBookHashLink).toHaveBeenCalledWith(7, HASH_A, 44, {
        title: 'Stats title',
        authors: 'Stats author',
        lastOpen: 100,
      });
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A], true);
    });

    it('preserves explicit intent even when the hash already resolves to the same file intrinsically', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 44, bookId: 55, libraryId: 1 });

      await service.linkUnmatchedBook(user, HASH_A, 55);

      expect(mockRepo.upsertBookHashLink).toHaveBeenCalledWith(7, HASH_A, 44, expect.any(Object));
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A], true);
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

    it('allows an explicit override of an intrinsic match to another book', async () => {
      mockRepo.getUnmatchedBook.mockResolvedValue(makeUnmatchedRow());
      mockRepo.findBookFileIdByBookId.mockResolvedValue(44);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 99, bookId: 88, libraryId: 1 });

      await expect(service.linkUnmatchedBook(user, HASH_A, 55)).resolves.toEqual({ hash: HASH_A, bookId: 55, bookFileId: 44 });

      expect(mockRepo.upsertBookHashLink).toHaveBeenCalled();
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A], true);
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
          positionCompatible: false,
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
          positionCompatible: false,
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
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A], true);
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

    it('allows relinking despite an intrinsic match to a different book', async () => {
      mockRepo.getBookHashLink.mockResolvedValue({ bookFileId: 44 });
      mockRepo.findBookFileIdByBookId.mockResolvedValue(66);
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 99, bookId: 88, libraryId: 1 });

      await expect(service.relinkManualHashLink(user, HASH_A, 77)).resolves.toEqual({ hash: HASH_A, bookId: 77, bookFileId: 66 });

      expect(mockRepo.upsertBookHashLink).toHaveBeenCalledWith(7, HASH_A, 66);
      expect(mockRepo.clearUnmatchedBooks).toHaveBeenCalledWith(7, [HASH_A], true);
    });
  });

  describe('unlinkManualHashLink', () => {
    it('unlinks a manual hash link and restores it as unmatched when no intrinsic match exists', async () => {
      mockRepo.unlinkBookHashLink.mockResolvedValue({
        hash: HASH_A,
        bookFileId: 44,
        koreaderTitle: 'KOReader Title',
        koreaderAuthors: 'KOReader Author',
        koreaderLastOpen: 100,
      });
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.unlinkManualHashLink(user, HASH_A)).resolves.toEqual({ hash: HASH_A });

      expect(mockRepo.unlinkBookHashLink).toHaveBeenCalledWith(7, HASH_A);
      expect(mockRepo.unlinkBookHashLink).toHaveBeenCalledWith(7, HASH_A);
    });

    it('restores a manual-link request even when the hash resolves intrinsically', async () => {
      mockRepo.unlinkBookHashLink.mockResolvedValue({
        hash: HASH_A,
        bookFileId: 44,
        koreaderTitle: 'KOReader Title',
        koreaderAuthors: 'KOReader Author',
        koreaderLastOpen: 100,
      });
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 44, bookId: 55, libraryId: 1 });

      await expect(service.unlinkManualHashLink(user, HASH_A)).resolves.toEqual({ hash: HASH_A });

      expect(mockRepo.unlinkBookHashLink).toHaveBeenCalledWith(7, HASH_A);
    });

    it('rejects unlinking when no manual link exists', async () => {
      mockRepo.unlinkBookHashLink.mockResolvedValue(null);

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
