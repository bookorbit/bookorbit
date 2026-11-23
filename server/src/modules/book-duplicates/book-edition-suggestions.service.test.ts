import { NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { BookEditionSuggestionsController } from './book-edition-suggestions.controller';
import type { EditionSuggestionRow, EditionSuggestionSource } from './book-edition-suggestions.repository';
import { BookEditionSuggestionsService, judgeEditionSuggestion } from './book-edition-suggestions.service';

function row(id: number, extra: Partial<EditionSuggestionRow> = {}): EditionSuggestionRow {
  return {
    id,
    title: 'The Lantern Keeper',
    isbn10: null,
    isbn13: null,
    hardcover_id: null,
    hardcover_edition_id: null,
    open_library_id: null,
    publisher: null,
    published_year: null,
    series_id: null,
    series_index: null,
    formats: ['epub'],
    authors: ['Sam Whitfield'],
    narrators: [],
    person_keys: ['samwhitfield'],
    ...extra,
  };
}

const audiobook = (id: number, extra: Partial<EditionSuggestionRow> = {}) => row(id, { formats: ['m4b'], narrators: ['Ellen Marsh'], ...extra });

describe('judgeEditionSuggestion', () => {
  it('offers the audiobook of an ebook as another format, matched by title and author', () => {
    expect(judgeEditionSuggestion(row(1), audiobook(2, { title: 'The Lantern Keeper (Unabridged)' }))).toEqual({
      kind: 'other_format',
      reasons: ['title_author'],
    });
  });

  it('matches a shared work id whatever the titles say, and names both reasons when both hold', () => {
    expect(judgeEditionSuggestion(row(1, { hardcover_id: '42' }), audiobook(2, { hardcover_id: '42', title: 'Lantern' }))).toEqual({
      kind: 'other_format',
      reasons: ['same_work'],
    });
    expect(judgeEditionSuggestion(row(1, { open_library_id: 'OL1W' }), audiobook(2, { open_library_id: 'OL1W' }))).toEqual({
      kind: 'other_format',
      reasons: ['same_work', 'title_author'],
    });
  });

  it('accepts an author on one side who narrates on the other', () => {
    const narratedByAuthor = audiobook(2, { authors: [], narrators: ['Sam Whitfield'] });
    expect(judgeEditionSuggestion(row(1), narratedByAuthor)?.kind).toBe('other_format');
  });

  it('offers a book of the same medium only when a fact both carry differs', () => {
    const first = row(1, { publisher: 'Harbor & Finch Press', isbn13: '9780306406157' });
    expect(judgeEditionSuggestion(first, row(2, { publisher: 'Northlight Books' }))).toEqual({ kind: 'other_edition', reasons: ['title_author'] });
    expect(judgeEditionSuggestion(first, row(2, { publisher: 'Harbor & Finch Press' }))).toBeNull();
    expect(judgeEditionSuggestion(first, row(2))).toBeNull();
    expect(judgeEditionSuggestion(audiobook(1), audiobook(2, { narrators: ['Daniel Price'] }))).toEqual({
      kind: 'other_edition',
      reasons: ['title_author'],
    });
  });

  it('treats a shared ISBN as a duplicate copy, not an edition', () => {
    expect(judgeEditionSuggestion(row(1, { isbn13: '9780306406157', publisher: 'A' }), row(2, { isbn10: '0306406152', publisher: 'B' }))).toBeNull();
  });

  it('never pairs two positions of one series, nor a look-alike title by someone else', () => {
    expect(judgeEditionSuggestion(row(1, { series_id: 5, series_index: '1' }), audiobook(2, { series_id: 5, series_index: '2' }))).toBeNull();
    expect(judgeEditionSuggestion(row(1, { series_id: 5, series_index: '1' }), audiobook(2, { series_id: 5, series_index: '1.0' }))?.kind).toBe(
      'other_format',
    );
    expect(judgeEditionSuggestion(row(1), audiobook(2, { authors: ['Another Writer'], narrators: ['Ellen Marsh'] }))).toBeNull();
    expect(judgeEditionSuggestion(row(1), audiobook(2, { title: 'The Lantern Keeper Returns' }))).toBeNull();
  });

  it('leaves out comics and books that hold no format it can place', () => {
    expect(judgeEditionSuggestion(row(1, { formats: ['cbz'] }), row(2, { formats: ['cbz'], publisher: 'B' }))).toBeNull();
  });
});

describe('BookEditionSuggestionsService', () => {
  const user = { id: 7, isSuperuser: false } as never;
  const source: EditionSuggestionSource = { ...row(1, { publisher: 'Harbor & Finch Press' }), link_group_id: 18 };

  function setup(candidates: EditionSuggestionRow[], dismissed: number[] = []) {
    const repo = {
      findSource: vi.fn().mockResolvedValue(source),
      findCandidates: vi.fn().mockResolvedValue(candidates),
      findDismissedPartners: vi.fn().mockResolvedValue(new Set(dismissed)),
    };
    const bookService = {
      verifyBookAccess: vi.fn().mockResolvedValue(undefined),
      findCardsByIds: vi.fn((_user: unknown, ids: number[]) =>
        Promise.resolve(ids.filter((id) => id !== 99).map((id) => ({ id, title: `Book ${id}` }))),
      ),
    };
    const libraryService = { findEditableLibraryIds: vi.fn().mockResolvedValue([1, 2]) };
    const service = new BookEditionSuggestionsService(repo as never, bookService as never, libraryService as never);
    return { service, repo, bookService, libraryService };
  }

  it('needs edit access to the book and searches only libraries the user may edit', async () => {
    const { service, repo, bookService } = setup([]);
    await expect(service.suggest(1, user)).resolves.toEqual({ items: [] });
    expect(bookService.verifyBookAccess).toHaveBeenCalledWith(1, user, 'editor');
    expect(repo.findCandidates).toHaveBeenCalledWith(expect.objectContaining({ source, libraryIds: [1, 2], user }));
  });

  it('refuses before searching when the user cannot edit the book', async () => {
    const { service, repo, bookService } = setup([]);
    bookService.verifyBookAccess.mockRejectedValue(new NotFoundException());
    await expect(service.suggest(1, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findSource).not.toHaveBeenCalled();
  });

  it('keeps only the editions, strongest first, without dismissed pairs or books the user cannot see', async () => {
    const { service, repo } = setup(
      [
        row(2, { publisher: 'Harbor & Finch Press' }),
        row(3, { publisher: 'Northlight Books' }),
        audiobook(4),
        audiobook(5, { hardcover_id: '42' }),
        audiobook(6),
        audiobook(99),
      ],
      [6],
    );
    repo.findSource.mockResolvedValue({ ...source, hardcover_id: '42' });

    const result = await service.suggest(1, user);
    expect(repo.findDismissedPartners).toHaveBeenCalledWith(7, 1, [2, 3, 4, 5, 6, 99]);
    expect(result.items.map(({ book, kind, reasons }) => [book.id, kind, reasons])).toEqual([
      [5, 'other_format', ['same_work', 'title_author']],
      [3, 'other_edition', ['title_author']],
      [4, 'other_format', ['title_author']],
    ]);
  });

  it('offers at most eight', async () => {
    const { service } = setup(Array.from({ length: 12 }, (_, index) => audiobook(index + 2)));
    expect((await service.suggest(1, user)).items).toHaveLength(8);
  });
});

describe('BookEditionSuggestionsController', () => {
  it('is gated like grouping editions', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookEditionSuggestionsController.prototype.suggest)).toBe(Permission.LibraryEditMetadata);
  });
});
