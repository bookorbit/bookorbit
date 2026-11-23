import { ForbiddenException, Logger } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { BookLinkService } from './book-link.service';

const USER = { id: 7, isSuperuser: true, permissions: [] } as unknown as RequestUser;

function makeService() {
  const repository = {
    transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work({})),
    findMemberships: vi.fn().mockResolvedValue([]),
    findMemberIds: vi.fn().mockResolvedValue([]),
    findBookLibraries: vi.fn().mockResolvedValue([]),
    createGroup: vi.fn().mockResolvedValue(40),
    absorbGroups: vi.fn().mockResolvedValue(undefined),
    addMembers: vi.fn().mockResolvedValue(undefined),
    setLead: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    deleteGroup: vi.fn().mockResolvedValue(undefined),
  };
  const bookService = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    findLinkGroupMembers: vi.fn().mockResolvedValue([]),
  };
  const gateway = { emitBookLinksChanged: vi.fn() };
  const readingAttemptEvents = { notifyChanged: vi.fn() };
  const service = new BookLinkService(repository as never, bookService as never, gateway as never, readingAttemptEvents as never);
  return { service, repository, bookService, gateway, readingAttemptEvents };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('BookLinkService change events', () => {
  it('tells each library room only about the members kept in that library', async () => {
    const { service, repository, gateway } = makeService();
    repository.findMemberships.mockResolvedValue([{ bookId: 1, groupId: 40, leadBookId: 1 }]);
    repository.findMemberIds.mockResolvedValue([1, 2, 3]);
    repository.findBookLibraries.mockResolvedValue([
      { bookId: 1, libraryId: 10 },
      { bookId: 2, libraryId: 20 },
      { bookId: 3, libraryId: 20 },
    ]);

    await service.unlink(1, USER);

    expect(repository.findBookLibraries).toHaveBeenCalledWith([1, 2, 3]);
    expect(gateway.emitBookLinksChanged).toHaveBeenCalledTimes(2);
    expect(gateway.emitBookLinksChanged).toHaveBeenCalledWith({ libraryId: 10, bookIds: [1] });
    expect(gateway.emitBookLinksChanged).toHaveBeenCalledWith({ libraryId: 20, bookIds: [2, 3] });
  });

  it('sends a new link to both libraries without naming the other side', async () => {
    const { service, repository, gateway } = makeService();
    repository.findBookLibraries.mockResolvedValue([
      { bookId: 5, libraryId: 10 },
      { bookId: 6, libraryId: 20 },
    ]);

    await service.link({ bookIds: [5, 6] }, USER);

    expect(gateway.emitBookLinksChanged.mock.calls).toEqual([[{ libraryId: 10, bookIds: [5] }], [{ libraryId: 20, bookIds: [6] }]]);
  });

  it('drops every reader cached statistics when a link or unlink regroups works', async () => {
    const { service, repository, readingAttemptEvents } = makeService();

    await service.link({ bookIds: [5, 6] }, USER);
    expect(readingAttemptEvents.notifyChanged).toHaveBeenCalledWith(null);

    readingAttemptEvents.notifyChanged.mockClear();
    repository.findMemberships.mockResolvedValue([{ bookId: 5, groupId: 40, leadBookId: 5 }]);
    repository.findMemberIds.mockResolvedValue([5, 6]);
    await service.unlink(5, USER);
    expect(readingAttemptEvents.notifyChanged).toHaveBeenCalledWith(null);

    readingAttemptEvents.notifyChanged.mockClear();
    repository.findMemberships.mockResolvedValue([]);
    await service.unlink(9, USER);
    expect(readingAttemptEvents.notifyChanged).not.toHaveBeenCalled();
  });

  it('still answers when the broadcast fails', async () => {
    const { service, repository, gateway } = makeService();
    repository.findBookLibraries.mockRejectedValue(new Error('db down'));

    await expect(service.link({ bookIds: [5, 6] }, USER)).resolves.toMatchObject({ groupId: 40 });
    expect(gateway.emitBookLinksChanged).not.toHaveBeenCalled();
  });
});

describe('BookLinkService group', () => {
  it('reads the members the user may see through the book service', async () => {
    const { service, bookService } = makeService();
    const books = [
      { bookId: 5, libraryId: 10, libraryName: 'Ebooks', title: 'Kindred', formats: ['epub'], mediaKind: 'ebook', status: 'present', isLead: true },
      {
        bookId: 6,
        libraryId: 20,
        libraryName: 'Audio',
        title: 'Kindred',
        formats: ['m4b'],
        mediaKind: 'audiobook',
        status: 'present',
        isLead: false,
      },
    ];
    bookService.findLinkGroupMembers.mockResolvedValue(books);

    await expect(service.link({ bookIds: [5, 6] }, USER)).resolves.toEqual({ groupId: 40, leadBookId: 5, books });
    expect(bookService.findLinkGroupMembers).toHaveBeenCalledWith(40, USER);
  });
});

describe('BookLinkService main edition', () => {
  it('needs editor access to every edition, not only the new main one', async () => {
    const { service, repository, bookService } = makeService();
    repository.findMemberships.mockResolvedValue([{ bookId: 6, groupId: 40, leadBookId: 5 }]);
    repository.findMemberIds.mockResolvedValue([5, 6, 7]);
    bookService.verifyBookAccess.mockImplementation((bookId: number) =>
      bookId === 7 ? Promise.reject(new ForbiddenException('Insufficient library access level')) : Promise.resolve(),
    );

    await expect(service.setLead(40, { leadBookId: 6 }, USER)).rejects.toMatchObject({
      response: { errorCode: 'LINK_GROUP_NOT_EDITABLE' },
    });
    expect(repository.setLead).not.toHaveBeenCalled();
  });

  it('changes the main edition when every edition is editable', async () => {
    const { service, repository, bookService } = makeService();
    repository.findMemberships.mockResolvedValue([{ bookId: 6, groupId: 40, leadBookId: 5 }]);
    repository.findMemberIds.mockResolvedValue([5, 6]);

    await service.setLead(40, { leadBookId: 6 }, USER);

    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(5, USER, 'editor');
    expect(repository.setLead).toHaveBeenCalledWith({}, 40, 6);
  });
});
