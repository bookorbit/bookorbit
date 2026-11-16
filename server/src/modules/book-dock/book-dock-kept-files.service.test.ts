import { mkdtemp, rm, stat, unlink, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import type { BookDockKeptFileRow, NewBookDockKeptFileRow } from '../../db/schema';
import { BookDockKeptFilesService } from './book-dock-kept-files.service';

const GLOBAL = { unsortedKeepOriginal: false } as Record<string, unknown>;

function makeService(options: { unsortedKeepOriginal?: boolean; docks?: Array<Record<string, unknown>> } = {}) {
  let kept: BookDockKeptFileRow[] = [];
  const keptRepo = {
    findByPaths: vi.fn((paths: string[]) => Promise.resolve(kept.filter((entry) => paths.includes(entry.absolutePath)))),
    upsert: vi.fn((entries: NewBookDockKeptFileRow[]) => {
      for (const entry of entries) {
        kept = kept.filter((existing) => existing.absolutePath !== entry.absolutePath);
        kept.push({ id: kept.length + 100, createdAt: new Date(), dockId: null, bookId: null, ignored: false, ...entry });
      }
      return Promise.resolve();
    }),
    deleteByIds: vi.fn((ids: number[]) => {
      kept = kept.filter((entry) => !ids.includes(entry.id));
      return Promise.resolve();
    }),
    deleteAtOrUnder: vi.fn().mockResolvedValue(0),
    findPage: vi.fn((afterId: number | undefined, limit: number) =>
      Promise.resolve(
        [...kept]
          .sort((a, b) => a.id - b.id)
          .filter((entry) => afterId === undefined || entry.id > afterId)
          .slice(0, limit),
      ),
    ),
    countByDock: vi.fn().mockResolvedValue(new Map()),
  };
  const repo = { findUnitFiles: vi.fn().mockResolvedValue([]) };
  const appSettings = {
    getBookDockSettings: vi.fn().mockResolvedValue({ ...GLOBAL, unsortedKeepOriginal: options.unsortedKeepOriginal ?? false }),
  };
  const docks = options.docks ?? [];
  const registry = { findById: vi.fn((id: number) => Promise.resolve(docks.find((dock) => dock.id === id))) };
  const service = new BookDockKeptFilesService(keptRepo as never, repo as never, appSettings as never, registry as never);
  return { service, keptRepo, repo, appSettings, registry, kept: () => kept, seed: (rows: BookDockKeptFileRow[]) => (kept = rows) };
}

const dock = (id: number, keepOriginal: boolean) => ({
  id,
  keepOriginal,
  autoJoin: false,
  autoFetchMetadata: null,
  autoFinalizeEnabled: null,
  autoFinalizeThreshold: null,
  autoFinalizeMetadataMode: null,
});

describe('BookDockKeptFilesService', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'book-dock-kept-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function put(name: string, content = 'seeding bytes'): Promise<string> {
    const path = join(root, name);
    await writeFile(path, content);
    return path;
  }

  describe('which rows keep their originals (D33)', () => {
    it("follows each dock's own toggle and Unsorted's global one, reading the settings once", async () => {
      const { service, appSettings } = makeService({ unsortedKeepOriginal: true, docks: [dock(11, true), dock(12, false)] });

      const keeps = await service.keepOriginalCheck();

      await expect(keeps({ dockId: 11, autoFinalizeSuppressed: false, uploadedBy: null })).resolves.toBe(true);
      await expect(keeps({ dockId: 12, autoFinalizeSuppressed: false, uploadedBy: null })).resolves.toBe(false);
      await expect(keeps({ dockId: null, autoFinalizeSuppressed: false, uploadedBy: null })).resolves.toBe(true);
      expect(appSettings.getBookDockSettings).toHaveBeenCalledTimes(1);
    });

    it('never keeps the dock copy of a request import, which is only a staging link', async () => {
      const { service } = makeService({ unsortedKeepOriginal: true });

      await expect(service.keepsOriginals({ dockId: null, autoFinalizeSuppressed: true, uploadedBy: null })).resolves.toBe(false);
    });

    it('never keeps an upload, which nothing is seeding', async () => {
      const { service } = makeService({ unsortedKeepOriginal: true, docks: [dock(11, true)] });

      await expect(service.keepsOriginals({ dockId: 11, autoFinalizeSuppressed: false, uploadedBy: 7 })).resolves.toBe(false);
      await expect(service.keepsOriginals({ dockId: null, autoFinalizeSuppressed: false, uploadedBy: 7 })).resolves.toBe(false);
    });
  });

  describe('remembering what stays behind', () => {
    it('remembers every file of a unit with its size and whole-millisecond time, as filed into the book', async () => {
      const { service, repo, kept } = makeService();
      const tracks = [await put('01.mp3', 'one'), await put('02.mp3', 'track two')];
      repo.findUnitFiles.mockResolvedValue(tracks.map((absolutePath) => ({ absolutePath })));

      await service.remember({ id: 1, absolutePath: tracks[0]!, dockId: 11 }, { bookId: 42 });

      expect(kept()).toEqual([
        expect.objectContaining({ absolutePath: tracks[0], fileSize: 3, dockId: 11, bookId: 42, ignored: false }),
        expect.objectContaining({ absolutePath: tracks[1], fileSize: 9, dockId: 11, bookId: 42, ignored: false }),
      ]);
      expect(Number.isInteger(kept()[0]!.mtimeMs)).toBe(true);
    });

    it('remembers a discarded single file as ignored, and nothing that is already gone', async () => {
      const { service, kept } = makeService();
      const path = await put('book.epub');

      await service.remember({ id: 1, absolutePath: path, dockId: null }, { discarded: true });
      await service.remember({ id: 2, absolutePath: join(root, 'missing.epub'), dockId: null }, { discarded: true });

      expect(kept()).toEqual([expect.objectContaining({ absolutePath: path, bookId: null, ignored: true })]);
    });
  });

  describe('skipping unchanged files (D36)', () => {
    it('reports an unchanged file as kept, and forgets one whose size, time or existence changed', async () => {
      const { service, kept } = makeService();
      const same = await put('same.epub');
      const grown = await put('grown.epub');
      const touched = await put('touched.epub');
      const gone = await put('gone.epub');
      for (const path of [same, grown, touched, gone]) await service.remember({ id: 1, absolutePath: path, dockId: null }, { bookId: 1 });

      await writeFile(grown, 'a longer file than before');
      const later = new Date((await stat(touched)).mtimeMs + 60_000);
      await utimes(touched, later, later);
      await unlink(gone);

      const unchanged = await service.unchangedKept([same, grown, touched, gone, join(root, 'never-kept.epub')]);

      expect([...unchanged]).toEqual([same]);
      expect(kept().map((entry) => entry.absolutePath)).toEqual([same]);
    });

    it('asks nothing for no paths', async () => {
      const { service, keptRepo } = makeService();

      await expect(service.unchangedKept([])).resolves.toEqual(new Set());
      expect(keptRepo.findByPaths).not.toHaveBeenCalled();
    });
  });

  describe('forgetting', () => {
    it('forgets a deleted file or folder by path', async () => {
      const { service, keptRepo } = makeService();

      await service.forget('/dock/_libraries/Fiction/Dune');

      expect(keptRepo.deleteAtOrUnder).toHaveBeenCalledWith('/dock/_libraries/Fiction/Dune');
    });

    it('prunes every entry whose file is gone, a page at a time', async () => {
      const { service, keptRepo, kept, seed } = makeService();
      const present = await put('present.epub');
      seed(
        Array.from({ length: 1201 }, (_, index) => ({
          id: index + 1,
          absolutePath: index === 600 ? present : join(root, `gone-${index}.epub`),
          fileSize: 1,
          mtimeMs: 1,
          dockId: null,
          bookId: null,
          ignored: false,
          createdAt: new Date(),
        })),
      );

      await expect(service.prune()).resolves.toBe(1200);

      expect(kept().map((entry) => entry.absolutePath)).toEqual([present]);
      expect(keptRepo.findPage.mock.calls.map(([afterId]) => afterId)).toEqual([undefined, 500, 1000, 1201]);
    });
  });
});
