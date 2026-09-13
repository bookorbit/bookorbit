import { ConflictException } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoverSweepStore } from './cover-sweep.store';
import { MissingResourcesService } from './missing-resources.service';

const user = { id: 7, isSuperuser: true } as never;

const SWEEP_SETTLE_TIMEOUT_MS = 10_000;

describe('MissingResourcesService', () => {
  let appDataPath: string;
  let coversRoot: string;
  let store: CoverSweepStore;

  beforeEach(async () => {
    appDataPath = await mkdtemp(join(tmpdir(), 'bookorbit-maintenance-'));
    coversRoot = join(appDataPath, 'covers');
    await mkdir(coversRoot, { recursive: true });
    store = new CoverSweepStore();
  });

  afterEach(async () => {
    await rm(appDataPath, { recursive: true, force: true });
  });

  async function makeCoverDir(bookId: number, files: Record<string, string>): Promise<void> {
    const dir = join(coversRoot, String(bookId));
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  }

  function setup(overrides: Partial<Record<string, unknown>> = {}) {
    const repo = {
      countMissingBooks: vi.fn().mockResolvedValue(0),
      findMissingBooks: vi.fn().mockResolvedValue([]),
      findMissingBookIds: vi.fn().mockResolvedValue([]),
      filterStillMissingBookIds: vi.fn().mockResolvedValue([]),
      countBooksWithCoverSource: vi.fn().mockResolvedValue(0),
      findBookIdsWithCoverSource: vi.fn().mockResolvedValue([]),
      findBrokenCoverEntries: vi.fn().mockResolvedValue([]),
      filterBookIdsWithCoverSource: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids)),
      clearCoverSource: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.length)),
      findExistingBookIds: vi.fn().mockResolvedValue([]),
      ...overrides,
    };
    const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue([1, 2]) };
    const bookService = { deleteBooks: vi.fn().mockImplementation((ids: number[]) => Promise.resolve({ total: ids.length, books: [], omitted: 0 })) };
    const config = { get: vi.fn().mockReturnValue(appDataPath) };
    const service = new MissingResourcesService(repo as never, store, libraryService as never, bookService as never, config as never);
    return { service, repo, libraryService, bookService };
  }

  async function runSweep(service: MissingResourcesService): Promise<void> {
    await service.startSweep(user);
    // The sweep runs detached over real filesystem I/O, so wait on the store rather than draining a
    // fixed number of turns: a loaded runner outlasts any turn budget, and giving up silently left
    // the sweep running into the next call, which failed as an unrelated "sweep is not complete".
    const deadline = Date.now() + SWEEP_SETTLE_TIMEOUT_MS;
    while (store.isRunning(user.id)) {
      if (Date.now() >= deadline) throw new Error(`cover sweep did not settle within ${SWEEP_SETTLE_TIMEOUT_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  describe('getSummary', () => {
    it('reports the missing book count scoped to accessible libraries', async () => {
      const { service, repo, libraryService } = setup({ countMissingBooks: vi.fn().mockResolvedValue(12) });

      expect(await service.getSummary(user)).toEqual({ missingBooks: 12, sweep: null });
      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
      expect(repo.countMissingBooks).toHaveBeenCalledWith([1, 2]);
    });
  });

  describe('startSweep', () => {
    it('rejects a second sweep while one is running', async () => {
      const { service } = setup();
      store.start(user.id, []);

      await expect(service.startSweep(user)).rejects.toBeInstanceOf(ConflictException);
    });

    it('flags books whose cover directory is absent or holds no servable cover', async () => {
      await makeCoverDir(2, { 'thumbnail.jpg': 'thumb' });
      await makeCoverDir(3, { 'cover_extracted.jpg': 'image' });
      const { service } = setup({
        countBooksWithCoverSource: vi.fn().mockResolvedValue(3),
        findBookIdsWithCoverSource: vi.fn().mockResolvedValueOnce([1, 2, 3]).mockResolvedValue([]),
      });

      await runSweep(service);

      const sweep = service.getSweep(user);
      expect(sweep).toMatchObject({ status: 'completed', processedBooks: 3, brokenCovers: 2, progressPercent: 100 });
      expect(store.get(user.id)?.brokenCoverBookIds.sort()).toEqual([1, 2]);
    });

    it('reports cover directories whose book is gone from the database', async () => {
      await makeCoverDir(41, { 'cover_custom.jpg': 'abcde' });
      await makeCoverDir(42, { 'cover_custom.jpg': 'xy' });
      const { service } = setup({ findExistingBookIds: vi.fn().mockResolvedValue([41]) });

      await runSweep(service);

      expect(store.get(user.id)?.orphanedCoverDirs).toEqual([{ bookId: 42, fileCount: 1, sizeBytes: 2 }]);
      expect(service.getSweep(user)).toMatchObject({ orphanedCoverDirs: 1, orphanedBytes: 2 });
    });

    it('records a failure when the sweep throws', async () => {
      const { service } = setup({ countBooksWithCoverSource: vi.fn().mockRejectedValue(new Error('db down')) });

      await runSweep(service);

      expect(service.getSweep(user)).toMatchObject({ status: 'failed', errorCode: 'cover_sweep_failed' });
    });
  });

  describe('listing', () => {
    it('requires a completed sweep before listing broken covers', async () => {
      const { service } = setup();
      await expect(service.listBrokenCovers(user, 1, 50)).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps missing book rows onto the wire shape', async () => {
      const updatedAt = new Date('2026-08-01T10:00:00.000Z');
      const { service } = setup({
        countMissingBooks: vi.fn().mockResolvedValue(1),
        findMissingBooks: vi.fn().mockResolvedValue([
          {
            id: 5,
            title: 'Gone',
            authors: ['Someone'],
            libraryId: 1,
            libraryName: 'Main',
            folderPath: '/library/gone',
            formats: ['epub'],
            updatedAt,
          },
        ]),
      });

      const page = await service.listMissingBooks(user, 1, 50);

      expect(page).toEqual({
        items: [
          {
            id: 5,
            title: 'Gone',
            authors: ['Someone'],
            libraryId: 1,
            libraryName: 'Main',
            folderPath: '/library/gone',
            formats: ['epub'],
            updatedAt: updatedAt.toISOString(),
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      });
    });
  });

  describe('cleanMissingBooks', () => {
    it('deletes only ids that are still missing', async () => {
      const { service, repo, bookService } = setup({
        filterStillMissingBookIds: vi.fn().mockResolvedValue([1, 3]),
        countMissingBooks: vi.fn().mockResolvedValue(4),
      });

      const result = await service.cleanMissingBooks(user, { bookIds: [1, 2, 3] });

      expect(repo.filterStillMissingBookIds).toHaveBeenCalledWith([1, 2, 3], [1, 2]);
      expect(bookService.deleteBooks).toHaveBeenCalledWith([1, 3], user);
      expect(result).toEqual({ category: 'missing_books', requested: 3, cleaned: 2, skipped: 1, remaining: 4 });
    });

    it('cleans a bounded pass when all is requested', async () => {
      const { service, repo, bookService } = setup({
        findMissingBookIds: vi.fn().mockResolvedValue([8, 9]),
        countMissingBooks: vi.fn().mockResolvedValue(0),
      });

      const result = await service.cleanMissingBooks(user, { all: true });

      expect(repo.findMissingBookIds).toHaveBeenCalledWith([1, 2], 0, 5000);
      expect(bookService.deleteBooks).toHaveBeenCalledWith([8, 9], user);
      expect(result).toMatchObject({ cleaned: 2, remaining: 0 });
    });

    it('rejects a request with neither ids nor all', async () => {
      const { service } = setup();
      await expect(service.cleanMissingBooks(user, {})).rejects.toThrow('Either bookIds or all must be provided');
    });
  });

  describe('cleanBrokenCovers', () => {
    it('clears only the books that are still missing a cover on disk', async () => {
      await makeCoverDir(2, { 'cover_extracted.jpg': 'image' });
      const { service, repo } = setup({
        countBooksWithCoverSource: vi.fn().mockResolvedValue(2),
        findBookIdsWithCoverSource: vi.fn().mockResolvedValueOnce([1, 2]).mockResolvedValue([]),
      });
      await runSweep(service);
      // Book 2 got its cover back between the sweep and the cleanup.
      store.get(user.id)!.brokenCoverBookIds = [1, 2];

      const result = await service.cleanBrokenCovers(user, { bookIds: [1, 2] });

      expect(repo.clearCoverSource).toHaveBeenCalledWith([1]);
      expect(result).toMatchObject({ category: 'broken_covers', requested: 2, cleaned: 1, skipped: 1 });
    });

    it('ignores ids the sweep never reported', async () => {
      const { service, repo } = setup();
      await runSweep(service);

      const result = await service.cleanBrokenCovers(user, { bookIds: [99] });

      expect(repo.filterBookIdsWithCoverSource).toHaveBeenCalledWith([], [1, 2]);
      expect(result).toMatchObject({ cleaned: 0, skipped: 1 });
    });
  });

  describe('cleanOrphanedCoverDirs', () => {
    it('removes the directory and drops it from the sweep', async () => {
      await makeCoverDir(42, { 'cover_custom.jpg': 'xy' });
      const { service } = setup();
      await runSweep(service);
      expect(store.get(user.id)?.orphanedCoverDirs).toHaveLength(1);

      const result = await service.cleanOrphanedCoverDirs(user, { bookIds: [42] });

      expect(result).toMatchObject({ category: 'orphaned_cover_dirs', cleaned: 1, remaining: 0 });
      expect(store.get(user.id)?.orphanedCoverDirs).toEqual([]);
      await expect(rm(join(coversRoot, '42'), { recursive: true })).rejects.toThrow();
    });

    it('leaves a directory alone when its book is back in the database', async () => {
      await makeCoverDir(42, { 'cover_custom.jpg': 'xy' });
      const { service, repo } = setup();
      await runSweep(service);
      repo.findExistingBookIds.mockResolvedValue([42]);

      const result = await service.cleanOrphanedCoverDirs(user, { bookIds: [42] });

      expect(result).toMatchObject({ cleaned: 0, skipped: 1 });
      expect(store.get(user.id)?.orphanedCoverDirs).toHaveLength(1);
    });
  });
});
