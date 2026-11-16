import type { BookDockMetadata } from '@bookorbit/types';

import { BookDockDuplicateService } from './book-dock-duplicate.service';
import type { BookDockJoinCandidateRow } from './book-dock.repository';

function candidate(overrides: Partial<BookDockJoinCandidateRow> = {}): BookDockJoinCandidateRow {
  return {
    bookId: 300,
    libraryId: 5,
    libraryFolderId: 4,
    folderPath: '/library/Herbert/Dune',
    libraryFolderPath: '/library',
    storedAsFile: false,
    title: 'Dune',
    titleKey: 'dune',
    isbn10: null,
    isbn13: null,
    hardcoverId: null,
    openLibraryId: null,
    amazonId: null,
    audibleId: null,
    googleBooksId: null,
    goodreadsId: null,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    findJoinCandidatesByIsbn: vi.fn().mockResolvedValue([]),
    findJoinCandidatesByEditionId: vi.fn().mockResolvedValue([]),
    findJoinCandidatesByWorkId: vi.fn().mockResolvedValue([]),
    findJoinCandidatesByTitle: vi.fn().mockResolvedValue([]),
    findAuthorNamesByBookIds: vi.fn().mockResolvedValue(new Map()),
    findContentFormatsByBookIds: vi.fn().mockResolvedValue(new Map()),
    findLibraryNames: vi.fn((ids: number[]) => Promise.resolve(new Map(ids.map((id) => [id, `Library ${id}`])))),
  };
  return { service: new BookDockDuplicateService(repo as never), repo };
}

const dune = { title: 'Dune', authors: ['Frank Herbert'], isbn13: '9780441013593' } as BookDockMetadata;

describe('BookDockDuplicateService', () => {
  it('asks nothing for no files or no libraries', async () => {
    const { service, repo } = makeService();

    await expect(service.findMatches([], [5])).resolves.toEqual(new Map());
    await expect(service.findMatches([{ fileId: 1, metadata: dune, formats: ['epub'] }], [])).resolves.toEqual(new Map());
    expect(repo.findJoinCandidatesByIsbn).not.toHaveBeenCalled();
  });

  it('keeps the strongest match per library, strongest library first', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue([candidate({ bookId: 301, libraryId: 6, isbn13: '9780441013593' })]);
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate({ bookId: 300, libraryId: 5 }), candidate({ bookId: 302, libraryId: 6 })]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(
      new Map([
        [300, ['Frank Herbert']],
        [302, ['Frank Herbert']],
      ]),
    );

    const matches = await service.findMatches([{ fileId: 1, metadata: dune, formats: ['epub'] }], [5, 6]);

    expect(matches.get(1)?.map((match) => [match.libraryId, match.bookId, match.reason])).toEqual([
      [6, 301, 'isbn'],
      [5, 300, 'title_author'],
    ]);
  });

  it('matches an ASIN whatever its case, and a Google Books id exactly', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByEditionId.mockResolvedValue([candidate({ amazonId: 'B00B7NPRY8' })]);

    const matches = await service.findMatches([{ fileId: 1, metadata: { amazonId: 'b00b7npry8' } as BookDockMetadata, formats: ['epub'] }], [5]);

    expect(repo.findJoinCandidatesByEditionId).toHaveBeenCalledWith(
      [5],
      { amazonIds: ['b00b7npry8', 'B00B7NPRY8'], audibleIds: [], googleBooksIds: [], goodreadsIds: [] },
      undefined,
    );
    expect(matches.get(1)?.[0]).toMatchObject({ bookId: 300, reason: 'edition_id' });
  });

  it('takes a shared title for the same book only when an author agrees', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByTitle.mockResolvedValue([candidate()]);
    repo.findAuthorNamesByBookIds.mockResolvedValue(new Map([[300, ['Somebody Else']]]));

    await expect(
      service.findMatches([{ fileId: 1, metadata: { title: 'Dune', authors: ['Frank Herbert'] }, formats: ['epub'] }], [5]),
    ).resolves.toEqual(new Map());
  });

  it('says whether the book could take the file as another format', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue([
      candidate({ bookId: 300, libraryId: 5, isbn13: '9780441013593' }),
      candidate({ bookId: 301, libraryId: 6, isbn13: '9780441013593' }),
      candidate({ bookId: 302, libraryId: 7, isbn13: '9780441013593', storedAsFile: true, folderPath: '/library/Dune.epub' }),
    ]);
    repo.findContentFormatsByBookIds.mockResolvedValue(
      new Map([
        [300, ['m4b']],
        [301, ['epub']],
        [302, ['pdf']],
      ]),
    );

    const matches = await service.findMatches([{ fileId: 1, metadata: dune, formats: ['epub'] }], [5, 6, 7]);

    expect(Object.fromEntries((matches.get(1) ?? []).map((match) => [match.bookId, match.canTakeFormat]))).toEqual({
      300: true,
      301: false,
      302: false,
    });
  });

  it('names other libraries holding a file, leaving out the one it is headed for, at most three', async () => {
    const { service, repo } = makeService();
    repo.findJoinCandidatesByIsbn.mockResolvedValue(
      [5, 6, 7, 8, 9].map((libraryId) => candidate({ bookId: 300 + libraryId, libraryId, isbn13: '9780441013593' })),
    );

    const names = await service.otherLibraryNames(
      [
        { fileId: 1, metadata: dune, targetLibraryId: 5 },
        { fileId: 2, metadata: { title: 'Nothing Like It' }, targetLibraryId: null },
      ],
      [5, 6, 7, 8, 9],
      { tags: { include: [], exclude: [] }, genres: { include: [], exclude: [] } } as never,
    );

    expect(names).toEqual(new Map([[1, ['Library 6', 'Library 7', 'Library 8']]]));
    expect(repo.findJoinCandidatesByIsbn.mock.calls[0]?.[3]).toBeDefined();
  });
});
