import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BOOK_MERGED_ERROR_CODE } from '@bookorbit/types';

import { BookService } from './book.service';

const MERGED_AWAY = 41;
const KEPT = 42;

describe('verifyBookAccess for a merged-away id', () => {
  const build = (options: { libraries: Record<number, number>; forbiddenLibraries?: number[]; passesFilters?: boolean }) => {
    const bookRepo = { findLibraryIdByBookId: vi.fn((id: number) => Promise.resolve(options.libraries[id] ?? null)) };
    const libraryService = {
      verifyAccess: vi.fn((_userId: number, libraryId: number) =>
        options.forbiddenLibraries?.includes(libraryId) ? Promise.reject(new ForbiddenException('No access to this library')) : Promise.resolve(),
      ),
    };
    const bookAlias = { resolveOne: vi.fn((id: number) => Promise.resolve(id === MERGED_AWAY ? KEPT : null)) };
    const service = Object.create(BookService.prototype) as BookService;
    Object.assign(service, {
      bookRepo,
      libraryService,
      bookAlias,
      isSuperuser: () => false,
      checkBookPassesContentFilters: vi.fn().mockResolvedValue(options.passesFilters ?? true),
    });
    return { service, bookAlias };
  };

  const rejection = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NotFoundException);
    return (error as NotFoundException).getResponse();
  };

  it('names the kept book when the caller can see it', async () => {
    const { service } = build({ libraries: { [KEPT]: 3 } });

    await expect(rejection(service.verifyBookAccess(MERGED_AWAY, { id: 23, contentFilters: null } as never))).resolves.toEqual({
      message: 'Book was merged into another book',
      errorCode: BOOK_MERGED_ERROR_CODE,
      errorMeta: { targetBookId: KEPT },
    });
  });

  it('answers the plain 404 when the kept book is in a library the caller cannot reach', async () => {
    const { service } = build({ libraries: { [KEPT]: 3 }, forbiddenLibraries: [3] });

    const response = await rejection(service.verifyBookAccess(MERGED_AWAY, { id: 23, contentFilters: null } as never));

    expect(response).toEqual(new NotFoundException(`Book ${MERGED_AWAY} not found`).getResponse());
    expect(JSON.stringify(response)).not.toContain(String(KEPT));
  });

  it('answers the plain 404 when the kept book is hidden by the caller content filter', async () => {
    const { service } = build({ libraries: { [KEPT]: 3 }, passesFilters: false });

    const response = await rejection(service.verifyBookAccess(MERGED_AWAY, { id: 23, contentFilters: { includeTagIds: [1] } } as never));

    expect(response).toEqual(new NotFoundException(`Book ${MERGED_AWAY} not found`).getResponse());
  });

  it('answers the plain 404 for an id that was never a merged book', async () => {
    const { service, bookAlias } = build({ libraries: { [KEPT]: 3 } });

    const response = await rejection(service.verifyBookAccess(999, { id: 23, contentFilters: null } as never));

    expect(response).toEqual(new NotFoundException('Book 999 not found').getResponse());
    expect(bookAlias.resolveOne).toHaveBeenCalledWith(999);
  });

  it('never consults the alias for a book that exists', async () => {
    const { service, bookAlias } = build({ libraries: { [KEPT]: 3 } });

    await expect(service.verifyBookAccess(KEPT, { id: 23, contentFilters: null } as never)).resolves.toBeUndefined();
    expect(bookAlias.resolveOne).not.toHaveBeenCalled();
  });
});
