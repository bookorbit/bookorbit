import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { BookService } from './book.service';

/**
 * F-013. A 403 tells the caller the book exists. Book ids are sequential integers, so an id space
 * that answers 403 for "present but forbidden" and 404 for "absent" can be walked to learn which
 * books a server holds.
 *
 * Measured against a real second account: `user2` requesting a book `neon` had uploaded into a
 * library `user2` cannot reach received `403 GET /api/v1/books/1487`.
 */
describe('verifyBookAccess', () => {
  const build = (libraryId: number | null, accessError?: Error) => {
    const bookRepo = { findLibraryIdByBookId: vi.fn().mockResolvedValue(libraryId) };
    const libraryService = {
      verifyUserAccess: accessError ? vi.fn().mockRejectedValue(accessError) : vi.fn().mockResolvedValue(undefined),
    };
    const service = Object.create(BookService.prototype) as BookService;
    Object.assign(service, {
      bookRepo,
      libraryService,
      isSuperuser: () => false,
      checkBookPassesContentFilters: vi.fn().mockResolvedValue(true),
    });
    return { service, libraryService };
  };

  it('reports a book in an inaccessible library as not found rather than forbidden', async () => {
    const { service } = build(7, new ForbiddenException('No access to this library'));
    await expect(service.verifyBookAccess(1487, { id: 23, contentFilters: null } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports an absent book as not found, so the two are indistinguishable', async () => {
    const { service } = build(null);
    await expect(service.verifyBookAccess(999999, { id: 23, contentFilters: null } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('still allows a book in a library the caller can reach', async () => {
    const { service, libraryService } = build(7);
    await expect(service.verifyBookAccess(1487, { id: 23, contentFilters: null } as never)).resolves.toBeUndefined();
    expect(libraryService.verifyUserAccess).toHaveBeenCalledWith(23, 7, false);
  });

  it('does not swallow errors that are not a forbidden access', async () => {
    const boom = new Error('database is on fire');
    const { service } = build(7, boom);
    await expect(service.verifyBookAccess(1487, { id: 23, contentFilters: null } as never)).rejects.toBe(boom);
  });
});
