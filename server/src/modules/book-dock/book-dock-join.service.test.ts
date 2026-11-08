import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { BookDockMetadata } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BookDockJoinCandidateRow } from './book-dock.repository';
import { BookDockJoinService, hasFolderOfItsOwn, joinErrorCodeOf, joinKeysFor, joinTitleKeys } from './book-dock-join.service';

const USER = {
  id: 7,
  isSuperuser: false,
  permissions: [],
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
} as unknown as RequestUser;

function makeService() {
  const repo = {
    findJoinTarget: vi.fn(),
    findJoinCandidatesByIsbn: vi.fn().mockResolvedValue([]),
    findJoinCandidatesByWorkId: vi.fn().mockResolvedValue([]),
    findJoinCandidatesByTitle: vi.fn().mockResolvedValue([]),
    findAuthorNamesByBookIds: vi.fn().mockResolvedValue(new Map()),
    findContentFormatsByBookIds: vi.fn().mockResolvedValue(new Map()),
  };
  const bookService = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const libraryService = { verifyAccessLevel: vi.fn().mockResolvedValue(undefined) };
  const service = new BookDockJoinService(repo as never, bookService as never, libraryService as never);
  return { service, repo, bookService, libraryService };
}

function candidate(overrides: Partial<BookDockJoinCandidateRow>): BookDockJoinCandidateRow {
  return {
    bookId: 1,
    libraryId: 5,
    folderPath: '/library/Frank Herbert/Dune',
    libraryFolderPath: '/library',
    storedAsFile: false,
    title: 'Dune',
    titleKey: 'dune',
    isbn10: null,
    isbn13: null,
    hardcoverId: null,
    openLibraryId: null,
    ...overrides,
  };
}

describe('joinTitleKeys', () => {
  it('probes the title as tagged, without audio markers, and without a subtitle', () => {
    expect(joinTitleKeys('Dune (Unabridged)')).toEqual(['dune (unabridged)', 'dune']);
    expect(joinTitleKeys('Dune: Book One - Unabridged')).toEqual(['dune: book one - unabridged', 'dune: book one', 'dune']);
    expect(joinTitleKeys('  Dune  ')).toEqual(['dune']);
    expect(joinTitleKeys('')).toEqual([]);
    expect(joinTitleKeys(null)).toEqual([]);
  });
});

describe('joinKeysFor', () => {
  it('derives both ISBN spellings from either one', () => {
    const keys = joinKeysFor({ isbn13: '978-0-441-17271-9' } as BookDockMetadata);
    expect(keys.isbn13s).toEqual(['9780441172719']);
    expect(keys.isbn10s).toEqual(['0441172717']);

    const fromTen = joinKeysFor({ isbn10: '0-441-17271-7' } as BookDockMetadata);
    expect(fromTen.isbn13s).toEqual(['9780441172719']);
    expect(fromTen.isbn10s).toEqual(['0441172717']);
  });

  it('ignores malformed tags instead of failing on them', () => {
    const keys = joinKeysFor({ isbn13: 12 as never, authors: 'Frank Herbert' as never, title: ['Dune'] as never } as BookDockMetadata);
    expect(keys).toEqual({ isbn13s: [], isbn10s: [], hardcoverIds: [], openLibraryIds: [], titleKeys: [], authorTokens: new Set() });
  });
});

describe('hasFolderOfItsOwn', () => {
  it.each([
    ['a folder inside the library folder', { folderPath: '/library/Frank Herbert/Dune' }, true],
    ['the library folder itself', { folderPath: '/library/' }, false],
    ['a path outside the library folder', { folderPath: '/library-other/Dune' }, false],
    ['a loose book keyed by its own file', { folderPath: '/library/Dune.epub', storedAsFile: true }, false],
    ['a folder whose storage is not known', { folderPath: '/library/Dune', storedAsFile: undefined }, true],
  ])('answers for %s', (_label, book, expected) => {
    expect(hasFolderOfItsOwn(book, '/library')).toBe(expected);
  });
});

