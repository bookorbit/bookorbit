import { Test, type TestingModule } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { watch } from 'chokidar';
import type { BookDockFileRow, BookDockKeptFileRow, NewBookDockFileRow, NewBookDockKeptFileRow, NewBookDockUnitFileRow } from '../../db/schema';
import { BookDockKeptFilesService } from './book-dock-kept-files.service';
import { BookDockWatcherService } from './book-dock-watcher.service';
import { BookDockIngestService } from './book-dock-ingest.service';
import { LibraryDockRegistry } from './library-dock-registry.service';
import type { LibraryDockWithLibrary } from './library-dock.repository';
import { waitForDirectoryStability } from '../../common/utils/fs-stability.utils';
import { UploadValidatorService } from '../upload/upload-validator.service';

vi.mock('../../common/utils/fs-stability.utils', () => ({
  waitForStability: vi.fn().mockResolvedValue(undefined),
  waitForDirectoryStability: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('chokidar', () => ({ watch: vi.fn() }));

type UnitFile = Omit<NewBookDockUnitFileRow, 'dockFileId'>;

function libraryDock(id: number, folderName: string, overrides: Partial<LibraryDockWithLibrary> = {}): LibraryDockWithLibrary {
  return {
    id,
    libraryId: id * 10,
    libraryName: folderName,
    folderName,
    enabled: true,
    targetFolderId: id * 100,
    autoFetchMetadata: null,
    autoFinalizeEnabled: null,
    autoFinalizeThreshold: null,
    autoFinalizeMetadataMode: null,
    autoJoin: false,
    keepOriginal: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Keep discovery, classification, grouping and persistence interactions real. Only the DB,
// external watcher and elapsed stability time are controlled by this test.
describe('Book Dock filesystem discovery', () => {
  let root: string;
  let module: TestingModule;
  let watcher: BookDockWatcherService;
  let rows: BookDockFileRow[];
  let members: Map<number, UnitFile[]>;
  let events: EventEmitter;
  let paused: boolean;
  let docks: LibraryDockWithLibrary[];
  let libraryFormats: Map<number, string[]>;
  let kept: BookDockKeptFileRow[];
  let keptFiles: BookDockKeptFilesService;

  async function put(path: string): Promise<string> {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, 'discovery fixture');
    return full;
  }

  function create(data: NewBookDockFileRow): BookDockFileRow {
    expect(rows.some((row) => row.absolutePath === data.absolutePath)).toBe(false);
    if (data.unitDirectory) expect(rows.some((row) => row.unitDirectory === data.unitDirectory)).toBe(false);
    const row = { id: rows.length + 1, unitDirectory: null, autoFinalizeSuppressed: false, ...data } as BookDockFileRow;
    rows.push(row);
    return row;
  }

  const paths = () => rows.map((row) => relative(root, row.absolutePath)).sort();
  const rowAt = (path: string) => rows.find((row) => row.absolutePath === join(root, path));
  const contentPaths = (id: number) =>
    (members.get(id) ?? []).filter((file) => file.role === 'content').map((file) => relative(root, file.absolutePath));

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), 'book-dock-discovery-'));
    // Canonical root spelling matters on platforms whose temp directory is a symlink.
    root = await realpath(root);
    rows = [];
    members = new Map();
    paused = false;
    docks = [libraryDock(1, 'Fiction'), libraryDock(2, 'Comics')];
    libraryFormats = new Map();
    kept = [];
    events = new EventEmitter();
    const close = vi.fn().mockResolvedValue(undefined);
    vi.mocked(watch).mockImplementation(() => {
      queueMicrotask(() => events.emit('ready'));
      return Object.assign(events, { close }) as unknown as ReturnType<typeof watch>;
    });
    const repo = {
      findByAbsolutePath: vi.fn((path: string) => Promise.resolve(rows.find((row) => row.absolutePath === path))),
      findByUnitDirectory: vi.fn((path: string) => Promise.resolve(rows.find((row) => row.unitDirectory === path))),
      deleteById: vi.fn((id: number) => {
        rows = rows.filter((row) => row.id !== id);
        return Promise.resolve();
      }),
      findLibraryFormats: vi.fn((libraryId: number) => {
        const dock = docks.find((candidate) => candidate.libraryId === libraryId);
        return Promise.resolve(dock ? { name: dock.libraryName, allowedFormats: libraryFormats.get(libraryId) ?? [] } : undefined);
      }),
      findClaimedPaths: vi.fn((inputs: string[]) => {
        const claimed = new Set([...rows.map((row) => row.absolutePath), ...[...members.values()].flat().map((file) => file.absolutePath)]);
        return Promise.resolve(new Set(inputs.filter((path) => claimed.has(path))));
      }),
      findUnitFiles: vi.fn((id: number) => Promise.resolve(members.get(id) ?? [])),
      create: vi.fn((data: NewBookDockFileRow) => Promise.resolve(create(data))),
      createUnit: vi.fn((data: NewBookDockFileRow, files: UnitFile[]) => {
        const existing = new Set([...members.values()].flat().map((file) => file.absolutePath));
        expect(files.some((file) => existing.has(file.absolutePath))).toBe(false);
        const row = create(data);
        members.set(row.id, files);
        return Promise.resolve(row);
      }),
    };
    const config = { get: (key: string) => (key === 'storage.bookDockPath' ? root : undefined) };
    // Discovery runs while the metadata queue remains paused to avoid unrelated provider work.
    const processing = { isPaused: () => Promise.resolve(paused), getCachedPaused: () => true };
    const gateway = { emitChanged: vi.fn() };
    const registry = new LibraryDockRegistry({ listAll: () => Promise.resolve(docks) } as never);
    const keptRepo = {
      findByPaths: (inputs: string[]) => Promise.resolve(kept.filter((entry) => inputs.includes(entry.absolutePath))),
      upsert: (entries: NewBookDockKeptFileRow[]) => {
        for (const entry of entries) {
          kept = kept.filter((existing) => existing.absolutePath !== entry.absolutePath);
          kept.push({ id: kept.length + 1, createdAt: new Date(), dockId: null, bookId: null, ignored: false, ...entry });
        }
        return Promise.resolve();
      },
      deleteByIds: (ids: number[]) => {
        kept = kept.filter((entry) => !ids.includes(entry.id));
        return Promise.resolve();
      },
      deleteAtOrUnder: (path: string) => {
        kept = kept.filter((entry) => entry.absolutePath !== path && !entry.absolutePath.startsWith(`${path}/`));
        return Promise.resolve(0);
      },
      findPage: (afterId: number | undefined, limit: number) =>
        Promise.resolve(kept.filter((entry) => afterId === undefined || entry.id > afterId).slice(0, limit)),
    };
    keptFiles = new BookDockKeptFilesService(
      keptRepo as never,
      repo as never,
      { getBookDockSettings: () => Promise.resolve({ unsortedKeepOriginal: true }) } as never,
      registry,
    );
    module = await Test.createTestingModule({
      providers: [
        {
          provide: BookDockIngestService,
          useFactory: () =>
            new BookDockIngestService(
              config as never,
              repo as never,
              new UploadValidatorService(),
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              {} as never,
              processing as never,
              gateway as never,
              registry,
              keptFiles,
            ),
        },
        {
          provide: BookDockWatcherService,
          inject: [BookDockIngestService],
          useFactory: (ingest: BookDockIngestService) =>
            new BookDockWatcherService(config as never, ingest, repo as never, gateway as never, processing as never, registry, keptFiles),
        },
      ],
    }).compile();
    watcher = module.get(BookDockWatcherService);
  });

  afterEach(async () => {
    await module?.close();
    await rm(root, { recursive: true, force: true });
    vi.mocked(waitForDirectoryStability).mockReset().mockResolvedValue(undefined);
  });

  it('rescans nested ebooks and audiobooks alongside root files, without duplicates', async () => {
    const expected = ['root.epub', 'ebooks/Author/Title/book.epub', 'audiobooks/Author/Title/book.m4b'];
    for (const path of expected) await put(path);
    await watcher.rescan();
    await watcher.rescan();
    expect(paths()).toEqual(expected.sort());
  });

  describe('files a keep-original dock left behind', () => {
    it('never takes a kept file in again while it is unchanged, and takes it in again once it changes', async () => {
      const path = await put('seeding.epub');
      await keptFiles.remember({ id: 900, absolutePath: path, dockId: null }, { bookId: 5 });

      await watcher.rescan();
      expect(paths()).toEqual([]);

      await writeFile(path, 'the download client replaced this file with a longer one');
      await watcher.rescan();
      expect(paths()).toEqual(['seeding.epub']);
      expect(kept).toEqual([]);
    });

    it('never finds a kept multi-track audiobook again, nor its loose sidecars', async () => {
      const tracks = [await put('Author/Title/01.mp3'), await put('Author/Title/02.mp3'), await put('Author/Title/cover.jpg')];
      members.set(
        901,
        tracks.map((absolutePath, sortOrder) => ({ absolutePath, fileName: absolutePath, fileSize: 17, format: null, role: 'content', sortOrder })),
      );
      await keptFiles.remember({ id: 901, absolutePath: tracks[0]!, dockId: null }, { discarded: true });
      members.delete(901);

      await watcher.rescan();

      expect(paths()).toEqual([]);
      expect(kept.map((entry) => entry.ignored)).toEqual([true, true, true]);

      // Without the records the same folder is one book again.
      kept = [];
      await watcher.rescan();
      expect(paths()).toEqual(['Author/Title/01.mp3']);
    });

    it('forgets a kept file once it is gone, on the next rescan', async () => {
      const path = await put('gone.epub');
      await keptFiles.remember({ id: 902, absolutePath: path, dockId: null }, { bookId: 5 });
      await unlink(path);

      await watcher.rescan();

      expect(kept).toEqual([]);
    });
  });

  it('skips AppleDouble files, recycle bins, sync version stores and NAS thumbnails', async () => {
    for (const path of [
      '._root.epub',
      '#recycle/deleted.epub',
      '.stversions/old.epub',
      '@eaDir/root.epub/SYNOFILE_THUMB_M.jpg',
      'Author/Title/@eaDir/book.epub/SYNOFILE_THUMB_M.jpg',
      'Author/Title/._book.epub',
    ]) {
      await put(path);
    }
    await put('root.epub');
    await put('Author/Title/book.epub');
    await watcher.rescan();
    expect(paths()).toEqual(['Author/Title/book.epub', 'root.epub']);
  });

  it('discovers nested books at startup and through debounced file events', async () => {
    await put('ebooks/Author/First/first.epub');
    await watcher.onApplicationBootstrap();
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Author/First/first.epub']);
    const second = await put('ebooks/Author/Second/second.epub');
    events.emit('all', 'add', second);
    await vi.waitFor(() => expect(paths()).toContain('ebooks/Author/Second/second.epub'), { timeout: 2500 });
  });

  it('groups nested multidisc tracks once and preserves covers and playback order', async () => {
    const book = 'audiobooks/Author/Title';
    for (const path of ['CD 1/01.mp3', 'CD 1/02.mp3', 'CD 2/01.mp3', 'cover.jpg']) await put(`${book}/${path}`);
    await watcher.rescan();
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(contentPaths(rows[0].id)).toEqual([`${book}/CD 1/01.mp3`, `${book}/CD 1/02.mp3`, `${book}/CD 2/01.mp3`]);
    expect(members.get(rows[0].id)?.map((file) => file.sortOrder)).toEqual([0, 1, 2, null]);
    expect(rows[0].unitDirectory).toBe(join(root, book));
  });

  it('discovers new siblings and nested books despite an existing watched directory claim', async () => {
    await put('ebooks/first.epub');
    await watcher.rescan();
    const originalId = rows[0].id;
    expect(rows[0].unitDirectory).toBe(join(root, 'ebooks'));
    await put('ebooks/second.epub');
    await put('ebooks/Author/third.epub');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Author/third.epub', 'ebooks/first.epub', 'ebooks/second.epub']);
    expect(rows.find((row) => row.id === originalId)?.unitDirectory).toBe(join(root, 'ebooks'));
    expect(rows.find((row) => row.fileName === 'second.epub')?.unitDirectory).toBeNull();
  });

  it('preserves stem-folded audio and discovers unrelated children of the same directory', async () => {
    for (const path of ['Title/book.epub', 'Title/book/01.mp3', 'Title/book/02.mp3', 'Title/book/Other/other.epub']) await put(path);
    await watcher.rescan();
    await watcher.rescan();
    expect(paths()).toEqual(['Title/book.epub', 'Title/book/01.mp3', 'Title/book/Other/other.epub']);
    const audio = rows.find((row) => row.format === 'mp3')!;
    expect(contentPaths(audio.id)).toEqual(['Title/book/01.mp3', 'Title/book/02.mp3']);
  });

  it('keeps comic issues separate and alternative ebook formats together', async () => {
    for (const path of ['comics/Series/Issue 001.cbz', 'comics/Series/Issue 002.cbz', 'ebooks/Title/book.epub', 'ebooks/Title/book.mobi'])
      await put(path);
    await watcher.rescan();
    expect(rows).toHaveLength(3);
    const ebook = rows.find((row) => row.format === 'epub')!;
    expect(contentPaths(ebook.id)).toEqual(['ebooks/Title/book.epub', 'ebooks/Title/book.mobi']);
  });

  it('does not descend into request-import claims or capture partial request files', async () => {
    const path = await put('request-book/CD 1/01.mp3');
    create({ fileName: '01.mp3', absolutePath: path, unitDirectory: join(root, 'request-book'), autoFinalizeSuppressed: true });
    await put('request-book/CD 2/01.mp3');
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(waitForDirectoryStability).not.toHaveBeenCalled();
  });

  it('rechecks a request claim acquired while waiting for stability', async () => {
    const path = await put('request-book/CD 1/01.mp3');
    await put('request-book/CD 2/01.mp3');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(() => {
      create({ fileName: '01.mp3', absolutePath: path, unitDirectory: join(root, 'request-book'), autoFinalizeSuppressed: true });
      return Promise.resolve();
    });
    await watcher.rescan();
    expect(rows).toHaveLength(1);
    expect(members.size).toBe(0);
  });

  it('rereads a growing audiobook after settling and serializes concurrent rescans', async () => {
    await put('Audio/01.mp3');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(async () => {
      await put('Audio/02.mp3');
    });
    await Promise.all([watcher.rescan(), watcher.rescan()]);
    expect(rows).toHaveLength(1);
    expect(contentPaths(rows[0].id)).toEqual(['Audio/01.mp3', 'Audio/02.mp3']);
  });

  it('stops before ingestion when paused during settling and recovers on rescan', async () => {
    await put('ebooks/Title/book.epub');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(() => {
      paused = true;
      return Promise.resolve();
    });
    await watcher.rescan();
    expect(rows).toHaveLength(0);
    paused = false;
    await watcher.rescan();
    expect(rows).toHaveLength(1);
  });

  it('stops between book folders during shutdown and permits a later manual rescan', async () => {
    await put('First/book.epub');
    await put('Second/book.epub');
    let release!: () => void;
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const scanning = watcher.rescan();
    await vi.waitFor(() => expect(waitForDirectoryStability).toHaveBeenCalledTimes(1));
    const stopping = watcher.onModuleDestroy();
    release();
    await Promise.all([scanning, stopping]);
    expect(rows).toHaveLength(1);
    await watcher.rescan();
    expect(rows).toHaveLength(2);
  });

  it('retains events arriving during discovery without creating duplicate rows', async () => {
    await watcher.onApplicationBootstrap();
    await watcher.rescan();
    const first = await put('ebooks/first.epub');
    vi.mocked(waitForDirectoryStability).mockImplementationOnce(async () => {
      const second = await put('ebooks/Author/second.epub');
      events.emit('all', 'add', second);
    });
    events.emit('all', 'add', first);
    await watcher.rescan();
    await vi.waitFor(() => expect(paths()).toEqual(['ebooks/Author/second.epub', 'ebooks/first.epub']), { timeout: 2500 });
    await watcher.rescan();
    expect(rows).toHaveLength(2);
  });

  it('applies the release limit per folder, not to the entire category tree', async () => {
    const books = Array.from({ length: 2002 }, (_, index) => `ebooks/Author-${index % 2}/Book-${index}.epub`);
    for (let offset = 0; offset < books.length; offset += 50) {
      await Promise.all(books.slice(offset, offset + 50).map(put));
    }
    await watcher.rescan();
    expect(paths()).toEqual(books.sort());
  });

  it('refuses an oversized audiobook without importing its discs as partial books', async () => {
    const tracks = Array.from({ length: 2001 }, (_, index) => `Audio/CD 1/${index}.mp3`);
    for (let offset = 0; offset < tracks.length; offset += 50) {
      await Promise.all(tracks.slice(offset, offset + 50).map(put));
    }
    await put('ebooks/Title/book.epub');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/Title/book.epub']);
  });

  describe('library docks', () => {
    const destination = (path: string) => {
      const row = rowAt(path);
      return row && { dockId: row.dockId, targetLibraryId: row.targetLibraryId, targetFolderId: row.targetFolderId, holdReason: row.holdReason };
    };

    it('files a loose ebook, a book folder and a multi-disc audiobook dropped in a dock under its library', async () => {
      await put('_libraries/Fiction/Dune.epub');
      await put('_libraries/Fiction/Hyperion/Hyperion.epub');
      for (const track of ['CD 1/01.mp3', 'CD 1/02.mp3', 'CD 2/01.mp3']) await put(`_libraries/Fiction/Foundation/${track}`);
      await put('Unsorted.epub');
      await watcher.rescan();
      await watcher.rescan();

      const fiction = { dockId: 1, targetLibraryId: 10, targetFolderId: 100, holdReason: undefined };
      expect(rows).toHaveLength(4);
      expect(destination('_libraries/Fiction/Dune.epub')).toEqual(fiction);
      expect(destination('_libraries/Fiction/Hyperion/Hyperion.epub')).toEqual(fiction);
      expect(destination('_libraries/Fiction/Foundation/CD 1/01.mp3')).toEqual(fiction);
      expect(contentPaths(rowAt('_libraries/Fiction/Foundation/CD 1/01.mp3')!.id)).toHaveLength(3);
      expect(rowAt('_libraries/Fiction/Foundation/CD 1/01.mp3')!.unitDirectory).toBe(join(root, '_libraries/Fiction/Foundation'));
      expect(rowAt('Unsorted.epub')).not.toHaveProperty('dockId');
    });

    it('takes nothing from loose files in _libraries, folders no dock owns, or a dock that is off', async () => {
      docks[1] = libraryDock(2, 'Comics', { enabled: false });
      await put('_libraries/stray.epub');
      await put('_libraries/Unknown/Dune.epub');
      await put('_libraries/Comics/Saga 001.cbz');
      await watcher.rescan();
      expect(rows).toHaveLength(0);
    });

    it('finds a dock folder whatever its case', async () => {
      await put('_Libraries/FICTION/Dune.epub');
      await watcher.rescan();
      expect(rows[0]).toMatchObject({ dockId: 1, targetLibraryId: 10 });
    });

    it('skips junk left inside a dock', async () => {
      for (const path of ['._Dune.epub', '@eaDir/Dune.epub/SYNOFILE_THUMB_M.jpg', '#recycle/old.epub', 'Dune.epub'])
        await put(`_libraries/Fiction/${path}`);
      await watcher.rescan();
      expect(paths()).toEqual(['_libraries/Fiction/Dune.epub']);
    });

    it('takes a covers folder inside a dock as books', async () => {
      await put('_libraries/Fiction/covers/Dune.epub');
      await watcher.rescan();
      expect(paths()).toEqual(['_libraries/Fiction/covers/Dune.epub']);
    });

    it('holds a format the library does not take, and a file whose dock has no folder', async () => {
      libraryFormats.set(10, ['epub']);
      docks[1] = libraryDock(2, 'Comics', { targetFolderId: null });
      await put('_libraries/Fiction/Saga 001.cbz');
      await put('_libraries/Comics/Saga 002.cbz');
      await watcher.rescan();
      expect(rowAt('_libraries/Fiction/Saga 001.cbz')).toMatchObject({
        dockId: 1,
        holdReason: 'not_allowed_in_library',
        holdDetail: { libraryId: 10, libraryName: 'Fiction' },
      });
      expect(rowAt('_libraries/Comics/Saga 002.cbz')).toMatchObject({ dockId: 2, targetFolderId: null, holdReason: 'no_folder' });
    });

    it('never changes a destination someone set when the dock is scanned again', async () => {
      await put('_libraries/Fiction/Dune.epub');
      await watcher.rescan();
      Object.assign(rows[0], { targetLibraryId: 99, targetFolderId: 999 });
      await watcher.rescan();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ dockId: 1, targetLibraryId: 99, targetFolderId: 999 });
    });

    it('treats a file moved from one dock folder to another as a new arrival', async () => {
      await watcher.onApplicationBootstrap();
      const from = await put('_libraries/Fiction/Saga.cbz');
      await watcher.rescan();
      expect(rows[0]).toMatchObject({ dockId: 1 });
      const to = join(root, '_libraries/Comics/Saga.cbz');
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      events.emit('all', 'unlink', from);
      events.emit('all', 'add', to);
      await vi.waitFor(() => expect(paths()).toEqual(['_libraries/Comics/Saga.cbz']), { timeout: 2500 });
      expect(rows[0]).toMatchObject({ dockId: 2, targetLibraryId: 20 });
    });

    it('picks up a dock folder that appears whole', async () => {
      await watcher.onApplicationBootstrap();
      await put('_libraries/Fiction/Dune/Dune.epub');
      await put('_libraries/Fiction/Hyperion.epub');
      events.emit('all', 'addDir', join(root, '_libraries/Fiction'));
      await vi.waitFor(() => expect(paths()).toEqual(['_libraries/Fiction/Dune/Dune.epub', '_libraries/Fiction/Hyperion.epub']), { timeout: 2500 });
      expect(rows.every((row) => row.dockId === 1)).toBe(true);
    });

    it('leaves a _libraries folder an older version took in as a book where it was', async () => {
      const old = await put('_libraries/old.epub');
      create({ fileName: 'old.epub', absolutePath: old, unitDirectory: join(root, '_libraries') });
      await put('_libraries/Fiction/Dune.epub');
      await watcher.rescan();
      expect(paths()).toEqual(['_libraries/Fiction/Dune.epub', '_libraries/old.epub']);
      expect(rowAt('_libraries/Fiction/Dune.epub')).not.toHaveProperty('dockId');
    });
  });

  it('skips internal covers and symlinked trees but allows a nested book named covers', async () => {
    await put('covers/ignored.epub');
    await put('ebooks/covers/book.epub');
    await symlink(join(root, 'ebooks'), join(root, 'linked'), 'dir');
    await symlink(root, join(root, 'ebooks', 'loop'), 'dir');
    await watcher.rescan();
    expect(paths()).toEqual(['ebooks/covers/book.epub']);
  });
});
