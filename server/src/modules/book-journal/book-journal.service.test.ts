import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { BOOK_JOURNAL_LIST_LIMIT, EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookJournalEntryRow } from '../../db/schema';
import { BOOK_JOURNAL_FUTURE_SKEW_MS, BookJournalService, resolveCreatedAt, toBookJournalEntry } from './book-journal.service';
import type { CreateBookJournalEntryDto } from './dto/create-book-journal-entry.dto';

const CLIENT_ID = '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13';
const NOW = new Date('2026-10-04T12:00:00.000Z');

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 7,
    username: 'journaler',
    name: 'Journal Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  };
}

function makeRow(overrides?: Partial<BookJournalEntryRow>): BookJournalEntryRow {
  return {
    id: 1,
    clientId: CLIENT_ID,
    userId: 7,
    bookId: 5,
    body: 'A thought about chapter two',
    quote: null,
    chapterTitle: null,
    positionPercent: null,
    cfi: null,
    positionSeconds: null,
    createdAt: new Date('2026-10-01T08:00:00.000Z'),
    updatedAt: new Date('2026-10-01T08:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    findByBook: vi.fn().mockResolvedValue([]),
    findByClientId: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    findActive: vi.fn().mockResolvedValue(null),
    updateActive: vi.fn().mockResolvedValue(null),
    trash: vi.fn(),
    restore: vi.fn().mockResolvedValue(null),
    purge: vi.fn().mockResolvedValue(false),
  };
  const bookService = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const service = new BookJournalService(repo as never, bookService as never);
  return { service, repo, bookService };
}

function createDto(overrides?: Partial<CreateBookJournalEntryDto>): CreateBookJournalEntryDto {
  return { clientId: CLIENT_ID, body: 'A thought about chapter two', ...overrides } as CreateBookJournalEntryDto;
}

describe('BookJournalService', () => {
  describe('list', () => {
    it('verifies access, scopes by the caller and maps rows to the shared shape', async () => {
      const { service, repo, bookService } = makeService();
      const user = makeUser();
      repo.findByBook.mockResolvedValue([makeRow({ quote: 'quoted', positionPercent: 12.5 })]);

      const result = await service.list(5, user);

      expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, user);
      expect(repo.findByBook).toHaveBeenCalledWith(7, 5, 'active', BOOK_JOURNAL_LIST_LIMIT);
      expect(result).toEqual([
        {
          id: 1,
          clientId: CLIENT_ID,
          bookId: 5,
          body: 'A thought about chapter two',
          quote: 'quoted',
          chapterTitle: null,
          positionPercent: 12.5,
          cfi: null,
          positionSeconds: null,
          createdAt: '2026-10-01T08:00:00.000Z',
          updatedAt: '2026-10-01T08:00:00.000Z',
          deletedAt: null,
        },
      ]);
      expect(result[0]).not.toHaveProperty('userId');
    });

    it('lists the trash when asked', async () => {
      const { service, repo } = makeService();
      await service.list(5, makeUser(), 'trashed');
      expect(repo.findByBook).toHaveBeenCalledWith(7, 5, 'trashed', BOOK_JOURNAL_LIST_LIMIT);
    });

    it('does not query when the book is not accessible', async () => {
      const { service, repo, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.list(5, makeUser())).rejects.toThrow(NotFoundException);
      expect(repo.findByBook).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('inserts a normalized entry owned by the caller', async () => {
      const { service, repo } = makeService();
      repo.insert.mockResolvedValue(makeRow());

      await service.create(
        5,
        makeUser(),
        createDto({
          body: '  trimmed body  ',
          quote: '  quoted line ',
          chapterTitle: '   ',
          positionPercent: 42,
          cfi: 'epubcfi(/6/8!/4/2/1:0)',
          positionSeconds: 0,
        }),
        NOW,
      );

      expect(repo.insert).toHaveBeenCalledWith({
        clientId: CLIENT_ID,
        userId: 7,
        bookId: 5,
        body: 'trimmed body',
        quote: 'quoted line',
        chapterTitle: null,
        positionPercent: 42,
        cfi: 'epubcfi(/6/8!/4/2/1:0)',
        positionSeconds: 0,
        createdAt: NOW,
      });
    });

    it('keeps an offline createdAt that is in the past', async () => {
      const { service, repo } = makeService();
      repo.insert.mockResolvedValue(makeRow());

      await service.create(5, makeUser(), createDto({ createdAt: '2026-09-30T21:15:00.000Z' }), NOW);

      expect(repo.insert.mock.calls[0][0].createdAt).toEqual(new Date('2026-09-30T21:15:00.000Z'));
    });

    it('rejects a body that is empty after trimming', async () => {
      const { service, repo } = makeService();

      await expect(service.create(5, makeUser(), createDto({ body: '   ' }), NOW)).rejects.toThrow(BadRequestException);
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('returns the stored entry unchanged when the client id is replayed for the same book', async () => {
      const { service, repo } = makeService();
      const stored = makeRow({ body: 'original body', deletedAt: new Date('2026-10-02T00:00:00.000Z') });
      repo.insert.mockResolvedValue(null);
      repo.findByClientId.mockResolvedValue(stored);

      const result = await service.create(5, makeUser(), createDto({ body: 'a different body' }), NOW);

      expect(repo.findByClientId).toHaveBeenCalledWith(7, CLIENT_ID);
      expect(result).toEqual(toBookJournalEntry(stored));
      expect(result.body).toBe('original body');
    });

    it('rejects a client id that already belongs to another book with 409', async () => {
      const { service, repo } = makeService();
      repo.insert.mockResolvedValue(null);
      repo.findByClientId.mockResolvedValue(makeRow({ bookId: 99 }));

      await expect(service.create(5, makeUser(), createDto(), NOW)).rejects.toThrow(ConflictException);
    });

    it('answers 409 when the conflicting row vanished before it could be read', async () => {
      const { service, repo } = makeService();
      repo.insert.mockResolvedValue(null);

      await expect(service.create(5, makeUser(), createDto(), NOW)).rejects.toThrow(ConflictException);
    });

    it('does not insert when the book is not accessible', async () => {
      const { service, repo, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.create(5, makeUser(), createDto(), NOW)).rejects.toThrow(NotFoundException);
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('patches only the fields sent and lets null clear a nullable field', async () => {
      const { service, repo } = makeService();
      repo.updateActive.mockResolvedValue(makeRow({ body: 'edited' }));

      const result = await service.update(5, CLIENT_ID, makeUser(), { body: ' edited ', quote: null, positionPercent: null, cfi: '' });

      expect(repo.updateActive).toHaveBeenCalledWith(7, 5, CLIENT_ID, { body: 'edited', quote: null, positionPercent: null, cfi: null });
      expect(result.body).toBe('edited');
    });

    it('reads the active row instead of writing when nothing was sent', async () => {
      const { service, repo } = makeService();
      repo.findActive.mockResolvedValue(makeRow());

      await service.update(5, CLIENT_ID, makeUser(), {});

      expect(repo.updateActive).not.toHaveBeenCalled();
      expect(repo.findActive).toHaveBeenCalledWith(7, 5, CLIENT_ID);
    });

    it('answers 404 for a missing or trashed entry', async () => {
      const { service } = makeService();

      await expect(service.update(5, CLIENT_ID, makeUser(), { body: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.update(5, CLIENT_ID, makeUser(), {})).rejects.toThrow(NotFoundException);
    });

    it('rejects an edited body that is empty after trimming', async () => {
      const { service, repo } = makeService();

      await expect(service.update(5, CLIENT_ID, makeUser(), { body: '  ' })).rejects.toThrow(BadRequestException);
      expect(repo.updateActive).not.toHaveBeenCalled();
    });
  });

  describe('trash', () => {
    it('succeeds when the entry moves to the trash and when it was already there', async () => {
      const { service, repo } = makeService();
      repo.trash.mockResolvedValueOnce('trashed').mockResolvedValueOnce('already_trashed');

      await expect(service.trash(5, CLIENT_ID, makeUser())).resolves.toBeUndefined();
      await expect(service.trash(5, CLIENT_ID, makeUser())).resolves.toBeUndefined();
      expect(repo.trash).toHaveBeenCalledWith(7, 5, CLIENT_ID);
    });

    it('answers 404 for an entry that does not exist', async () => {
      const { service, repo } = makeService();
      repo.trash.mockResolvedValue('not_found');

      await expect(service.trash(5, CLIENT_ID, makeUser())).rejects.toThrow(NotFoundException);
    });
  });

  describe('restore', () => {
    it('returns the restored entry', async () => {
      const { service, repo } = makeService();
      repo.restore.mockResolvedValue(makeRow());

      const result = await service.restore(5, CLIENT_ID, makeUser());

      expect(repo.restore).toHaveBeenCalledWith(7, 5, CLIENT_ID);
      expect(result.deletedAt).toBeNull();
    });

    it('answers 404 unless the entry is in the trash', async () => {
      const { service } = makeService();
      await expect(service.restore(5, CLIENT_ID, makeUser())).rejects.toThrow(NotFoundException);
    });
  });

  describe('purge', () => {
    it('hard-deletes a trashed entry', async () => {
      const { service, repo } = makeService();
      repo.purge.mockResolvedValue(true);

      await expect(service.purge(5, CLIENT_ID, makeUser())).resolves.toBeUndefined();
      expect(repo.purge).toHaveBeenCalledWith(7, 5, CLIENT_ID);
    });

    it('answers 404 unless the entry is in the trash', async () => {
      const { service } = makeService();
      await expect(service.purge(5, CLIENT_ID, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('checks access before touching the trash', async () => {
      const { service, repo, bookService } = makeService();
      bookService.verifyBookAccess.mockRejectedValue(new NotFoundException('Book 5 not found'));

      await expect(service.purge(5, CLIENT_ID, makeUser())).rejects.toThrow(NotFoundException);
      expect(repo.purge).not.toHaveBeenCalled();
    });
  });
});

describe('resolveCreatedAt', () => {
  it('defaults to now', () => {
    expect(resolveCreatedAt(undefined, NOW)).toBe(NOW);
  });

  it('keeps a timestamp within the allowed clock skew', () => {
    const ahead = new Date(NOW.getTime() + BOOK_JOURNAL_FUTURE_SKEW_MS);
    expect(resolveCreatedAt(ahead.toISOString(), NOW)).toEqual(ahead);
  });

  it('clamps a timestamp further in the future to now', () => {
    const farAhead = new Date(NOW.getTime() + BOOK_JOURNAL_FUTURE_SKEW_MS + 1);
    expect(resolveCreatedAt(farAhead.toISOString(), NOW)).toBe(NOW);
  });

  it('rejects a timestamp before 1970', () => {
    expect(() => resolveCreatedAt('1969-12-31T23:59:59.000Z', NOW)).toThrow(BadRequestException);
  });
});