describe('BookDockJoinService.resolveRequested', () => {
  it('describes a book the requester may edit', async () => {
    const { service, repo, bookService } = makeService();
    repo.findJoinTarget.mockResolvedValue({
      bookId: 42,
      libraryId: 5,
      libraryFolderId: 9,
      folderPath: '/library/Dune',
      storedAsFile: false,
      status: 'present',
      title: 'Dune',
    });
    repo.findAuthorNamesByBookIds.mockResolvedValue(new Map([[42, ['Frank Herbert']]]));

    await expect(service.resolveRequested(42, USER, ['pdf'])).resolves.toEqual({
      bookId: 42,
      libraryId: 5,
      libraryFolderId: 9,
      folderPath: '/library/Dune',
      storedAsFile: false,
      summary: { bookId: 42, title: 'Dune', authors: ['Frank Herbert'] },
    });
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(42, USER, 'editor');
    // Only audio is checked against the book's own formats.
    expect(repo.findContentFormatsByBookIds).not.toHaveBeenCalled();
  });

  it.each([
    [new NotFoundException('Book 42 not found'), 'BOOK_DOCK_JOIN_BOOK_NOT_FOUND'],
    [new ForbiddenException('Insufficient library access level'), 'BOOK_DOCK_JOIN_FORBIDDEN'],
  ])('answers a refused access check with a stable code', async (error, code) => {
    const { service, bookService } = makeService();
    bookService.verifyBookAccess.mockRejectedValue(error);

    const failure = await service.resolveRequested(42, USER, ['pdf']).catch((caught: unknown) => caught);
    expect(joinErrorCodeOf(failure)).toBe(code);
  });

  it('refuses without a person to check', async () => {
    const { service, bookService } = makeService();
    const failure = await service.resolveRequested(42, undefined, ['pdf']).catch((caught: unknown) => caught);
    expect(joinErrorCodeOf(failure)).toBe('BOOK_DOCK_JOIN_FORBIDDEN');
    expect(bookService.verifyBookAccess).not.toHaveBeenCalled();
  });

  it('refuses a book whose files are missing', async () => {
    const { service, repo } = makeService();
    repo.findJoinTarget.mockResolvedValue({
      bookId: 42,
      libraryId: 5,
      libraryFolderId: 9,
      folderPath: '/library/Dune',
      status: 'missing',
      title: 'Dune',
    });
    const failure = await service.resolveRequested(42, USER, ['pdf']).catch((caught: unknown) => caught);
    expect(joinErrorCodeOf(failure)).toBe('BOOK_DOCK_JOIN_BOOK_MISSING');
  });

  it('refuses a second audio set', async () => {
    const { service, repo } = makeService();
    repo.findJoinTarget.mockResolvedValue({
      bookId: 42,
      libraryId: 5,
      libraryFolderId: 9,
      folderPath: '/library/Dune',
      status: 'present',
      title: 'Dune',
    });
    repo.findContentFormatsByBookIds.mockResolvedValue(new Map([[42, ['epub', 'm4b']]]));
    const failure = await service.resolveRequested(42, USER, ['mp3']).catch((caught: unknown) => caught);
    expect(joinErrorCodeOf(failure)).toBe('BOOK_DOCK_JOIN_AUDIO_CONFLICT');
  });
});

describe('BookDockJoinService.canJoinIn', () => {
  it('needs a folder-per-book library the requester can edit, and asks once per library', async () => {
    const { service, libraryService } = makeService();
    const cache = new Map<number, Promise<boolean>>();

    await expect(service.canJoinIn({ id: 5, organizationMode: 'book_per_folder' }, USER, cache)).resolves.toBe(true);
    await expect(service.canJoinIn({ id: 5, organizationMode: 'book_per_folder' }, USER, cache)).resolves.toBe(true);
    await expect(service.canJoinIn({ id: 6, organizationMode: 'book_per_file' }, USER, cache)).resolves.toBe(false);
    expect(libraryService.verifyAccessLevel).toHaveBeenCalledTimes(1);
    expect(libraryService.verifyAccessLevel).toHaveBeenCalledWith(expect.objectContaining({ id: 7, isSuperuser: false }), 5, 'editor');

    libraryService.verifyAccessLevel.mockRejectedValueOnce(new ForbiddenException('Insufficient library access level'));
    await expect(service.canJoinIn({ id: 8, organizationMode: 'book_per_folder' }, USER, cache)).resolves.toBe(false);
  });
});

describe('BookDockJoinService.suggest', () => {
  const dune = { title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441172719' } as BookDockMetadata;

  it('prefers an ISBN match and reads every probe once for the whole batch', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue([candidate({ bookId: 11, isbn13: '9780441172719' })]);
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate({ bookId: 12 })]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(
      new Map([
        [11, ['Frank Herbert']],
        [12, ['Frank Herbert']],
      ]),
    );
    repo.findContentFormatsByBookIds.mockResolvedValue(
      new Map([
        [11, ['epub']],
        [12, ['epub']],
      ]),
    );

    const suggestions = await service.suggest(
      [
        { fileId: 1, libraryId: 5, metadata: dune, formats: ['pdf'] },
        { fileId: 2, libraryId: 5, metadata: { ...dune, isbn13: null }, formats: ['cbz'] },
      ],
      USER,
    );

    expect(suggestions.get(1)).toEqual({ bookId: 11, title: 'Dune', authors: ['Frank Herbert'], reason: 'isbn' });
    expect(suggestions.get(2)).toEqual({ bookId: 12, title: 'Dune', authors: ['Frank Herbert'], reason: 'title_author' });
    expect(repo.findJoinCandidatesByIsbn).toHaveBeenCalledTimes(1);
    expect(repo.findJoinCandidatesByIsbn).toHaveBeenCalledWith([5], ['9780441172719'], ['0441172717'], USER.contentFilters);
    expect(repo.findJoinCandidatesByTitle).toHaveBeenCalledTimes(1);
    expect(repo.findJoinCandidatesByTitle).toHaveBeenCalledWith([5], ['dune'], USER.contentFilters);
  });

  it('matches a work id in either case, ahead of a title, and asks only for ids the files carry', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByWorkId.mockResolvedValue([
      candidate({ bookId: 31, title: 'Dune Messiah', hardcoverId: 'dune-hc' }),
      candidate({ bookId: 32, title: 'Children of Dune', openLibraryId: 'OL893415W' }),
    ]);
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate({ bookId: 12 })]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(new Map([[12, ['Frank Herbert']]]));

    const suggestions = await service.suggest(
      [
        { fileId: 1, libraryId: 5, metadata: { title: 'Dune', authors: ['Frank Herbert'], hardcoverId: ' DUNE-HC ' }, formats: ['pdf'] },
        { fileId: 2, libraryId: 5, metadata: { title: 'Something else', openLibraryId: 'ol893415w' }, formats: ['pdf'] },
        { fileId: 3, libraryId: 5, metadata: { title: 'Dune', authors: ['Frank Herbert'] }, formats: ['pdf'] },
      ],
      USER,
    );

    expect(suggestions.get(1)).toMatchObject({ bookId: 31, reason: 'work_id' });
    expect(suggestions.get(2)).toMatchObject({ bookId: 32, reason: 'work_id' });
    expect(suggestions.get(3)).toMatchObject({ bookId: 12, reason: 'title_author' });
    expect(repo.findJoinCandidatesByWorkId).toHaveBeenCalledExactlyOnceWith([5], ['DUNE-HC', 'dune-hc'], ['ol893415w'], USER.contentFilters);
  });

  it('never matches on a title alone', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate({ bookId: 12 })]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(new Map([[12, ['Somebody Else']]]));

    const withOtherAuthor = await service.suggest(
      [{ fileId: 1, libraryId: 5, metadata: { title: 'Dune', authors: ['Frank Herbert'] }, formats: ['pdf'] }],
      USER,
    );
    const withNoAuthor = await service.suggest([{ fileId: 1, libraryId: 5, metadata: { title: 'Dune' }, formats: ['pdf'] }], USER);

    expect(withOtherAuthor.size).toBe(0);
    expect(withNoAuthor.size).toBe(0);
  });

  it('skips books in another library, books that already hold the format, and a second audio set', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue([
      candidate({ bookId: 21, libraryId: 6, isbn13: '9780441172719' }),
      candidate({ bookId: 22, isbn13: '9780441172719' }),
      candidate({ bookId: 23, isbn13: '9780441172719' }),
    ]);
    repo.findContentFormatsByBookIds.mockResolvedValue(
      new Map([
        [21, ['epub']],
        [22, ['m4b']],
        [23, ['pdf']],
      ]),
    );

    const audio = await service.suggest([{ fileId: 1, libraryId: 5, metadata: dune, formats: ['mp3'] }], USER);
    const pdf = await service.suggest([{ fileId: 1, libraryId: 5, metadata: dune, formats: ['pdf'] }], USER);

    expect(audio.get(1)?.bookId).toBe(23);
    expect(pdf.get(1)?.bookId).toBe(22);
  });

  it('never suggests a book with no folder of its own, and falls through to the next match', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue([
      candidate({ bookId: 31, isbn13: '9780441172719', folderPath: '/library/Dune.epub', storedAsFile: true }),
      candidate({ bookId: 32, isbn13: '9780441172719', folderPath: '/library' }),
    ]);
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate({ bookId: 33 })]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(new Map([[33, ['Frank Herbert']]]));

    const suggestions = await service.suggest([{ fileId: 1, libraryId: 5, metadata: dune, formats: ['pdf'] }], USER);

    expect(suggestions.get(1)).toMatchObject({ bookId: 33, reason: 'title_author' });
    expect(repo.findAuthorNamesByBookIds).toHaveBeenCalledWith([33]);
  });

  it('lets a superuser see every book and touches nothing for an empty batch', async () => {
    const { service, repo } = makeService();
    await expect(service.suggest([], USER)).resolves.toEqual(new Map());
    expect(repo.findJoinCandidatesByIsbn).not.toHaveBeenCalled();

    await service.suggest([{ fileId: 1, libraryId: 5, metadata: dune, formats: ['pdf'] }], { ...USER, isSuperuser: true });
    expect(repo.findJoinCandidatesByIsbn).toHaveBeenCalledWith([5], ['9780441172719'], ['0441172717'], undefined);
    expect(repo.findAuthorNamesByBookIds).not.toHaveBeenCalled();
  });
});
